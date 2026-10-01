import QuickLook
import SAMKit
import SwiftUI

/// The vault: SAM's Markdown notes on the Mac (daily logs, project notes, facts). Read-only.
/// The brain serves these to the desktop app and to paired devices (canReadPrivate), so a paired
/// iPhone can browse; anything it refuses with a 403 is shown as "Open on your Mac".
struct VaultView: View {
    @Environment(AppModel.self) private var model
    @State private var graph: VaultGraph?
    @State private var stats: VaultStats?
    @State private var log: [VaultLogEntry] = []
    @State private var failure: VaultFailure?
    @State private var loading = false
    @State private var query = ""
    @State private var selection: VaultNode?

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationTitle("Vault")
                #if os(macOS)
                .navigationSplitViewColumnWidth(min: 240, ideal: 290)
                #endif
        } detail: {
            NavigationStack {
                if let selection {
                    VaultNoteView(node: selection, graph: graph, select: { self.selection = $0 })
                        .id(selection)
                } else {
                    ContentUnavailableView("Pick a note", systemImage: "books.vertical",
                                           description: Text("Daily logs and project notes SAM keeps on your Mac."))
                }
            }
        }
        .task(id: model.isPaired) { await load() }
    }

    // MARK: Sidebar

    private var sidebar: some View {
        List(selection: $selection) {
            if graph != nil {
                Section {
                    VaultStatsHeader(stats: stats, linked: graph?.nodes.filter { $0.group == .link }.count ?? 0)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                if query.isEmpty && !log.isEmpty {
                    Section("Today") {
                        ForEach(log.prefix(6)) { entry in
                            Label {
                                Text(entry.msg).lineLimit(2)
                            } icon: {
                                Text(entry.time).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            }
                            .labelStyle(.titleAndIcon)
                            .font(.callout)
                            .selectionDisabled()
                        }
                    }
                }
                group("Memory", filter(graph?.memory), symbol: "brain")
                group("Projects", filter(graph?.projects), symbol: "folder")
                group("Daily", filter(graph?.daily), symbol: "calendar")
            }
        }
        .overlay { overlay }
        .searchable(text: $query, placement: .sidebar, prompt: "Search notes")
        .refreshable { await load() }
        .toolbar {
            #if os(macOS)
            ToolbarItem {
                Button { Task { await load() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .disabled(loading)
                    .keyboardShortcut("r")
            }
            #endif
        }
    }

    @ViewBuilder private func group(_ title: String, _ nodes: [VaultNode], symbol: String) -> some View {
        if !nodes.isEmpty {
            Section(title) {
                ForEach(nodes) { node in
                    NavigationLink(value: node) {
                        Label(node.title, systemImage: node.group == .daily ? "calendar" : symbol)
                    }
                }
            }
        }
    }

    private func filter(_ nodes: [VaultNode]?) -> [VaultNode] {
        guard let nodes else { return [] }
        guard !query.isEmpty else { return nodes }
        return nodes.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.id.localizedCaseInsensitiveContains(query) }
    }

    @ViewBuilder private var overlay: some View {
        if !model.isPaired {
            ContentUnavailableView("Not paired", systemImage: "link.badge.plus",
                                   description: Text("Pair with SAM on your Mac in Settings to read its vault."))
        } else if let failure {
            failure.view(retry: { Task { await load() } })
        } else if graph == nil {
            ProgressView("Opening the vault…")
        } else if let graph, graph.readable.isEmpty {
            ContentUnavailableView("The vault is empty", systemImage: "books.vertical",
                                   description: Text("SAM writes a daily log and project notes here as you work."))
        } else if !query.isEmpty, filter(graph?.readable).isEmpty {
            ContentUnavailableView.search(text: query)
        }
    }

    private func load() async {
        guard let brain = model.brain else { graph = nil; return }
        loading = true
        defer { loading = false }
        do {
            async let g = brain.vaultGraph()
            async let s = try? brain.vaultStats()
            async let l = try? brain.vaultLog()
            graph = try await g
            stats = await s
            log = await l ?? []
            failure = nil
        } catch {
            failure = VaultFailure(error)
        }
    }
}

/// Why a vault read failed, said the way a person can act on.
struct VaultFailure: Equatable {
    enum Kind { case macOnly, unpaired, unreachable }
    let kind: Kind
    let message: String

    init(_ error: Error) {
        let e = error as? BrainError
        if e?.isMacOnly == true { kind = .macOnly }
        else if e?.isUnpaired == true { kind = .unpaired }
        else { kind = .unreachable }
        message = error.localizedDescription
    }

    @ViewBuilder func view(retry: @escaping () -> Void) -> some View {
        switch kind {
        case .macOnly:
            ContentUnavailableView("Open on your Mac", systemImage: "desktopcomputer",
                                   description: Text("SAM keeps this to the Mac it runs on. Open SAM there to see it."))
        case .unpaired:
            ContentUnavailableView("Pair again", systemImage: "link.badge.plus",
                                   description: Text("SAM on your Mac doesn't recognise this device any more. Pair again in Settings."))
        case .unreachable:
            ContentUnavailableView {
                Label("Can't reach your Mac", systemImage: "desktopcomputer.trianglebadge.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try again", action: retry).samSecondary()
            }
        }
    }
}

private struct VaultStatsHeader: View {
    let stats: VaultStats?
    let linked: Int
    var body: some View {
        HStack(spacing: 10) {
            tile(stats?.projectNotes, "Projects", "folder.fill", .sam)
            tile(stats?.dailyNotes, "Days", "calendar", .blue)
            tile(linked, "Topics", "link", .purple)
        }
    }

    private func tile(_ value: Int?, _ label: String, _ symbol: String, _ color: Color) -> some View {
        VStack(spacing: 4) {
            Image(systemName: symbol).foregroundStyle(color)
            Text(value.map { "\($0)" } ?? "–").font(.title3.bold()).contentTransition(.numericText())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .samGlass(in: .rect(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Reader

struct VaultNoteView: View {
    @Environment(AppModel.self) private var model
    let node: VaultNode
    let graph: VaultGraph?
    let select: (VaultNode) -> Void
    @State private var content: String?
    @State private var failure: VaultFailure?
    @State private var file: URL?
    @State private var preview: URL?

    var body: some View {
        ScrollView {
            if let content {
                VStack(alignment: .leading, spacing: 18) {
                    MarkdownDocument(markdown: content)
                    backlinks
                }
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding()
                .textSelection(.enabled)
            }
        }
        .overlay {
            if let failure {
                failure.view(retry: { Task { await load() } })
            } else if content == nil {
                ProgressView()
            } else if content?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
                ContentUnavailableView("Empty note", systemImage: "doc")
            }
        }
        .navigationTitle(node.title)
        #if !os(macOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            if let file {
                ToolbarItemGroup {
                    #if !os(visionOS)
                    Button { preview = file } label: { Label("Quick Look", systemImage: "eye") }
                        .keyboardShortcut("y")
                    #endif
                    ShareLink(item: file, preview: SharePreview(node.title, image: Image(systemName: "doc.text")))
                }
            }
        }
        #if !os(visionOS)
        .quickLookPreview($preview)
        #endif
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "samvault" else { return .systemAction }
            let id = url.host(percentEncoded: false) ?? ""
            if let target = graph?.readable.first(where: { $0.id == id }) { select(target) }
            return .handled
        })
        .refreshable { await load() }
        .task { await load() }
    }

    @ViewBuilder private var backlinks: some View {
        let incoming = (graph?.links(of: node.id).incoming ?? []).compactMap { id in graph?.readable.first { $0.id == id } }
        if !incoming.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Linked from").font(.headline)
                FlowChips(nodes: incoming, select: select)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .samGlass(in: .rect(cornerRadius: 16))
        }
    }

    private func load() async {
        guard let brain = model.brain else { return }
        do {
            let text = try await brain.vaultNote(node).content
            content = text
            failure = nil
            file = Self.export(text, name: node.id)
        } catch {
            failure = VaultFailure(error)
        }
    }

    /// A temporary .md copy for Quick Look and sharing. Lives in this app's own temp folder.
    static func export(_ text: String, name: String) -> URL? {
        let safe = name.replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "-", options: .regularExpression)
        let url = URL.temporaryDirectory.appending(path: "Vault", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let file = url.appending(path: "\(safe).md")
        do { try text.write(to: file, atomically: true, encoding: .utf8) } catch { return nil }
        return file
    }
}

