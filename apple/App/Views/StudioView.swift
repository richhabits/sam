import CoreTransferable
import Photos
import SAMKit
import SwiftUI
import UniformTypeIdentifiers

/// Studio: describe a picture and SAM's Mac makes it (free lanes first, then keyed ones).
/// Every generation spends the owner's provider budget, so nothing here runs on its own:
/// Generate and Enhance are explicit button presses, and there is no auto-retry.
struct StudioView: View {
    @Environment(AppModel.self) private var model
    @State private var prompt = ""
    @State private var style: StudioStyle? = StudioStyle.all.first
    @State private var lenses: [StudioLens] = []
    @State private var lensID: String?
    @State private var aspect: StudioAspect = .square
    @State private var results: [StudioResult] = []
    @State private var generating: Task<Void, Never>?
    @State private var startedAt: Date?
    @State private var enhancing = false
    @State private var failure: String?
    @State private var opened: StudioResult?
    @FocusState private var promptFocused: Bool

    private var lens: StudioLens? { lenses.first { $0.id == lensID } }
    private var busy: Bool { generating != nil }
    private var canGenerate: Bool { model.isPaired && !busy && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if !model.isPaired {
                        ContentUnavailableView("Not paired", systemImage: "link.badge.plus",
                                               description: Text("Studio renders on the Mac running SAM. Pair with it in Settings."))
                    }
                    promptCard
                    styles
                    options
                    generateBar
                    if let failure {
                        Label(failure, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .font(.callout)
                    }
                    gallery
                }
                .padding()
                .frame(maxWidth: 980)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Studio")
            .task(id: model.isPaired) { await loadLenses() }
            .sheet(item: $opened) { StudioResultDetail(result: $0) }
        }
    }

    // MARK: Prompt

    private var promptCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Describe a picture…", text: $prompt, axis: .vertical)
                .lineLimit(3...8)
                .textFieldStyle(.plain)
                .font(.title3)
                .focused($promptFocused)
                .onSubmit { if canGenerate { generate() } }
            HStack {
                Button {
                    Task { await enhance() }
                } label: {
                    Label(enhancing ? "Enhancing…" : "Enhance prompt", systemImage: "wand.and.sparkles")
                        .symbolEffect(.pulse, isActive: enhancing)
                }
                .samSecondary()
                .controlSize(.small)
                .disabled(enhancing || busy || prompt.trimmingCharacters(in: .whitespaces).isEmpty || !model.isPaired)
                .help("Ask SAM to rewrite your idea as a vivid, specific prompt (one free-lane text call).")
                Spacer()
                Text("\(prompt.count)").font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
            }
        }
        .padding(16)
        .samGlass(in: .rect(cornerRadius: 22))
    }

    // MARK: Style, lens, aspect

    private var styles: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Style").font(.headline)
            ScrollView(.horizontal) {
                LazyHStack(spacing: 12) {
                    StyleCard(style: nil, selected: style == nil, brain: model.brain) { style = nil }
                    ForEach(StudioStyle.all) { s in
                        StyleCard(style: s, selected: style == s, brain: model.brain) { style = s }
                    }
                }
                .padding(.vertical, 4)
            }
            .scrollIndicators(.hidden)
            .frame(height: 118)
        }
    }

    private var options: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Shape", selection: $aspect) {
                ForEach(StudioAspect.allCases) { a in
                    Label(a.rawValue, systemImage: a.symbol).tag(a)
                }
            }
            .pickerStyle(.segmented)
            if !lenses.isEmpty {
                Picker(selection: $lensID) {
                    Text("No lens").tag(String?.none)
                    ForEach(lenses) { l in
                        Text(l.name).tag(Optional(l.id))
                    }
                } label: {
                    Label("Lens", systemImage: "camera.aperture")
                }
                .pickerStyle(.menu)
                if let c = lens?.characteristics {
                    Text(c).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: Generate

    private var generateBar: some View {
        HStack(spacing: 12) {
            if busy {
                ProgressView().controlSize(.small)
                if let startedAt {
                    Text(timerInterval: startedAt...Date.distantFuture, countsDown: false)
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Text("Rendering on your Mac…").font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button("Stop", role: .cancel) { generating?.cancel() }.samSecondary()
            } else {
                Text("Uses your free image lanes first.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button(action: generate) {
                    Label("Generate", systemImage: "sparkles")
                        .padding(.horizontal, 6)
                }
                .samProminent()
                .controlSize(.large)
                .disabled(!canGenerate)
                .keyboardShortcut(.return, modifiers: .command)
            }
        }
        .animation(.smooth, value: busy)
    }

    private func generate() {
        guard canGenerate, let brain = model.brain else { return }
        let idea = prompt
        let full = StudioPrompt.compose(idea, style: style, lens: lens)
        let shape = aspect
        failure = nil
        startedAt = .now
        promptFocused = false
        generating = Task {
            defer { generating = nil; startedAt = nil }
            guard await model.macAllowed() else {
                failure = "Studio needs your OK to use your Mac's AI services. Change it in Settings → AI and your data."
                return
            }
            do {
                let url = try await brain.generateImage(prompt: full, aspect: shape)
                try Task.checkCancellation()
                withAnimation(.smooth) {
                    results.insert(StudioResult(url: url, prompt: idea, aspect: shape), at: 0)
                }
                Haptics.success()
            } catch is CancellationError {
            } catch let e as BrainError where e.isMacOnly {
                failure = "Studio only renders from SAM on your Mac. Open SAM there to generate."
            } catch {
                if !Task.isCancelled { failure = error.localizedDescription }
            }
        }
    }

    private func enhance() async {
        guard let brain = model.brain else { return }
        enhancing = true
        defer { enhancing = false }
        guard await model.macAllowed() else {
            failure = "Enhancing needs your OK to use your Mac's AI services. Change it in Settings → AI and your data."
            return
        }
        do {
            let better = try await brain.enhancePrompt(prompt, style: style?.label)
            withAnimation(.smooth) { prompt = better }
            failure = nil
        } catch {
            failure = error.localizedDescription
        }
    }

    private func loadLenses() async {
        guard let brain = model.brain else { lenses = []; return }
        lenses = (try? await brain.studioLenses()) ?? []
    }

    // MARK: Gallery

    @ViewBuilder private var gallery: some View {
        if results.isEmpty {
            ContentUnavailableView("Nothing made yet", systemImage: "paintpalette",
                                   description: Text("Pictures you generate this session appear here. Save them to Photos or share them."))
                .frame(maxWidth: .infinity)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("This session").font(.headline)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], spacing: 12) {
                    ForEach(results) { r in
                        StudioTile(result: r, brain: model.brain)
                            .onTapGesture { opened = r }
                    }
                }
            }
        }
    }
}

