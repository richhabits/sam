import Foundation
import PDFKit
import UniformTypeIdentifiers
import SAMKit
import Vision

/// What someone shared into SAM, turned into text on this device.
/// Photos are read with Vision OCR and PDFs with PDFKit, both on-device; nothing is uploaded
/// anywhere except the resulting text, and only to the person's own SAM.
struct SharedContent: Equatable {
    enum Kind: String { case link, text, image, pdf }
    var kind: Kind
    var title: String
    var text: String
    var url: URL?

    static let maxCharacters = 12_000

    /// Pulls the first usable attachment out of the share sheet's items.
    static func extract(from items: [NSExtensionItem]) async -> SharedContent? {
        let providers = items.flatMap { $0.attachments ?? [] }
        let title = items.compactMap { $0.attributedContentText?.string }.first ?? ""

        // A web page shared from Safari arrives as a URL; prefer it over its plain-text twin.
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL, !url.isFileURL {
                return SharedContent(kind: .link, title: title, text: "", url: url)
            }
        }
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
            if let data = await data(p, UTType.pdf), let doc = PDFDocument(data: data) {
                let pages = (0..<min(doc.pageCount, 40)).compactMap { doc.page(at: $0)?.string }
                return SharedContent(kind: .pdf, title: (doc.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String) ?? title,
                                     text: clip(pages.joined(separator: "\n\n")), url: nil)
            }
        }
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            if let data = await data(p, UTType.image) {
                let request = RecognizeTextRequest()
                let lines = (try? await request.perform(on: data))?.compactMap { $0.topCandidates(1).first?.string } ?? []
                return SharedContent(kind: .image, title: title, text: clip(lines.joined(separator: "\n")), url: nil)
            }
        }
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let s = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                return SharedContent(kind: .text, title: title, text: clip(s), url: nil)
            }
        }
        return nil
    }

    private static func data(_ p: NSItemProvider, _ type: UTType) async -> Data? {
        await withCheckedContinuation { c in
            _ = p.loadDataRepresentation(for: type) { data, _ in c.resume(returning: data) }
        }
    }

    private static func clip(_ s: String) -> String {
        s.count > maxCharacters ? String(s.prefix(maxCharacters)) : s
    }

    /// A link is the person's own request ("look at this"), so SAM may use its tools to read it:
    /// its web fetch fences what the page says. Text, photos and PDFs carry outside content,
    /// so they go untrusted: no tools, memory or log (server/stream-policy.ts).
    var isUntrusted: Bool { kind != .link }

    func prompt(action: PagePrompt.Action, question: String) -> String {
        switch kind {
        case .link:
            let ask = action == .ask && !question.trimmingCharacters(in: .whitespaces).isEmpty ? question : action.instruction
            return "\(ask)\n\nLink: \(url?.absoluteString ?? "")"
        case .text, .image, .pdf:
            return PagePrompt.make(action: action, question: question, title: title.isEmpty ? kind.label : title,
                                          url: "", text: text)
        }
    }
}

extension SharedContent.Kind {
    var label: String {
        switch self {
        case .link: "Link"
        case .text: "Text"
        case .image: "Text from a photo"
        case .pdf: "PDF"
        }
    }
    var symbol: String {
        switch self {
        case .link: "link"
        case .text: "text.alignleft"
        case .image: "text.viewfinder"
        case .pdf: "doc.richtext"
        }
    }
}
