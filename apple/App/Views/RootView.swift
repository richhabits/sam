import SAMKit
import SwiftData
import SwiftUI

enum AppSection: String, Hashable, CaseIterable {
    case chat, vault, studio, yard, more, crew, tools, addOns, settings
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var phase
    @State private var lock = AppLock.shared
    // DEBUG/screenshots: -samTab chat|vault|studio|yard|more|crew|tools|addOns|settings picks the first screen.
    @State private var section: AppSection = {
        #if DEBUG
        AppSection(rawValue: UserDefaults.standard.string(forKey: "samTab") ?? "") ?? .chat
        #else
        .chat
        #endif
    }()
    @State private var skippedPairing = UserDefaults.standard.object(forKey: "sam.skippedPairing") as? Bool ?? true
    @State private var incomingLink: PairLink?

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
        .onReceive(NotificationCenter.default.publisher(for: .samOpenSection)) { note in
            if let raw = note.object as? String, let next = AppSection(rawValue: raw) { section = next }
        }
        .sheet(item: Binding(get: { model.consentRequest.map(ConsentItem.init) }, set: { if $0 == nil && model.consentRequest != nil { model.answerConsent(false) } })) { item in
            ConsentSheet(providers: item.providers).environment(model)
        }
        .confirmationDialog("Pair with this SAM?", isPresented: Binding(get: { incomingLink != nil }, set: { if !$0 { incomingLink = nil } }),
                            titleVisibility: .visible, presenting: incomingLink) { link in
            Button("Pair") {
                Task {
                    do { try await model.pair(link: link, fallbackHost: nil) } catch { model.lastError = error.localizedDescription }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { link in
            Text("\(link.host ?? "Unknown address")\(link.fingerprint.map { "\nCertificate \($0.prefix(16))…" } ?? "")\n\nOnly pair if this link came from your own Mac.")
        }
    }

    private var tabs: some View {
        // iPhone gets five tabs (HIG: five or fewer); iPad, Mac and Vision Pro list everything in the
        // sidebar. "More" only exists in the tab bar; the four it holds only exist in the sidebar.
        TabView(selection: $section) {
            Tab("Chat", systemImage: "bubble.left.and.text.bubble.right", value: .chat) { ChatView() }
            // The mind is the app. These are things it can do, so they stay out of the phone tab bar.
            Tab("Studio", systemImage: "paintpalette", value: .studio) { StudioView() }
                .defaultVisibility(.hidden, for: .tabBar)
            Tab("Yard", systemImage: "hammer", value: .yard) { YardView() }
                .badge(model.yard.map { $0.running + $0.queued } ?? 0)
                .defaultVisibility(.hidden, for: .tabBar)
            Tab("Vault", systemImage: "books.vertical", value: .vault) { VaultView() }
                .defaultVisibility(.hidden, for: .tabBar)
            #if !os(macOS)
            Tab("More", systemImage: "ellipsis.circle", value: .more) { MoreView(section: $section) }
                .defaultVisibility(.hidden, for: .sidebar)
            #endif
            Tab("Crew", systemImage: "person.3", value: .crew) { CrewView(section: $section) }
                .defaultVisibility(.hidden, for: .tabBar)
            Tab("Tools", systemImage: "wrench.and.screwdriver", value: .tools) { ToolsView() }
                .defaultVisibility(.hidden, for: .tabBar)
            Tab("Add-ons", systemImage: "puzzlepiece.extension", value: .addOns) { AddOnsView() }
                .defaultVisibility(.hidden, for: .tabBar)
            Tab("Settings", systemImage: "gearshape", value: .settings) { SettingsView() }
                .defaultVisibility(.hidden, for: .tabBar)
        }
        .tabViewStyle(.sidebarAdaptable)
        #if os(iOS)
        // The demo label lives in the tab bar's accessory (the strip Music uses for Now Playing),
        // so it never covers a title or a button.
        .modifier(DemoAccessory(on: model.isDemo))
        #else
        .overlay(alignment: .top) {
            if model.isDemo { DemoBanner().allowsHitTesting(false) }
        }
        #endif
    }

    private func handle(_ url: URL) {
        if let link = PairLink.parse(url.absoluteString) {
            // A link can come from any web page, so it never pairs on its own: the person confirms.
            incomingLink = link
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

extension Notification.Name {
    /// Empty chat and deep links ask the root to show a section. Object is an AppSection raw value.
    static let samOpenSection = Notification.Name("sam.openSection")
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
        if d.bool(forKey: "samConsentPreview"), let p = try? await model.brain?.aiProviders() {
            model.consentRequest = p      // preview only: no chat is waiting on it
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

/// Always visible while exploring, so sample data is never mistaken for real.
#if os(iOS)
/// iOS 26.1 can switch the accessory off; on 26.0 it's only attached while the demo is on.
private struct DemoAccessory: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: on) { DemoBanner(inAccessory: true) }
        } else if on {
            content.tabViewBottomAccessory { DemoBanner(inAccessory: true) }
        } else {
            content
        }
    }
}
#endif

struct DemoBanner: View {
    var inAccessory = false
    var body: some View {
        let label = Label("Demo · sample data, not your Mac", systemImage: "sparkles")
            .font(.footnote.weight(.semibold))
            .accessibilityLabel("Demo mode: sample data, not connected to a Mac")
        if inAccessory {
            label.foregroundStyle(.secondary).frame(maxWidth: .infinity)    // the accessory already is glass
        } else {
            label.padding(.horizontal, 12).padding(.vertical, 5).samGlass(in: .capsule).padding(.top, 2)
        }
    }
}

/// The iPhone's fifth tab: everything that lives in the sidebar on bigger screens.
struct MoreView: View {
    @Binding var section: AppSection
    var body: some View {
        NavigationStack {
            List {
                Section("Ask SAM") {
                    Button { section = .studio } label: { Label("Make a picture", systemImage: "paintpalette") }
                    Button { section = .yard } label: { Label("Jobs in the yard", systemImage: "hammer") }
                    Button { section = .addOns } label: { Label("Flip It and add-ons", systemImage: "puzzlepiece.extension") }
                    Button { section = .vault } label: { Label("Notes", systemImage: "books.vertical") }
                }
                Section {
                    NavigationLink { CrewView(section: $section) } label: { Label("Crew", systemImage: "person.3") }
                    NavigationLink { ToolsView() } label: { Label("Tools", systemImage: "wrench.and.screwdriver") }
                    NavigationLink { SettingsView() } label: { Label("Settings", systemImage: "gearshape") }
                }
            }
            .navigationTitle("More")
        }
    }
}

/// Wraps the provider list so it can drive `.sheet(item:)`.
struct ConsentItem: Identifiable {
    let providers: AIProviders
    var id: String { providers.thirdParties.map(\.id).joined(separator: ",") }
}
