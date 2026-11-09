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
}
