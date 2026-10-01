import PhotosUI
import SAMKit
import SwiftData
import SwiftUI
import Vision

struct ChatView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.modelContext) private var context
    @Query(sort: \Conversation.updated, order: .reverse) private var conversations: [Conversation]
    @State private var current: Conversation?
    @State private var draft = ""
    @State private var dictation = Dictation()
    @State private var speaker = Speaker.shared
    @State private var photo: PhotosPickerItem?
    @State private var readingPhoto = false
    @FocusState private var focused: Bool

    private var conversation: Conversation? { current ?? conversations.first }

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var regular: Bool { sizeClass == .regular }
    #else
    private let regular = true
    #endif

    var body: some View {
        Group {
            if regular {
                // iPad, Mac, Vision Pro: conversations beside the chat, like Messages and Notes.
                // A fixed conversation column beside the chat. (A NavigationSplitView nested inside
                // the app's sidebar TabView added an unpredictable leading inset on macOS.)
                HStack(spacing: 0) {
                    NavigationStack {
                        ConversationList(conversations: conversations, current: conversation, select: { current = $0 },
                                         newChat: newChat, delete: delete)
                    }
                    .frame(width: 300)
                    Divider()
                    NavigationStack { chatPane }
                        .frame(maxWidth: .infinity)
                }
            } else {
                NavigationStack { chatPane }
            }
        }
        .userActivity(ChatActivity.type) { activity in
            activity.title = conversation?.title ?? "SAM"
            activity.isEligibleForHandoff = true
            activity.isEligibleForSearch = false
        }
        .onChange(of: dictation.transcript) { _, t in if !t.isEmpty { draft = t } }
        .onChange(of: photo) { _, item in if let item { Task { await readText(from: item) } } }
    }

    private var chatPane: some View {
        messages
            .safeAreaInset(edge: .bottom) { composer }
            .navigationTitle(conversation?.title ?? "SAM")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { toolbar }
            .sheet(item: pendingBinding) { approval in
                ApprovalSheet(approval: approval) { approved, always in
                    guard let conversation else { return }
                    Task { await model.answer(approval, approved: approved, always: always, in: conversation, context: context) }
                }
                .presentationDetents([.medium])
            }
    }

    // MARK: Messages

    private var messages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 20) {
                    if let conversation, !(conversation.messages ?? []).isEmpty {
                        ForEach(conversation.sorted) { MessageRow(message: $0) }
                    } else {
                        EmptyChat { draft = $0; focused = true }
                            .padding(.top, 48)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, Spacing.gutter)
                .padding(.vertical, 20)
                .readableWidth()
            }
            #if !os(visionOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .defaultScrollAnchor(.bottom)
            .onChange(of: conversation?.sorted.last?.text) { _, _ in
                withAnimation(.smooth(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
        }
    }

    // MARK: Composer

    private var composer: some View {
        VStack(spacing: 8) {
            if let err = dictation.error ?? model.lastError {
                Text(err).font(.caption).foregroundStyle(.orange).frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .bottom, spacing: 10) {
                PhotosPicker(selection: $photo, matching: .images) {
                    Image(systemName: readingPhoto ? "text.viewfinder" : "photo.badge.plus")
                        .symbolEffect(.pulse, isActive: readingPhoto)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Read text from a photo")

                TextField(dictation.listening ? "Listening…" : "Ask SAM anything", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...8)
                    .focused($focused)
                    .onSubmit(send)
                    .padding(.vertical, 8)

                Button { Task { await dictation.toggle() } } label: {
                    Image(systemName: dictation.listening ? "waveform" : "mic")
                        .symbolEffect(.variableColor.iterative, isActive: dictation.listening)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(dictation.listening ? Color.sam : .secondary)
                .accessibilityLabel(dictation.listening ? "Stop dictation" : "Dictate")

                Button(action: model.busy ? model.stop : send) {
                    Image(systemName: model.busy ? "stop.fill" : "arrow.up")
                        .font(.body.bold())
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(.samGradient, in: .circle)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.plain)
                .disabled(!model.busy && draft.trimmingCharacters(in: .whitespaces).isEmpty)
                .keyboardShortcut(.return, modifiers: .command)
                .accessibilityLabel(model.busy ? "Stop" : "Send")
            }
            .padding(.leading, 10)
            .padding(.trailing, 6)
            .padding(.vertical, 4)
            .samGlass(in: .rect(cornerRadius: 26), interactive: true)
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, 8)
        .padding(.bottom, 16)
        .readableWidth()
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if !regular {
        ToolbarItem(placement: .primaryAction) {
            Button { newChat() } label: { Label("New chat", systemImage: "square.and.pencil") }
                .keyboardShortcut("n", modifiers: .command)
        }
        ToolbarItem(placement: .primaryAction) {
            Menu {
                ForEach(conversations.prefix(30)) { c in
                    Button(c.title) { current = c }
                }
                if !conversations.isEmpty {
                    Divider()
                    Button("Delete this chat", role: .destructive) { deleteCurrent() }
                }
            } label: { Label("History", systemImage: "clock.arrow.circlepath") }
        }
        }
        ToolbarItem(placement: .status) {
            ConnectionBadge(paired: model.isPaired, reachable: model.reachable)
        }
    }

    private var pendingBinding: Binding<PendingApproval?> {
        Binding(get: { model.pending }, set: { model.pending = $0 })
    }

    // MARK: Actions

    private func send() {
        dictation.stop()
        let text = draft
        draft = ""
        let convo = conversation ?? {
            let c = Conversation()
            context.insert(c)
            current = c
            return c
        }()
        model.send(text, in: convo, context: context)
    }

    private func newChat() {
        let c = Conversation()
        context.insert(c)
        current = c
        focused = true
    }

    private func deleteCurrent() {
        guard let c = conversation else { return }
        delete(c)
    }

    private func delete(_ c: Conversation) {
        if current == c { current = nil }
        context.delete(c)
        try? context.save()
    }

    /// Vision OCR, on-device: the photo never leaves the device, only the text the person sends.
    private func readText(from item: PhotosPickerItem) async {
        readingPhoto = true
        defer { readingPhoto = false; photo = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let request = RecognizeTextRequest()
        guard let observations = try? await request.perform(on: data) else { return }
        let text = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        guard !text.isEmpty else { model.lastError = "No text found in that photo."; return }
        draft = draft.isEmpty ? text : draft + "\n\n" + text
        focused = true
    }
}

// MARK: - Rows

struct MessageRow: View {
    let message: Message
    @State private var speaker = Speaker.shared

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if message.isUser { Spacer(minLength: 64) } else { SAMMark(size: 30) }
            VStack(alignment: message.isUser ? .trailing : .leading, spacing: 4) {
                Group {
                    if message.text.isEmpty {
                        TypingDots()
                    } else {
                        Text(markdown)
                            .textSelection(.enabled)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .lineSpacing(3)
                .foregroundStyle(message.isUser ? .white : .primary)
                .background {
                    if message.isUser {
                        RoundedRectangle(cornerRadius: 20, style: .continuous).fill(.samGradient)
                    } else {
                        RoundedRectangle(cornerRadius: 20, style: .continuous).fill(.fill.tertiary)
                    }
                }
                if !message.isUser, let provider = message.provider {
                    Label(provider == "on-device" ? "Apple Intelligence · on-device" : provider,
                          systemImage: provider == "on-device" ? "apple.intelligence" : "desktopcomputer")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .contextMenu {
                Button { copy(message.text) } label: { Label("Copy", systemImage: "doc.on.doc") }
                Button { speaker.speak(message.text) } label: { Label("Read aloud", systemImage: "speaker.wave.2") }
                ShareLink(item: message.text)
            }
            if !message.isUser { Spacer(minLength: 64) }
        }
        .frame(maxWidth: .infinity, alignment: message.isUser ? .trailing : .leading)
    }

    private var markdown: AttributedString {
        (try? AttributedString(markdown: message.text,
                               options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(message.text)
    }

    private func copy(_ s: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
        #else
        UIPasteboard.general.string = s
        #endif
    }
}

struct TypingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Image(systemName: "ellipsis")
            .font(.title3)
            .symbolEffect(.variableColor.iterative.dimInactiveLayers, options: .repeating, isActive: !reduceMotion)
            .foregroundStyle(.secondary)
            .accessibilityLabel("SAM is thinking")
    }
}

struct EmptyChat: View {
    var pick: (String) -> Void
    private let ideas = [
        ("sparkles", "What can you do for me today?"),
        ("hammer", "What's running in the yard?"),
        ("doc.text.magnifyingglass", "Summarise my notes from this week"),
        ("globe", "Research the best free AI models right now"),
    ]
    var body: some View {
        VStack(spacing: 28) {
            VStack(spacing: 14) {
                SAMMark(size: 88)
                Text("How can I help?").font(.largeTitle.bold())
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: Spacing.item)], spacing: Spacing.item) {
                ForEach(ideas, id: \.1) { icon, text in
                    Button { pick(text) } label: {
                        Label(text, systemImage: icon)
                            .font(.body.weight(.medium))
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 14)
                    }
                    .buttonStyle(.plain)
                    .samGlass(in: .rect(cornerRadius: 18), interactive: true)
                }
            }
        }
    }
}

struct ApprovalSheet: View {
    let approval: PendingApproval
    var decide: (_ approved: Bool, _ always: Bool) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("SAM wants to use \(approval.tool)", systemImage: "hand.raised.fill")
                .font(.headline)
                .foregroundStyle(.orange)
            if let activity = approval.activity { Text(activity) }
            if let preview = approval.preview, !preview.isEmpty {
                ScrollView {
                    Text(preview).font(.callout.monospaced()).frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 160)
                .padding(10)
                .background(.fill.tertiary, in: .rect(cornerRadius: 12))
            }
            Spacer()
            HStack {
                Button("Don't allow", role: .cancel) { decide(false, false); dismiss() }.samSecondary()
                Spacer()
                Button("Always allow") { decide(true, true); dismiss() }.samSecondary()
                Button("Allow once") { decide(true, false); dismiss() }.samProminent()
            }
        }
        .padding(24)
    }
}

