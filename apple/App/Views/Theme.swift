import SwiftUI

extension Color {
    /// SAM's one accent (mobile/lib/samTheme.ts `accent` #F0824E in Dark Mode). Light Mode uses a
    /// deeper terracotta (#A83F15) so accent text and white-on-accent pass 4.5:1 contrast.
    static let sam = Color("AccentColor")
    static let samDeep = Color("AccentDeep")
}

extension ShapeStyle where Self == LinearGradient {
    static var samGradient: LinearGradient {
        LinearGradient(colors: [.sam, .samDeep], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

extension View {
    /// Liquid Glass where the platform has it; visionOS already draws its own glass.
    @ViewBuilder func samGlass(in shape: some Shape = .capsule, interactive: Bool = false) -> some View {
        #if os(visionOS)
        self.background(.regularMaterial, in: shape)
        #else
        if interactive {
            self.glassEffect(.regular.interactive(), in: shape)
        } else {
            self.glassEffect(.regular, in: shape)
        }
        #endif
    }
}

/// The mascot, drawn from the app icon.
struct SAMMark: View {
    var size: CGFloat = 64
    var body: some View {
        Image("Mascot")
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(.rect(cornerRadius: size * 0.225, style: .continuous))
            .shadow(color: .samDeep.opacity(0.35), radius: size * 0.15, y: size * 0.06)
            .accessibilityLabel("SAM")
    }
}

/// Green when the Mac answers, amber when SAM is running on-device, grey when unpaired.
struct ConnectionBadge: View {
    let paired: Bool
    let reachable: Bool
    var body: some View {
        Label(title, systemImage: symbol)
            .font(.caption.weight(.medium))
            .foregroundStyle(color)
            .labelStyle(.titleAndIcon)
            .contentTransition(.symbolEffect(.replace))
    }
    private var title: String { !paired ? "Not paired" : reachable ? "Mac connected" : "On-device" }
    private var symbol: String { !paired ? "link.badge.plus" : reachable ? "desktopcomputer" : "apple.intelligence" }
    private var color: Color { !paired ? .secondary : reachable ? .green : .orange }
}

extension View {
    /// Primary action style: Liquid Glass on iOS/macOS, the native prominent style on visionOS.
    @ViewBuilder func samProminent() -> some View {
        #if os(visionOS)
        self.buttonStyle(.borderedProminent)
        #else
        self.buttonStyle(.glassProminent)
        #endif
    }

    @ViewBuilder func samSecondary() -> some View {
        #if os(visionOS)
        self.buttonStyle(.bordered)
        #else
        self.buttonStyle(.glass)
        #endif
    }
}

extension View {
    /// Centres content at a comfortable reading width on big screens (iPad, Mac, Vision Pro)
    /// instead of stretching it edge to edge or hugging one side. No effect on iPhone widths.
    func readableWidth(_ max: CGFloat = 760) -> some View {
        frame(maxWidth: max).frame(maxWidth: .infinity)
    }
}

enum Spacing {
    static let gutter: CGFloat = 28     // page side padding on regular width
    static let section: CGFloat = 24
    static let item: CGFloat = 16
}
