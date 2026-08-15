import SwiftUI
import WidgetKit

// SAM ON THE HOME AND LOCK SCREEN.
//
// A widget cannot talk to SAM. It runs in its own sandboxed process, on the system's schedule,
// with no pairing token and no network reach to the Mac — so anything it "showed" about your
// SAM would be a guess. What it CAN do is be the shortest path from a locked phone to a
// started task, and that is all this one claims to be: a launcher.
//
// Every destination below is a surface the app already has. `sam://ask` and `sam://tasks` are
// parsed by lib/quicklink.ts and routed by App.tsx — the widget invents no transport of its
// own, it taps the same deep link a QR code or a Shortcut would.
//
// Live data (what's running, today's token spend) would need an App Group plus a background
// writer in the app, and an App Group needs a registered identifier on a paid Apple account.
// See docs/WIDGETS.md for why that is deliberately a later step rather than a half-done one.

private enum Destination {
    static let ask = URL(string: "sam://ask")!
    static let tasks = URL(string: "sam://tasks")!
}

private enum Palette {
    // The same terracotta the app tints with (lib/ios.ts), light and dark, stated once.
    static let tint = Color(red: 0.851, green: 0.325, blue: 0.122) // #D9531F
    static let tintDark = Color(red: 0.941, green: 0.510, blue: 0.306) // #F0824E
}

struct SAMEntry: TimelineEntry {
    let date: Date
}

struct SAMProvider: TimelineProvider {
    func placeholder(in context: Context) -> SAMEntry {
        SAMEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (SAMEntry) -> Void) {
        completion(SAMEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SAMEntry>) -> Void) {
        // A launcher has nothing that changes over time. One entry with `.never` means the
        // system never wakes this extension again — no timeline budget spent, no battery.
        completion(Timeline(entries: [SAMEntry(date: Date())], policy: .never))
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
                .foregroundStyle(filled ? Color.white : tint)
            Spacer(minLength: 0)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(filled ? Color.white : Color.primary)
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(filled ? Color.white.opacity(0.85) : Color.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(
            filled ? tint : Color.primary.opacity(0.06),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
    }
}

struct SAMQuickActionsView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme

    private var tint: Color { scheme == .dark ? Palette.tintDark : Palette.tint }

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
                Text("Ask something")
                    .font(.headline)
                Text("Runs on your own machine")
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
                        title: "Ask SAM",
                        subtitle: "Start something",
                        filled: true,
                        tint: tint
                    )
                }
                Link(destination: Destination.tasks) {
                    QuickTile(
                        symbol: "list.bullet.rectangle",
                        title: "Tasks",
                        subtitle: "What SAM has run",
                        filled: false,
                        tint: tint
                    )
                }
            }
            .samWidgetBackground(Color(.systemBackground))

        default:
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.title2)
                    .foregroundStyle(tint)
                Spacer(minLength: 0)
                Text("Ask SAM")
                    .font(.headline)
                Text("Start something")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .widgetURL(Destination.ask)
            .samWidgetBackground(Color(.systemBackground))
        }
    }
}

struct SAMQuickActionsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SAMQuickActions", provider: SAMProvider()) { _ in
            SAMQuickActionsView()
        }
        .configurationDisplayName("SAM")
        .description("Start something with SAM from the Home or Lock Screen.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}

@main
struct SAMWidgetBundle: WidgetBundle {
    var body: some Widget {
        SAMQuickActionsWidget()
    }
}
