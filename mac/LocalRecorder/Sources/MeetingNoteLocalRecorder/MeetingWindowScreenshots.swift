import AppKit
import Foundation
import LocalRecorderCore
@preconcurrency import ScreenCaptureKit

// The selected filter is immutable after selection and only used for capture.
struct SelectedMeetingWindow: @unchecked Sendable {
    let filter: SCContentFilter
    let selectedWindowIdentity: MeetingCaptureWindow?
}

/// Lists windows for Tape's own chooser. The system content-sharing picker is not used:
/// once the Recall helper has run in this process and exited, replayd forgets which
/// client owns Tape's bundle ID and silently drops the picker's result, leaving the
/// start waiting forever. Shareable-content queries route by connection and keep working.
@MainActor
enum MeetingWindowCatalog {
    struct Listing {
        var choices: [CaptureWindowChoice]
        var windows: [UInt32: SCWindow]
    }

    static func load() async throws -> Listing {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let stackOrder = frontToBackOrder()
        var windows: [UInt32: SCWindow] = [:]
        let candidates = content.windows.compactMap { window -> CaptureWindowChoice? in
            guard let application = window.owningApplication else { return nil }
            windows[window.windowID] = window
            return CaptureWindowChoice(
                id: window.windowID, bundleID: application.bundleIdentifier, appName: application.applicationName,
                title: window.title ?? "", width: window.frame.width, height: window.frame.height,
                layer: window.windowLayer, isOnScreen: window.isOnScreen, stackOrder: stackOrder[window.windowID]
            )
        }
        let choices = CaptureWindowChoices.choices(from: candidates, excludingBundleID: Bundle.main.bundleIdentifier)
        return Listing(choices: choices, windows: windows.filter { id, _ in choices.contains { $0.id == id } })
    }

    static func selection(for window: SCWindow) -> SelectedMeetingWindow {
        // An unidentified browser tab (Chrome often hides it from accessibility)
        // records audio without screenshots instead of refusing the window.
        SelectedMeetingWindow(
            filter: SCContentFilter(desktopIndependentWindow: window),
            selectedWindowIdentity: window.captureIdentity?.screenshotIdentity
        )
    }

    /// The window list is ordered front to back; only the numbers are read, which needs
    /// no Screen Recording access.
    private static func frontToBackOrder() -> [UInt32: Int] {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return [:]
        }
        var order: [UInt32: Int] = [:]
        for (index, info) in list.enumerated() {
            if let number = (info[kCGWindowNumber as String] as? NSNumber)?.uint32Value, order[number] == nil { order[number] = index }
        }
        return order
    }
}

@MainActor
final class MeetingWindowScreenshots {
    private let filter: SCContentFilter
    private let selectedWindowIdentity: MeetingCaptureWindow?
    private let directory: URL
    private let startedAt: Date
    private let onStatus: @Sendable (String?) -> Void
    private var task: Task<Void, Never>?
    private var fingerprint: [UInt8]?
    private var screenshots: [LocalRecordingScreenshot] = []

    init(filter: SCContentFilter, selectedWindowIdentity: MeetingCaptureWindow? = nil, directory: URL, startedAt: Date, onStatus: @escaping @Sendable (String?) -> Void) {
        self.filter = filter
        self.selectedWindowIdentity = selectedWindowIdentity
        self.directory = directory
        self.startedAt = startedAt
        self.onStatus = onStatus
    }

    func start() async throws {
        guard selectedWindowIdentity != nil else {
            onStatus("Screenshots are unavailable for this window. Audio recording continues.")
            return
        }
        // Screenshots are secondary: a first capture that fails pauses them with a
        // visible status instead of stopping the audio recording from starting.
        do {
            try await capture()
        } catch {
            onStatus("Screenshots paused. Keep the selected meeting window open and its meeting tab visible.")
        }
        task = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
                guard let self, !Task.isCancelled else { return }
                do {
                    try await self.capture()
                    self.onStatus(nil)
                } catch {
                    self.onStatus("Screenshots paused. Keep the selected meeting window open and its meeting tab visible.")
                }
            }
        }
    }

    func stop() async -> [LocalRecordingScreenshot] {
        task?.cancel()
        await task?.value
        task = nil
        return screenshots
    }

    private func validateSelectedWindow() async throws {
        if let selectedWindowIdentity {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard content.windows.contains(where: { $0.captureIdentity == selectedWindowIdentity }) else {
                throw LocalRecordingCaptureError.writerFailed("The detected meeting is no longer visible in its window")
            }
        }
    }

    private func capture() async throws {
        try await validateSelectedWindow()
        let capturedAt = Date()
        let configuration = SCStreamConfiguration()
        let rect = filter.contentRect
        let scale = min(1, 1600 / max(rect.width, rect.height))
        configuration.width = max(2, Int(rect.width * scale))
        configuration.height = max(2, Int(rect.height * scale))
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        guard !Task.isCancelled else { return }
        try await validateSelectedWindow()
        let current = try Self.fingerprint(image)
        guard ScreenshotChangeDetector.shouldSave(previous: fingerprint, current: current) else { return }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.75]) else {
            throw LocalRecordingCaptureError.writerFailed("Could not save the meeting screenshot")
        }
        let url = directory.appendingPathComponent("screen-\(screenshots.count).jpg")
        try jpeg.write(to: url, options: .atomic)
        screenshots.append(.init(fileURL: url, timestampMs: max(0, Int(capturedAt.timeIntervalSince(startedAt) * 1000))))
        fingerprint = current
    }

    private static func fingerprint(_ image: CGImage) throws -> [UInt8] {
        var pixels = [UInt8](repeating: 0, count: 64 * 36)
        try pixels.withUnsafeMutableBytes { bytes in
            guard let context = CGContext(data: bytes.baseAddress, width: 64, height: 36, bitsPerComponent: 8,
                bytesPerRow: 64, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else {
                throw LocalRecordingCaptureError.writerFailed("Could not compare meeting screenshots")
            }
            context.draw(image, in: CGRect(x: 0, y: 0, width: 64, height: 36))
        }
        return pixels
    }
}

private extension SCWindow {
    var captureIdentity: MeetingCaptureWindow? {
        guard let application = owningApplication, let title else { return nil }
        return MeetingCaptureWindow(id: windowID, processID: application.processID,
                                    bundleID: application.bundleIdentifier, title: title,
                                    activeTabURL: MeetingCaptureWindow.browserBundleIDs.contains(application.bundleIdentifier)
                                        ? BrowserMeetingTab.activeURL(processID: application.processID, frame: frame) : nil)
    }
}
