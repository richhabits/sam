import Foundation
import Observation
import SAMKit
import SwiftData
#if canImport(UIKit)
import UIKit
#endif
#if canImport(WidgetKit)
import WidgetKit
#endif

/// A risky tool call SAM paused on, waiting for the person.
struct PendingApproval: Identifiable, Equatable {
    let id: String
    let tool: String
    let preview: String?
    let activity: String?
}

@MainActor @Observable final class AppModel {
    static let shared = AppModel()

    private(set) var host: String? = Session.host
    private var token: String? = Session.token
    private(set) var fingerprint: String? = Session.fingerprint
    private(set) var reachable = false
    var yard: YardSummary?
    var specialists: [Specialist] = []
    var tools: [ToolInfo] = []
    var pending: PendingApproval?
    var busy = false
    var lastError: String?
    /// Which brain answered last: a lane name from the Mac, or "on-device".
    var lastProvider: String?

    /// Exploring with fictional sample data (DemoBrain). Never touches the network.
    private(set) var isDemo = Session.isDemo
    var isPaired: Bool { isDemo || (host != nil && token != nil) }
    var brain: BrainClient? {
        if isDemo { return Session.brain }
        guard let host, let token else { return nil }
        return BrainClient(host: host, token: token, fingerprint: fingerprint)
    }

    private var streamTask: Task<Void, Never>?

    // MARK: Demo

    /// Explore every screen with fictional sample data. Nothing is sent anywhere.
    func enterDemo() async {
        DemoBrain.register()
        Session.isDemo = true
        isDemo = true
        lastError = nil
        seedDemoConversation()
        await refresh()
        await loadCatalogue()
    }

