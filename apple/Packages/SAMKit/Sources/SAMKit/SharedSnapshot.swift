import Foundation

/// What the app last saw, written to the app group so widgets, controls and the Watch can
/// show it without ever holding the session token.
public struct SharedSnapshot: Codable, Equatable, Sendable {
    public var paired: Bool
    public var reachable: Bool
    public var queued: Int
    public var running: Int
    public var failed: Int
    public var latestJob: String?
    public var latestState: String?
    public var lastReply: String?
    public var updated: Date

    public init(paired: Bool = false, reachable: Bool = false, queued: Int = 0, running: Int = 0, failed: Int = 0,
                latestJob: String? = nil, latestState: String? = nil, lastReply: String? = nil, updated: Date = .now) {
        self.paired = paired; self.reachable = reachable
        self.queued = queued; self.running = running; self.failed = failed
        self.latestJob = latestJob; self.latestState = latestState
        self.lastReply = lastReply; self.updated = updated
    }

    /// iOS-family app group, or on the Mac the team-prefixed form. A sandboxed Mac app using a
    /// "group." identifier makes macOS ask "would like to access data from other apps" (and
    /// blocks until answered); "<TeamID>.<name>" is the Mac convention and never prompts.
    #if os(macOS)
    public static let appGroup = "CC9Q9BH5NT.com.hectic.sam"
    #else
    public static let appGroup = "group.com.hectic.sam.mobile"
    #endif
    static let key = "sam.snapshot.v1"

    public static func load(_ defaults: UserDefaults? = UserDefaults(suiteName: appGroup)) -> SharedSnapshot {
        guard let data = defaults?.data(forKey: key),
              let snap = try? JSONDecoder().decode(SharedSnapshot.self, from: data) else { return SharedSnapshot() }
        return snap
    }

    public func save(_ defaults: UserDefaults? = UserDefaults(suiteName: appGroup)) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        defaults?.set(data, forKey: Self.key)
    }
}
