import SAMKit
import SwiftUI

/// App Review 5.1.2(i): before a chat leaves for the person's Mac, say plainly which outside AI
/// services the Mac may pass it to, and ask. "Not now" keeps answers on this device.
struct ConsentSheet: View {
    @Environment(AppModel.self) private var model
    let providers: AIProviders

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Image(systemName: "hand.raised.circle.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(Color.sam)
                            .accessibilityHidden(true)
                        Text("Before SAM answers from your Mac")
                            .font(.title2.bold())
                        Text("Your Mac uses the AI services below to answer. What you type in SAM is sent to them, and each one handles it under its own privacy policy. SAM itself collects nothing.")
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                }
                Section("AI services your Mac may use") {
                    ForEach(providers.thirdParties) { p in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).font(.body.weight(.medium))
                                if let c = p.company { Text(c).font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer()
                            if let link = p.privacy.flatMap(URL.init(string:)) {
                                Link("Privacy", destination: link).font(.callout)
                            }
                        }
                    }
                }
                Section {
                    Text("You can change this any time in Settings → Privacy. Pages and files you share are sent as data only: SAM won't run tools on them or remember them.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            #if !os(macOS)
            .listStyle(.insetGrouped)
            #endif
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 10) {
                    Button { model.answerConsent(true) } label: {
                        Text("Allow").frame(maxWidth: .infinity).padding(.vertical, 4)
                    }
                    .samProminent()
                    .controlSize(.large)
                    Button { model.answerConsent(false) } label: {
                        Text("Not now, answer on this device").frame(maxWidth: .infinity)
                    }
                    .samSecondary()
                }
                .padding(Spacing.gutter)
                .background(.bar)
            }
            .navigationTitle("AI and your data")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        .tint(.sam)
        .interactiveDismissDisabled()
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 560)
        #endif
    }
}

/// Settings → Privacy: what was agreed, and a way to change it.
struct AIConsentSettings: View {
    @Environment(AppModel.self) private var model
    @State private var providers: AIProviders?
    @State private var changed = false

    var body: some View {
        Section {
            if model.isDemo {
                LabeledContent("AI sharing", value: "Not used in the demo")
            } else if let providers {
                let state = AIConsent.state(for: providers)
                LabeledContent("AI sharing") {
                    Text(state == .allowed ? "Allowed" : state == .declined ? "Off · on-device only" : "Not asked yet")
                        .foregroundStyle(state == .allowed ? .green : .secondary)
                }
                if !providers.thirdParties.isEmpty {
                    Text(providers.thirdParties.map(\.name).joined(separator: ", "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Button(state == .allowed ? "Stop sharing with these services" : "Ask me again") {
                    if state == .allowed { AIConsent.decline() } else { AIConsent.reset() }
                    changed.toggle()
                }
            } else {
                LabeledContent("AI sharing", value: model.isPaired ? "Checking…" : "Pair with your Mac first")
            }
        } header: {
            Text("AI and your data")
        } footer: {
            Text("When it's off, SAM answers with Apple Intelligence on this device and nothing is sent anywhere.")
        }
        .id(changed)
        .task(id: model.isPaired) {
            providers = try? await model.brain?.aiProviders()
        }
    }
}
