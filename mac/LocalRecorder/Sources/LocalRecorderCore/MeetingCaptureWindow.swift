import Foundation

public struct MeetingCaptureWindow: Equatable, Sendable {
    public let id: UInt32
    public let processID: Int32
    public let bundleID: String
    public let title: String
    public let activeTabURL: URL?
    public static let browserBundleIDs: Set<String> = ["com.google.Chrome", "com.apple.Safari", "com.microsoft.edgemac", "org.mozilla.firefox"]

    public init(id: UInt32, processID: Int32, bundleID: String, title: String, activeTabURL: URL? = nil) {
        self.id = id
        self.processID = processID
        self.bundleID = bundleID
        self.title = title
        self.activeTabURL = activeTabURL
    }

    /// The identity screenshots may follow, or nil when they must stay off. A browser
    /// window whose tab cannot be identified could show any tab, so it is never
    /// screenshotted; its audio still records.
    public var screenshotIdentity: MeetingCaptureWindow? {
        Self.browserBundleIDs.contains(bundleID) && activeTabURL == nil ? nil : self
    }

    /// Whether `current` is still the window the user chose, so screenshots may continue.
    /// The window ID and owning process decide it. Titles are ignored: they change with
    /// notifications, unread counts and speakers. In a browser only a tab that is known
    /// to differ stops screenshots, because a URL lookup that comes back empty says
    /// nothing about which tab is showing.
    public func isSameCaptureTarget(as current: MeetingCaptureWindow) -> Bool {
        guard id == current.id, processID == current.processID else { return false }
        if let chosenTab = activeTabURL, let currentTab = current.activeTabURL {
            return chosenTab == currentTab
        }
        return true
    }
}

/// One on-screen window as the in-app window chooser sees it. A plain value, so the
/// filtering rule is testable and the chooser renders without Screen Recording access.
public struct CaptureWindowChoice: Equatable, Identifiable, Sendable {
    public let id: UInt32
    public let bundleID: String
    public let appName: String
    public let title: String
    public let width: Double
    public let height: Double
    public let layer: Int
    public let isOnScreen: Bool
    /// Front-to-back position on screen; nil when the window server did not report it.
    public let stackOrder: Int?

    public init(id: UInt32, bundleID: String, appName: String, title: String, width: Double, height: Double,
                layer: Int = 0, isOnScreen: Bool = true, stackOrder: Int? = nil) {
        self.id = id
        self.bundleID = bundleID
        self.appName = appName
        self.title = title
        self.width = width
        self.height = height
        self.layer = layer
        self.isOnScreen = isOnScreen
        self.stackOrder = stackOrder
    }
}

public enum CaptureWindowChoices {
    public static let minimumWidth = 200.0
    public static let minimumHeight = 120.0
    /// System UI draws ordinary-looking windows (menu extras, widgets, the Dock's
    /// shelf) that are never a meeting.
    public static let systemBundleIDs: Set<String> = [
        "com.apple.dock", "com.apple.controlcenter", "com.apple.notificationcenterui",
        "com.apple.systemuiserver", "com.apple.WindowManager", "com.apple.Spotlight",
        "com.apple.loginwindow", "com.apple.screencaptureui", "com.apple.TextInputMenuAgent",
    ]
    public static let systemAppNames: Set<String> = [
        "Window Server", "Dock", "Control Center", "Notification Center", "SystemUIServer",
        "Spotlight", "WindowManager",
    ]

    /// Normal, titled, reasonably sized windows of other apps, grouped by app with the
    /// app nearest the front first, so the meeting the person just left sits at the top.
    public static func choices(from windows: [CaptureWindowChoice], excludingBundleID ownBundleID: String?) -> [CaptureWindowChoice] {
        let eligible = windows.filter { window in
            window.isOnScreen && window.layer == 0
                && !window.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && window.width >= minimumWidth && window.height >= minimumHeight
                && window.bundleID != ownBundleID
                && !systemBundleIDs.contains(window.bundleID) && !systemAppNames.contains(window.appName)
        }
        let unknown = Int.max
        var appRank: [String: Int] = [:]
        for window in eligible {
            appRank[window.bundleID] = min(appRank[window.bundleID] ?? unknown, window.stackOrder ?? unknown)
        }
        return eligible.sorted { left, right in
            let leftRank = appRank[left.bundleID] ?? unknown, rightRank = appRank[right.bundleID] ?? unknown
            if leftRank != rightRank { return leftRank < rightRank }
            let byName = left.appName.localizedCaseInsensitiveCompare(right.appName)
            if byName != .orderedSame { return byName == .orderedAscending }
            if left.bundleID != right.bundleID { return left.bundleID < right.bundleID }
            let leftOrder = left.stackOrder ?? unknown, rightOrder = right.stackOrder ?? unknown
            if leftOrder != rightOrder { return leftOrder < rightOrder }
            return left.title.localizedCaseInsensitiveCompare(right.title) == .orderedAscending
        }
    }
}
