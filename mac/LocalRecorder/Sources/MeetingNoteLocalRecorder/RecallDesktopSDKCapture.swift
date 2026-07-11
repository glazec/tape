@preconcurrency import Foundation
import LocalRecorderCore

struct RecallDesktopSDKRecordingResult {
    var clientRecordingId: String
    var sdkUploadId: String
    var windowId: String
    var startedAt: Date
    var stoppedAt: Date
}

enum RecallDesktopSDKRecordingError: LocalizedError {
    case alreadyRecording
    case noActiveRecording
    case invalidAPIURL
    case scriptNotFound
    case startFailed(String)

    var errorDescription: String? {
        switch self {
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
    private var activeSession: RecallDesktopSDKRecordingSession?
    var onUnexpectedTermination: (() -> Void)?

    func start(
        upload: RecallSDKUploadResponse,
        clientRecordingId: String
    ) async throws {
        if activeSession != nil {
            throw RecallDesktopSDKRecordingError.alreadyRecording
        }

        guard URL(string: upload.recallApiUrl) != nil else {
            throw RecallDesktopSDKRecordingError.invalidAPIURL
        }

        let scriptURL = try sidecarScriptURL()
        let nodeInvocation = nodeInvocation(scriptURL: scriptURL)
        let process = Process()
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        let inputPipe = Pipe()

        process.executableURL = nodeInvocation.executableURL
        process.arguments = nodeInvocation.arguments + [
            "--api-url",
            upload.recallApiUrl,
            "--upload-token",
            upload.uploadToken,
            "--parent-pid",
            String(ProcessInfo.processInfo.processIdentifier),
        ]
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        process.standardInput = inputPipe
        process.terminationHandler = { [weak self, weak process] _ in
            guard let process else {
                return
            }

            Task { @MainActor in
                self?.handleUnexpectedTermination(process)
            }
        }

        try process.run()

        do {
            let windowId = try await Self.readStartedWindowId(
                from: outputPipe.fileHandleForReading
            )
            activeSession = RecallDesktopSDKRecordingSession(
                clientRecordingId: clientRecordingId,
                inputPipe: inputPipe,
                outputPipe: outputPipe,
                process: process,
                sdkUploadId: upload.sdkUploadId,
                startedAt: Date(),
                windowId: windowId
            )
            if !process.isRunning {
                activeSession = nil
                throw RecallDesktopSDKRecordingError.startFailed(
                    "Recall Desktop SDK stopped before recording was ready"
                )
            }
        } catch {
            if process.isRunning {
                process.terminate()
            }

            let stderr = String(
                data: errorPipe.fileHandleForReading.readDataToEndOfFile(),
                encoding: .utf8
            )?
                .trimmingCharacters(in: .whitespacesAndNewlines)

            throw RecallDesktopSDKRecordingError.startFailed(
                stderr?.isEmpty == false ? stderr! : error.localizedDescription
            )
        }
    }

    func stop() async throws -> RecallDesktopSDKRecordingResult {
        guard let session = activeSession else {
            throw RecallDesktopSDKRecordingError.noActiveRecording
        }

        activeSession = nil

        let stopMessage = Data("{\"type\":\"stop\"}\n".utf8)
        session.inputPipe.fileHandleForWriting.write(stopMessage)
        try? session.inputPipe.fileHandleForWriting.close()

        let deadline = Date().addingTimeInterval(15)
        while session.process.isRunning && Date() < deadline {
            try await Task.sleep(for: .milliseconds(100))
        }

        if session.process.isRunning {
            session.process.terminate()
            throw RecallDesktopSDKRecordingError.startFailed(
                "Recall Desktop SDK did not stop within 15 seconds"
            )
        }

        let output = String(
            data: session.outputPipe.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        try RecallDesktopSDKStopAcknowledgement.validate(
            output: output,
            terminationStatus: session.process.terminationStatus
        )

        return RecallDesktopSDKRecordingResult(
            clientRecordingId: session.clientRecordingId,
            sdkUploadId: session.sdkUploadId,
            windowId: session.windowId,
            startedAt: session.startedAt,
            stoppedAt: Date()
        )
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

    private static func readStartedWindowId(from handle: FileHandle) async throws -> String {
        for try await line in handle.bytes.lines {
            guard let data = line.data(using: .utf8) else {
                continue
            }

            let message = try JSONDecoder().decode(
                RecallDesktopSDKSidecarMessage.self,
                from: data
            )

            switch message.type {
            case "started":
                if let windowId = message.windowId, !windowId.isEmpty {
                    return windowId
                }
            case "error":
                throw RecallDesktopSDKRecordingError.startFailed(
                    message.message ?? "Recall Desktop SDK recording failed"
                )
            default:
                continue
            }
        }

        throw RecallDesktopSDKRecordingError.startFailed(
            "Recall Desktop SDK sidecar exited before recording started"
        )
    }

    private func handleUnexpectedTermination(_ process: Process) {
        guard let session = activeSession, session.process === process else {
            return
        }

        activeSession = nil
        onUnexpectedTermination?()
    }
}

private struct RecallDesktopSDKRecordingSession {
    var clientRecordingId: String
    var inputPipe: Pipe
    var outputPipe: Pipe
    var process: Process
    var sdkUploadId: String
    var startedAt: Date
    var windowId: String
}

private struct RecallDesktopSDKNodeInvocation {
    var executableURL: URL
    var arguments: [String]
}

private struct RecallDesktopSDKSidecarMessage: Decodable {
    var type: String
    var windowId: String?
    var message: String?
}
