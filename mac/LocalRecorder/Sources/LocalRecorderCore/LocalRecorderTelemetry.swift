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

    @MainActor
    public static func start(dsn: String?, environment: String, release: String) {
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
    @discardableResult
    public static func capture(_ error: Error, operation: LocalRecorderFailureOperation) -> String {
        let safeError = sanitizedError(error, operation: operation)
        logger.error("Recording failure: \(operation.rawValue, privacy: .public), code \(safeError.code)")
        return SentrySDK.capture(error: safeError) { scope in
            scope.setTag(value: "desktop", key: "error.source")
            scope.setTag(value: "true", key: "error.handled")
            scope.setTag(value: operation.rawValue, key: "operation.name")
            scope.setFingerprint(["desktop", operation.rawValue, safeError.domain, String(safeError.code)])
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
