#if os(iOS)
import Foundation
import SAMKit
import WatchConnectivity

/// The iPhone half of the Apple Watch app. The watch never holds a session token: it asks
/// through this link and the phone answers with its own pairing (or Apple Intelligence
/// on-device when the Mac is out of reach). Yard status goes the other way as application
/// context, so the watch face is current even when the phone app isn't open.
final class PhoneLink: NSObject, WCSessionDelegate, @unchecked Sendable {
    static let shared = PhoneLink()

    func start() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Called whenever the shared snapshot changes.
    func push(_ snapshot: SharedSnapshot) {
        guard WCSession.default.activationState == .activated, WCSession.default.isWatchAppInstalled,
              let data = try? JSONEncoder().encode(snapshot) else { return }
        try? WCSession.default.updateApplicationContext(["snapshot": data])
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        guard let question = message["ask"] as? String, !question.isEmpty else {
            replyHandler(["error": "Nothing to ask."])
            return
        }
        Task {
            do {
                // The Watch skips Face ID; with the app lock on, its question goes as untrusted.
                let text = try await AskSAMIntent.ask(question, untrusted: UserDefaults.standard.bool(forKey: "sam.lock"))
                var snap = SharedSnapshot.load()
                snap.lastReply = String(text.prefix(280))
                snap.updated = .now
                snap.save()
                replyHandler(["text": text])
            } catch {
                replyHandler(["error": error.localizedDescription])
            }
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        if state == .activated { push(SharedSnapshot.load()) }
    }
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }
}
#endif
