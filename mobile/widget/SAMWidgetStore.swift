import Foundation
import WidgetKit

@objc(SAMWidgetStore)
class SAMWidgetStore: NSObject {
  static let suiteName = "group.com.hectic.sam.mobile"
  static let key = "state"

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc func save(_ json: String) {
    UserDefaults(suiteName: SAMWidgetStore.suiteName)?.set(json, forKey: SAMWidgetStore.key)
    WidgetCenter.shared.reloadAllTimelines()
  }
}
