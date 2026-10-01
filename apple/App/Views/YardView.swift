import SAMKit
import SwiftUI

/// The yard: long-running build jobs on the Mac.
struct YardView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            List {
                if let yard = model.yard {
                    Section {
                        HStack(spacing: 12) {
                            Stat(value: yard.running, label: "Running", color: .sam, symbol: "gearshape.2")
                            Stat(value: yard.queued, label: "Queued", color: .blue, symbol: "tray.full")
                            Stat(value: yard.done, label: "Done", color: .green, symbol: "checkmark.seal")
                            Stat(value: yard.failed, label: "Failed", color: .red, symbol: "xmark.octagon")
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                    if let error = yard.error {
                        Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    }
                    Section("Recent") {
                        if (yard.recent ?? []).isEmpty {
                            ContentUnavailableView("Nothing in the yard", systemImage: "hammer",
                                                   description: Text("Builds and deploys SAM runs on your Mac show up here."))
                        }
                        ForEach(yard.recent ?? []) { job in
                            NavigationLink(value: job) { JobRow(job: job) }
                                .swipeActions {
                                    if job.isActive {
                                        Button("Cancel", role: .destructive) { Task { await model.cancel(job) } }
                                    } else if job.state == "failed" {
                                        Button("Retry") { Task { await model.retry(job) } }.tint(.sam)
                                    }
                                }
                        }
                    }
                } else if model.isPaired {
                    ContentUnavailableView("Can't reach your Mac", systemImage: "desktopcomputer.trianglebadge.exclamationmark",
                                           description: Text("The yard lives on the Mac running SAM. Check it's awake and on the same network."))
                } else {
                    ContentUnavailableView("Not paired", systemImage: "link.badge.plus",
                                           description: Text("Pair with SAM on your Mac in Settings to see its yard."))
                }
            }
            .readableWidth(900)
            .navigationTitle("Yard")
            .navigationDestination(for: YardJob.self) { JobDetail(job: $0) }
            .refreshable { await model.refresh() }
        }
    }
}


private struct Stat: View {
    let value: Int
    let label: String
    let color: Color
    let symbol: String
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: symbol).foregroundStyle(color)
            Text("\(value)").font(.title2.bold()).contentTransition(.numericText())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .samGlass(in: .rect(cornerRadius: 18))
        .accessibilityElement(children: .combine)
    }
}

struct JobRow: View {
    let job: YardJob
    var body: some View {
        HStack(spacing: 12) {
            StateIcon(state: job.state)
            VStack(alignment: .leading, spacing: 2) {
                Text(job.title).font(.body.weight(.medium))
                HStack(spacing: 6) {
                    if let project = job.project { Text(project) }
                    Text("\(job.created, style: .relative) ago")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }
}

struct StateIcon: View {
    let state: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Image(systemName: symbol)
            .foregroundStyle(color)
            .symbolEffect(.rotate, isActive: state == "running" && !reduceMotion)
            .frame(width: 24)
            .accessibilityLabel(state)
    }
    private var symbol: String {
        switch state {
        case "running": "gearshape.2.fill"
        case "queued": "clock"
        case "done": "checkmark.circle.fill"
        case "failed": "xmark.circle.fill"
        case "cancelled": "slash.circle"
        default: "circle.dashed"
        }
    }
    private var color: Color {
        switch state {
        case "running": .sam
        case "done": .green
        case "failed": .red
        default: .secondary
        }
    }
}

struct JobDetail: View {
    @Environment(AppModel.self) private var model
    let job: YardJob
    var body: some View {
        List {
            Section {
                LabeledContent("State") { HStack { StateIcon(state: job.state); Text(job.state.capitalized) } }
                if let project = job.project { LabeledContent("Project", value: project) }
                LabeledContent("Started") { Text(job.created, format: .dateTime) }
                if let f = job.finished { LabeledContent("Finished") { Text(f, format: .dateTime) } }
                if let tier = job.tier { LabeledContent("Model tier", value: tier) }
                if let tokens = job.costTokens { LabeledContent("Tokens", value: tokens.formatted()) }
                if let attempts = job.attempts { LabeledContent("Attempts", value: "\(attempts)") }
            }
            if let error = job.lastError {
                Section("What went wrong") { Text(error).font(.callout.monospaced()).textSelection(.enabled) }
            }
            Section {
                if job.isActive {
                    Button("Cancel job", role: .destructive) { Task { await model.cancel(job) } }
                } else if job.state == "failed" {
                    Button("Retry") { Task { await model.retry(job) } }
                }
            }
        }
        .navigationTitle(job.title)
    }
}
