@preconcurrency import AVFoundation
import CoreMedia
import Foundation
import LocalRecorderCore
import ScreenCaptureKit

struct LocalRecordingCaptureResult {
    var cleanupDirectoryURL: URL
    var payload: LocalRecordingUploadPayload
}

enum LocalRecordingCaptureError: LocalizedError {
    case alreadyRecording
    case noActiveRecording
    case noDisplayAvailable
    case audioBufferUnavailable
    case audioFormatUnavailable
    case writerFailed(String)

    var errorDescription: String? {
        switch self {
        case .alreadyRecording:
            return "Recording is already running"
        case .noActiveRecording:
            return "No active recording"
        case .noDisplayAvailable:
            return "No display is available for system audio capture"
        case .audioBufferUnavailable:
            return "Audio buffer is unavailable"
        case .audioFormatUnavailable:
            return "Audio format is unavailable"
        case .writerFailed(let message):
            return message
        }
    }
}

@MainActor
final class LocalRecordingCaptureController {
    private var activeSession: LocalRecordingCaptureSession?

    func start(fallbackIntentId: String, appVersion: String) async throws {
        if activeSession != nil {
            throw LocalRecordingCaptureError.alreadyRecording
        }

        let session = try LocalRecordingCaptureSession(
            fallbackIntentId: fallbackIntentId,
            appVersion: appVersion
        )
        try await session.start()
        activeSession = session
    }

    func stop() async throws -> LocalRecordingCaptureResult {
        guard let activeSession else {
            throw LocalRecordingCaptureError.noActiveRecording
        }

        self.activeSession = nil
        return try await activeSession.stop()
    }
}

@MainActor
final class LocalRecordingCaptureSession {
    private let appVersion: String
    private let clientRecordingId: String
    private let computerAudioURL: URL
    private let fallbackIntentId: String
    private let microphoneAudioURL: URL
    private let microphoneRecorder: MicrophoneTrackRecorder
    private let startedAt: Date
    private let systemRecorder: SystemAudioTrackRecorder

    init(fallbackIntentId: String, appVersion: String) throws {
        let directoryURL = FileManager.default.temporaryDirectory
            .appending(path: "meeting-note-local-recorder", directoryHint: .isDirectory)
            .appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true
        )

        self.appVersion = appVersion
        self.clientRecordingId = UUID().uuidString
        self.computerAudioURL = directoryURL.appending(path: "computer.wav")
        self.fallbackIntentId = fallbackIntentId
        self.microphoneAudioURL = directoryURL.appending(path: "microphone.wav")
        self.startedAt = Date()
        self.microphoneRecorder = try MicrophoneTrackRecorder(outputURL: microphoneAudioURL)
        self.systemRecorder = try SystemAudioTrackRecorder(outputURL: computerAudioURL)
    }

    func start() async throws {
        try microphoneRecorder.start()

        do {
            try await systemRecorder.start()
        } catch {
            microphoneRecorder.stop()
            throw error
        }
    }

    func stop() async throws -> LocalRecordingCaptureResult {
        let stoppedAt = Date()
        await systemRecorder.stop()
        microphoneRecorder.stop()

        let manifest = RecordingManifest(
            appVersion: appVersion,
            computerAudio: TrackMetadata(
                captureStartedAt: startedAt,
                captureStoppedAt: stoppedAt,
                sampleRate: LocalTrackAudioFormat.sampleRate,
                channelCount: LocalTrackAudioFormat.channelCount,
                codec: "pcm_s16le",
                container: "wav",
                firstSampleTime: 0
            ),
            microphoneAudio: TrackMetadata(
                captureStartedAt: startedAt,
                captureStoppedAt: stoppedAt,
                sampleRate: LocalTrackAudioFormat.sampleRate,
                channelCount: LocalTrackAudioFormat.channelCount,
                codec: "pcm_s16le",
                container: "wav",
                firstSampleTime: 0
            )
        )
        let payload = LocalRecordingUploadPayload(
            fallbackIntentId: fallbackIntentId,
            clientRecordingId: clientRecordingId,
            recordingStartedAt: startedAt,
            recordingStoppedAt: stoppedAt,
            computerAudioURL: computerAudioURL,
            microphoneAudioURL: microphoneAudioURL,
            manifest: manifest
        )

        return LocalRecordingCaptureResult(
            cleanupDirectoryURL: payload.computerAudioURL.deletingLastPathComponent(),
            payload: payload
        )
    }
}

enum LocalTrackAudioFormat {
    static let sampleRate = 48_000.0
    static let channelCount = 2

    static var avFormat: AVAudioFormat {
        AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: sampleRate,
            channels: AVAudioChannelCount(channelCount),
            interleaved: false
        )!
    }
}

