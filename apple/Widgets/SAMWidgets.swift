import AppIntents
import SAMKit
import SwiftUI
import WidgetKit

@main
struct SAMWidgets: WidgetBundle {
    var body: some Widget {
        YardWidget()
        AskSAMControl()
    }
}

// MARK: Yard widget (Home Screen, Lock Screen, StandBy)

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snap: SharedSnapshot
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in _: Context) -> SnapshotEntry {
        SnapshotEntry(date: .now, snap: SharedSnapshot(paired: true, reachable: true, queued: 1, running: 2, latestJob: "Project deploy", latestState: "running"))
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : SnapshotEntry(date: .now, snap: .load()))
    }

    /// The app pushes fresh snapshots and reloads timelines; this is only the fallback cadence.
    func getTimeline(in _: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        completion(Timeline(entries: [SnapshotEntry(date: .now, snap: .load())], policy: .after(.now.addingTimeInterval(15 * 60))))
    }
}

struct YardWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SAMYard", provider: SnapshotProvider()) { entry in
            YardWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "sam://yard"))
        }
        .configurationDisplayName("SAM Yard")
        .description("What SAM is building on your Mac.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

struct YardWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry
    private var s: SharedSnapshot { entry.snap }
    private let accent = Color(red: 0xF0 / 255, green: 0x82 / 255, blue: 0x4E / 255)

    var body: some View {
        switch family {
        case .accessoryInline:
            Label(s.paired ? "\(s.running) running · \(s.queued) queued" : "SAM not paired", systemImage: "hammer")
        case .accessoryCircular:
            Gauge(value: Double(s.running), in: 0...Double(max(s.running + s.queued, 1))) {
                Image(systemName: "hammer")
            } currentValueLabel: {
                Text("\(s.running)")
            }
            .gaugeStyle(.accessoryCircular)
        case .accessoryRectangular:
            VStack(alignment: .leading) {
                Label("SAM Yard", systemImage: "hammer").font(.headline)
                Text("\(s.running) running · \(s.queued) queued")
                if let job = s.latestJob { Text(job).foregroundStyle(.secondary) }
            }
        default:
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: "hammer.fill").foregroundStyle(accent)
                    Text("SAM").font(.headline)
                    Spacer()
                    Circle().fill(s.reachable ? .green : .orange).frame(width: 8, height: 8)
                }
                if !s.paired {
                    Text("Open SAM to pair with your Mac.").font(.caption).foregroundStyle(.secondary)
                } else {
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(s.running)").font(.system(size: 34, weight: .bold, design: .rounded)).foregroundStyle(accent)
                        Text("running").font(.caption).foregroundStyle(.secondary)
                    }
                    Text("\(s.queued) queued · \(s.failed) failed").font(.caption)
                    if family == .systemMedium, let reply = s.lastReply {
                        Text(reply).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    if let job = s.latestJob {
                        Text("\(job) · \(s.latestState ?? "")").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
        }
    }
}

// MARK: Control Center, Lock Screen and Action button

struct AskSAMControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.hectic.sam.ask") {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "sam://chat")!)) {
                Label("Ask SAM", systemImage: "bubble.left.and.text.bubble.right")
            }
        }
        .displayName("Ask SAM")
        .description("Open a new chat with SAM.")
    }
}
