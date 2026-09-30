import SAMKit
import SwiftUI
#if os(iOS)
import VisionKit
#endif

/// First run: connect this device to SAM on the person's Mac.
/// Scan the QR SAM shows, paste its /pair link, or type the address and code.
struct PairView: View {
    @Environment(AppModel.self) private var model
    var onSkip: () -> Void

    @State private var host = ""
    @State private var code = ""
    @State private var working = false
    @State private var error: String?
    @State private var scanning = false
    @State private var discovery = Discovery()
    @State private var picked: Discovery.Found?

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 14) {
                    SAMMark(size: 104)
                    Text("Meet SAM").font(.largeTitle.bold())
                    Text("Your AI runs on your Mac: tools, files, memory, builds. Pair this device to use it from anywhere on your network.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 40)

                #if os(iOS)
                if DataScannerViewController.isSupported {
                    Button { scanning = true } label: {
                        Label("Scan the code on your Mac", systemImage: "qrcode.viewfinder")
                            .frame(maxWidth: .infinity)
                    }
                    .samProminent()
                    .controlSize(.large)
                }
                #endif

                #if os(macOS)
                Button {
                    Task { await model.connect() }
                } label: {
                    Label("Connect to SAM on this Mac", systemImage: "desktopcomputer")
                        .frame(maxWidth: .infinity)
                }
                .samProminent()
                .controlSize(.large)
                #endif

                if !discovery.found.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("On your network").font(.headline)
                        ForEach(discovery.found) { f in
                            Button {
                                picked = f
                                host = f.host
                            } label: {
                                HStack {
                                    Image(systemName: "desktopcomputer").foregroundStyle(Color.sam)
                                    VStack(alignment: .leading) {
                                        Text(f.name)
                                        Text("Check your Mac shows \(f.shortFingerprint)").font(.caption.monospaced()).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if picked == f { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                                }
                                .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                        }
                        Text("Then enter the pairing code your Mac shows.").font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(20)
                    .samGlass(in: .rect(cornerRadius: 24))
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("Or enter it yourself").font(.headline)
                    TextField("Pairing link, or the Mac's address (192.168.1.4:8787)", text: $host)
                        .textContentType(.URL)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                    TextField("Pairing code", text: $code)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                    Button {
                        Task { await submit() }
                    } label: {
                        if working { ProgressView().frame(maxWidth: .infinity) } else { Text("Pair").frame(maxWidth: .infinity) }
                    }
                    .samSecondary()
                    .disabled(working || (PairLink.parse(host) == nil && (host.isEmpty || code.isEmpty)))
                }
                .textFieldStyle(.roundedBorder)
                .padding(20)
                .samGlass(in: .rect(cornerRadius: 24))

                if let error = error ?? model.lastError {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .font(.callout)
                }

                VStack(spacing: 6) {
                    Button(OnDeviceBrain.isAvailable ? "Chat on-device with Apple Intelligence for now" : "Look around first", action: onSkip)
                        .font(.callout)
                    Text("On-device chat stays on this device. Nothing is sent anywhere.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .task { discovery.start() }
        .onDisappear { discovery.stop() }
        #if os(iOS)
        .fullScreenCover(isPresented: $scanning) {
            QRScanner { payload in
                scanning = false
                host = payload
                Task { await submit() }
            }
            .ignoresSafeArea()
            .overlay(alignment: .topTrailing) {
                Button("Cancel") { scanning = false }.samSecondary().padding()
            }
        }
        #endif
    }

    private func submit() async {
        working = true
        error = nil
        defer { working = false }
        do {
            if let link = PairLink.parse(host) {
                try await model.pair(link: link, fallbackHost: nil)
            } else if let picked, host == picked.host {
                // Fingerprint from the network, compared by the person against their Mac.
                try await model.pair(host: picked.host, code: code, fingerprint: picked.fingerprint)
            } else {
                try await model.pair(host: host.contains(":") || host.contains("://") ? host : "\(host):\(BrainClient.defaultPort)", code: code)
            }
            Haptics.success()
        } catch {
            self.error = error.localizedDescription
            Haptics.attention()
        }
    }
}

#if os(iOS)
/// Live QR scanning with VisionKit. Hands back the first pairing link it sees.
struct QRScanner: UIViewControllerRepresentable {
    var onFound: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])],
                                           qualityLevel: .balanced, isHighlightingEnabled: true)
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }

    func updateUIViewController(_: DataScannerViewController, context _: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onFound: onFound) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onFound: (String) -> Void
        var done = false
        init(onFound: @escaping (String) -> Void) { self.onFound = onFound }

        func dataScanner(_: DataScannerViewController, didAdd items: [RecognizedItem], allItems _: [RecognizedItem]) {
            for case .barcode(let code) in items {
                guard !done, let s = code.payloadStringValue, PairLink.parse(s) != nil else { continue }
                done = true
                onFound(s)
            }
        }
    }
}
#endif
