import Foundation
import Testing
@testable import LocalRecorderCore

@Test func screenshotsKeepInitialAndChangedContentButIgnoreSmallNoise() {
    let original = [UInt8](repeating: 80, count: 64 * 36)
    #expect(ScreenshotChangeDetector.shouldSave(previous: nil, current: original))
    #expect(!ScreenshotChangeDetector.shouldSave(previous: original, current: original))
    #expect(!ScreenshotChangeDetector.shouldSave(previous: original, current: original.map { $0 + 1 }))
    var cursor = original
    cursor[0] = 255
    #expect(!ScreenshotChangeDetector.shouldSave(previous: original, current: cursor))
    var slide = original
    for index in 0..<300 { slide[index] = 200 }
    #expect(ScreenshotChangeDetector.shouldSave(previous: original, current: slide))
}

@Test func screenshotQueueAndCompletionPreserveCaptureTimes() throws {
    let screenshot = LocalRecordingScreenshot(fileURL: URL(fileURLWithPath: "/tmp/screen-0.jpg"), timestampMs: 5000)
    let restored = try JSONDecoder().decode(LocalRecordingScreenshot.self, from: JSONEncoder().encode(screenshot))
    #expect(restored == screenshot)
    var assets = LocalRecordingUploadAssetIds(computerAudioAssetId: "c", microphoneAudioAssetId: "m", synthesizedAudioAssetId: "s", audioFormat: "m4a")
    assets.screenshots = [.init(assetId: "image", timestampMs: restored.timestampMs)]
    let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(assets)) as! [String: Any]
    #expect(json["audioFormat"] as? String == "m4a")
    #expect((json["screenshots"] as? [[String: Any]])?.first?["timestampMs"] as? Int == 5000)
}
