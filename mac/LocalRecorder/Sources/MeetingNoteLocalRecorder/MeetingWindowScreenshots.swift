import AppKit
import Foundation
import LocalRecorderCore
@preconcurrency import ScreenCaptureKit

// The selected filter is immutable after selection and only used for capture.
struct SelectedMeetingWindow: @unchecked Sendable {
    let filter: SCContentFilter
    let selectedWindowIdentity: MeetingCaptureWindow?
}

@MainActor
final class MeetingWindowPicker: NSObject, SCContentSharingPickerObserver {
    private var continuation: CheckedContinuation<SelectedMeetingWindow, Error>?

    func select() async throws -> SelectedMeetingWindow {
        let picker = SCContentSharingPicker.shared
        var configuration = SCContentSharingPickerConfiguration()
        configuration.allowedPickerModes = [.singleWindow]
        configuration.allowsChangingSelectedContent = false
        configuration.excludedBundleIDs = [Bundle.main.bundleIdentifier].compactMap { $0 }
        picker.defaultConfiguration = configuration
        picker.add(self)
        picker.isActive = true
        defer { picker.remove(self) }
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            picker.present(using: .window)
        }
    }

    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        Task { @MainActor in self.resolve(.failure(CancellationError())) }
    }
    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
        Task { @MainActor in
            guard #available(macOS 15.2, *) else {
                self.resolve(.success(SelectedMeetingWindow(filter: filter, selectedWindowIdentity: nil)))
                return
            }
            let identity = filter.includedWindows.first?.captureIdentity
            if let identity, MeetingCaptureWindow.browserBundleIDs.contains(identity.bundleID), identity.activeTabURL == nil {
                self.resolve(.failure(LocalRecordingCaptureError.writerFailed("Could not identify this browser tab. Choose a dedicated presentation window instead.")))
                return
            }
            self.resolve(.success(SelectedMeetingWindow(filter: filter, selectedWindowIdentity: identity)))
        }
    }
    nonisolated func contentSharingPickerStartDidFailWithError(_ error: Error) {
        Task { @MainActor in self.resolve(.failure(error)) }
    }
    private func resolve(_ result: Result<SelectedMeetingWindow, Error>) {
        if case .failure = result { SCContentSharingPicker.shared.isActive = false }
        continuation?.resume(with: result)
        continuation = nil
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
        // Fail startup visibly if the selected window cannot be captured.
        try await capture()
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
        SCContentSharingPicker.shared.isActive = false
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
