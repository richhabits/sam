import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Apple Intelligence on this device. Used when the Mac running SAM can't be reached, so SAM
/// still answers on a plane or on 5G, and nothing leaves the device while it does.
/// Replaces the React Native app's "direct to third-party providers" path, which needed a
/// 5.1.2(i) consent screen precisely because it sent messages off-device.
enum OnDeviceBrain {
    static var isAvailable: Bool {
        #if canImport(FoundationModels)
        if case .available = SystemLanguageModel.default.availability { return true }
        #endif
        return false
    }

    /// Why it isn't available, in plain words, or nil when it is.
    static var unavailableReason: String? {
        #if canImport(FoundationModels)
        switch SystemLanguageModel.default.availability {
        case .available: return nil
        case .unavailable(.deviceNotEligible): return "This device doesn't support Apple Intelligence."
        case .unavailable(.appleIntelligenceNotEnabled): return "Turn on Apple Intelligence in Settings to chat offline."
        case .unavailable(.modelNotReady): return "Apple Intelligence is still downloading."
        case .unavailable: return "Apple Intelligence isn't available right now."
        }
        #else
        return "Apple Intelligence isn't available on this device."
        #endif
    }

    static let instructions = """
    You are SAM, a warm, concise personal assistant. You are running on-device because the \
    person's Mac is out of reach, so you have no tools, files or web access right now. Say so \
    plainly if asked to do something that needs them. Never invent facts.
    """

    /// Streams cumulative text snapshots.
    static func stream(_ prompt: String, history: [(role: String, text: String)]) -> AsyncThrowingStream<String, Error> {
        #if canImport(FoundationModels)
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let context = history.suffix(6).map { "\($0.role == "user" ? "Person" : "SAM"): \($0.text)" }.joined(separator: "\n")
                    let session = LanguageModelSession(instructions: instructions)
                    let full = context.isEmpty ? prompt : "Conversation so far:\n\(context)\n\nPerson: \(prompt)"
                    for try await snapshot in session.streamResponse(to: full) {
                        continuation.yield(snapshot.content)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
        #else
        AsyncThrowingStream { $0.finish(throwing: CocoaError(.featureUnsupported)) }
        #endif
    }
}
