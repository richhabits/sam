import Foundation
import Network
import Observation
import SAMKit

/// Finds SAMs on this network that advertise the encrypted phone listener (`_sam._tcp`,
/// TXT `fp=<cert SHA-256>`, docs/decisions/0002).
///
/// Discovery only saves typing an address. A fingerprint learned from the network is shown to
/// the person to compare with their Mac before it's trusted; the QR code carries it out of band
/// and needs no comparison.
@MainActor @Observable final class Discovery {
    struct Found: Identifiable, Equatable {
        let name: String
        let host: String            // https://ip:port
        let fingerprint: String
        var id: String { host }
        /// The first 16 hex characters in groups of 4, to compare against the Mac.
        var shortFingerprint: String {
            stride(from: 0, to: 16, by: 4).map { i -> String in
                let start = fingerprint.index(fingerprint.startIndex, offsetBy: i)
                return String(fingerprint[start..<fingerprint.index(start, offsetBy: 4)])
            }.joined(separator: " ")
        }
    }

    private(set) var found: [Found] = []
    private var browser: NWBrowser?

    func start() {
        guard browser == nil else { return }
        let b = NWBrowser(for: .bonjourWithTXTRecord(type: "_sam._tcp", domain: nil), using: .tcp)
        b.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in await self?.update(results) }
        }
        b.start(queue: .main)
        browser = b
    }

    func stop() {
        browser?.cancel()
        browser = nil
    }

    private func update(_ results: Set<NWBrowser.Result>) async {
        var next: [Found] = []
        for r in results {
            guard case .service(let name, _, _, _) = r.endpoint,
                  case .bonjour(let txt) = r.metadata,
                  let fp = txt["fp"]?.lowercased(), PairLink.isFingerprint(fp),
                  let host = await Self.resolve(r.endpoint) else { continue }
            next.append(Found(name: name, host: host, fingerprint: fp))
        }
        found = next.sorted { $0.name < $1.name }
    }

    /// Resolves a Bonjour service to https://ip:port by opening (and immediately closing) a TCP
    /// connection. No data is sent.
    private static func resolve(_ endpoint: NWEndpoint) async -> String? {
        await withCheckedContinuation { (c: CheckedContinuation<String?, Never>) in
            let conn = NWConnection(to: endpoint, using: .tcp)
            let once = Once()
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    var result: String?
                    if case .hostPort(let host, let port) = conn.currentPath?.remoteEndpoint {
                        var h = "\(host)"
                        if let pct = h.firstIndex(of: "%") { h = String(h[..<pct]) }   // drop the interface scope
                        result = h.contains(":") ? "https://[\(h)]:\(port)" : "https://\(h):\(port)"
                    }
                    conn.cancel()
                    once.run { c.resume(returning: result) }
                case .failed, .cancelled:
                    once.run { c.resume(returning: nil) }
                default:
                    break
                }
            }
            conn.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + 4) {
                conn.cancel()
                once.run { c.resume(returning: nil) }
            }
        }
    }
}

/// Runs a closure at most once, from any thread.
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func run(_ body: () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        guard !done else { return }
        done = true
        body()
    }
}
