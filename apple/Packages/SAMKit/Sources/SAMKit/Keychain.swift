import Foundation
import Security

/// The session token lives in the Keychain, never in defaults. Device-only and
/// after-first-unlock, so it doesn't sync to iCloud or leave in a backup.
public enum Keychain {
    static let service = "com.hectic.sam.session"

    /// Returns false when the Keychain refused the write (e.g. a build without the
    /// keychain entitlement, errSecMissingEntitlement -34018), so callers can say so.
    @discardableResult
    public static func set(_ value: String?, for account: String) -> Bool {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: service,
                                   kSecAttrAccount as String: account,
                                   kSecUseDataProtectionKeychain as String: true]
        SecItemDelete(base as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return true }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status != errSecSuccess { print("SAM Keychain write failed: \(status)") }
        return status == errSecSuccess
    }

    public static func get(_ account: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: account,
                                    kSecUseDataProtectionKeychain as String: true,
                                    kSecReturnData as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne]
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