final class MicrophoneTrackRecorder {
    private let engine = AVAudioEngine()
    private let writer: PCM16WavWriter

    init(outputURL: URL) throws {
        self.writer = try PCM16WavWriter(outputURL: outputURL)
    }

    func start() throws {
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)

        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [writer] buffer, _ in
            writer.write(buffer)
        }
        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        writer.close()
    }
}

final class SystemAudioTrackRecorder: NSObject, @unchecked Sendable, SCStreamOutput, SCStreamDelegate {
    private let queue = DispatchQueue(label: "tech.inevitable.meeting-note.local-recorder.system-audio")
    private let writer: PCM16WavWriter
    private var stream: SCStream?

    init(outputURL: URL) throws {
        self.writer = try PCM16WavWriter(outputURL: outputURL)
    }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        guard let display = content.displays.first else {
            throw LocalRecordingCaptureError.noDisplayAvailable
        }

        let configuration = SCStreamConfiguration()
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.queueDepth = 3
        configuration.capturesAudio = true
        configuration.sampleRate = Int(LocalTrackAudioFormat.sampleRate)
        configuration.channelCount = LocalTrackAudioFormat.channelCount
        configuration.excludesCurrentProcessAudio = true

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try await stream.startCapture()
        self.stream = stream
    }

    func stop() async {
        guard let stream else {
            writer.close()
            return
        }

        try? await stream.stopCapture()
        self.stream = nil
        writer.close()
    }

    nonisolated func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .audio, sampleBuffer.isValid else {
            return
        }

        do {
            let buffer = try AVAudioPCMBuffer.localRecorderBuffer(from: sampleBuffer)
            writer.write(buffer)
        } catch {
            writer.record(error)
        }
    }

    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        writer.record(error)
    }
}

final class PCM16WavWriter: @unchecked Sendable {
    private let file: AVAudioFile
    private let lock = NSLock()
    private let outputFormat = LocalTrackAudioFormat.avFormat
    private var error: Error?
    private var isClosed = false

    init(outputURL: URL) throws {
        self.file = try AVAudioFile(
            forWriting: outputURL,
            settings: outputFormat.settings
        )
    }

    func write(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer {
            lock.unlock()
        }

        guard !isClosed, error == nil else {
            return
        }

        do {
            guard let converted = try convert(buffer) else {
                return
            }

            try file.write(from: converted)
        } catch {
            self.error = error
        }
    }

    func record(_ error: Error) {
        lock.lock()
        self.error = error
        lock.unlock()
    }

    func close() {
        lock.lock()
        isClosed = true
        lock.unlock()
    }

    private func convert(_ buffer: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer? {
        if buffer.format == outputFormat {
            return buffer
        }

        guard let converter = AVAudioConverter(from: buffer.format, to: outputFormat) else {
            throw LocalRecordingCaptureError.audioFormatUnavailable
        }

        let ratio = outputFormat.sampleRate / buffer.format.sampleRate
        let frameCapacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
        guard let converted = AVAudioPCMBuffer(
            pcmFormat: outputFormat,
            frameCapacity: frameCapacity
        ) else {
            throw LocalRecordingCaptureError.audioBufferUnavailable
        }

        let input = AudioConverterInput(buffer: buffer)
        var conversionError: NSError?
        converter.convert(to: converted, error: &conversionError) { _, status in
            input.provide(status: status)
        }

        if let conversionError {
            throw conversionError
        }

        return converted
    }
}

final class AudioConverterInput: @unchecked Sendable {
    private let buffer: AVAudioPCMBuffer
    private let lock = NSLock()
    private var didProvideBuffer = false

    init(buffer: AVAudioPCMBuffer) {
        self.buffer = buffer
    }

    func provide(status: UnsafeMutablePointer<AVAudioConverterInputStatus>) -> AVAudioBuffer? {
        lock.lock()
        defer {
            lock.unlock()
        }

        if didProvideBuffer {
            status.pointee = .noDataNow
            return nil
        }

        didProvideBuffer = true
        status.pointee = .haveData
        return buffer
    }
}

private extension AVAudioPCMBuffer {
    static func localRecorderBuffer(from sampleBuffer: CMSampleBuffer) throws -> AVAudioPCMBuffer {
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else {
            throw LocalRecordingCaptureError.audioFormatUnavailable
        }

        let format = AVAudioFormat(cmAudioFormatDescription: formatDescription)
        let frameCount = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: frameCount
        ) else {
            throw LocalRecordingCaptureError.audioBufferUnavailable
        }

        buffer.frameLength = frameCount
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer,
            at: 0,
            frameCount: Int32(frameCount),
            into: buffer.mutableAudioBufferList
        )

        guard status == noErr else {
            throw LocalRecordingCaptureError.writerFailed("Could not copy system audio buffer")
        }

        return buffer
    }
}
