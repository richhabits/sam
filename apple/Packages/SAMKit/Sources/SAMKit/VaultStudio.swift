import Foundation

// MARK: - Vault (server/vault.ts, routes in server/index.ts)
//
// All four reads sit behind canReadPrivate: the desktop app on loopback, or any paired device
// carrying its session token as a Bearer. Not loopback-only, so a paired phone can browse.

/// GET /api/vault/log entry: today's exchanges, newest first ("HH:MM …" headings).
public struct VaultLogEntry: Codable, Hashable, Identifiable, Sendable {
    public let time: String
    public let msg: String
    public var id: String { time + msg }
}

/// GET /api/vault/graph: notes are nodes, [[wikilinks]] are edges.
public struct VaultGraph: Codable, Equatable, Sendable {
    public let nodes: [VaultNode]
    public let edges: [VaultEdge]

    public init(nodes: [VaultNode], edges: [VaultEdge]) {
        self.nodes = nodes
        self.edges = edges
    }

    /// Notes that exist on disk, so /api/vault/note can serve them.
    public var readable: [VaultNode] { nodes.filter(\.isReadable) }
    /// Daily notes, newest first (ids are yyyy-MM-dd, so string order is date order).
    public var daily: [VaultNode] { nodes.filter { $0.group == .daily }.sorted { $0.id > $1.id } }
    public var projects: [VaultNode] { nodes.filter { $0.group == .project }.sorted { $0.id.localizedStandardCompare($1.id) == .orderedAscending } }
    public var memory: [VaultNode] { nodes.filter { $0.group == .memory } }

    /// Notes that link to `id`, and notes `id` links to.
    public func links(of id: String) -> (incoming: [String], outgoing: [String]) {
        (edges.filter { $0.to == id }.map(\.from), edges.filter { $0.from == id }.map(\.to))
    }
}

public struct VaultNode: Codable, Hashable, Identifiable, Sendable {
    public enum Group: String, Codable, Hashable, Sendable {
        case project, daily, memory, link, unknown
        public init(from decoder: Decoder) throws {
            self = Group(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
        }
    }
    public let id: String
    public let group: Group

    public init(id: String, group: Group) {
        self.id = id
        self.group = group
    }

    /// A "link" node is a [[wikilink]] target with no file behind it; readVaultNote refuses it.
    public var isReadable: Bool {
        switch group {
        case .project, .daily: true
        case .memory: id == "facts"
        case .link, .unknown: false
        }
    }

    /// "2026-09-30" → a Date for daily notes (UTC, as the server names them).
    public var date: Date? {
        guard group == .daily else { return nil }
        return try? Date(id + "T12:00:00Z", strategy: .iso8601)
    }

    /// Human title: dates as dates, slugs with spaces.
    public var title: String {
        if let date { return date.formatted(date: .complete, time: .omitted) }
        if group == .memory && id == "facts" { return "Facts" }
        return id.replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ")
    }
}

public struct VaultEdge: Codable, Hashable, Sendable {
    public let from: String
    public let to: String
}

/// GET /api/vault/note?group=&id= → raw Markdown.
public struct VaultNote: Codable, Equatable, Sendable {
    public let content: String
}

// MARK: - Studio (server/routes.studio.ts)

/// A style card. The ids are the server's STUDIO_PREVIEWS keys, so each has a thumbnail at
/// GET /api/studio/preview/:id; labels and cues match the web Studio (src/StudioView.tsx STYLES).
public struct StudioStyle: Hashable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let cue: String

    public static let all: [StudioStyle] = [
        .init(id: "dusk", label: "Anamorphic Dusk", cue: "warm anamorphic lens flare, twilight dusk"),
        .init(id: "cyber", label: "Cyberpunk Neon", cue: "neon reflections, wet asphalt, dark futuristic"),
        .init(id: "noir", label: "Moody Noir", cue: "high contrast chiaroscuro, deep dramatic shadows"),
        .init(id: "photoreal", label: "Photoreal 8K", cue: "ultra-detailed, realistic global illumination"),
        .init(id: "golden", label: "Golden Hour", cue: "warm sunlight haze, soft rim lighting"),
        .init(id: "cinematic", label: "35mm Kodak", cue: "35mm film grain, cinematic depth of field"),
        .init(id: "3d", label: "3D Octane", cue: "octane render, soft volumetric lighting, pixar style"),
        .init(id: "anime", label: "Anime Cel", cue: "cel shaded, vibrant palette, studio ghibli"),
        .init(id: "neon", label: "Synthwave", cue: "vibrant neon glow, magenta and cyan beams"),
        .init(id: "vapor", label: "Vaporwave", cue: "retro chrome grid, pastel sunset"),
        .init(id: "clay", label: "Claymation", cue: "stop-motion plasticine, tactile texture"),
        .init(id: "product", label: "Luxury Studio", cue: "clean studio commercial lighting, macro lens"),
    ]
}

/// Output shape. The server caps each side at 1440.
public enum StudioAspect: String, CaseIterable, Hashable, Identifiable, Sendable {
    case square = "1:1", landscape = "16:9", portrait = "9:16", widescreen = "2.39:1"
    public var id: String { rawValue }
    public var size: (width: Int, height: Int) {
        switch self {
        case .square: (1024, 1024)
        case .landscape: (1440, 810)
        case .portrait: (810, 1440)
        case .widescreen: (1440, 602)
        }
    }
    public var ratio: Double { Double(size.width) / Double(size.height) }
    public var symbol: String {
        switch self {
        case .square: "square"
        case .landscape: "rectangle"
        case .portrait: "rectangle.portrait"
        case .widescreen: "rectangle.ratio.16.to.9"
        }
    }
}

