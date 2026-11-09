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
}
