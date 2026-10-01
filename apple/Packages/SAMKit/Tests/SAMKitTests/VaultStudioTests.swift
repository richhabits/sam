import Foundation
import Testing
@testable import SAMKit

// Shapes captured from the live brain (GET only), 2026-10-01. Vault note ids, paths and text are
// replaced with neutral samples; only the structure is real. The lens presets are the server's own
// static data (server/studio-higgsfield.ts), not personal content.

@Suite struct VaultDecodingTests {
    @Test func stats() throws {
        let json = #"{"projectNotes":6,"dailyNotes":14,"path":"/Users/example/sam/vault"}"#
        let s = try JSONDecoder().decode(VaultStats.self, from: Data(json.utf8))
        #expect(s.projectNotes == 6)
        #expect(s.dailyNotes == 14)
    }

    @Test func emptyLogAndEntries() throws {
        #expect(try JSONDecoder().decode([VaultLogEntry].self, from: Data("[]".utf8)).isEmpty)
        let json = #"[{"time":"14:05","msg":"14:05 · free · sample question"},{"time":"09:12","msg":"09:12 · local · another sample"}]"#
        let log = try JSONDecoder().decode([VaultLogEntry].self, from: Data(json.utf8))
        #expect(log.count == 2)
        #expect(log[0].time == "14:05")
    }

    @Test func graphGroupsAndOrder() throws {
        let json = """
        {"nodes":[{"id":"sample-project","group":"project"},{"id":"Another_Project","group":"project"},
        {"id":"some-topic","group":"link"},{"id":"2026-07-04","group":"daily"},{"id":"2026-09-30","group":"daily"},
        {"id":"facts","group":"memory"},{"id":"future-kind","group":"something-new"}],
        "edges":[{"from":"sample-project","to":"some-topic"},{"from":"2026-09-30","to":"sample-project"}]}
        """
        let g = try JSONDecoder().decode(VaultGraph.self, from: Data(json.utf8))
        #expect(g.nodes.count == 7)
        #expect(g.daily.map(\.id) == ["2026-09-30", "2026-07-04"])
        #expect(g.projects.map(\.id) == ["Another_Project", "sample-project"])
        #expect(g.memory.map(\.id) == ["facts"])
        #expect(g.readable.count == 5)       // link + unknown are not files
        #expect(g.nodes.last?.group == .unknown)
        let links = g.links(of: "sample-project")
        #expect(links.incoming == ["2026-09-30"])
        #expect(links.outgoing == ["some-topic"])
        #expect(g.daily.first?.date != nil)
        #expect(g.projects.last?.title == "sample project")
    }

    @Test func note() throws {
        let json = ##"{"content":"# Sample\n\n- one **bold** point\n- [[linked-note]]\n"}"##
        let n = try JSONDecoder().decode(VaultNote.self, from: Data(json.utf8))
        #expect(n.content.hasPrefix("# Sample"))
    }

    @Test func notePathEncodesQuery() {
        #expect(BrainClient.notePath(group: "daily", id: "2026-09-30") == "/api/vault/note?group=daily&id=2026-09-30")
        #expect(BrainClient.notePath(group: "project", id: "a b&c") == "/api/vault/note?group=project&id=a%20b%26c")
    }
}

@Suite struct StudioTests {
    @Test func lenses() throws {
        let json = """
        {"lenses": [{"id": "anamorphic_panavision", "name": "Panavision C-Series Anamorphic", "focalLength": "40mm Anamorphic", "aperture": "T2.0", "aspectRatio": "2.39:1", "characteristics": "Horizontal blue/cyan streak flares, oval bokeh, vintage barrel distortion", "promptSignature": "shot on Panavision C-Series 40mm Anamorphic lens, 2.39:1 widescreen, subtle cyan streak flares, creamy oval bokeh, cinematic filmic depth"}, {"id": "arri_master_prime", "name": "Arri / Zeiss Master Prime 50mm", "focalLength": "50mm Prime", "aperture": "f/1.3", "aspectRatio": "16:9", "characteristics": "Razor sharpness, neutral color reproduction, pristine glass, cinematic rendering", "promptSignature": "shot on Arri Alexa 35 with Zeiss Master Prime 50mm at f/1.3, tack-sharp subject isolation, natural skin texture micro-contrast, Hollywood master cinematography"}]}
        """
        let c = try JSONDecoder().decode(StudioLensCatalogue.self, from: Data(json.utf8))
        #expect(c.lenses.map(\.id) == ["anamorphic_panavision", "arri_master_prime"])
        #expect(c.lenses[1].aperture == "f/1.3")
    }

    @Test func imageReplies() throws {
        let ok = try JSONDecoder().decode(StudioImageReply.self, from: Data(#"{"url":"/api/studio/media/0123456789abcdef.jpg"}"#.utf8))
        #expect(ok.url == "/api/studio/media/0123456789abcdef.jpg")
        let bad = try JSONDecoder().decode(StudioImageReply.self, from: Data(#"{"error":"no lane answered"}"#.utf8))
        #expect(bad.url == nil && bad.error == "no lane answered")
    }

    @Test func resolveAndTokenScope() throws {
        let brain = BrainClient(host: "http://192.168.1.20:8787/", token: "t0k", session: .shared)
        let local = try #require(brain.resolve("/api/studio/media/abc.jpg"))
        #expect(local.absoluteString == "http://192.168.1.20:8787/api/studio/media/abc.jpg")
        #expect(brain.mediaRequest(for: local).value(forHTTPHeaderField: "Authorization") == "Bearer t0k")
        // A provider URL must never receive the session token.
        let remote = try #require(brain.resolve("https://image.example.com/p/abc"))
        #expect(brain.mediaRequest(for: remote).value(forHTTPHeaderField: "Authorization") == nil)
        let otherPort = try #require(URL(string: "http://192.168.1.20:9999/x"))
        #expect(brain.mediaRequest(for: otherPort).value(forHTTPHeaderField: "Authorization") == nil)
        #expect(brain.stylePreviewURL(StudioStyle.all[0])?.absoluteString == "http://192.168.1.20:8787/api/studio/preview/dusk")
    }

    @Test func dataURIDecodesLocally() async throws {
        let brain = BrainClient(host: "http://127.0.0.1:8787", token: "t", session: .shared)
        let url = try #require(URL(string: "data:image/png;base64,aGVsbG8="))
        #expect(try await brain.media(url) == Data("hello".utf8))
    }

    @Test func aspectsWithinServerCap() {
        for a in StudioAspect.allCases {
            #expect(a.size.width <= 1440 && a.size.height <= 1440)
        }
        #expect(StudioAspect.landscape.ratio > 1.7 && StudioAspect.portrait.ratio < 0.6)
    }

    @Test func styleIdsMatchServerPreviews() {
        // server/routes.studio.ts STUDIO_PREVIEWS keys; a missing one renders a blank card.
        let server: Set = ["cinematic", "photoreal", "anime", "3d", "product", "neon", "vapor", "clay", "dusk", "noir", "golden", "cyber"]
        #expect(Set(StudioStyle.all.map(\.id)) == server)
    }

    @Test func composePrompt() {
        let lens = StudioLens(id: "l", name: "L", focalLength: nil, aperture: nil, aspectRatio: nil, characteristics: nil, promptSignature: "shot on a 50mm")
        #expect(StudioPrompt.compose("  a lighthouse ", style: StudioStyle.all[2], lens: lens)
                == "a lighthouse, high contrast chiaroscuro, deep dramatic shadows, shot on a 50mm")
        #expect(StudioPrompt.compose("a lighthouse", style: nil, lens: nil) == "a lighthouse")
    }
}