// MARK: - Model

struct StudioResult: Identifiable, Hashable {
    let id = UUID()
    let url: URL
    let prompt: String
    let aspect: StudioAspect
}

/// Loaded image bytes plus what they are, for Photos, sharing and drag-out.
struct StudioPicture: Transferable {
    let data: Data
    let name: String

    var type: UTType {
        if data.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return .png }
        if data.count > 12, data[8..<12] == Data("WEBP".utf8) { return .webP }
        return .jpeg
    }

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .png) { $0.data }
            .exportingCondition { $0.type == .png }
            .suggestedFileName { "\($0.name).png" }
        DataRepresentation(exportedContentType: .webP) { $0.data }
            .exportingCondition { $0.type == .webP }
            .suggestedFileName { "\($0.name).webp" }
        DataRepresentation(exportedContentType: .jpeg) { $0.data }
            .exportingCondition { $0.type == .jpeg }
            .suggestedFileName { "\($0.name).jpg" }
    }

    var image: Image? { Image(samData: data) }

    /// Add-only Photos access: SAM can save into the library but never read it.
    func saveToPhotos() async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            throw BrainError(0, "Allow SAM to add photos in Settings › Privacy › Photos.")
        }
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
        }
    }
}

extension Image {
    init?(samData data: Data) {
        #if os(macOS)
        guard let img = NSImage(data: data) else { return nil }
        self.init(nsImage: img)
        #else
        guard let img = UIImage(data: data) else { return nil }
        self.init(uiImage: img)
        #endif
    }
}

/// Loads one image from the brain (with this device's session) and caches it per URL.
@MainActor @Observable final class StudioImageLoader {
    static let shared = StudioImageLoader()
    private var cache: [URL: Data] = [:]

    func data(_ url: URL, brain: BrainClient?) async -> Data? {
        if let d = cache[url] { return d }
        guard let brain, let d = try? await brain.media(url) else { return nil }
        cache[url] = d
        return d
    }
}

// MARK: - Views

private struct StyleCard: View {
    let style: StudioStyle?
    let selected: Bool
    let brain: BrainClient?
    let pick: () -> Void
    @State private var thumb: Data?

