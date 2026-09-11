import SwiftUI
import WidgetKit

// SAM ON THE HOME AND LOCK SCREEN.
//
// The widget cannot hold the pairing token or reach the Mac. The app writes a JSON snapshot
// into App Group `group.com.hectic.sam.mobile` (SAMWidgetStore.save). This process reads that
// and shows it. Taps still open sam://ask and sam://tasks — same contract as lib/quicklink.ts.
// Empty/missing snapshot is an honest "not connected", never invented live data.

private enum Destination {
    static let ask = URL(string: "sam://ask")!
    static let tasks = URL(string: "sam://tasks")!
}

private enum Palette {
    // Same tokens as mobile/lib/samTheme.ts — the app is dark-only, so the widget is too.
    static let ground = Color(red: 12 / 255, green: 10 / 255, blue: 9 / 255) // #0C0A09
    static let ink = Color(red: 253 / 255, green: 246 / 255, blue: 239 / 255) // #FDF6EF
    static let tint = Color(red: 240 / 255, green: 130 / 255, blue: 78 / 255) // #F0824E
    static let raise = Color(red: 23 / 255, green: 19 / 255, blue: 15 / 255) // #17130F
}

struct SAMSnapshot {
    var paired: Bool
    var demo: Bool
    var line: String
    var detail: String

    static func load() -> SAMSnapshot {
        let fallback = SAMSnapshot(paired: false, demo: false, line: "Ask SAM", detail: "Open the app to connect")
        guard
            let raw = UserDefaults(suiteName: "group.com.hectic.sam.mobile")?.string(forKey: "state"),
            let data = raw.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return fallback }
        return SAMSnapshot(
            paired: obj["paired"] as? Bool ?? false,
            demo: obj["demo"] as? Bool ?? false,
            line: String((obj["line"] as? String ?? fallback.line).prefix(80)),
            detail: String((obj["detail"] as? String ?? fallback.detail).prefix(80))
        )
    }
}

struct SAMEntry: TimelineEntry {
    let date: Date
    let snap: SAMSnapshot
}

struct SAMProvider: TimelineProvider {
    func placeholder(in context: Context) -> SAMEntry {
        SAMEntry(date: Date(), snap: SAMSnapshot.load())
    }

    func getSnapshot(in context: Context, completion: @escaping (SAMEntry) -> Void) {
        completion(SAMEntry(date: Date(), snap: SAMSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SAMEntry>) -> Void) {
        let entry = SAMEntry(date: Date(), snap: SAMSnapshot.load())
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60))))
    }
}

private extension View {
    /// iOS 17 draws NOTHING behind a widget unless it declares `containerBackground`, and that
    /// API does not exist on iOS 16 — which this app still deploys to. Guarded in one place so
    /// no view has to remember. The iOS 16 branch adds the margins iOS 17 supplies for free.
    @ViewBuilder
    func samWidgetBackground(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(color, for: .widget)
        } else {
            padding(16).background(color)
        }
    }

    /// Lock Screen widgets are rendered as a vibrant stencil over the wallpaper, so their
    /// container must stay clear — a colour here would be flattened into a grey slab.
    @ViewBuilder
    func samAccessoryBackground() -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(.clear, for: .widget)
        } else {
            self
        }
    }
}

/// One tap target. `filled` is the primary action; there is only ever one of those, because a
/// widget with two equally loud buttons makes you read it instead of hitting it.
private struct QuickTile: View {
    let symbol: String
    let title: String
    let subtitle: String
    let filled: Bool
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(filled ? Palette.ink : tint)
            Spacer(minLength: 0)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(filled ? Palette.ink : Palette.ink)
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(filled ? Palette.ink.opacity(0.85) : Palette.ink.opacity(0.4))
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(
            filled ? tint : Palette.raise,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
    }
}

struct SAMQuickActionsView: View {
    var entry: SAMEntry
    @Environment(\.widgetFamily) private var family

    private var tint: Color { Palette.tint }
    private var snap: SAMSnapshot { entry.snap }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "sparkles").font(.title3)
            }
            .widgetURL(Destination.ask)
            .samAccessoryBackground()

        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text("S.A.M.")
                    .font(.caption2.weight(.bold))
                    .tracking(1.2)
                Text(snap.line)
                    .font(.headline)
                Text(snap.detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(Destination.ask)
            .samAccessoryBackground()

        case .systemMedium:
            // Two destinations only, and the whole tile is the target — a Link is honoured in
            // system families (it is ignored in accessory ones, which is why those use
            // widgetURL instead).
            HStack(spacing: 10) {
                Link(destination: Destination.ask) {
                    QuickTile(
                        symbol: "sparkles",
                        title: snap.line,
                        subtitle: snap.paired ? (snap.demo ? "Demo" : "Paired") : "Not connected",
                        filled: true,
                        tint: tint
                    )
                }
                Link(destination: Destination.tasks) {
                    QuickTile(
                        symbol: "list.bullet.rectangle",
                        title: "Tasks",
                        subtitle: snap.detail,
                        filled: false,
                        tint: tint
                    )
                }
            }
            .samWidgetBackground(Palette.ground)

        default:
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.title2)
                    .foregroundStyle(tint)
                Spacer(minLength: 0)
                Text(snap.line)
                    .font(.headline)
                    .foregroundStyle(Palette.ink)
                Text(snap.detail)
                    .font(.caption)
                    .foregroundStyle(Palette.ink.opacity(0.6))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .widgetURL(Destination.ask)
            .samWidgetBackground(Palette.ground)
        }
    }
}

struct SAMQuickActionsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SAMQuickActions", provider: SAMProvider()) { entry in
            SAMQuickActionsView(entry: entry)
        }
        .configurationDisplayName("SAM")
        .description("Live SAM status from this phone, and a tap to ask or open tasks.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}

@main
struct SAMWidgetBundle: WidgetBundle {
    var body: some Widget {
        SAMQuickActionsWidget()
    }
}
