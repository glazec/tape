import AppKit
import Foundation
import OSLog
import Sentry

public enum LocalRecorderFailureOperation: String, Sendable, CaseIterable {
    case recordingClaim = "recording.claim"
    case recordingCreate = "recording.create"
    case recordingStart = "recording.start"
    case recordingStop = "recording.stop"
    case recordingUpload = "recording.upload"
    case sdkStart = "recording.sdk.start"
    case sdkTermination = "recording.sdk.termination"
    case fallbackStart = "recording.fallback.start"
    case audioProcessingStart = "audio.processing.start"
    case audioMeterStart = "audio.meter.start"
    case audioTestStart = "audio.test.start"
    case audioWrite = "audio.write"
    case audioStream = "audio.stream"
}

public enum LocalRecorderTelemetry {
    private static let logger = Logger(
        subsystem: "tech.inevitable.meeting-note.local-recorder",
        category: "recording-errors"
    )

    /// Screenshots show Tape's own windows only, which can include meeting titles.
    @MainActor private static var attachScreenshots = true

    @MainActor
    public static func start(
        dsn: String?,
        environment: String,
        release: String,
        attachScreenshots: Bool = true
    ) {
        self.attachScreenshots = attachScreenshots
        guard let dsn, !dsn.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            logger.notice("Sentry disabled: no DSN configured")
            return
        }
        SentrySDK.start { options in
            options.dsn = dsn
            options.environment = environment
            options.releaseName = release
            options.sendDefaultPii = false
            options.enableAutoSessionTracking = false
            options.enableAutoBreadcrumbTracking = false
            options.enableNetworkTracking = false
            options.enableCaptureFailedRequests = false
            options.beforeSend = { event in
                event.error = nil
                event.user = nil
                event.serverName = nil
                event.context?["device"]?.removeValue(forKey: "name")
                for exception in event.exceptions ?? [] {
                    exception.value = event.tags?["operation.name"] ?? "Native failure"
                }
                event.request = nil
                event.extra = nil
                event.breadcrumbs = nil
                return event
            }
        }
        SentrySDK.configureScope { scope in
            scope.setTag(value: "desktop", key: "error.source")
        }
    }

    /// Never send error descriptions, userInfo, URLs, file paths, or meeting data.
    /// Handled errors carry a screenshot of Tape's visible windows. Errors raised off
    /// the main thread are sent from the main thread, so this returns nil for them.
    @discardableResult
    public static func capture(_ error: Error, operation: LocalRecorderFailureOperation) -> String? {
        let safeError = sanitizedError(error, operation: operation)
        logger.error("Recording failure: \(operation.rawValue, privacy: .public), code \(safeError.code)")
        if Thread.isMainThread {
            return MainActor.assumeIsolated { send(safeError, operation: operation) }
        }
        Task { @MainActor in send(safeError, operation: operation) }
        return nil
    }

    @MainActor
    private static func send(_ safeError: NSError, operation: LocalRecorderFailureOperation) -> String {
        let screenshots = attachScreenshots ? LocalRecorderScreenshot.windowAttachments() : []
        return SentrySDK.capture(error: safeError) { scope in
            scope.setTag(value: "desktop", key: "error.source")
            scope.setTag(value: "true", key: "error.handled")
            scope.setTag(value: operation.rawValue, key: "operation.name")
            scope.setFingerprint(["desktop", operation.rawValue, safeError.domain, String(safeError.code)])
            screenshots.forEach { scope.addAttachment($0) }
        }.sentryIdString
    }

    static func sanitizedError(_ error: Error, operation: LocalRecorderFailureOperation) -> NSError {
        // The Swift type contains no associated values; NSError domains can contain provider data.
        NSError(
            domain: String(reflecting: type(of: error)),
            code: (error as NSError).code,
            userInfo: [NSLocalizedDescriptionKey: operation.rawValue]
        )
    }

    public static func flush(timeout: TimeInterval = 5) {
        SentrySDK.flush(timeout: timeout)
    }
}

/// Renders Tape's own visible windows. No screen recording permission is needed,
/// and other apps or the desktop are never captured.
@MainActor
enum LocalRecorderScreenshot {
    static let maxWindows = 3
    static let minimumSide: CGFloat = 80

    static func windowAttachments() -> [Attachment] {
        let windows = (NSApp?.windows ?? [])
            .filter(isCapturable)
            .sorted { $0.isKeyWindow && !$1.isKeyWindow }
            .prefix(maxWindows)
        return windows.enumerated().compactMap { index, window in
            guard let view = window.contentView?.superview ?? window.contentView,
                  let data = pngData(of: view) else { return nil }
            let filename = index == 0 ? "screenshot.png" : "screenshot-\(index + 1).png"
            return Attachment(data: data, filename: filename, contentType: "image/png")
        }
    }

    static func isCapturable(_ window: NSWindow) -> Bool {
        window.isVisible
            && window.frame.width >= minimumSide
            && window.frame.height >= minimumSide
            && !window.className.contains("StatusBar")
    }

    static func pngData(of view: NSView) -> Data? {
        let bounds = view.bounds
        guard bounds.width > 0, bounds.height > 0,
              let bitmap = view.bitmapImageRepForCachingDisplay(in: bounds) else { return nil }
        view.cacheDisplay(in: bounds, to: bitmap)
        return bitmap.representation(using: .png, properties: [:])
    }
}
