#if os(macOS)
import AppKit
import SwiftData

/// Services menu: select text in any app → Services → Ask SAM. Opens the quick panel with it.
final class SAMServices: NSObject {
    @objc func askSAM(_ pboard: NSPasteboard, userData: String?, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let text = pboard.string(forType: .string), !text.isEmpty else { return }
        Task { @MainActor in QuickPanel.shared.show(text: text) }
    }
}

/// Mac-only start-up: Services provider and the ⌥Space quick panel.
final class MacAppDelegate: NSObject, NSApplicationDelegate {
    private let services = SAMServices()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.servicesProvider = services
        NSUpdateDynamicServices()
        Task { @MainActor in
            QuickPanel.shared.install(model: AppModel.shared, container: SAMStore.container)
        }
    }

    /// Clicking the Dock icon with no window open brings one back, like any Mac app.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { !flag }
}
#endif