private struct FlowChips: View {
    let nodes: [VaultNode]
    let select: (VaultNode) -> Void
    var body: some View {
        ScrollView(.horizontal) {
            HStack {
                ForEach(nodes) { n in
                    Button(n.title) { select(n) }.samSecondary().controlSize(.small)
                }
            }
        }
        .scrollIndicators(.hidden)
    }
}

// MARK: - Markdown

/// Renders a note's Markdown with Foundation's parser: block structure (headings, lists, quotes,
/// code, rules) laid out here, inline styling (bold, italics, code, links) by AttributedString.
/// [[wikilinks]] become tappable links to the note they name.
struct MarkdownDocument: View {
    let markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(MarkdownBlock.parse(markdown).enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func view(for block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            Text(Self.inline(text))
                .font(level == 1 ? .title.bold() : level == 2 ? .title2.bold() : .headline)
                .padding(.top, level <= 2 ? 6 : 2)
        case .bullet(let text, let depth):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: depth == 0 ? "circle.fill" : "circle").font(.system(size: 5)).foregroundStyle(Color.sam)
                Text(Self.inline(text))
            }
            .padding(.leading, CGFloat(depth) * 16)
        case .task(let text, let done):
            Label { Text(Self.inline(text)).strikethrough(done) } icon: {
                Image(systemName: done ? "checkmark.circle.fill" : "circle").foregroundStyle(done ? .green : .secondary)
            }
        case .quote(let text):
            Text(Self.inline(text))
                .foregroundStyle(.secondary)
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Capsule().fill(Color.sam.opacity(0.6)).frame(width: 3) }
        case .code(let text):
            ScrollView(.horizontal) {
                Text(text).font(.callout.monospaced()).padding(12)
            }
            .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 10))
        case .rule:
            Divider()
        case .paragraph(let text):
            Text(Self.inline(text))
        }
    }

    static func inline(_ text: String) -> AttributedString {
        // [[note]] → [note](samvault://note) so it renders, and taps, as a link.
        let linked = text.replacing(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/) { m in
            let id = String(m.1)
            let label = m.2.map(String.init) ?? id
            let host = id.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed) ?? id
            return "[\(label)](samvault://\(host))"
        }
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace,
                                                              failurePolicy: .returnPartiallyParsedIfPossible)
        return (try? AttributedString(markdown: linked, options: options)) ?? AttributedString(text)
    }
}

