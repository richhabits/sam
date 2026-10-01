import SAMKit
import SwiftUI
import WidgetKit

/// Watch face complications and Smart Stack: what SAM's yard is doing, from the snapshot the
/// iPhone sends over WatchConnectivity.
@main
struct SAMWatchWidgets: WidgetBundle {
    var body: some Widget { WatchYardWidget() }
}

struct WatchEntry: TimelineEntry {
    let date: Date
    let snap: SharedSnapshot
}

struct WatchProvider: TimelineProvider {
    func placeholder(in _: Context) -> WatchEntry {
        WatchEntry(date: .now, snap: SharedSnapshot(paired: true, reachable: true, queued: 1, running: 2, latestJob: "Project deploy"))
    }
    func getSnapshot(in context: Context, completion: @escaping (WatchEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : WatchEntry(date: .now, snap: .load()))
    }
    func getTimeline(in _: Context, completion: @escaping (Timeline<WatchEntry>) -> Void) {
        completion(Timeline(entries: [WatchEntry(date: .now, snap: .load())], policy: .after(.now.addingTimeInterval(30 * 60))))
    }
}

struct WatchYardWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SAMWatchYard", provider: WatchProvider()) { entry in
            WatchYardView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("SAM Yard")
        .description("What SAM is building on your Mac.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}

struct WatchYardView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WatchEntry
    private var s: SharedSnapshot { entry.snap }

    var body: some View {
        switch family {
        case .accessoryInline:
            Label(s.paired ? "\(s.running) running" : "SAM", systemImage: "hammer")
        case .accessoryCircular:
            Gauge(value: Double(s.running), in: 0...Double(max(s.running + s.queued, 1))) {
                Image(systemName: "hammer")
            } currentValueLabel: { Text("\(s.running)") }
            .gaugeStyle(.accessoryCircular)
        case .accessoryCorner:
            Image(systemName: "hammer.fill")
                .widgetLabel("\(s.running) running")
        default:
            VStack(alignment: .leading) {
                Label("SAM Yard", systemImage: "hammer").font(.headline).widgetAccentable()
                Text(s.paired ? "\(s.running) running · \(s.queued) queued" : "Pair on iPhone")
                if let job = s.latestJob { Text(job).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
    }
}
