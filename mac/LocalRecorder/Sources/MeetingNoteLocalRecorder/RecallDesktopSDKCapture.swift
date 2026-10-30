@preconcurrency import Foundation
import Darwin
import LocalRecorderCore

struct RecallDesktopSDKRecordingResult {
    var clientRecordingId: String
    var sdkUploadId: String
    var windowId: String
    var startedAt: Date
    var stoppedAt: Date
    var didCaptureStart: Bool
}

enum RecallDesktopSDKRecordingError: LocalizedError {
    case alreadyRecording
    case noActiveRecording
    case invalidAPIURL
    case scriptNotFound
    case startFailed(String)
    case captureStateUnknown

    var errorDescription: String? {
        switch self {
        case .captureStateUnknown:
            return "Capture has not confirmed it stopped. Use Stop before recording again."
        case .alreadyRecording:
            return "Recording is already running"
        case .noActiveRecording:
            return "No active SDK recording"
        case .invalidAPIURL:
            return "Recall API URL is invalid"
        case .scriptNotFound:
            return "Recall Desktop SDK sidecar is not available"
        case .startFailed(let message):
            return message
        }
    }
}

@MainActor
final class RecallDesktopSDKRecordingController {
    private var sessions: [String: RecallDesktopSDKRecordingSession] = [:]
    private var activeID: String?
    var onUnexpectedTermination: ((String) -> Void)?
    var onCaptureFailure: ((String) -> Void)?
    func didCaptureStart(_ id: String) -> Bool { sessions[id]?.started ?? false }
    var activeCaptureEnded: Bool { activeID.flatMap { sessions[$0]?.stopped } ?? false }
    var onLifecycleEvent: ((String, RecorderSDKEvent) -> Void)?

