import Foundation
import SAMKit
import UserNotifications

/// Tells the person when a yard job finishes or fails, on any device that's watching the yard.
/// Only transitions seen by this device notify, so opening the app never replays old jobs.
@MainActor final class YardNotifier {
    static let shared = YardNotifier()
    private var lastStates: [String: String] = [:]
    private var primed = false
    private var asked = false

    func observe(_ yard: YardSummary) async {
        let jobs = yard.recent ?? []
        defer {
            lastStates = Dictionary(jobs.map { ($0.id, $0.state) }, uniquingKeysWith: { a, _ in a })
            primed = true
        }
        guard primed else { return }   // first look: remember, don't notify
        for job in jobs {
            guard let before = lastStates[job.id], before != job.state,
                  ["done", "failed"].contains(job.state) else { continue }
            await notify(job)
        }
    }

    private func notify(_ job: YardJob) async {
        let center = UNUserNotificationCenter.current()
        if !asked {
            asked = true
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }
        let content = UNMutableNotificationContent()
        content.title = job.state == "done" ? "Done: \(job.title)" : "Failed: \(job.title)"
        if let p = job.project { content.subtitle = p }
        // Error text can carry paths or tokens; keep the lock screen to a short, generic line.
        content.body = job.state == "done" ? "SAM finished this in the yard." : "Open SAM to see what went wrong."
        content.sound = .default
        content.threadIdentifier = "yard"
        content.userInfo = ["url": "sam://yard"]
        try? await center.add(UNNotificationRequest(identifier: "yard-\(job.id)-\(job.state)", content: content, trigger: nil))
    }
}