/// GET /api/studio/presets/lenses entry.
public struct StudioLens: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let focalLength: String?
    public let aperture: String?
    public let aspectRatio: String?
    public let characteristics: String?
    public let promptSignature: String?
}

struct StudioLensCatalogue: Codable, Sendable { let lenses: [StudioLens] }

/// POST /api/studio/image reply: `{url}` on success, `{error}` (often with a 200) on failure.
/// `url` is usually same-origin (/api/studio/media/<id>), but can be a provider URL or data URI
/// when caching failed.
public struct StudioImageReply: Codable, Equatable, Sendable {
    public let url: String?
    public let error: String?
}

struct StudioEnhanceReply: Codable, Sendable { let prompt: String }

/// Builds the prompt the way the web Studio does: idea, then the style and lens cues.
public enum StudioPrompt {
    public static func compose(_ idea: String, style: StudioStyle?, lens: StudioLens?) -> String {
        var parts = [idea.trimmingCharacters(in: .whitespacesAndNewlines)]
        if let style { parts.append(style.cue) }
        if let sig = lens?.promptSignature, !sig.isEmpty { parts.append(sig) }
        return parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

// MARK: - Client

extension BrainClient {
    public func vaultLog() async throws -> [VaultLogEntry] { try await get("/api/vault/log") }
    public func vaultGraph() async throws -> VaultGraph { try await get("/api/vault/graph") }

    public func vaultNote(_ node: VaultNode) async throws -> VaultNote {
        try await get(Self.notePath(group: node.group.rawValue, id: node.id))
    }

    static func notePath(group: String, id: String) -> String {
        var c = URLComponents()
        c.path = "/api/vault/note"
        c.queryItems = [URLQueryItem(name: "group", value: group), URLQueryItem(name: "id", value: id)]
        return c.string ?? "/api/vault/note"
    }

    public func studioLenses() async throws -> [StudioLens] {
        (try await get("/api/studio/presets/lenses") as StudioLensCatalogue).lenses
    }

    /// One free-lane text call on the Mac. Only ever from an explicit button press.
    public func enhancePrompt(_ prompt: String, style: String?) async throws -> String {
        struct Body: Encodable { let prompt: String; let style: String? }
        let data = try await post("/api/studio/enhance", Body(prompt: prompt, style: style), timeout: 60)
        return try JSONDecoder().decode(StudioEnhanceReply.self, from: data).prompt
    }

    /// Generates one image on the Mac (free lanes first, then keyed ones). Spends the owner's
    /// provider budget, so callers must only reach this from an explicit Generate press.
    /// Returns where the image can be loaded from (see `mediaRequest(for:)`).
    public func generateImage(prompt: String, aspect: StudioAspect) async throws -> URL {
        struct Body: Encodable { let prompt: String; let width: Int; let height: Int }
        let (w, h) = aspect.size
        let data = try await post("/api/studio/image", Body(prompt: prompt, width: w, height: h), timeout: 180)
        let reply = try JSONDecoder().decode(StudioImageReply.self, from: data)
        guard let ref = reply.url, let url = resolve(ref) else {
            throw BrainError(200, reply.error.map { "Studio couldn't make that: \($0)" } ?? "Studio didn't return an image.")
        }
        return url
    }

    /// A same-origin ref ("/api/…") becomes an absolute URL on this brain; absolute and data
    /// URLs pass through.
    public func resolve(_ ref: String) -> URL? {
        if ref.hasPrefix("/") { return URL(string: host + ref) }
        return URL(string: ref)
    }

    /// The thumbnail for a style card (cached on the Mac after the first render).
    public func stylePreviewURL(_ style: StudioStyle) -> URL? {
        URL(string: "\(host)/api/studio/preview/\(style.id)")
    }

    /// A request for a Studio image. The session token goes ONLY to this brain: a provider URL
    /// on another host gets a plain request, so the token never leaves for a third party.
    public func mediaRequest(for url: URL) -> URLRequest {
        var req = URLRequest(url: url, timeoutInterval: 30)
        if isBrain(url) { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return req
    }

    func isBrain(_ url: URL) -> Bool {
        guard let base = URL(string: host) else { return false }
        return url.scheme == base.scheme && url.host() == base.host() && url.port == base.port
    }

    /// Image bytes for a Studio URL: data URIs decode locally; brain URLs go through the pinned
    /// session with the token.
    public func media(_ url: URL) async throws -> Data {
        if url.scheme == "data" {
            guard let comma = url.absoluteString.firstIndex(of: ","),
                  let data = Data(base64Encoded: String(url.absoluteString[url.absoluteString.index(after: comma)...])) else {
                throw BrainError(0, "That image couldn't be read.")
            }
            return data
        }
        let (data, status) = try await Self.transport(isBrain(url) ? session : .shared, mediaRequest(for: url))
        try Self.check(status, data)
        return data
    }

    func post<B: Encodable>(_ path: String, _ body: B, timeout: TimeInterval) async throws -> Data {
        var req = try makeRequest(path, method: "POST", timeout: timeout)
        req.httpBody = try JSONEncoder().encode(body)
        let (data, status) = try await Self.transport(session, req)
        try Self.check(status, data)
        return data
    }
}

extension BrainError {
    /// The brain refused because this route is for the Mac itself (loopback-only).
    public var isMacOnly: Bool { status == 403 }
    /// The brain doesn't recognise this device's session.
    public var isUnpaired: Bool { status == 401 }
}
