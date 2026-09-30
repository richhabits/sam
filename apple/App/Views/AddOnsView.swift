import SAMKit
import SwiftUI

/// Add-ons: our own apps (FLIP IT…) and business tools SAM can connect to over MCP.
/// Connecting happens on the Mac SAM runs on (keys never leave it); other devices can browse.
struct AddOnsView: View {
    @Environment(AppModel.self) private var model
    @State private var addOns: [AddOn] = []
    @State private var loading = false
    @State private var error: String?
    @State private var editing: AddOn?
    @State private var needsRestart = false
    @State private var restarting = false

    private var ours: [AddOn] { addOns.filter { $0.label.localizedCaseInsensitiveContains("add-on") } }
    private var tools: [AddOn] { addOns.filter { !$0.label.localizedCaseInsensitiveContains("add-on") } }

    var body: some View {
        NavigationStack {
            List {
                if needsRestart {
                    Section {
                        HStack {
                            Label("Restart SAM to finish", systemImage: "arrow.clockwise.circle.fill")
                                .foregroundStyle(Color.sam)
                            Spacer()
                            Button(restarting ? "Restarting…" : "Restart") { Task { await restart() } }
                                .samProminent()
                                .disabled(restarting)
                        }
                    } footer: {
                        Text("Add-ons load when SAM starts. Takes a few seconds.")
                    }
                }
                if !ours.isEmpty {
                    Section {
                        ForEach(ours) { row($0) }
                    } header: {
                        Text("Our apps")
                    } footer: {
                        Text("Separate apps SAM can look at when you switch them on. FLIP IT is read-only: SAM can see your rig, never trade.")
                    }
                }
                if !tools.isEmpty {
                    Section("Business tools") { ForEach(tools) { row($0) } }
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                }
            }
            .overlay {
                if addOns.isEmpty && !loading {
                    ContentUnavailableView("Add-ons live on your Mac", systemImage: "puzzlepiece.extension",
                                           description: Text(model.isPaired ? "Can't reach SAM right now." : "Pair with SAM to see them."))
                }
            }
            .navigationTitle("Add-ons")
            .task { await load() }
            .refreshable { await load() }
            .sheet(item: $editing) { addOn in
                AddOnSheet(addOn: addOn) { keys in
                    try await connect(addOn, keys: keys)
                } disconnect: {
                    try await disconnect(addOn)
                }
            }
        }
    }

    private func row(_ a: AddOn) -> some View {
        Button { editing = a } label: {
            HStack(spacing: 12) {
                Text(a.emoji ?? "🧩").font(.title2).frame(width: 36)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(a.label.replacingOccurrences(of: " (add-on)", with: "")).font(.body.weight(.medium))
                        if a.official == false { TierBadge(tier: "community") }
                    }
                    if let note = a.note { Text(note).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                }
                Spacer()
                if a.connected {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).accessibilityLabel("Connected")
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        guard let brain = model.brain else { return }
        loading = true
        defer { loading = false }
        do { addOns = try await brain.addOns(); error = nil } catch { self.error = error.localizedDescription }
    }

    private func connect(_ a: AddOn, keys: [String: String]) async throws {
        guard let brain = model.brain else { throw BrainError.notPaired }
        do { try await brain.connectAddOn(a.id, keys: keys) } catch let e as BrainError where e.status == 403 {
            throw BrainError(403, "Connect add-ons in SAM on your Mac. Keys never leave it.")
        }
        needsRestart = true
        await load()
    }

    private func disconnect(_ a: AddOn) async throws {
        guard let brain = model.brain else { throw BrainError.notPaired }
        do { try await brain.removeAddOn(a.id) } catch let e as BrainError where e.status == 403 {
            throw BrainError(403, "Disconnect add-ons in SAM on your Mac.")
        }
        needsRestart = true
        await load()
    }

    private func restart() async {
        guard let brain = model.brain else { return }
        restarting = true
        defer { restarting = false }
        do {
            try await brain.restart()
            try? await Task.sleep(for: .seconds(3))
            for _ in 0..<60 where !(await BrainClient.isUp(brain.host)) { try? await Task.sleep(for: .seconds(2)) }
            needsRestart = false
            await model.refresh()
            await model.loadCatalogue()
            Haptics.success()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct AddOnSheet: View {
    let addOn: AddOn
    var connect: ([String: String]) async throws -> Void
    var disconnect: () async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var keys: [String: String] = [:]
    @State private var working = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        Text(addOn.emoji ?? "🧩").font(.largeTitle)
                        VStack(alignment: .leading) {
                            Text(addOn.label.replacingOccurrences(of: " (add-on)", with: "")).font(.headline)
                            if let note = addOn.note { Text(note).font(.callout).foregroundStyle(.secondary) }
                        }
                    }
                }
                if !addOn.fields.isEmpty && !addOn.connected {
                    Section {
                        ForEach(addOn.fields, id: \.env) { f in
                            SecureField(f.placeholder ?? f.label, text: Binding(get: { keys[f.env] ?? "" }, set: { keys[f.env] = $0 }))
                                .textContentType(.password)
                                .autocorrectionDisabled()
                        }
                    } header: {
                        Text("Keys")
                    } footer: {
                        Text("Saved only in SAM's vault on your Mac. SAM asks before every add-on action.")
                    }
                }
                if let docs = addOn.docs, let url = URL(string: docs) {
                    Link("About \(addOn.label.replacingOccurrences(of: " (add-on)", with: ""))", destination: url)
                }
                if let error { Text(error).foregroundStyle(.orange) }
            }
            .formStyle(.grouped)
            .navigationTitle(addOn.connected ? "Connected" : "Connect")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if addOn.connected {
                        Button("Disconnect", role: .destructive) { run { try await disconnect() } }.disabled(working)
                    } else {
                        Button("Connect") { run { try await connect(keys) } }
                            .disabled(working || addOn.fields.contains { (keys[$0.env] ?? "").trimmingCharacters(in: .whitespaces).isEmpty })
                    }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 320)
        #endif
    }

    private func run(_ action: @escaping () async throws -> Void) {
        working = true
        Task {
            defer { working = false }
            do { try await action(); Haptics.success(); dismiss() } catch { self.error = error.localizedDescription }
        }
    }
}