/// The sidebar of conversations on iPad, Mac and Vision Pro.
struct ConversationList: View {
    let conversations: [Conversation]
    let current: Conversation?
    var select: (Conversation) -> Void
    var newChat: () -> Void
    var delete: (Conversation) -> Void
    @State private var query = ""

    private var filtered: [Conversation] {
        query.isEmpty ? conversations : conversations.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        List(selection: Binding(get: { current?.id }, set: { id in
            if let c = conversations.first(where: { $0.id == id }) { select(c) }
        })) {
            ForEach(filtered) { c in
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.title).lineLimit(1)
                    Text(c.updated, format: .relative(presentation: .named))
                        .font(.caption).foregroundStyle(.secondary)
                }
                .tag(c.id)
                .contextMenu { Button("Delete", role: .destructive) { delete(c) } }
                .swipeActions { Button("Delete", role: .destructive) { delete(c) } }
            }
        }
        .overlay {
            if conversations.isEmpty {
                ContentUnavailableView("No chats yet", systemImage: "bubble.left.and.text.bubble.right",
                                       description: Text("Ask SAM anything to start one."))
            }
        }
        .searchable(text: $query, prompt: "Search chats")
        .navigationTitle("Chats")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: newChat) { Label("New chat", systemImage: "square.and.pencil") }
                    .keyboardShortcut("n", modifiers: .command)
            }
        }
    }
}
