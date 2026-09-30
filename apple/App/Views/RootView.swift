import SAMKit
import SwiftData
import SwiftUI

enum AppSection: String, Hashable, CaseIterable {
    case chat, yard, crew, tools, addOns, settings
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var phase
    @State private var lock = AppLock.shared
    @State private var section: AppSection = .chat
    @State private var skippedPairing = UserDefaults.standard.bool(forKey: "sam.skippedPairing")

    var body: some View {
        ZStack {
            if !model.isPaired && !skippedPairing {
                PairView(onSkip: {
                    skippedPairing = true
                    UserDefaults.standard.set(true, forKey: "sam.skippedPairing")
                })
                .transition(.opacity)
            } else {
                tabs
            }
            if lock.locked {
                LockView().transition(.opacity)
            }
        }
        .animation(.smooth, value: model.isPaired)
        .animation(.smooth, value: lock.locked)
        .tint(.sam)
        .task {
            await model.connect()
            #if DEBUG
            await SelfTest.runIfRequested(model: model)
            #endif
        }
        .task(id: phase) {
            // Poll the yard while the app is in front; widgets get the same snapshot.
            guard phase == .active else { return }
            while !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(15))
            }
        }
        .onChange(of: phase) { _, new in
            if new == .background { lock.lock() }
            if new == .active { Task { await lock.unlock() } }
        }
        .onOpenURL { url in handle(url) }
        .onContinueUserActivity(ChatActivity.type) { _ in section = .chat }
    }

    private var tabs: some View {
        TabView(selection: $section) {
            Tab("Chat", systemImage: "bubble.left.and.text.bubble.right", value: .chat) { ChatView() }
            Tab("Yard", systemImage: "hammer", value: .yard) { YardView() }
                .badge(model.yard.map { $0.running + $0.queued } ?? 0)
            Tab("Crew", systemImage: "person.3", value: .crew) { CrewView(section: $section) }
            Tab("Tools", systemImage: "wrench.and.screwdriver", value: .tools) { ToolsView() }
            Tab("Add-ons", systemImage: "puzzlepiece.extension", value: .addOns) { AddOnsView() }
            Tab("Settings", systemImage: "gearshape", value: .settings) { SettingsView() }
        }
        .tabViewStyle(.sidebarAdaptable)
    }

    private func handle(_ url: URL) {
        if let link = PairLink.parse(url.absoluteString) {
            Task {
                do { try await model.pair(link: link, fallbackHost: model.host) } catch { model.lastError = error.localizedDescription }
            }
        } else if url.host() == "chat" {
            section = .chat
        } else if url.host() == "yard" {
            section = .yard
        }
    }
}

struct LockView: View {
    @State private var lock = AppLock.shared
    var body: some View {
        VStack(spacing: 20) {
            SAMMark(size: 88)
            Text("SAM is locked").font(.title2.bold())
            Button("Unlock with \(lock.biometryName)") { Task { await lock.unlock() } }
                .samProminent()
                .controlSize(.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.ultraThickMaterial)
        .task { await lock.unlock() }
    }
}

/// Handoff: pick the conversation up on another device.
enum ChatActivity {
    static let type = "com.hectic.sam.chat"
}

#if DEBUG
/// Headless check, no taps: `simctl launch --console <udid> com.hectic.sam.mobile
/// -samPairLink "sam://pair?code=…&host=…" -samSelfTest "question"`. Uses the same code paths
/// the UI does and prints PASS/FAIL lines.
@MainActor enum SelfTest {
    static func runIfRequested(model: AppModel) async {
        let d = UserDefaults.standard
        if let raw = d.string(forKey: "samPairLink"), let link = PairLink.parse(raw) {
            do {
                try await model.pair(link: link, fallbackHost: nil)
                print("SAMTEST PASS pair host=\(model.host ?? "-") reachable=\(model.reachable)")
            } catch {
                print("SAMTEST FAIL pair \(error.localizedDescription)")
            }
        }
        guard let question = d.string(forKey: "samSelfTest") else { return }
        let container = try! ModelContainer(for: Conversation.self, Message.self,
                                            configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let context = container.mainContext
        let convo = Conversation()
        context.insert(convo)
        model.send(question, in: convo, context: context)
        let start = Date.now
        while model.busy, Date.now.timeIntervalSince(start) < 90 { try? await Task.sleep(for: .milliseconds(200)) }
        let reply = convo.sorted.last
        let ok = !(reply?.text.isEmpty ?? true) && !model.busy
        print("SAMTEST \(ok ? "PASS" : "FAIL") chat provider=\(reply?.provider ?? "-") seconds=\(String(format: "%.1f", Date.now.timeIntervalSince(start))) text=\(reply?.text.prefix(120) ?? "")")
        await model.refresh()
        print("SAMTEST \(model.yard != nil ? "PASS" : "FAIL") yard queued=\(model.yard?.queued ?? -1) running=\(model.yard?.running ?? -1)")
        let snap = SharedSnapshot.load()
        print("SAMTEST \(snap.paired ? "PASS" : "FAIL") widget-snapshot paired=\(snap.paired) reachable=\(snap.reachable)")
    }
}
#endif
