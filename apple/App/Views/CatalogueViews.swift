import SAMKit
import SwiftUI

/// SAM's specialists. Tapping one starts a chat addressed to them.
struct CrewView: View {
    @Environment(AppModel.self) private var model
    @Binding var section: AppSection

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 20)], spacing: 20) {
                    ForEach(model.specialists) { s in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(s.emoji ?? "🤖").font(.largeTitle)
                                VStack(alignment: .leading) {
                                    Text(s.name).font(.headline)
                                    if let m = s.modeledOn { Text(m).font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                            if let brief = s.brief { Text(brief).font(.callout).foregroundStyle(.secondary) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(20)
                        .samGlass(in: .rect(cornerRadius: 22))
                    }
                }
                .padding(.horizontal, Spacing.gutter)
                .padding(.vertical, 20)
                .readableWidth(1100)
                .overlay {
                    if model.specialists.isEmpty {
                        ContentUnavailableView("The crew lives on your Mac", systemImage: "person.3",
                                               description: Text(model.isPaired ? "Can't reach it right now." : "Pair to meet them."))
                    }
                }
            }
            .navigationTitle("Crew")
            .task { await model.loadCatalogue() }
            .refreshable { await model.loadCatalogue() }
        }
    }
}

/// Everything SAM can do, searchable.
struct ToolsView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    private var filtered: [ToolInfo] {
        guard !query.isEmpty else { return model.tools }
        return model.tools.filter { $0.name.localizedCaseInsensitiveContains(query) || ($0.description ?? "").localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            List(filtered) { tool in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(tool.name.replacingOccurrences(of: "_", with: " ")).font(.body.weight(.medium))
                        Spacer()
                        TierBadge(tier: tool.tier ?? (tool.safe == true ? "safe" : "ask"))
                    }
                    if let d = tool.description {
                        Text(d).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                    }
                }
            }
            .overlay {
                if model.tools.isEmpty {
                    ContentUnavailableView("No tools yet", systemImage: "wrench.and.screwdriver",
                                           description: Text("SAM's tools run on your Mac. Pair to see them."))
                } else if filtered.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
            }
            .readableWidth(900)
            .searchable(text: $query, prompt: "\(model.tools.count) tools")
            .navigationTitle("Tools")
            .task { if model.tools.isEmpty { await model.loadCatalogue() } }
        }
    }
}

struct TierBadge: View {
    let tier: String
    var body: some View {
        Text(tier)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(color)
            .background(color.opacity(0.15), in: .capsule)
    }
    private var color: Color { tier == "safe" ? .green : tier == "danger" || tier == "privileged" ? .red : .orange }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var speaker = Speaker.shared
    @State private var lock = AppLock.shared
    @State private var confirmUnpair = false
    @State private var showPair = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Your Mac") {
                    LabeledContent("Status") { ConnectionBadge(paired: model.isPaired, reachable: model.reachable) }
                    if model.isDemo {
                        LabeledContent("Address", value: "Demo · sample data")
                    } else if let host = model.host {
                        LabeledContent("Address", value: host)
                    }
                    if let p = model.lastProvider { LabeledContent("Last answered by", value: p) }
                    if model.isDemo {
                        Button("Leave the demo") { Task { await model.leaveDemo() } }
                    } else if model.isPaired {
                        Button("Unpair this device", role: .destructive) { confirmUnpair = true }
                    } else {
                        Button("Pair with SAM") { showPair = true }
                        Button("Explore the demo") { Task { await model.enterDemo() } }
                    }
                }
                Section {
                    LabeledContent("Apple Intelligence") {
                        Text(OnDeviceBrain.unavailableReason == nil ? "Ready" : "Unavailable")
                            .foregroundStyle(OnDeviceBrain.unavailableReason == nil ? .green : .secondary)
                    }
                    if let why = OnDeviceBrain.unavailableReason { Text(why).font(.caption).foregroundStyle(.secondary) }
                } header: {
                    Text("Offline")
                } footer: {
                    Text("When your Mac can't be reached, SAM answers with Apple Intelligence on this device. Nothing is sent anywhere.")
                }
                Section("Voice") {
                    Toggle("Read replies aloud", isOn: $speaker.readAloud)
                    LabeledContent("Voice", value: Speaker.bestVoice()?.name ?? "System")
                }
                Section {
                    Toggle("Lock with \(lock.biometryName)", isOn: $lock.enabled)
                } header: {
                    Text("Security")
                } footer: {
                    Text("SAM can act on your Mac. Locking means a borrowed, unlocked device isn't enough to drive it. Your session key is kept in the Keychain on this device only.")
                }
                AIConsentSettings()
                Section("Privacy") {
                    Button("Clear SAM from Spotlight") { Spotlight.clear() }
                    Link("Privacy policy", destination: URL(string: "https://richhabits.github.io/sam/privacy.html")!)
                }
                Section {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "–")
                }
            }
            .formStyle(.grouped)
            .readableWidth(720)
            .navigationTitle("Settings")
            .confirmationDialog("Unpair this device?", isPresented: $confirmUnpair) {
                Button("Unpair", role: .destructive) { Task { await model.unpair() } }
            } message: {
                Text("SAM on your Mac will forget this device. You can pair again any time.")
            }
            .sheet(isPresented: $showPair) { PairView(onSkip: { showPair = false }) }
            .onChange(of: model.isPaired) { _, paired in if paired { showPair = false } }
        }
    }
}
