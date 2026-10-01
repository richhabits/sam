import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A pretend SAM brain that lives inside the app, for "Explore with sample data", App Review,
/// and App Store screenshots. It answers every API call to `DemoBrain.host` from fictional
/// fixtures through a URLProtocol, so every screen works unchanged and nothing touches the
/// network. All names, notes and numbers here are made up; none come from anyone's vault.
public enum DemoBrain {
    public static let host = "https://demo.sam.invalid"
    public static let token = "demo"

    /// Call once at launch; harmless when demo mode is never used.
    public static func register() { URLProtocol.registerClass(DemoURLProtocol.self) }

    static func response(method: String, path: String, query: [String: String], body: Data?) -> (status: Int, type: String, data: Data) {
        func json(_ s: String) -> (Int, String, Data) { (200, "application/json", Data(s.utf8)) }
        switch (method, path) {
        case ("GET", "/api/health"):
            return json(#"{"ok":true}"#)
        case ("GET", "/api/yard"):
            return json(yard)
        case ("GET", "/api/tools"):
            return json(tools)
        case ("GET", "/api/agents"):
            return json(agents)
        case ("GET", "/api/mcp/presets"):
            return json(presets)
        case ("GET", "/api/vault/stats"):
            return json(#"{"projectNotes":3,"dailyNotes":4}"#)
        case ("GET", "/api/vault/log"):
            return json(#"[{"time":"09:12","msg":"Deployed teahouse to production"},{"time":"10:40","msg":"Drafted the Lemon & Ivy spring newsletter"},{"time":"14:05","msg":"Summarised three supplier quotes"}]"#)
        case ("GET", "/api/vault/graph"):
            return json(graph)
        case ("GET", "/api/vault/note"):
            return json(note(query["id"] ?? ""))
        case ("GET", "/api/studio/presets/lenses"):
            return json(#"{"lenses":[{"id":"35mm","name":"35mm prime","focalLength":"35mm","aperture":"f/1.8","promptSignature":"35mm lens, natural perspective"},{"id":"85mm","name":"85mm portrait","focalLength":"85mm","aperture":"f/1.4","promptSignature":"85mm portrait lens, creamy bokeh"}]}"#)
        case ("POST", "/api/studio/enhance"):
            return json(#"{"prompt":"A sunlit teahouse counter with steaming cups, soft morning light, shallow depth of field"}"#)
        case ("POST", "/api/studio/image"):
            return json(#"{"url":"/api/studio/media/demo-1"}"#)
        case ("POST", "/api/stream"):
            let message = (try? JSONSerialization.jsonObject(with: body ?? Data()) as? [String: Any])?["message"] as? String ?? ""
            return (200, "text/event-stream", Data(stream(for: message).utf8))
        case ("POST", "/api/confirm"):
            return json(#"{"kind":"final","text":"Done. (Demo: nothing actually ran.)"}"#)
        default:
            if method == "GET", path.hasPrefix("/api/studio/media/") || path.hasPrefix("/api/studio/preview/") {
                return (200, "image/png", swatch(seed: path))
            }
            if method == "POST" {
                return (403, "application/json", Data(#"{"error":"This is a demo. Pair with SAM on your Mac to do this for real."}"#.utf8))
            }
            return (404, "application/json", Data(#"{"error":"not in the demo"}"#.utf8))
        }
    }

    // MARK: Fixtures (fictional)

    static let now = Date().timeIntervalSince1970 * 1000

    static var yard: String {
        func job(_ id: String, _ kind: String, _ state: String, _ project: String, _ ago: Double, _ err: String? = nil) -> String {
            let created = now - ago * 60_000
            let finished = state == "done" || state == "failed" ? "\(created + 180_000)" : "null"
            let error = err.map { "\"\($0)\"" } ?? "null"
            return #"{"id":"\#(id)","kind":"\#(kind)","state":"\#(state)","attempts":1,"createdAt":\#(created),"startedAt":\#(created),"finishedAt":\#(finished),"costTokens":1840,"lastError":\#(error),"project":"\#(project)","tier":"free"}"#
        }
        let recent = [
            job("d1", "project.build", "running", "lemon-and-ivy", 2),
            job("d2", "notebook.summarise", "queued", "supplier-quotes", 1),
            job("d3", "project.deploy", "done", "teahouse", 26),
            job("d4", "project.loop", "done", "teahouse", 75),
            job("d5", "project.deploy", "failed", "teahouse-preview", 140, "Smoke test: the page returned 404 at /menu"),
        ].joined(separator: ",")
        return #"{"on":true,"worker":{"up":true},"queued":1,"running":1,"done":42,"failed":1,"cancelled":0,"recent":[\#(recent)]}"#
    }

    static let tools = #"""
    [{"name":"web_search","safe":true,"tier":"safe","description":"Search the web and cite sources."},
     {"name":"read_file","safe":true,"tier":"safe","description":"Read a file in your projects."},
     {"name":"write_file","safe":false,"tier":"ask","description":"Create or change a file (asks first)."},
     {"name":"run_tests","safe":true,"tier":"safe","description":"Run a project's tests and report only the failures."},
     {"name":"deploy_site","safe":false,"tier":"ask","description":"Publish a site from the yard (asks first)."},
     {"name":"summarise_notes","safe":true,"tier":"safe","description":"Summarise notes from your vault."},
     {"name":"draft_email","safe":true,"tier":"safe","description":"Draft an email for you to send."},
     {"name":"generate_image","safe":true,"tier":"safe","description":"Make an image in Studio."},
     {"name":"calendar_today","safe":true,"tier":"safe","description":"What's on today."},
     {"name":"run_shell","safe":false,"tier":"danger","description":"Run a shell command on your Mac (always asks)."}]
    """#

    static let agents = #"""
    {"specialists":[
     {"id":"scout","name":"Scout","emoji":"🔬","modeledOn":"an investigative analyst","brief":"Research and fact-finding. Digs, verifies, cites."},
     {"id":"forge","name":"Forge","emoji":"🛠️","modeledOn":"a first-principles engineer","brief":"Code, builds and fixes. Ships clean."},
     {"id":"quill","name":"Quill","emoji":"✍️","modeledOn":"a classic ad writer","brief":"Writing and copy that sounds like you."},
     {"id":"ledger","name":"Ledger","emoji":"📒","modeledOn":"a careful bookkeeper","brief":"Numbers, quotes and budgets."}]}
    """#

    static let presets = #"""
    {"presets":[
     {"id":"flipit","label":"FLIP IT (add-on)","emoji":"📈","note":"read-only view of a paper-trading rig. Never trades.","official":true,"fields":[],"connected":false},
     {"id":"stripe","label":"Stripe","emoji":"💳","note":"payments, revenue, customers","official":true,"fields":[{"env":"STRIPE_SECRET_KEY","label":"Secret key","placeholder":"sk_live_…"}],"connected":true},
     {"id":"notion","label":"Notion","emoji":"📝","note":"read and write your Notion workspace","official":true,"fields":[{"env":"NOTION_TOKEN","label":"Integration token"}],"connected":false}]}
    """#

    static let graph = #"""
    {"nodes":[{"id":"teahouse","group":"project"},{"id":"lemon-and-ivy","group":"project"},{"id":"supplier-quotes","group":"project"},
     {"id":"2026-09-29","group":"daily"},{"id":"2026-09-30","group":"daily"},{"id":"facts","group":"memory"}],
     "edges":[{"from":"2026-09-30","to":"teahouse"},{"from":"2026-09-30","to":"lemon-and-ivy"}]}
    """#

    static func note(_ id: String) -> String {
        let text: String
        switch id {
        case "teahouse": text = "# Teahouse\n\nSmall café site: menu, opening hours, booking form.\n\n- Live since Monday\n- Next: seasonal menu page"
        case "lemon-and-ivy": text = "# Lemon & Ivy\n\nFlorist shop site and a monthly newsletter.\n\n- Spring newsletter drafted\n- Photos to pick for the hero"
        case "supplier-quotes": text = "# Supplier quotes\n\nThree quotes for cups and lids, compared by price per 1,000."
        case "facts": text = "# Facts\n\n- Prefers short answers\n- Works mornings"
        default: text = "# \(id)\n\n- Deployed [[teahouse]]\n- Drafted the [[lemon-and-ivy]] newsletter"
        }
        let escaped = (try? JSONSerialization.data(withJSONObject: [text], options: [])).flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return #"{"content":\#(escaped.dropFirst().dropLast())}"#
    }

    static func stream(for message: String) -> String {
        let m = message.lowercased()
        let answer: String
        if m.contains("yard") || m.contains("running") {
            answer = "Two things in the yard: **Lemon & Ivy** is building now, and the supplier-quotes summary is queued. Teahouse deployed 26 minutes ago."
        } else if m.contains("week") || m.contains("notes") {
            answer = "This week: Teahouse went live, the Lemon & Ivy spring newsletter is drafted, and you compared three supplier quotes. The cheapest lids came out 12% lower."
        } else if m.contains("what can you do") {
            answer = "I can research with sources, write in your voice, build and deploy sites in the yard, summarise your notes, and make images in Studio. Anything risky waits for your OK."
        } else {
            answer = "Here's a quick take: start with the one change that saves the most time, then check it again tomorrow. Want me to put it on your list?"
        }
        var frames = [#"data: {"type":"route","tier":"free","klass":"standard","reason":"demo"}"#]
        for word in answer.split(separator: " ", omittingEmptySubsequences: false) {
            let token = (try? JSONSerialization.data(withJSONObject: [String(word) + " "])).flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
            frames.append(#"data: {"type":"token","t":\#(token.dropFirst().dropLast())}"#)
        }
        let full = (try? JSONSerialization.data(withJSONObject: [answer])).flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        frames.append(#"data: {"type":"done","text":\#(full.dropFirst().dropLast()),"provider":"demo"}"#)
        frames.append(#"data: {"type":"end"}"#)
        return frames.joined(separator: "\n\n") + "\n\n"
    }

    /// A soft terracotta-to-dusk gradient, so Studio results look like images, not errors.
    static func swatch(seed: String) -> Data {
        let size = 512
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return Data() }
        let hue = Double(abs(seed.hashValue % 360)) / 360
        let colors = [CGColor(red: 0.94, green: 0.51, blue: 0.31, alpha: 1),
                      CGColor(red: 0.25 + hue * 0.3, green: 0.2, blue: 0.45, alpha: 1)] as CFArray
        if let g = CGGradient(colorsSpace: space, colors: colors, locations: [0, 1]) {
            ctx.drawLinearGradient(g, start: .zero, end: CGPoint(x: size, y: size), options: [])
        }
        guard let image = ctx.makeImage() else { return Data() }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.png.identifier as CFString, 1, nil) else { return Data() }
        CGImageDestinationAddImage(dest, image, nil)
        CGImageDestinationFinalize(dest)
        return out as Data
    }
}

/// Serves `DemoBrain.host` from fixtures. Only ever answers that one reserved host
/// (.invalid can never resolve), so it can't intercept real traffic.
final class DemoURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == URL(string: DemoBrain.host)?.host
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = Dictionary((comps?.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
        var body = request.httpBody
        if body == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buf = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buf, maxLength: buf.count)
                if n <= 0 { break }
                data.append(buf, count: n)
            }
            stream.close()
            body = data
        }
        let r = DemoBrain.response(method: request.httpMethod ?? "GET", path: url.path, query: query, body: body)
        let response = HTTPURLResponse(url: url, statusCode: r.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": r.type])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: r.data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