    var body: some View {
        Button(action: pick) {
            VStack(spacing: 6) {
                ZStack {
                    if let thumb, let image = Image(samData: thumb) {
                        image.resizable().scaledToFill()
                    } else {
                        Rectangle().fill(.samGradient.opacity(style == nil ? 0.35 : 0.15))
                        Image(systemName: style == nil ? "circle.slash" : "photo")
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(width: 108, height: 74)
                .clipShape(.rect(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(selected ? Color.sam : .clear, lineWidth: 3)
                }
                Text(style?.label ?? "No style")
                    .font(.caption.weight(selected ? .semibold : .regular))
                    .foregroundStyle(selected ? Color.sam : .primary)
                    .lineLimit(1)
            }
            .frame(width: 108)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .task(id: style?.id) {
            guard let style, let url = brain?.stylePreviewURL(style) else { return }
            thumb = await StudioImageLoader.shared.data(url, brain: brain)
        }
    }
}

private struct StudioTile: View {
    let result: StudioResult
    let brain: BrainClient?
    @State private var picture: StudioPicture?
    @State private var failed = false
    @State private var saved = false

    var body: some View {
        ZStack {
            if let picture, let image = picture.image {
                image.resizable().scaledToFill()
            } else if failed {
                ContentUnavailableView("Couldn't load", systemImage: "photo.badge.exclamationmark")
            } else {
                Rectangle().fill(.quaternary)
                ProgressView()
            }
        }
        .aspectRatio(result.aspect.ratio, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipShape(.rect(cornerRadius: 18, style: .continuous))
        .overlay(alignment: .topTrailing) {
            if saved {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.white, .green)
                    .padding(8)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .contentShape(.rect(cornerRadius: 18))
        .contextMenu {
            if let picture {
                Button { Task { await save(picture) } } label: { Label("Save to Photos", systemImage: "square.and.arrow.down") }
                ShareLink(item: picture, preview: SharePreview(result.prompt, image: picture.image ?? Image(systemName: "photo")))
            }
            Button { copy(result.prompt) } label: { Label("Copy prompt", systemImage: "doc.on.doc") }
        }
        #if os(macOS)
        .modifier(DragOut(picture: picture))
        #endif
        .accessibilityLabel(Text(result.prompt))
        .task(id: result.url) {
            guard let d = await StudioImageLoader.shared.data(result.url, brain: brain) else { failed = true; return }
            picture = StudioPicture(data: d, name: Self.fileName(result.prompt))
        }
    }

    private func save(_ p: StudioPicture) async {
        do {
            try await p.saveToPhotos()
            withAnimation(.bouncy) { saved = true }
        } catch {
            saved = false
        }
    }

    static func fileName(_ prompt: String) -> String {
        let words = prompt.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).prefix(6).joined(separator: "-")
        return words.isEmpty ? "SAM Studio" : "SAM \(words)"
    }
}

#if os(macOS)
/// Drag a finished picture straight into Finder, Mail, Keynote…
private struct DragOut: ViewModifier {
    let picture: StudioPicture?
    func body(content: Content) -> some View {
        if let picture {
            content.draggable(picture) { picture.image?.resizable().scaledToFit().frame(width: 160) }
        } else {
            content
        }
    }
}
#endif

private func copy(_ text: String) {
    #if os(macOS)
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    #else
    UIPasteboard.general.string = text
    #endif
}

private struct StudioResultDetail: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let result: StudioResult
    @State private var picture: StudioPicture?
    @State private var status: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if let picture, let image = picture.image {
                    image.resizable().scaledToFit()
                        .clipShape(.rect(cornerRadius: 20, style: .continuous))
                        #if os(macOS)
                        .draggable(picture)
                        #endif
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                Text(result.prompt).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                if let status { Text(status).font(.caption).foregroundStyle(.secondary) }
            }
            .padding()
            .frame(minWidth: 320, minHeight: 360)
            .navigationTitle("Studio")
            #if !os(macOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                if let picture {
                    ToolbarItemGroup(placement: .primaryAction) {
                        Button {
                            Task {
                                do { try await picture.saveToPhotos(); status = "Saved to Photos." }
                                catch { status = error.localizedDescription }
                            }
                        } label: { Label("Save to Photos", systemImage: "square.and.arrow.down") }
                        ShareLink(item: picture, preview: SharePreview(result.prompt, image: picture.image ?? Image(systemName: "photo")))
                    }
                }
            }
            .task {
                if let d = await StudioImageLoader.shared.data(result.url, brain: model.brain) {
                    picture = StudioPicture(data: d, name: StudioTile.fileName(result.prompt))
                }
            }
        }
    }
}
