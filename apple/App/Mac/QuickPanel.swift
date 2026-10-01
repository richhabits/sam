#if os(macOS)
import AppKit
import Carbon.HIToolbox
import SAMKit
import SwiftData
import SwiftUI

/// ⌥Space from anywhere: a floating, Spotlight-style panel to ask SAM without switching apps.
/// The hot key goes through Carbon's RegisterEventHotKey, which needs no Accessibility
/// permission (unlike a global event monitor). Replaces the Electron overlay on the Mac.
@MainActor final class QuickPanel {
    static let shared = QuickPanel()

    private var panel: NSPanel?
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private(set) var registered = false
    /// Text handed in from the Services menu, shown in the panel for the person to act on.
    var pendingText: String?

    func install(model: AppModel, container: ModelContainer) {
        guard panel == nil else { return }
        let p = FloatingPanel(contentRect: NSRect(x: 0, y: 0, width: 640, height: 460))
        let root = QuickPanelView(close: { [weak self] in self?.hide() })
            .environment(model)
            .modelContainer(container)
        p.contentView = NSHostingView(rootView: root)
        panel = p
        registerHotKey()
    }

    func toggle() {
        guard let panel else { return }
        panel.isVisible ? hide() : show()
    }

    func show(text: String? = nil) {
        guard let panel else { return }
        if let text { pendingText = text }
        NotificationCenter.default.post(name: .samQuickPanelWillShow, object: nil)
        if let screen = NSScreen.main {
            let f = screen.visibleFrame
            panel.setFrameTopLeftPoint(NSPoint(x: f.midX - panel.frame.width / 2, y: f.maxY - f.height * 0.18))
        }
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    func hide() {
        panel?.orderOut(nil)
    }

    private func registerHotKey() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            Task { @MainActor in QuickPanel.shared.toggle() }
            return noErr
        }, 1, &spec, nil, &handler)
        let id = EventHotKeyID(signature: OSType(0x53414D31), id: 1)   // 'SAM1'
        let status = RegisterEventHotKey(UInt32(kVK_Space), UInt32(optionKey), id, GetApplicationEventTarget(), 0, &hotKey)
        // Another app (the Electron SAM, Raycast…) may already own ⌥Space. The menu bar item
        // still opens the panel, so this is logged rather than fatal.
        registered = status == noErr
        if !registered { print("SAM: ⌥Space is taken by another app (status \(status)); use the menu bar icon.") }
    }
}

extension Notification.Name {
    static let samQuickPanelWillShow = Notification.Name("SAMQuickPanelWillShow")
}

/// A borderless panel that floats over full-screen apps, takes keyboard input without
/// activating the rest of SAM's windows, and closes with Escape or when it loses focus.
private final class FloatingPanel: NSPanel {
    init(contentRect: NSRect) {
        super.init(contentRect: contentRect,
                   styleMask: [.nonactivatingPanel, .titled, .fullSizeContentView, .resizable],
                   backing: .buffered, defer: false)
        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        isMovableByWindowBackground = true
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        backgroundColor = .clear
        standardWindowButton(.closeButton)?.isHidden = true
        standardWindowButton(.miniaturizeButton)?.isHidden = true
        standardWindowButton(.zoomButton)?.isHidden = true
    }

    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { orderOut(nil) }
    override func resignKey() {
        super.resignKey()
        orderOut(nil)
    }
}

private struct QuickPanelView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.modelContext) private var context
    var close: () -> Void

    @State private var convo = Conversation(title: "Quick ask")
    @State private var inserted = false
    @State private var draft = ""
    @State private var shared: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                SAMMark(size: 26)
                TextField(shared == nil ? "Ask SAM…" : "What should SAM do with this?", text: $draft)
                    .textFieldStyle(.plain)
                    .font(.title2)
                    .focused($focused)
                    .onSubmit(send)
                if model.busy {
                    Button(action: model.stop) { Image(systemName: "stop.circle.fill").font(.title2) }
                        .buttonStyle(.plain)
                        .foregroundStyle(Color.sam)
                } else {
                    ConnectionBadge(paired: model.isPaired, reachable: model.reachable)
                }
            }
            .padding(16)

            if let shared {
                HStack(alignment: .top) {
                    Image(systemName: "text.quote").foregroundStyle(.secondary)
                    Text(shared).lineLimit(3).font(.callout).foregroundStyle(.secondary)
                    Spacer()
                    Button { self.shared = nil } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
            }

            if !convo.sorted.isEmpty {
                Divider()
                ScrollView {
                    LazyVStack(spacing: 10) { ForEach(convo.sorted) { MessageRow(message: $0) } }
                        .padding(14)
                }
                .defaultScrollAnchor(.bottom)
            }
        }
        .frame(minWidth: 520, idealWidth: 640, minHeight: 64, maxHeight: 520)
        .samGlass(in: .rect(cornerRadius: 22))
        .onAppear { focused = true }
        .onReceive(NotificationCenter.default.publisher(for: .samQuickPanelWillShow)) { _ in
            if let text = QuickPanel.shared.pendingText {
                shared = text
                QuickPanel.shared.pendingText = nil
            }
            focused = true
        }
        .onExitCommand(perform: close)
    }

    private func send() {
        let ask = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !ask.isEmpty || shared != nil else { return }
        if !inserted { context.insert(convo); inserted = true }
        if let shared {
            // Selected text from another app is outside content: fenced and sent untrusted.
            let action: PagePrompt.Action = ask.isEmpty ? .summarise : .ask
            model.send(PagePrompt.make(action: action, question: ask, title: "Selected text", url: "", text: shared),
                       in: convo, context: context, untrusted: true, display: ask.isEmpty ? "Summarise the selected text" : ask)
            self.shared = nil
        } else {
            model.send(ask, in: convo, context: context)
        }
        draft = ""
    }
}
#endif
