import SAMKit
import SwiftData
import SwiftUI

/// One SwiftData store for every scene (main window, menu bar, the Mac quick panel).
enum SAMStore {
    static let container: ModelContainer = {
        do {
            // Chat history stays in the app's own container, not the app group: extensions don't
            // read it, and on a fresh device the group's Library folder doesn't exist yet
            // (SwiftData then fails to create the store; seen on the iPad, 2026-10-01).
            // A fresh install has no Application Support folder yet, and SwiftData won't create it.
            let support = URL.applicationSupportDirectory
            try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
            let config = ModelConfiguration("SAM", url: support.appending(path: "SAM.store"))
            return try ModelContainer(for: Conversation.self, Message.self, configurations: config)
        } catch {
            // A damaged store must not brick the app: fall back to memory and say so in the log.
            print("SAM: SwiftData store failed (\(error)); using in-memory history this launch")
            return try! ModelContainer(for: Conversation.self, Message.self,
                                       configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        }
    }()
}

@main
struct SAMApp: App {
    @State private var model = AppModel.shared
    let container = SAMStore.container
    #if os(macOS)
    @NSApplicationDelegateAdaptor(MacAppDelegate.self) private var macDelegate
    #endif

    init() {
        #if os(iOS)
        PhoneLink.shared.start()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                #if os(macOS)
                .frame(minWidth: 720, minHeight: 520)
                #endif
        }
        .modelContainer(container)
        #if os(macOS)
        .windowToolbarStyle(.unified)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
        #endif
        #if os(visionOS)
        .defaultSize(width: 900, height: 700)
        #endif

        #if os(macOS)
        // ⌘, opens Settings in its own window, like every Mac app.
        Settings {
            SettingsView()
                .environment(model)
                .frame(width: 520, height: 560)
        }

        // Quick ask from the menu bar, without bringing the main window forward.
        MenuBarExtra("SAM", systemImage: "brain.head.profile") {
            QuickAskView()
                .environment(model)
                .modelContainer(container)
                .frame(width: 380, height: 460)
        }
        .menuBarExtraStyle(.window)
        #endif
    }
}

#if os(macOS)
struct QuickAskView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.modelContext) private var context
    @Environment(\.openWindow) private var openWindow
    @State private var convo = Conversation(title: "Quick ask")
    @State private var draft = ""
    @State private var inserted = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                SAMMark(size: 22)
                Text("SAM").font(.headline)
                Spacer()
                ConnectionBadge(paired: model.isPaired, reachable: model.reachable)
            }
            .padding(12)
            ScrollView {
                LazyVStack(spacing: 10) { ForEach(convo.sorted) { MessageRow(message: $0) } }.padding(12)
            }
            .defaultScrollAnchor(.bottom)
            HStack {
                TextField("Ask SAM", text: $draft).textFieldStyle(.plain).onSubmit(send)
                Button(action: model.busy ? model.stop : send) {
                    Image(systemName: model.busy ? "stop.fill" : "arrow.up.circle.fill").font(.title2)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(model.busy ? "Stop" : "Send")
                .foregroundStyle(Color.sam)
            }
            .padding(10)
            .samGlass(in: .capsule)
            .padding(10)
        }
    }

    private func send() {
        if !inserted { context.insert(convo); inserted = true }
        model.send(draft, in: convo, context: context)
        draft = ""
    }
}
#endif
