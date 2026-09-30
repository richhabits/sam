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

    var body: some View {
        NavigationStack {
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
        .userActivity(ChatActivity.type) { activity in
            activity.title = conversation?.title ?? "SAM"
            activity.isEligibleForHandoff = true
            activity.isEligibleForSearch = false
        }
        .onChange(of: dictation.transcript) { _, t in if !t.isEmpty { draft = t } }
        .onChange(of: photo) { _, item in if let item { Task { await readText(from: item) } } }
    }

    // MARK: Messages

    private var messages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 14) {
                    if let conversation, !(conversation.messages ?? []).isEmpty {
                        ForEach(conversation.sorted) { MessageRow(message: $0) }
                    } else {
                        EmptyChat { draft = $0; focused = true }
                            .padding(.top, 60)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding()
                .frame(maxWidth: 820)
                .frame(maxWidth: .infinity)
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
                        .frame(width: 36, height: 36)
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
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
                .foregroundStyle(dictation.listening ? Color.sam : .secondary)
                .accessibilityLabel(dictation.listening ? "Stop dictation" : "Dictate")

                Button(action: model.busy ? model.stop : send) {
                    Image(systemName: model.busy ? "stop.fill" : "arrow.up")
                        .font(.body.bold())
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
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
        .padding(.horizontal)
        .padding(.bottom, 8)
        .frame(maxWidth: 820)
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
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
        context.delete(c)
        current = nil
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
            if message.isUser { Spacer(minLength: 48) } else { SAMMark(size: 28) }
            VStack(alignment: message.isUser ? .trailing : .leading, spacing: 4) {
                Group {
                    if message.text.isEmpty {
                        TypingDots()
                    } else {
                        Text(markdown)
                            .textSelection(.enabled)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
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
            if !message.isUser { Spacer(minLength: 48) }
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
    var body: some View {
        Image(systemName: "ellipsis")
            .font(.title3)
            .symbolEffect(.variableColor.iterative.dimInactiveLayers, options: .repeating)
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
        VStack(spacing: 20) {
            SAMMark(size: 72)
            Text("How can I help?").font(.title2.bold())
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], spacing: 12) {
                ForEach(ideas, id: \.1) { icon, text in
                    Button { pick(text) } label: {
                        Label(text, systemImage: icon)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
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
