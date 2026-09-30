import AVFoundation
import Foundation
import LocalAuthentication
import Observation
import Speech
#if canImport(CoreSpotlight)
import CoreSpotlight
#endif
#if canImport(UIKit)
import UIKit
#endif

// MARK: Haptics

enum Haptics {
    static func send() { impact(.light) }
    static func success() { notify(.success) }
    static func attention() { notify(.warning) }

    #if os(iOS)
    private static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) { UIImpactFeedbackGenerator(style: style).impactOccurred() }
    private static func notify(_ type: UINotificationFeedbackGenerator.FeedbackType) { UINotificationFeedbackGenerator().notificationOccurred(type) }
    #else
    private enum Style { case light }
    private enum Kind { case success, warning }
    private static func impact(_: Style) {}
    private static func notify(_: Kind) {}
    #endif
}

// MARK: Voice out

/// Reads replies aloud with the system's best installed voice (Premium / Enhanced first).
@MainActor @Observable final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
    static let shared = Speaker()
    private let synth = AVSpeechSynthesizer()
    private(set) var speaking = false

    var readAloud: Bool = UserDefaults.standard.bool(forKey: "sam.readAloud") {
        didSet { UserDefaults.standard.set(readAloud, forKey: "sam.readAloud") }
    }

    override init() {
        super.init()
        synth.delegate = self
    }

    func speak(_ text: String) {
        stop()
        let plain = text.replacingOccurrences(of: #"[*_`#>\[\]]"#, with: "", options: .regularExpression)
        let u = AVSpeechUtterance(string: plain)
        u.voice = Self.bestVoice()
        #if os(iOS) || os(visionOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        #endif
        synth.speak(u)
        speaking = true
    }

    func stop() {
        synth.stopSpeaking(at: .immediate)
        speaking = false
    }

    static func bestVoice() -> AVSpeechSynthesisVoice? {
        let lang = AVSpeechSynthesisVoice.currentLanguageCode()
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == lang }
        return voices.first { $0.quality == .premium } ?? voices.first { $0.quality == .enhanced } ?? AVSpeechSynthesisVoice(language: lang)
    }

    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish _: AVSpeechUtterance) {
        Task { @MainActor in self.speaking = false }
    }
}

// MARK: Voice in

/// Live dictation with the Speech framework. Prefers on-device recognition so the audio
/// never leaves the device when the language supports it.
@MainActor @Observable final class Dictation {
    private(set) var listening = false
    private(set) var transcript = ""
    var error: String?

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer()

    func toggle() async {
        listening ? stop() : await start()
    }

    func start() async {
        error = nil
        transcript = ""
        let speechOK = await withCheckedContinuation { c in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
        }
        let micOK = await AVAudioApplication.requestRecordPermission()
        guard speechOK, micOK else { error = "Allow Microphone and Speech Recognition in Settings to talk to SAM."; return }
        guard let recognizer, recognizer.isAvailable else { error = "Dictation isn't available right now."; return }

        do {
            #if os(iOS) || os(visionOS)
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            #endif
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            req.addsPunctuation = true
            if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
            request = req

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
            engine.prepare()
            try engine.start()
            listening = true

            task = recognizer.recognitionTask(with: req) { [weak self] result, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let result { self.transcript = result.bestTranscription.formattedString }
                    if err != nil || result?.isFinal == true { self.stop() }
                }
            }
        } catch {
            self.error = error.localizedDescription
            stop()
        }
    }

    func stop() {
        guard listening || task != nil else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        listening = false
        #if os(iOS) || os(visionOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }
}

// MARK: Spotlight

/// SAM's answers are searchable from the Home Screen / Spotlight, on-device only.
enum Spotlight {
    static func index(_ message: Message) {
        #if canImport(CoreSpotlight)
        guard !message.text.isEmpty else { return }
        let attrs = CSSearchableItemAttributeSet(contentType: .text)
        attrs.title = message.conversation?.title ?? "SAM"
        attrs.contentDescription = String(message.text.prefix(300))
        attrs.textContent = message.text
        let item = CSSearchableItem(uniqueIdentifier: message.id.uuidString,
                                    domainIdentifier: message.conversation?.id.uuidString ?? "sam",
                                    attributeSet: attrs)
        CSSearchableIndex.default().indexSearchableItems([item])
        #endif
    }

    static func clear() {
        #if canImport(CoreSpotlight)
        CSSearchableIndex.default().deleteAllSearchableItems()
        #endif
    }
}

// MARK: App lock

/// Optional Face ID / Touch ID / Optic ID lock. SAM can run shell, files and email on the
/// Mac, so a borrowed unlocked phone shouldn't be enough to drive it.
@MainActor @Observable final class AppLock {
    static let shared = AppLock()
    var enabled: Bool = UserDefaults.standard.bool(forKey: "sam.lock") {
        didSet { UserDefaults.standard.set(enabled, forKey: "sam.lock"); if !enabled { locked = false } }
    }
    private(set) var locked: Bool

    init() { locked = UserDefaults.standard.bool(forKey: "sam.lock") }

    var biometryName: String {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
        switch ctx.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "Passcode"
        }
    }

    func lock() { if enabled { locked = true } }

    func unlock() async {
        guard locked else { return }
        let ctx = LAContext()
        let ok = (try? await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock SAM")) ?? false
        if ok { locked = false }
    }
}
