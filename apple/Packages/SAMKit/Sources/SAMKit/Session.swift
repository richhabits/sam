import Foundation

/// Where this device's pairing lives, shared by the app and its extensions
/// (Safari, widgets, share sheet):
/// - host in the app group's defaults (not secret),
/// - token in the Keychain, in the shared access group when the target has one.
public enum Session {
    static let hostKey = "sam.host"
    static let tokenAccount = "token"

    static var defaults: UserDefaults { UserDefaults(suiteName: SharedSnapshot.appGroup) ?? .standard }

    public static var host: String? {
        // Older builds kept the host in standard defaults; carry it over once.
        if let h = defaults.string(forKey: hostKey) { return h }
        if let old = UserDefaults.standard.string(forKey: hostKey) {
            defaults.set(old, forKey: hostKey)
            return old
        }
        return nil
    }

    public static var token: String? { Keychain.get(tokenAccount) }

    /// Nil when this device isn't paired.
    public static var brain: BrainClient? {
        guard let host, let token else { return nil }
        return BrainClient(host: host, token: token)
    }

    /// Returns false if the Keychain refused the token.
    @discardableResult
    public static func save(host: String?, token: String?) -> Bool {
        defaults.set(host, forKey: hostKey)
        UserDefaults.standard.removeObject(forKey: hostKey)
        return Keychain.set(token, for: tokenAccount)
    }

    /// Streams one question and returns the whole answer. For extensions and intents that
    /// can't show tokens as they arrive.
    public static func ask(_ question: String, brain: BrainClient, untrusted: Bool = false) async throws -> (text: String, provider: String?, needsApproval: String?) {
        var text = ""
        var provider: String?
        for try await event in brain.stream(message: question, history: [], untrusted: untrusted) {
            switch event {
            case .token(let t): text += t
            case .done(let final, let p):
                if let final, !final.isEmpty { text = final }
                provider = p
            case .pending(_, let tool, _, _): return (text, provider, tool)
            default: break
            }
        }
        return (text, provider, nil)
    }
}
