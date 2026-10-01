import CryptoKit
import Foundation
import Security

/// Certificate pinning for the brain's encrypted phone listener (docs/decisions/0002).
///
/// SAM's certificate is self-signed, so there's no CA to trust. Trust comes from the SHA-256
/// fingerprint the person carried from their Mac in the pairing QR. A connection is accepted
/// only if the server's leaf certificate hashes to exactly that value, and refused otherwise,
/// including when someone on the network presents a certificate that some CA would accept.
public final class PinningDelegate: NSObject, URLSessionDelegate, @unchecked Sendable {
    public let fingerprint: String

    public init(fingerprint: String) {
        self.fingerprint = fingerprint.lowercased()
    }

    public func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge)
        async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = chain.first,
              Self.matches(der: SecCertificateCopyData(leaf) as Data, fingerprint: fingerprint)
        else { return (.cancelAuthenticationChallenge, nil) }
        return (.useCredential, URLCredential(trust: trust))
    }

    /// Lowercase hex SHA-256 of a certificate's DER bytes, the same value the server prints.
    public static func fingerprint(of der: Data) -> String {
        SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined()
    }

    public static func matches(der: Data, fingerprint: String) -> Bool {
        // Constant-time comparison: timing shouldn't hint at how much of a forged cert matched.
        let a = Array(Self.fingerprint(of: der).utf8), b = Array(fingerprint.lowercased().utf8)
        guard a.count == b.count else { return false }
        return zip(a, b).reduce(0) { $0 | ($1.0 ^ $1.1) } == 0
    }

    /// A URLSession that only talks to the server holding this certificate.
    public static func session(fingerprint: String) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        return URLSession(configuration: config, delegate: PinningDelegate(fingerprint: fingerprint), delegateQueue: nil)
    }
}
