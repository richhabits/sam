import Foundation
import SwiftData

/// Conversations persist with SwiftData on the device. Nothing here leaves the device
/// except what the person sends to their own SAM.
@Model final class Conversation {
    var id: UUID = UUID()
    var title: String = "New chat"
    var created: Date = Date.now
    var updated: Date = Date.now
    /// Created while exploring the demo; deleted when the demo ends so it never mixes with real history.
    var demo: Bool = false
    @Relationship(deleteRule: .cascade, inverse: \Message.conversation) var messages: [Message]? = []

    init(title: String = "New chat") {
        self.title = title
    }

    var sorted: [Message] { (messages ?? []).sorted { $0.created < $1.created } }
}

@Model final class Message {
    var id: UUID = UUID()
    var role: String = "user"          // "user" | "assistant"
    var text: String = ""
    var created: Date = Date.now
    var provider: String?              // which brain answered: a cloud lane, or "on-device"
    var conversation: Conversation?

    init(role: String, text: String, provider: String? = nil) {
        self.role = role
        self.text = text
        self.provider = provider
    }

    var isUser: Bool { role == "user" }
}
