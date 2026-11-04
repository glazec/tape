import Foundation

public enum ScreenshotChangeDetector {
    public static func shouldSave(previous: [UInt8]?, current: [UInt8]) -> Bool {
        guard !current.isEmpty else { return false }
        guard let previous, previous.count == current.count else { return true }
        let differences = zip(previous, current).map { abs(Int($0) - Int($1)) }
        // Ignore cursor sized changes and small rendering noise. Compare with
        // the last saved frame so gradual edits eventually cross the threshold.
        return differences.reduce(0, +) > current.count * 2
            && differences.filter { $0 > 16 }.count * 100 > current.count
    }
}

public struct LocalRecordingScreenshot: Codable, Equatable, Sendable {
    public var fileURL: URL
    public var timestampMs: Int
    public init(fileURL: URL, timestampMs: Int) {
        self.fileURL = fileURL
        self.timestampMs = timestampMs
    }
}

public struct LocalRecordingScreenshotAsset: Codable, Equatable, Sendable {
    public var assetId: String
    public var timestampMs: Int
}
