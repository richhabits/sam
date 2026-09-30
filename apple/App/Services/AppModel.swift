import Foundation
import Observation
import SAMKit
import SwiftData
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
    private(set) var reachable = false
    var yard: YardSummary?
    var specialists: [Specialist] = []
    var tools: [ToolInfo] = []
    var pending: PendingApproval?
    var busy = false
    var lastError: String?
    /// Which brain answered last: a lane name from the Mac, or "on-device".
    var lastProvider: String?

    var isPaired: Bool { host != nil && token != nil }
    var brain: BrainClient? {
        guard let host, let token else { return nil }
        return BrainClient(host: host, token: token)
    }

    private var streamTask: Task<Void, Never>?

    // MARK: Pairing

    /// On the Mac SAM runs on, pair silently over loopback. Anywhere else, wait for a code.
    func connect() async {
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

    func pair(host: String, code: String) async throws {
        let base = PairLink.normalizeHost(host.contains("://") ? host : "http://\(host)")
        let token = try await BrainClient.claim(host: base, code: code, client: Self.clientName)
        store(host: base, token: token)
        await refresh()
    }

    func pair(link: PairLink, fallbackHost: String?) async throws {
        guard let h = link.host ?? fallbackHost, !h.isEmpty else { throw BrainError(0, "That link doesn't say which SAM to pair with. Enter its address.") }
        try await pair(host: h, code: link.code)
    }

    func unpair() async {
        try? await brain?.forget()
        store(host: nil, token: nil)
        reachable = false
        yard = nil
        publishSnapshot()
    }

    private func store(host: String?, token: String?) {
        self.host = host
        self.token = token
        if !Session.save(host: host, token: token), token != nil {
            lastError = "Paired, but the Keychain wouldn't save the session, so you'll need to pair again next launch."
        }
    }

    static var clientName: String {
        #if os(macOS)
        "macos"
        #elseif os(visionOS)
        "visionos"
        #elseif os(watchOS)
        "watchos"
        #else
        "ios"
        #endif
    }

    // MARK: Reads

    func refresh() async {
        guard let brain else { reachable = false; publishSnapshot(); return }
        do {
            yard = try await brain.yard()
            reachable = true
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

    func send(_ text: String, in conversation: Conversation, context: ModelContext) {
        let prompt = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, !busy else { return }
        let history = conversation.sorted.map { Turn(role: $0.isUser ? .user : .assistant, content: $0.text) }
        let user = Message(role: "user", text: prompt)
        user.conversation = conversation
        context.insert(user)
        if conversation.title == "New chat" { conversation.title = String(prompt.prefix(48)) }
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
            if let brain, await streamFromMac(brain, prompt: prompt, history: history, into: reply) { return }
            await streamOnDevice(prompt: prompt, history: history, into: reply)
        }
    }

    func stop() {
        streamTask?.cancel()
        busy = false
    }

    /// True when the Mac handled it (answered or paused for approval).
    private func streamFromMac(_ brain: BrainClient, prompt: String, history: [Turn], into reply: Message) async -> Bool {
        var text = ""
        do {
            for try await event in brain.stream(message: prompt, history: history) {
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
