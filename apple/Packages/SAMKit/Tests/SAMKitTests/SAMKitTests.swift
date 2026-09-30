import Foundation
import Testing
@testable import SAMKit

@Suite struct SSEParserTests {
    @Test func parsesWholeFramesAndKeepsPartial() {
        let buf = "data: {\"type\":\"route\",\"tier\":\"free\"}\n\ndata: {\"type\":\"token\",\"t\":\"hel\"}\n\ndata: {\"type\":\"tok"
        let (events, rest) = SSEParser.parse(buf)
        #expect(events == [.route(tier: "free", klass: nil, reason: nil), .token("hel")])
        #expect(rest == "data: {\"type\":\"tok")
    }

    @Test func realServerStream() {
        // Captured from the live brain, 2026-09-29.
        let buf = """
        data: {"type":"route","tier":"free","klass":"standard","reason":"standard → free · user:free"}

        data: {"type":"token","t":"hello"}

        data: {"type":"done","text":"hello","provider":"gemini-2.5-flash","trace":[]}

        data: {"type":"end","projectId":""}


        """
        let (events, rest) = SSEParser.parse(buf)
        #expect(events.count == 4)
        #expect(events[1] == .token("hello"))
        #expect(events[2] == .done(text: "hello", provider: "gemini-2.5-flash"))
        #expect(events[3] == .end)
        #expect(rest.isEmpty)
    }

    @Test func pendingNeedsAnId() {
        #expect(SSEParser.decode(#"{"type":"pending","tool":"run_shell"}"#) == nil)
        #expect(SSEParser.decode(#"{"type":"pending","pendingId":"p1","tool":"run_shell","preview":"ls"}"#)
                == .pending(id: "p1", tool: "run_shell", preview: "ls", activity: nil))
    }

    @Test func ignoresJunk() {
        let (events, _) = SSEParser.parse(": keep-alive\n\ndata: not json\n\ndata: [DONE]\n\n")
        #expect(events.isEmpty)
    }
}

@Suite struct PairLinkTests {
    let code = "b9d0e07fe82c64ea7d16b855fe7b3f75"

    @Test func serverLinkImpliesHost() {
        #expect(PairLink.parse("http://172.20.10.10:8787/pair?code=\(code)") == PairLink(code: code, host: "http://172.20.10.10:8787"))
    }

    @Test func customSchemeWithHost() {
        let link = PairLink.parse("sam://pair?code=\(code)&host=http%3A%2F%2F192.168.1.4%3A8787%2F")
        #expect(link == PairLink(code: code, host: "http://192.168.1.4:8787"))
    }

    @Test func rejectsBadCodesAndPaths() {
        #expect(PairLink.parse("sam://pair?code=nothex!") == nil)
        #expect(PairLink.parse("http://x/login?code=\(code)") == nil)
        #expect(PairLink.parse("sam://pair?code=abc") == nil)
        #expect(PairLink.parse(nil) == nil)
    }

    @Test func rejectsHostWithPath() {
        #expect(PairLink.parse("sam://pair?code=\(code)&host=http://evil/x")?.host == nil)
        #expect(PairLink.parse("sam://pair?code=\(code)&host=javascript:alert(1)")?.host == nil)
    }

    @Test func normalizesHost() {
        #expect(PairLink.normalizeHost("  http://a:8787/// ") == "http://a:8787")
    }
}

@Suite struct ModelTests {
    @Test func decodesYard() throws {
        let json = #"{"on":true,"worker":{"up":true,"pid":1},"queued":1,"running":0,"done":3,"failed":1,"cancelled":0,"meter":{},"recent":[{"id":"j1","kind":"project.deploy","payload":{"slug":"x"},"state":"failed","attempts":1,"createdAt":1759180000000,"startedAt":null,"finishedAt":1759180060000,"heartbeatAt":null,"costTokens":10,"costBudget":null,"lastError":"boom","failureKind":"fault","cancelRequested":false,"runAfter":0,"logPath":null,"project":"x","steps":[],"tier":"free"}]}"#
        let yard = try JSONDecoder().decode(YardSummary.self, from: Data(json.utf8))
        #expect(yard.queued == 1 && yard.failed == 1)
        let job = try #require(yard.recent?.first)
        #expect(job.title == "Project deploy")
        #expect(job.lastError == "boom")
        #expect(!job.isActive)
    }

    @Test func snapshotRoundTrips() throws {
        let defaults = try #require(UserDefaults(suiteName: "samkit.tests.\(UUID())"))
        let snap = SharedSnapshot(paired: true, reachable: true, queued: 2, updated: Date(timeIntervalSince1970: 1))
        snap.save(defaults)
        #expect(SharedSnapshot.load(defaults) == snap)
    }
}

/// Opt-in: `SAM_LIVE=1 swift test` against a real brain on this Mac. Pairs over loopback,
/// streams one short free-tier reply, reads the yard, then forgets the session it made.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["SAM_LIVE"] == "1")) struct LiveBrainTests {
    @Test func pairStreamAndRead() async throws {
        #expect(await BrainClient.isUp(BrainClient.localHost))
        let token = try await BrainClient.pairThisMac()
        let brain = BrainClient(host: BrainClient.localHost, token: token)
        var text = ""
        var sawDone = false
        for try await event in brain.stream(message: "Reply with just the word ready.", history: [], tier: "free") {
            if case .token(let t) = event { text += t }
            if case .done = event { sawDone = true }
        }
        #expect(sawDone)
        #expect(text.lowercased().contains("ready"))
        let yard = try await brain.yard()
        #expect(yard.on == true)
        #expect(try await brain.tools().count > 100)
        // Revokes this session. (Can't assert a 401 afterwards: on this Mac, loopback yard
        // reads are trusted without a token while the handshake is off.)
        try await brain.forget()
    }
}