enum MarkdownBlock: Equatable {
    case heading(Int, String)
    case bullet(String, depth: Int)
    case task(String, done: Bool)
    case quote(String)
    case code(String)
    case rule
    case paragraph(String)

    static func parse(_ markdown: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var code: [String]?
        func flush() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))) }
            paragraph = []
        }
        for raw in markdown.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                if let open = code { blocks.append(.code(open.joined(separator: "\n"))); code = nil }
                else { flush(); code = [] }
                continue
            }
            if code != nil { code?.append(raw); continue }
            if line.isEmpty { flush(); continue }
            let indent = raw.prefix { $0 == " " || $0 == "\t" }.count / 2
            if let m = line.wholeMatch(of: /(#{1,6})\s+(.*)/) {
                flush(); blocks.append(.heading(m.1.count, String(m.2)))
            } else if line == "---" || line == "***" || line == "___" {
                flush(); blocks.append(.rule)
            } else if let m = line.wholeMatch(of: /[-*+]\s+\[( |x|X)\]\s+(.*)/) {
                flush(); blocks.append(.task(String(m.2), done: m.1 != " "))
            } else if let m = line.wholeMatch(of: /(?:[-*+]|\d+[.)])\s+(.*)/) {
                flush(); blocks.append(.bullet(String(m.1), depth: indent))
            } else if line.hasPrefix(">") {
                flush(); blocks.append(.quote(String(line.dropFirst()).trimmingCharacters(in: .whitespaces)))
            } else {
                paragraph.append(line)
            }
        }
        if let open = code { blocks.append(.code(open.joined(separator: "\n"))) }
        flush()
        return blocks
    }
}
