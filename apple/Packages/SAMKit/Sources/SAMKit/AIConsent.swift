import Foundation

/// GET /api/ai/providers: which third parties the person's Mac may send a chat to.
public struct AIProviders: Codable, Equatable, Sendable {
    public struct Provider: Codable, Equatable, Hashable, Identifiable, Sendable {
        public let id: String
        public let name: String
        public let company: String?
        public let privacy: String?
        public let free: Bool?

        public init(id: String, name: String, company: String?, privacy: String?, free: Bool?) {
            self.id = id; self.name = name; self.company = company; self.privacy = privacy; self.free = free
        }
    }
    public let onDevice: Bool
    public let cloud: [Provider]
    public let keyless: [Provider]

    public init(onDevice: Bool, cloud: [Provider], keyless: [Provider]) {
        self.onDevice = onDevice
        self.cloud = cloud
        self.keyless = keyless
    }

    /// Everyone who could receive a message. Empty means the Mac answers locally.
    public var thirdParties: [Provider] { cloud + keyless }
    public var ids: Set<String> { Set(thirdParties.map(\.id)) }
}

extension BrainClient {
    public func aiProviders() async throws -> AIProviders { try await get("/api/ai/providers") }
}

/// App Review 5.1.2(i): name the third-party AI providers and get explicit permission before a
/// chat goes to them (via the person's Mac). The decision is stored with the exact provider set
/// that was shown, so a new provider on the Mac asks again rather than riding on old consent.
/// Lives in the app group so Siri, the Share and Safari extensions and the Watch follow it.
public enum AIConsent {
    public enum State: Equatable, Sendable {
        case allowed           // this provider set was approved
        case declined          // "Not now": answer on-device only
        case undecided         // never asked, or the provider set changed
    }

    static let allowedKey = "sam.aiConsent.allowedIDs"
    static let declinedKey = "sam.aiConsent.declined"
    public static var defaults: UserDefaults { UserDefaults(suiteName: SharedSnapshot.appGroup) ?? .standard }

    public static func state(for providers: AIProviders, defaults: UserDefaults = defaults) -> State {
        if providers.thirdParties.isEmpty { return .allowed }          // nothing leaves the Mac
        if defaults.bool(forKey: declinedKey) { return .declined }
        let approved = Set(defaults.stringArray(forKey: allowedKey) ?? [])
        return providers.ids.isSubset(of: approved) ? .allowed : .undecided
    }

    public static func allow(_ providers: AIProviders, defaults: UserDefaults = defaults) {
        defaults.set(Array(providers.ids).sorted(), forKey: allowedKey)
        defaults.set(false, forKey: declinedKey)
    }

    public static func decline(defaults: UserDefaults = defaults) {
        defaults.set(true, forKey: declinedKey)
        defaults.removeObject(forKey: allowedKey)
    }

    /// Settings → Privacy → "Ask me again".
    public static func reset(defaults: UserDefaults = defaults) {
        defaults.removeObject(forKey: allowedKey)
        defaults.removeObject(forKey: declinedKey)
    }

    /// For surfaces that can't show a sheet (Siri, the Watch, Share, Safari): true only when the
    /// person approved every provider the Mac uses *now*. A new provider, no answer yet, or a Mac
    /// that can't list its providers all count as no, so the app asks first.
    public static func allowsCurrentProviders(_ brain: BrainClient, defaults: UserDefaults = defaults) async -> Bool {
        guard let providers = try? await brain.aiProviders() else { return false }
        return state(for: providers, defaults: defaults) == .allowed
    }
}
