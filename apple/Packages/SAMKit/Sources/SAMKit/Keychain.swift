import Foundation
import Security

/// The session token lives in the Keychain, never in defaults. Device-only and
/// after-first-unlock, so it doesn't sync to iCloud or leave in a backup.
public enum Keychain {
    static let service = "com.hectic.sam.session"

    /// `SAMKeychainGroup` in the target's Info.plist (= $(AppIdentifierPrefix)com.hectic.sam.shared),
    /// so the app and its extensions read the same token. Absent → the target's default group.
    static var accessGroup: String? { Bundle.main.object(forInfoDictionaryKey: "SAMKeychainGroup") as? String }

    static func baseQuery(_ account: String) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account,
                                kSecUseDataProtectionKeychain as String: true]
        if let accessGroup { q[kSecAttrAccessGroup as String] = accessGroup }
        return q
    }

    /// Returns false when the Keychain refused the write (e.g. a build without the
    /// keychain entitlement, errSecMissingEntitlement -34018), so callers can say so.
    @discardableResult
    public static func set(_ value: String?, for account: String) -> Bool {
        let base = baseQuery(account)
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
        var query = baseQuery(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