    /// One fictional conversation so Chat isn't empty in the demo (and in store screenshots).
    private func seedDemoConversation() {
        let context = SAMStore.container.mainContext
        let existing = (try? context.fetch(FetchDescriptor<Conversation>(predicate: #Predicate { $0.demo }))) ?? []
        guard existing.isEmpty else { return }
        let c = Conversation(title: "What did I get done this week?")
        c.demo = true
        context.insert(c)
        for (role, text, provider) in [
            ("user", "What did I get done this week?", nil as String?),
            ("assistant", "A good week:\n\n- **Teahouse** went live on Monday, menu and booking form included.\n- The **Lemon & Ivy** spring newsletter is drafted and waiting for photos.\n- You compared three supplier quotes; the cheapest lids came out **12% lower**.\n\nWant me to schedule the newsletter for Thursday morning?", "demo"),
            ("user", "Yes, and remind me to pick the photos.", nil),
            ("assistant", "Done. The newsletter is queued for **Thursday 9:00**, and I'll remind you about the photos tomorrow at 10.", "demo"),
        ] {
            let m = Message(role: role, text: text, provider: provider)
            m.conversation = c
            context.insert(m)
        }
        try? context.save()
    }

    func leaveDemo() async {
        let context = SAMStore.container.mainContext
        for c in (try? context.fetch(FetchDescriptor<Conversation>(predicate: #Predicate { $0.demo }))) ?? [] {
            context.delete(c)
        }
        try? context.save()
        Session.isDemo = false
        isDemo = false
        yard = nil
        specialists = []
        tools = []
        var snap = SharedSnapshot()
        snap.paired = isPaired
        snap.save()
        await refresh()
    }

    // MARK: Pairing

    /// On the Mac SAM runs on, pair silently over loopback. Anywhere else, wait for a code.
    func connect() async {
        if ProcessInfo.processInfo.arguments.contains("-samDemo") || isDemo {
            await enterDemo()
            return
        }
        #if os(macOS)
        if !isPaired, await BrainClient.isUp(BrainClient.localHost) {
            do {
                store(host: BrainClient.localHost, token: try await BrainClient.pairThisMac())
            } catch {
                lastError = error.localizedDescription
            }
        }
        #endif
        await refresh()
    }

    func pair(host: String, code: String, fingerprint: String? = nil) async throws {
        let base = PairLink.normalizeHost(host.contains("://") ? host : "http://\(host)")
        if base.hasPrefix("https://") && fingerprint == nil {
            throw BrainError(0, "That SAM uses encryption. Scan its QR code so this device can check it's really your Mac.")
        }
        // Plain http only where it can't be read on the way: this device, or a Tailscale address
        // (100.64.0.0/10, already WireGuard-encrypted). Anything else needs the pinned https listener.
        if base.hasPrefix("http://") && !Self.plainHTTPAllowed(base) {
            throw BrainError(0, "For your privacy SAM won't pair over an unencrypted connection. Turn on phone access on your Mac and scan its QR code.")
        }
        let token = try await BrainClient.claim(host: base, code: code, client: Self.clientName, fingerprint: fingerprint)
        store(host: base, token: token, fingerprint: fingerprint)
        await refresh()
    }

    func pair(link: PairLink, fallbackHost: String?) async throws {
        guard let h = link.host ?? fallbackHost, !h.isEmpty else { throw BrainError(0, "That link doesn't say which SAM to pair with. Enter its address.") }
        try await pair(host: h, code: link.code, fingerprint: link.fingerprint)
    }

    func unpair() async {
        if isDemo { await leaveDemo(); return }
        try? await brain?.forget()
        store(host: nil, token: nil)
        reachable = false
        yard = nil
        SharedSnapshot().save()   // nothing from the old pairing lingers on the Lock Screen
        Spotlight.clear()
        publishSnapshot()
    }

    private func store(host: String?, token: String?, fingerprint: String? = nil) {
        self.host = host
        self.token = token
        self.fingerprint = fingerprint
        if !Session.save(host: host, token: token, fingerprint: fingerprint), token != nil {
            lastError = "Paired, but the Keychain wouldn't save the session, so you'll need to pair again next launch."
        }
    }

    static func plainHTTPAllowed(_ base: String) -> Bool {
        guard let host = URL(string: base)?.host() else { return false }
        if host == "127.0.0.1" || host == "localhost" || host == "::1" { return true }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        return parts.count == 4 && parts[0] == 100 && (64...127).contains(parts[1])
    }

    static var clientName: String {
        #if os(macOS)
        "macos"
        #elseif os(visionOS)
        "visionos"
        #elseif os(watchOS)
        "watchos"
        #else
        // Matches server/pairing.ts NATIVE_CLIENTS, so the Mac's device list says "iPad · SAM app".
        UIDevice.current.userInterfaceIdiom == .pad ? "ios-ipad" : "ios-iphone"
        #endif
    }

    // MARK: Reads

    func refresh() async {
        guard let brain else { reachable = false; publishSnapshot(); return }
        do {
            let latest = try await brain.yard()
            yard = latest
            reachable = true
            await YardNotifier.shared.observe(latest)
            lastError = nil
        } catch let e as BrainError where e.status == 401 || e.status == 403 {
            // The Mac forgot this device (revoked, or its sessions were reset).
            store(host: nil, token: nil)
            reachable = false
            lastError = "SAM on your Mac no longer recognises this device. Pair again."
        } catch {
            reachable = false
        }
        publishSnapshot()
    }

    func loadCatalogue() async {
        guard let brain else { return }
        async let s = try? brain.specialists()
        async let t = try? brain.tools()
        specialists = await s ?? specialists
        tools = await t ?? tools
    }

    func cancel(_ job: YardJob) async {
        do { try await brain?.cancel(job: job.id) } catch { lastError = error.localizedDescription }
        await refresh()
    }

    func retry(_ job: YardJob) async {
        do { try await brain?.retry(job: job.id) } catch { lastError = error.localizedDescription }
        await refresh()
    }

    // MARK: Chat

    /// `untrusted` marks outside content (selected text, a shared file): the brain answers with
    /// no tools, memory or log. `display` is what the bubble shows instead of the fenced prompt.
    func send(_ text: String, in conversation: Conversation, context: ModelContext, untrusted: Bool = false, display: String? = nil) {
        let prompt = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, !busy else { return }
        let history = conversation.sorted.map { Turn(role: $0.isUser ? .user : .assistant, content: $0.text) }
        if isDemo { conversation.demo = true }
        let user = Message(role: "user", text: display ?? prompt)
        user.conversation = conversation
        context.insert(user)
        if conversation.title == "New chat" { conversation.title = String((display ?? prompt).prefix(48)) }
        let reply = Message(role: "assistant", text: "")
        reply.conversation = conversation
        context.insert(reply)
        conversation.updated = .now
        busy = true
        lastError = nil
        Haptics.send()

        streamTask = Task {
            defer {
                busy = false
                conversation.updated = .now
                try? context.save()
            }
            if let brain, await streamFromMac(brain, prompt: prompt, history: untrusted ? [] : history, untrusted: untrusted, into: reply) { return }
            await streamOnDevice(prompt: prompt, history: history, into: reply)
        }
    }

    func stop() {
        streamTask?.cancel()
        busy = false
    }

    /// True when the Mac handled it (answered or paused for approval).
    private func streamFromMac(_ brain: BrainClient, prompt: String, history: [Turn], untrusted: Bool = false, into reply: Message) async -> Bool {
        var text = ""
        do {
            for try await event in brain.stream(message: prompt, history: history, untrusted: untrusted) {
                switch event {
                case .token(let t):
                    text += t
                    reply.text = text
                case .done(let final, let provider):
                    if let final, !final.isEmpty { reply.text = final }
                    reply.provider = provider
                    lastProvider = provider
                case .pending(let id, let tool, let preview, let activity):
                    pending = PendingApproval(id: id, tool: tool, preview: preview, activity: activity)
                    if reply.text.isEmpty { reply.text = activity ?? "SAM wants to use \(tool). Approve it to continue." }
                    Haptics.attention()
                default:
                    break
                }
            }
            reachable = true
            finished(reply)
            return true
        } catch is CancellationError {
            return true
        } catch {
            if Task.isCancelled { return true }
            // Keep a partial answer rather than re-asking elsewhere.
            if !text.isEmpty { finished(reply); return true }
            reachable = false
            return false
        }
    }

    private func streamOnDevice(prompt: String, history: [Turn], into reply: Message) async {
        guard OnDeviceBrain.isAvailable else {
            reply.text = isPaired
                ? "I can't reach SAM on your Mac right now, and \(OnDeviceBrain.unavailableReason?.lowercasedFirst ?? "on-device AI isn't available.")"
                : "Pair with SAM on your Mac to get started. \(OnDeviceBrain.unavailableReason ?? "")"
            reply.provider = "offline"
            return
        }
        do {
            for try await snapshot in OnDeviceBrain.stream(prompt, history: history.map { ($0.role.rawValue, $0.content) }) {
                reply.text = snapshot
            }
            reply.provider = "on-device"
            lastProvider = "on-device"
            finished(reply)
        } catch {
            if reply.text.isEmpty { reply.text = "Apple Intelligence couldn't answer that: \(error.localizedDescription)" }
        }
    }

    private func finished(_ reply: Message) {
        Haptics.success()
        Spotlight.index(reply)
        if Speaker.shared.readAloud { Speaker.shared.speak(reply.text) }
        var snap = SharedSnapshot.load()
        snap.lastReply = String(reply.text.prefix(280))
        snap.updated = .now
        snap.save()
        reloadWidgets()
    }

    func answer(_ approval: PendingApproval, approved: Bool, always: Bool, in conversation: Conversation, context: ModelContext) async {
        pending = nil
        guard let brain else { return }
        do {
            let text = try await brain.confirm(pendingId: approval.id, approved: approved, always: always)
            let msg = Message(role: "assistant", text: text.isEmpty ? (approved ? "Done." : "Okay, I won't.") : text, provider: lastProvider)
            msg.conversation = conversation
            context.insert(msg)
            try? context.save()
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: Shared state for widgets, controls and the Watch

    func publishSnapshot() {
        var snap = SharedSnapshot.load()
        snap.paired = isPaired
        snap.reachable = reachable
        snap.queued = yard?.queued ?? 0
        snap.running = yard?.running ?? 0
        snap.failed = yard?.failed ?? 0
        snap.latestJob = yard?.recent?.first?.title
        snap.latestState = yard?.recent?.first?.state
        snap.updated = .now
        snap.save()
        reloadWidgets()
        #if os(iOS)
        PhoneLink.shared.push(snap)
        #endif
    }

    private func reloadWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}

extension String {
    var lowercasedFirst: String { prefix(1).lowercased() + dropFirst() }
}
