import SAMKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// The share sheet: see what's being sent, pick what SAM should do, read the answer in place.
struct ShareView: View {
    let items: [NSExtensionItem]
    var done: () -> Void

    @State private var content: SharedContent?
    @State private var loading = true
    @State private var action: PagePrompt.Action = .summarise
    @State private var question = ""
    @State private var answer: String?
    @State private var provider: String?
    @State private var error: String?
    @State private var working = false

    private let accent = Color(red: 0xF0 / 255, green: 0x82 / 255, blue: 0x4E / 255)

    var body: some View {
        NavigationStack {
            Form {
                if loading {
                    ProgressView("Reading…")
                } else if let content {
                    Section {
                        Label(content.kind.label, systemImage: content.kind.symbol).font(.headline)
                        if let url = content.url {
                            Text(url.absoluteString).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                        } else {
                            Text(content.text.isEmpty ? "No text found." : content.text)
                                .font(.callout).foregroundStyle(.secondary).lineLimit(4)
                        }
                    } footer: {
                        Text(content.isUntrusted
                             ? "Read as data only: SAM won't run tools on it, remember it or log it."
                             : "SAM can open this link with its own tools.")
                    }
                    Section("What should SAM do?") {
                        Picker("Action", selection: $action) {
                            ForEach(PagePrompt.Action.allCases, id: \.self) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        if action == .ask {
                            TextField("Your question", text: $question, axis: .vertical).lineLimit(1...4)
                        }
                    }
                    if let answer {
                        Section {
                            Text(answer).textSelection(.enabled)
                            Button("Copy answer") { copy(answer) }
                        } header: {
                            Text("SAM")
                        } footer: {
                            if let provider, !provider.isEmpty { Text("Answered by \(provider) on your Mac") }
                        }
                    }
                } else {
                    ContentUnavailableView("Nothing SAM can read", systemImage: "questionmark.square.dashed",
                                           description: Text("Share text, a link, a photo or a PDF."))
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Send to SAM")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(answer == nil ? "Cancel" : "Done", action: done) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(working ? "Asking…" : "Ask SAM") { Task { await ask() } }
                        .disabled(working || content == nil || (content?.text.isEmpty ?? true) && content?.url == nil)
                        .tint(accent)
                }
            }
        }
        .task {
            content = await SharedContent.extract(from: items)
            loading = false
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 420)
        #endif
    }

    private func ask() async {
        guard let content else { return }
        guard let brain = Session.brain else {
            error = "Open the SAM app and pair it with your Mac first."
            return
        }
        guard Session.isDemo || AIConsent.hasAllowedAnything() else {
            error = "Open the SAM app first and choose whether your Mac's AI services may be used."
            return
        }
        working = true
        error = nil
        defer { working = false }
        do {
            let result = try await Session.ask(content.prompt(action: action, question: question), brain: brain,
                                               untrusted: content.isUntrusted)
            if let tool = result.needsApproval {
                error = "SAM wants to use \(tool). Approve it in the SAM app."
            }
            answer = result.text.isEmpty ? nil : result.text
            provider = result.provider
        } catch {
            self.error = "Couldn't reach SAM on your Mac: \(error.localizedDescription)"
        }
    }

    private func copy(_ s: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = s
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
        #endif
    }
}

#if canImport(UIKit)
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let host = UIHostingController(rootView: ShareView(items: items) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        })
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }
}
#else
final class ShareViewController: NSViewController {
    override func loadView() {
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        view = NSHostingView(rootView: ShareView(items: items) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        })
    }
}
#endif
