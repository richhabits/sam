import Foundation

/// One frame from POST /api/stream. Mirrors mobile/lib/sse.ts's StreamEvent.
public enum StreamEvent: Equatable, Sendable {
    case route(tier: String?, klass: String?, reason: String?)
    case token(String)
    case done(text: String?, provider: String?)
    case end
    /// A risky tool call the brain paused on. The client approves by id only
    /// (see server/pending.ts); input never round-trips.
    case pending(id: String, tool: String, preview: String?, activity: String?)
    case other(type: String)
}

/// Pulls whole SSE frames out of a growing buffer.
///
/// Chunk boundaries land anywhere, mid-JSON or mid-frame, so anything not terminated by a
/// blank line stays in `rest`. Same contract as parseFrames() in mobile/lib/sse.ts.
public enum SSEParser {
    public static func parse(_ buffer: String) -> (events: [StreamEvent], rest: String) {
        var parts = buffer.components(separatedBy: "\n\n")
        let rest = parts.removeLast()
        var events: [StreamEvent] = []
        for frame in parts {
            for line in frame.split(separator: "\n", omittingEmptySubsequences: true) where line.hasPrefix("data:") {
                let raw = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                if raw.isEmpty || raw == "[DONE]" { continue }
                if let event = decode(raw) { events.append(event) }
            }
        }
        return (events, rest)
    }

    /// A frame that isn't JSON is a server bug, not a reason to break the chat, so it's dropped.
    static func decode(_ raw: String) -> StreamEvent? {
        guard let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return nil }
        switch type {
        case "route":
            return .route(tier: obj["tier"] as? String, klass: obj["klass"] as? String, reason: obj["reason"] as? String)
        case "token":
            guard let t = obj["t"] as? String else { return nil }
            return .token(t)
        case "done":
            return .done(text: obj["text"] as? String, provider: obj["provider"] as? String)
        case "end":
            return .end
        case "pending":
            guard let id = obj["pendingId"] as? String else { return nil }
            return .pending(id: id, tool: obj["tool"] as? String ?? "tool",
                            preview: obj["preview"] as? String, activity: obj["activity"] as? String)
        default:
            return .other(type: type)
        }
    }
}
