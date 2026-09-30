import Foundation

/// One turn of conversation, as /api/stream's `history` expects it.
public struct Turn: Codable, Equatable, Sendable {
    public enum Role: String, Codable, Sendable { case user, assistant }
    public var role: Role
    public var content: String
    public init(role: Role, content: String) {
        self.role = role
        self.content = content
    }
}

/// A yard job (server/yard/store.ts `Job`). Times are epoch milliseconds.
public struct YardJob: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let kind: String
    public let state: String
    public let attempts: Int?
    public let createdAt: Double
    public let startedAt: Double?
    public let finishedAt: Double?
    public let costTokens: Int?
    public let costBudget: Int?
    public let lastError: String?
    public let failureKind: String?
    public let project: String?
    public let tier: String?

    public var created: Date { Date(timeIntervalSince1970: createdAt / 1000) }
    public var finished: Date? { finishedAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
    public var isActive: Bool { state == "queued" || state == "running" }
    /// "project.deploy" → "Project deploy"
    public var title: String {
        let words = kind.replacingOccurrences(of: ".", with: " ").replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}

/// GET /api/yard.
public struct YardSummary: Codable, Equatable, Sendable {
    public struct Worker: Codable, Equatable, Sendable { public let up: Bool? }
    public let on: Bool?
    public let unavailable: Bool?
    public let error: String?
    public let worker: Worker?
    public let queued: Int
    public let running: Int
    public let done: Int
    public let failed: Int
    public let cancelled: Int
    public let recent: [YardJob]?

    public init(queued: Int = 0, running: Int = 0, done: Int = 0, failed: Int = 0, cancelled: Int = 0, recent: [YardJob] = []) {
        self.on = true; self.unavailable = nil; self.error = nil; self.worker = nil
        self.queued = queued; self.running = running; self.done = done
        self.failed = failed; self.cancelled = cancelled; self.recent = recent
    }
}

/// GET /api/tools entry.
public struct ToolInfo: Codable, Identifiable, Equatable, Sendable {
    public let name: String
    public let safe: Bool?
    public let tier: String?
    public let description: String?
    public var id: String { name }
}

/// GET /api/agents → specialists.
public struct Specialist: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let emoji: String?
    public let modeledOn: String?
    public let brief: String?
}

public struct AgentRoster: Codable, Sendable {
    public let specialists: [Specialist]
}

/// GET /api/vault/stats.
public struct VaultStats: Codable, Equatable, Sendable {
    public let projectNotes: Int?
    public let dailyNotes: Int?
}

/// POST /api/confirm reply.
public struct ConfirmOutcome: Codable, Sendable {
    public let kind: String?
    public let text: String?
}

/// POST /api/pair/new (loopback only).
public struct PairingBundle: Codable, Sendable {
    public let url: String
    public let code: String
    public let expiresInSec: Int?
    public let pin: String?
}
