import AppIntents
import SAMKit

/// "Hey Siri, ask SAM…", the Action button, Spotlight and Shortcuts all land here.
struct AskSAMIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask SAM"
    /// SAM can act on your Mac, so Siri never runs it from a locked device.
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
    static let description = IntentDescription("Ask SAM a question and hear the answer. Uses your Mac when it's reachable, Apple Intelligence on this device when it isn't.")

    @Parameter(title: "Question", requestValueDialog: "What would you like to ask SAM?")
    var question: String

    static var parameterSummary: some ParameterSummary { Summary("Ask SAM \(\.$question)") }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let answer = try await Self.ask(question)
        return .result(value: answer, dialog: IntentDialog(stringLiteral: answer))
    }

    static func ask(_ question: String) async throws -> String {
        // Siri/Watch can't show the consent sheet: only use the Mac once the person said yes in the app.
        if let brain = Session.brain, Session.isDemo || AIConsent.hasAllowedAnything(),
           let answer = try? await Session.ask(question, brain: brain) {
            if let tool = answer.needsApproval { return "SAM needs your approval to use \(tool). Open SAM to allow it." }
            if !answer.text.isEmpty { return answer.text }
        }
        guard OnDeviceBrain.isAvailable else {
            throw BrainError(0, OnDeviceBrain.unavailableReason ?? "SAM can't answer right now.")
        }
        var last = ""
        for try await snapshot in OnDeviceBrain.stream(question, history: []) { last = snapshot }
        return last
    }
}

/// "What's running in SAM's yard?"
struct YardStatusIntent: AppIntent {
    static let title: LocalizedStringResource = "Check SAM's Yard"
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
    static let description = IntentDescription("Hear what SAM is building on your Mac.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let brain = Session.brain else {
            return .result(dialog: "SAM isn't paired with a Mac yet.")
        }
        let yard = try await brain.yard()
        var line = "\(yard.running) running, \(yard.queued) queued"
        if yard.failed > 0 { line += ", \(yard.failed) failed" }
        if let job = yard.recent?.first { line += ". Latest: \(job.title), \(job.state)." }
        return .result(dialog: IntentDialog(stringLiteral: line))
    }
}

struct OpenChatIntent: AppIntent {
    static let title: LocalizedStringResource = "New SAM Chat"
    static let openAppWhenRun = true
    func perform() async throws -> some IntentResult { .result() }
}

struct SAMShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AskSAMIntent(), phrases: [
            "Ask \(.applicationName)",
            "Ask \(.applicationName) a question",
        ], shortTitle: "Ask SAM", systemImageName: "bubble.left.and.text.bubble.right")
        AppShortcut(intent: YardStatusIntent(), phrases: [
            "What's running in \(.applicationName)",
            "Check \(.applicationName) yard",
        ], shortTitle: "Yard status", systemImageName: "hammer")
        AppShortcut(intent: OpenChatIntent(), phrases: [
            "New \(.applicationName) chat",
        ], shortTitle: "New chat", systemImageName: "square.and.pencil")
    }
}
