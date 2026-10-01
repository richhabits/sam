import Foundation
import SAMKit
import SafariServices

/// Native half of the Safari extension. The popup's JavaScript sends the page here with
/// `browser.runtime.sendNativeMessage`; this reads the session from the shared Keychain,
/// asks the brain, and returns the answer. The token never reaches JavaScript.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]
        Task {
            let reply = await Self.handle(message)
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: reply]
            context.completeRequest(returningItems: [response])
        }
    }

    static func handle(_ message: [String: Any]) async -> [String: Any] {
        switch message["action"] as? String {
        case "status":
            guard let brain = Session.brain else { return ["paired": false] }
            return ["paired": true, "reachable": await BrainClient.isUp(brain.host)]

        case "page":
            guard let brain = Session.brain else {
                return ["error": "Open the SAM app and pair it with your Mac first."]
            }
            guard Session.isDemo || AIConsent.hasAllowedAnything() else {
                return ["error": "Open the SAM app first and choose whether your Mac's AI services may be used."]
            }
            let action = PagePrompt.Action(rawValue: message["mode"] as? String ?? "") ?? .summarise
            let prompt = PagePrompt.make(action: action,
                                         question: message["question"] as? String,
                                         title: message["title"] as? String ?? "",
                                         url: message["url"] as? String ?? "",
                                         text: message["text"] as? String ?? "")
            do {
                // untrusted: the page can't make SAM run tools, trigger routines or write memory.
                let answer = try await Session.ask(prompt, brain: brain, untrusted: true)
                if let tool = answer.needsApproval {
                    return ["error": "SAM wanted to use \(tool) — pages can't do that. Ask in the SAM app instead."]
                }
                return ["text": answer.text, "provider": answer.provider ?? ""]
            } catch {
                return ["error": "Couldn't reach SAM on your Mac: \(error.localizedDescription)"]
            }

        default:
            return ["error": "Unknown request."]
        }
    }
}
