import AppKit
import Foundation
import CoreServices

enum RecorderSystemActions {
    enum RepairPermission: String, CaseIterable, Sendable {
        case microphone = "Microphone"
        case notifications = "Notifications"
        case accessibility = "Accessibility"
        case screenCapture = "ScreenCapture"

        var title: String {
            switch self {
            case .microphone: "Microphone"
            case .notifications: "Notifications"
            case .accessibility: "Accessibility"
            case .screenCapture: "Screen and system audio"
            }
        }

        var resetService: String? { self == .notifications ? nil : rawValue }

        var launchArgument: String { "--repair-" + rawValue }
    }

    enum Failure: Error {
        case replacementDidNotLaunch
        case permissionResetFailed
        case applicationRegistrationFailed
    }

    @MainActor
    static func launchReplacement(at applicationURL: URL, arguments: [String] = []) async throws {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        configuration.activates = true
        configuration.arguments = arguments
        let replacement = try await NSWorkspace.shared.openApplication(
            at: applicationURL,
            configuration: configuration
        )
        guard replacement.processIdentifier != ProcessInfo.processInfo.processIdentifier,
              !replacement.isTerminated else {
            throw Failure.replacementDidNotLaunch
        }
    }

    // Only reset this app's selected permission entry. macOS still requires the
    // user to grant access when the current app registers itself again.
    static func repairPermission(_ permission: RepairPermission, bundleIdentifier: String, applicationURL: URL) async throws {
        guard !bundleIdentifier.isEmpty else { throw Failure.permissionResetFailed }
        guard LSRegisterURL(applicationURL as CFURL, true) == noErr else {
            throw Failure.applicationRegistrationFailed
        }
        // Notifications have no supported tccutil reset service. Preserve their
        // authorization and reopen the current app to request or show settings.
        guard let service = permission.resetService else { return }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/tccutil")
            process.arguments = ["reset", service, bundleIdentifier]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            process.terminationHandler = { completed in
                if completed.terminationStatus == 0 {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: Failure.permissionResetFailed)
                }
            }
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}
