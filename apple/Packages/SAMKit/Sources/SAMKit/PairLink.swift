import Foundation

/// A pairing code, plus the SAM to send it to when the link names one.
/// Port of mobile/lib/pairlink.ts. Accepts:
///
///     sam://pair?code=<hex>&host=<url>    what a QR or Handoff link carries
///     http://<host>:<port>/pair?code=…    the exact link the server mints for browsers
///
/// Strict about the code (hex, bounded length) because it goes straight onto the wire.
public struct PairLink: Equatable, Sendable {
    public let code: String
    public let host: String?

    public init(code: String, host: String?) {
        self.code = code
        self.host = host
    }

    public static func parse(_ url: String?) -> PairLink? {
        let raw = (url ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let q = raw.firstIndex(of: "?") else { return nil }
        let before = String(raw[..<q])
        let query = String(raw[raw.index(after: q)...])

        let lower = before.lowercased()
        let isPairPath = lower == "sam://pair" || lower == "sam://pair/" || lower.hasSuffix("/pair") || lower.hasSuffix("/pair/")
        guard isPairPath else { return nil }

        let code = param(query, "code")
        guard isCode(code) else { return nil }

        var host: String?
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            let trimmed = before.hasSuffix("/") ? String(before.dropLast()) : before
            let base = String(trimmed.dropLast("/pair".count))
            // Only scheme://authority, nothing path-like, same as the TS regex.
            if let schemeEnd = base.range(of: "://"), !base[schemeEnd.upperBound...].contains("/"), !base[schemeEnd.upperBound...].isEmpty {
                host = base
            }
        } else {
            let explicit = param(query, "host")
            if let r = explicit.range(of: "://"),
               ["http", "https"].contains(explicit[..<r.lowerBound].lowercased()) {
                let authority = explicit[r.upperBound...].replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
                if !authority.isEmpty, !authority.contains("/"), !authority.contains(where: \.isWhitespace) {
                    host = explicit.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
                }
            }
        }
        return PairLink(code: code, host: host)
    }

    /// 16–64 hex characters, the shape SAM mints.
    public static func isCode(_ s: String) -> Bool {
        (16...64).contains(s.count) && s.allSatisfy(\.isHexDigit)
    }

    static func param(_ query: String, _ name: String) -> String {
        for pair in query.split(separator: "&") {
            guard let eq = pair.firstIndex(of: "=") else { continue }
            guard pair[..<eq].removingPercentEncoding == name else { continue }
            return String(pair[pair.index(after: eq)...]).removingPercentEncoding ?? ""
        }
        return ""
    }

    /// Trims whitespace and trailing slashes so the same machine always compares equal.
    public static func normalizeHost(_ host: String) -> String {
        host.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
    }
}
