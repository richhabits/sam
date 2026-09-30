import Foundation

public struct BrainError: LocalizedError, Equatable, Sendable {
    public let status: Int
    public let message: String
    public init(_ status: Int, _ message: String) {
        self.status = status
        self.message = message
    }
    public var errorDescription: String? { message }
    public static let notPaired = BrainError(401, "Not paired with a SAM yet.")
}

/// Talks to the SAM brain (the TypeScript server, default :8787) as a paired device:
/// `Authorization: Bearer <token>`, exactly like mobile/lib/api.ts.
public struct BrainClient: Sendable {
    public static let defaultPort = 8787
    public static let localHost = "http://127.0.0.1:\(defaultPort)"

    public let host: String
    public let token: String
    let session: URLSession

    public init(host: String, token: String, session: URLSession = .shared) {
        self.host = PairLink.normalizeHost(host)
        self.token = token
        self.session = session
    }

    // MARK: Pairing

    /// Exchange a one-time code for a session token (POST /api/pair/claim).
    public static func claim(host: String, code: String, client: String, session: URLSession = .shared) async throws -> String {
        let base = PairLink.normalizeHost(host)
        guard let url = URL(string: "\(base)/api/pair/claim") else { throw BrainError(0, "That address isn't valid.") }
        var req = URLRequest(url: url, timeoutInterval: 8)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(client, forHTTPHeaderField: "X-SAM-Client")
        req.httpBody = try JSONEncoder().encode(["code": code.trimmingCharacters(in: .whitespacesAndNewlines)])
        let (data, res) = try await transport(session, req)
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard (200..<300).contains(res), let token = body?["token"] as? String else {
            throw BrainError(res, body?["error"] as? String ?? "Pairing failed (\(res)).")
        }
        return token
    }

    /// On the Mac SAM runs on: mint a code over loopback (POST /api/pair/new) and claim it.
    /// The server only mints for loopback callers, so this can't pair anything remote.
    public static func pairThisMac(session: URLSession = .shared) async throws -> String {
        guard let url = URL(string: "\(localHost)/api/pair/new") else { throw BrainError(0, "bad url") }
        var req = URLRequest(url: url, timeoutInterval: 5)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, res) = try await transport(session, req)
        guard (200..<300).contains(res), let bundle = try? JSONDecoder().decode(PairingBundle.self, from: data) else {
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw BrainError(res, body?["error"] as? String ?? "SAM on this Mac wouldn't mint a pairing code (\(res)).")
        }
        return try await claim(host: localHost, code: bundle.code, client: "macos", session: session)
    }

    /// Unauthenticated liveness check (GET /api/health).
    public static func isUp(_ host: String, session: URLSession = .shared) async -> Bool {
        guard let url = URL(string: "\(PairLink.normalizeHost(host))/api/health") else { return false }
        guard let (_, res) = try? await transport(session, URLRequest(url: url, timeoutInterval: 3)) else { return false }
        return res == 200
    }

    // MARK: Reads

    public func yard() async throws -> YardSummary { try await get("/api/yard") }
    public func tools() async throws -> [ToolInfo] { try await get("/api/tools") }
    public func specialists() async throws -> [Specialist] { (try await get("/api/agents") as AgentRoster).specialists }
    public func vaultStats() async throws -> VaultStats { try await get("/api/vault/stats") }

    // MARK: Actions

    public func cancel(job id: String) async throws { _ = try await send("/api/yard/cancel", ["id": id]) }
    public func retry(job id: String) async throws { _ = try await send("/api/yard/retry", ["id": id]) }
    public func forget() async throws { _ = try await send("/api/pair/forget", [String: String]()) }

    /// Approve or refuse a paused tool call. Only the id travels; the server holds the rest.
    public func confirm(pendingId: String, approved: Bool, always: Bool = false) async throws -> String {
        struct Body: Encodable { let pendingId: String; let approved: Bool; let always: Bool }
        let data = try await send("/api/confirm", Body(pendingId: pendingId, approved: approved, always: always))
        return (try? JSONDecoder().decode(ConfirmOutcome.self, from: data))?.text ?? ""
    }

    // MARK: Chat

    /// POST /api/stream as parsed SSE events. Cancelling the consuming task cancels the request.
    public func stream(message: String, history: [Turn], tier: String? = nil) -> AsyncThrowingStream<StreamEvent, Error> {
        struct Body: Encodable { let message: String; let history: [Turn]; let tier: String? }
        let request: URLRequest
        do {
            var req = try makeRequest("/api/stream", method: "POST", timeout: 300)
            req.httpBody = try JSONEncoder().encode(Body(message: message, history: Array(history.suffix(10)), tier: tier))
            request = req
        } catch {
            return AsyncThrowingStream { $0.finish(throwing: error) }
        }
        let session = self.session
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard (200..<300).contains(status) else { throw BrainError(status, "SAM answered \(status).") }
                    var buffer = ""
                    var pending = Data()
                    for try await byte in bytes {
                        pending.append(byte)
                        // Only decode at a newline so a multi-byte character is never split.
                        guard byte == UInt8(ascii: "\n"), let chunk = String(data: pending, encoding: .utf8) else { continue }
                        pending.removeAll(keepingCapacity: true)
                        buffer += chunk
                        let (events, rest) = SSEParser.parse(buffer)
                        buffer = rest
                        for e in events { continuation.yield(e) }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: Plumbing

    func makeRequest(_ path: String, method: String = "GET", timeout: TimeInterval = 8) throws -> URLRequest {
        guard let url = URL(string: host + path) else { throw BrainError(0, "That address isn't valid.") }
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return req
    }

    func get<T: Decodable>(_ path: String) async throws -> T {
        let (data, status) = try await Self.transport(session, try makeRequest(path))
        try Self.check(status, data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    func send<B: Encodable>(_ path: String, _ body: B) async throws -> Data {
        var req = try makeRequest(path, method: "POST")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, status) = try await Self.transport(session, req)
        try Self.check(status, data)
        return data
    }

    static func check(_ status: Int, _ data: Data) throws {
        guard !(200..<300).contains(status) else { return }
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        throw BrainError(status, body?["error"] as? String ?? "Request failed (\(status)).")
    }

    static func transport(_ session: URLSession, _ req: URLRequest) async throws -> (Data, Int) {
        do {
            let (data, res) = try await session.data(for: req)
            return (data, (res as? HTTPURLResponse)?.statusCode ?? 0)
        } catch let e as URLError {
            throw BrainError(0, e.code == .timedOut ? "SAM didn't answer in time." : "Can't reach SAM: \(e.localizedDescription)")
        }
    }
}
