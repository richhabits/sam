import SAMKit
import SwiftUI
import WatchConnectivity
import WatchKit
#if canImport(WidgetKit)
import WidgetKit
#endif

@main
struct SAMWatchApp: App {
    @State private var model = WatchModel()

    var body: some Scene {
        WindowGroup {
            WatchHome()
                .environment(model)
                .tint(Color(red: 0xF0 / 255, green: 0x82 / 255, blue: 0x4E / 255))
        }
    }
}

/// Talks to SAM through the iPhone (WatchConnectivity). The watch holds no session token.
@MainActor @Observable final class WatchModel: NSObject, WCSessionDelegate {
    var snapshot = SharedSnapshot.load()
    var answer: String?
    var asking = false
    var error: String?
    var phoneReachable = false

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func ask(_ question: String) {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        guard WCSession.default.isReachable else {
            error = "Open SAM on your iPhone, or bring it closer."
            WKInterfaceDevice.current().play(.failure)
            return
        }
        asking = true
        error = nil
        answer = nil
        WKInterfaceDevice.current().play(.start)
        WCSession.default.sendMessage(["ask": q]) { reply in
            Task { @MainActor in
                self.asking = false
                if let text = reply["text"] as? String {
                    self.answer = text
                    WKInterfaceDevice.current().play(.success)
                } else {
                    self.error = reply["error"] as? String ?? "SAM didn't answer."
                    WKInterfaceDevice.current().play(.failure)
                }
            }
        } errorHandler: { err in
            Task { @MainActor in
                self.asking = false
                self.error = err.localizedDescription
                WKInterfaceDevice.current().play(.failure)
            }
        }
    }

    // MARK: WCSessionDelegate

    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        let context = session.receivedApplicationContext
        Task { @MainActor in
            self.phoneReachable = session.isReachable
            self.apply(context)
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        Task { @MainActor in self.apply(context) }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor in self.phoneReachable = reachable }
    }

    private func apply(_ context: [String: Any]) {
        guard let data = context["snapshot"] as? Data,
              let snap = try? JSONDecoder().decode(SharedSnapshot.self, from: data) else { return }
        snapshot = snap
        snap.save()   // the watch's own app group, read by its complications
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}

struct WatchHome: View {
    @Environment(WatchModel.self) private var model
    @State private var question = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // System text input: dictation, Scribble or the keyboard.
                    TextField("Ask SAM", text: $question)
                        .onSubmit {
                            model.ask(question)
                            question = ""
                        }
                        .disabled(model.asking)

                    if model.asking {
                        HStack {
                            ProgressView()
                            Text("Thinking…").foregroundStyle(.secondary)
                        }
                    }
                    if let answer = model.answer {
                        Text(answer).font(.body)
                    }
                    if let error = model.error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote).foregroundStyle(.orange)
                    }

                    YardCard(snapshot: model.snapshot)
                }
                .padding(.horizontal, 4)
            }
            .navigationTitle("SAM")
        }
    }
}

private struct YardCard: View {
    let snapshot: SharedSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Yard", systemImage: "hammer").font(.headline)
            if !snapshot.paired {
                Text("Pair SAM on your iPhone first.").font(.footnote).foregroundStyle(.secondary)
            } else {
                HStack {
                    Text("\(snapshot.running)").font(.title2.bold()).foregroundStyle(.tint)
                    Text("running").foregroundStyle(.secondary)
                    Spacer()
                    Text("\(snapshot.queued) queued").font(.footnote)
                }
                if let job = snapshot.latestJob {
                    Text("\(job) · \(snapshot.latestState ?? "")").font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                }
                Text(snapshot.updated, style: .relative).font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .padding(10)
        .background(.fill.tertiary, in: .rect(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }
}
