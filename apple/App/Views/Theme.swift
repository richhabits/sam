import SwiftUI

extension Color {
    /// SAM's one accent (mobile/lib/samTheme.ts `accent`).
    static let sam = Color(red: 0xF0 / 255, green: 0x82 / 255, blue: 0x4E / 255)
    static let samDeep = Color(red: 0xD9 / 255, green: 0x53 / 255, blue: 0x1F / 255)
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