    func start(upload: RecallSDKUploadResponse, clientRecordingId: String) async throws {
        guard activeID == nil else { throw RecallDesktopSDKRecordingError.alreadyRecording }
        guard URL(string: upload.recallApiUrl) != nil else { throw RecallDesktopSDKRecordingError.invalidAPIURL }
        let scriptURL = try sidecarScriptURL()
        let invocation = nodeInvocation(scriptURL: scriptURL)
        let controlURL = Self.controlURL(clientRecordingId)
        try FileManager.default.createDirectory(at: controlURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data().write(to: controlURL, options: .atomic)
        let process = Process()
        let output = Pipe(), input = Pipe()
        // The child may close stdin between isRunning and write. Convert that
        // race to a thrown EPIPE instead of terminating the recorder with SIGPIPE.
        _ = fcntl(input.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1)
        process.executableURL = invocation.executableURL
        process.arguments = invocation.arguments + ["--api-url", upload.recallApiUrl, "--upload-token", upload.uploadToken, "--parent-pid", String(ProcessInfo.processInfo.processIdentifier), "--control-file", controlURL.path]
        process.standardInput = input
        process.standardOutput = output
        // The structured error stream is stdout; never leave an unread stderr pipe.
        process.standardError = FileHandle.nullDevice
        let session = RecallDesktopSDKRecordingSession(id: clientRecordingId, process: process, input: input, output: output, uploadID: upload.sdkUploadId)
        sessions[clientRecordingId] = session
        activeID = clientRecordingId
        process.terminationHandler = { [weak self] process in
            Task { @MainActor in self?.terminated(id: clientRecordingId, status: process.terminationStatus) }
        }
        do {
            try process.run()
            // Exactly one reader owns stdout for the entire process lifetime.
            session.reader = Task { [weak self] in
                do {
                    for try await line in output.fileHandleForReading.bytes.lines {
                        guard let data = line.data(using: .utf8),
                              let message = try? JSONDecoder().decode(RecallDesktopSDKSidecarMessage.self, from: data) else { continue }
                        self?.receive(message, id: clientRecordingId)
                    }
                } catch {
                    session.error = error.localizedDescription
                }
            }
            let deadline = Date().addingTimeInterval(30)
            while !session.started && session.error == nil && process.isRunning && Date() < deadline {
                try await Task.sleep(for: .milliseconds(50))
            }
            guard session.started, session.error == nil, process.isRunning else {
                throw RecallDesktopSDKRecordingError.startFailed(session.error ?? "Recording did not start")
            }
        } catch {
            session.stopRequested = true
            session.lifecycle?.explicitStopRequested = true
            if process.isRunning {
                try? send("stop", to: session)
                let deadline = Date().addingTimeInterval(15)
                while !session.stopped && process.isRunning && Date() < deadline {
                    try await Task.sleep(for: .milliseconds(50))
                }
            }
            guard session.stopped || !process.isRunning else {
                // Keep ownership and the stdout reader. Never overlap a native
                // fallback with an SDK start whose cancellation is unconfirmed.
                throw RecallDesktopSDKRecordingError.captureStateUnknown
            }
            activeID = nil
            session.stopped = true
            throw error
        }
    }

    /// Acknowledges capture stop, leaving the sidecar alive for its upload.
    func stop() async throws -> RecallDesktopSDKRecordingResult {
        guard let id = activeID, let session = sessions[id] else {
            throw RecallDesktopSDKRecordingError.noActiveRecording
        }
        session.stopRequested = true
        session.lifecycle?.explicitStopRequested = true
        var stopWriteError: Error?
        if !session.stopped && session.process.isRunning {
            do { try send("stop", to: session) }
            catch { stopWriteError = error }
        }
        let deadline = Date().addingTimeInterval(15)
        while !session.stopped && session.process.isRunning && Date() < deadline {
            try await Task.sleep(for: .milliseconds(50))
        }
        guard session.stopped || !session.process.isRunning else {
            throw RecallDesktopSDKRecordingError.startFailed(stopWriteError?.localizedDescription ?? session.error ?? "Capture has not confirmed it stopped. Try Stop again.")
        }
        // Process exit proves capture ended, but says nothing about upload delivery.
        session.stopped = true
        activeID = nil
        return RecallDesktopSDKRecordingResult(clientRecordingId: id, sdkUploadId: session.uploadID, windowId: session.windowID ?? "unstarted", startedAt: session.startedAt, stoppedAt: Date(), didCaptureStart: session.started)
    }

    func shutdown(clientRecordingId: String) async throws {
        let controlURL = Self.controlURL(clientRecordingId)
        guard let session = sessions[clientRecordingId] else {
            // A surviving upload from a prior app process reads this unique file.
            try FileManager.default.createDirectory(at: controlURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("shutdown".utf8).write(to: controlURL, options: .atomic)
            return
        }
        guard session.stopped else { throw RecallDesktopSDKRecordingError.startFailed("Capture is still active") }
        if session.process.isRunning {
            try send("shutdown", to: session)
            let deadline = Date().addingTimeInterval(15)
            while session.process.isRunning && Date() < deadline { try await Task.sleep(for: .milliseconds(100)) }
            guard !session.process.isRunning else { throw RecallDesktopSDKRecordingError.startFailed("Upload process is still closing") }
        }
        session.reader?.cancel()
        try? session.input.fileHandleForWriting.close()
        sessions.removeValue(forKey: clientRecordingId)
        try? FileManager.default.removeItem(at: controlURL)
    }

    private static func controlURL(_ id: String) -> URL {
        LocalRecorderFileLocations.uploadQueueDirectoryURL().deletingLastPathComponent().appendingPathComponent("sdk-controls").appendingPathComponent(id + ".control")
    }

    private func send(_ type: String, to session: RecallDesktopSDKRecordingSession) throws {
        try session.input.fileHandleForWriting.write(contentsOf: Data("{\"type\":\"\(type)\"}\n".utf8))
    }

    private func receive(_ message: RecallDesktopSDKSidecarMessage, id: String) {
        guard let session = sessions[id] else { return }
        switch message.type {
        case "started":
            session.started = true
            session.windowID = message.windowId
            if let windowID = message.windowId, session.lifecycle == nil {
                session.lifecycle = RecorderSDKLifecycle(windowID: windowID)
                session.lifecycle?.explicitStopRequested = session.stopRequested
            }
        case "prepared":
            session.windowID = message.windowId
            if let windowID = message.windowId, session.lifecycle == nil {
                session.lifecycle = RecorderSDKLifecycle(windowID: windowID)
                session.lifecycle?.explicitStopRequested = session.stopRequested
            }
        case "cancelled", "stopped": session.stopped = true
        case "error":
            session.error = message.message
            if activeID == id, session.started, session.lifecycle?.explicitStopRequested == false {
                onCaptureFailure?(id)
            }
        case "sdk_event":
            guard let event = message.event else { return }
            if let decision = session.lifecycle?.observe(event: event, windowID: message.payload?.window?.id) {
                if decision == .recordingEnded { session.stopped = true }
                if activeID == id { onLifecycleEvent?(id, decision) }
            }
        default: break
        }
    }

    private func terminated(id: String, status: Int32) {
        guard let session = sessions[id] else { return }
        let unexpected = !session.stopped && session.started && !session.stopRequested
        session.error = session.error ?? "Recording process exited (\(status))"
        session.stopped = true
        // Retain ownership and started evidence until Stop consumes it or the
        // model handles the unexpected exit. A late termination callback must
        // neither strand Stop nor turn a captured segment into a failed start.
        if activeID == id && unexpected {
            onUnexpectedTermination?(id)
        }
    }

    private func sidecarScriptURL() throws -> URL {
        let environment = ProcessInfo.processInfo.environment

        if let override = environment["MEETING_NOTE_RECALL_SDK_SIDECAR_SCRIPT"],
           !override.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let url = URL(fileURLWithPath: override)
            if FileManager.default.fileExists(atPath: url.path) {
                return url
            }
        }

        if let resourceURL = Bundle.main.resourceURL {
            let bundled = resourceURL
                .appending(path: "RecallDesktopSDKSidecar")
                .appending(path: "src")
                .appending(path: "recall-desktop-sdk-sidecar.mjs")
            if FileManager.default.fileExists(atPath: bundled.path) {
                return bundled
            }
        }

        let currentDirectory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let local = currentDirectory
            .appending(path: "Sidecar")
            .appending(path: "src")
            .appending(path: "recall-desktop-sdk-sidecar.mjs")
        if FileManager.default.fileExists(atPath: local.path) {
            return local
        }

        throw RecallDesktopSDKRecordingError.scriptNotFound
    }

    private func nodeInvocation(scriptURL: URL) -> RecallDesktopSDKNodeInvocation {
        let environment = ProcessInfo.processInfo.environment

        if let override = environment["MEETING_NOTE_RECALL_SDK_NODE"],
           !override.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return RecallDesktopSDKNodeInvocation(
                executableURL: URL(fileURLWithPath: override),
                arguments: [scriptURL.path]
            )
        }

        if let resourceURL = Bundle.main.resourceURL {
            let bundledNode = resourceURL
                .appending(path: "node")
                .appending(path: "bin")
                .appending(path: "node")
            if FileManager.default.fileExists(atPath: bundledNode.path) {
                return RecallDesktopSDKNodeInvocation(
                    executableURL: bundledNode,
                    arguments: [scriptURL.path]
                )
            }
        }

        for path in [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ] where FileManager.default.fileExists(atPath: path) {
            return RecallDesktopSDKNodeInvocation(
                executableURL: URL(fileURLWithPath: path),
                arguments: [scriptURL.path]
            )
        }

        return RecallDesktopSDKNodeInvocation(
            executableURL: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: ["node", scriptURL.path]
        )
    }

}

@MainActor
private final class RecallDesktopSDKRecordingSession {
    let id: String
    let process: Process
    let input: Pipe
    let output: Pipe
    let uploadID: String
    let startedAt = Date()
    var windowID: String?
    var lifecycle: RecorderSDKLifecycle?
    var stopped = false
    var started = false
    var stopRequested = false
    var error: String?
    var reader: Task<Void, Never>?
    init(id: String, process: Process, input: Pipe, output: Pipe, uploadID: String) {
        self.id = id; self.process = process; self.input = input; self.output = output; self.uploadID = uploadID
    }
}

private struct RecallDesktopSDKNodeInvocation {
    var executableURL: URL
    var arguments: [String]
}

private struct RecallDesktopSDKSidecarMessage: Decodable {
    var type: String
    var windowId: String?
    var message: String?
    var event: String?
    var payload: Payload?
    struct Payload: Decodable { var window: Window? }
    struct Window: Decodable { var id: String? }
}
