import AppKit
import Foundation

enum RecorderSystemActions {
    enum Failure: Error {
        case replacementDidNotLaunch
        case permissionResetFailed
    }

    @MainActor
    static func launchReplacement(at applicationURL: URL) async throws {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        configuration.activates = true
        let replacement = try await NSWorkspace.shared.openApplication(
            at: applicationURL,
            configuration: configuration
        )
        guard replacement.processIdentifier != ProcessInfo.processInfo.processIdentifier,
              !replacement.isTerminated else {
            throw Failure.replacementDidNotLaunch
        }
    }

    // Only reset this app's Accessibility entry. macOS still requires the
    // user to grant access when the current app registers itself again.
    static func resetAccessibility(bundleIdentifier: String) async throws {
        guard !bundleIdentifier.isEmpty else { throw Failure.permissionResetFailed }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/tccutil")
            process.arguments = ["reset", "Accessibility", bundleIdentifier]
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
