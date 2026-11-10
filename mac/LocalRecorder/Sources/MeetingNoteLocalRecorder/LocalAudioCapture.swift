@preconcurrency import AVFoundation
import CoreAudio
import CoreMedia
import Foundation
import LocalRecorderCore
@preconcurrency import ScreenCaptureKit

struct AudioInputDevice: Equatable, Identifiable, Sendable {
    var name: String
    var uid: String

    var id: String { uid }
}

enum AudioInputDeviceList {
    static func inputDevices() -> [AudioInputDevice] {
        allDeviceIDs().compactMap { deviceID in
            guard
                inputChannelCount(deviceID) > 0,
                let uid = stringProperty(deviceID, selector: kAudioDevicePropertyDeviceUID),
                let name = stringProperty(deviceID, selector: kAudioObjectPropertyName)
            else {
                return nil
            }

            return AudioInputDevice(name: name, uid: uid)
        }
    }

    static func deviceID(forUID uid: String) -> AudioDeviceID? {
        allDeviceIDs().first { deviceID in
            stringProperty(deviceID, selector: kAudioDevicePropertyDeviceUID) == uid
        }
    }

    private static func allDeviceIDs() -> [AudioDeviceID] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size
        ) == noErr, size > 0 else {
            return []
        }

        var deviceIDs = [AudioDeviceID](
            repeating: 0,
            count: Int(size) / MemoryLayout<AudioDeviceID>.size
        )
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size,
            &deviceIDs
        ) == noErr else {
            return []
        }

        return deviceIDs
    }

    private static func inputChannelCount(_ deviceID: AudioDeviceID) -> Int {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size) == noErr,
              size > 0 else {
            return 0
        }

        let bufferListPointer = UnsafeMutableRawPointer.allocate(
            byteCount: Int(size),
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer {
            bufferListPointer.deallocate()
        }

        guard AudioObjectGetPropertyData(
            deviceID,
            &address,
            0,
            nil,
            &size,
            bufferListPointer
        ) == noErr else {
            return 0
        }

        let bufferList = UnsafeMutableAudioBufferListPointer(
            bufferListPointer.assumingMemoryBound(to: AudioBufferList.self)
        )
        return bufferList.reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    private static func stringProperty(
        _ deviceID: AudioDeviceID,
        selector: AudioObjectPropertySelector
    ) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size = UInt32(MemoryLayout<CFString?>.size)
        var value: CFString?
        let status = withUnsafeMutablePointer(to: &value) { pointer in
            AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, pointer)
        }

        guard status == noErr, let value else {
            return nil
        }

        return value as String
    }
}

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

    func start(
        fallbackIntentId: String,
        appVersion: String,
        microphoneDeviceUID: String? = nil,
        chooseWindow: @MainActor () async throws -> SelectedMeetingWindow,
        onScreenshotStatus: @escaping @Sendable (String?) -> Void = { _ in },
        onAudioLevel: @escaping @Sendable (LocalRecorderAudioSource, Float) -> Void = { _, _ in }
    ) async throws {
        if activeSession != nil {
            throw LocalRecordingCaptureError.alreadyRecording
        }

        let selectedWindow = try await chooseWindow()
        let session = try LocalRecordingCaptureSession(
            fallbackIntentId: fallbackIntentId,
            appVersion: appVersion,
            microphoneDeviceUID: microphoneDeviceUID,
            windowFilter: selectedWindow.filter,
            selectedWindowIdentity: selectedWindow.selectedWindowIdentity,
            onScreenshotStatus: onScreenshotStatus,
            onAudioLevel: onAudioLevel
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
    private let screenshots: MeetingWindowScreenshots
    private let windowFilter: SCContentFilter
    private let appVersion: String
    private let activitySampler: LocalRecorderActivitySampler
    private let clientRecordingId: String
    private let computerAudioURL: URL
    private let fallbackIntentId: String
    private let microphoneAudioURL: URL
    private let microphoneRecorder: MicrophoneTrackRecorder
    private let startedAt: Date
    private let synthesizedAudioURL: URL
    private var isSystemAudioRecording = false
    private let systemRecorder: SystemAudioTrackRecorder

    init(
        fallbackIntentId: String,
        appVersion: String,
        microphoneDeviceUID: String?,
        windowFilter: SCContentFilter,
        selectedWindowIdentity: MeetingCaptureWindow?,
        onScreenshotStatus: @escaping @Sendable (String?) -> Void,
        onAudioLevel: @escaping @Sendable (LocalRecorderAudioSource, Float) -> Void
    ) throws {
        let directoryURL = LocalRecorderFileLocations.recordingsDirectoryURL()
            .appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true
        )

        self.windowFilter = windowFilter
        self.appVersion = appVersion
        self.clientRecordingId = UUID().uuidString
        self.computerAudioURL = directoryURL.appending(path: "computer.m4a")
        self.fallbackIntentId = fallbackIntentId
        self.microphoneAudioURL = directoryURL.appending(path: "microphone.m4a")
        let startedAt = Date()
        let activitySampler = LocalRecorderActivitySampler(startedAt: startedAt)
        self.activitySampler = activitySampler
        self.startedAt = startedAt
        self.screenshots = MeetingWindowScreenshots(filter: windowFilter, selectedWindowIdentity: selectedWindowIdentity, directory: directoryURL, startedAt: startedAt, onStatus: onScreenshotStatus)
        self.synthesizedAudioURL = directoryURL.appending(path: "synthesized.m4a")
        self.microphoneRecorder = try MicrophoneTrackRecorder(
            outputURL: microphoneAudioURL,
            deviceUID: microphoneDeviceUID,
            onAudioLevel: { level in
                activitySampler.observe(source: .microphone, level: level)
                onAudioLevel(.microphone, level)
            }
        )
        self.systemRecorder = try SystemAudioTrackRecorder(
            outputURL: computerAudioURL,
            onAudioLevel: { level in
                activitySampler.observe(source: .computerAudio, level: level)
                onAudioLevel(.computerAudio, level)
            }
        )
    }

    func start() async throws {
        do {
            try await screenshots.start()
            try microphoneRecorder.start()
            try await systemRecorder.start(filter: windowFilter)
            isSystemAudioRecording = true
        } catch {
            _ = await screenshots.stop()
            microphoneRecorder.stop()
            await systemRecorder.stop()
            throw error
        }
    }

    func stop() async throws -> LocalRecordingCaptureResult {
        let stoppedAt = Date()
        let capturedScreenshots = await screenshots.stop()
        if isSystemAudioRecording {
            await systemRecorder.stop()
        }
        microphoneRecorder.stop()
        try systemRecorder.finish()
        try microphoneRecorder.finish()
        let computerAudioURL = computerAudioURL
        let microphoneAudioURL = microphoneAudioURL
        let synthesizedAudioURL = synthesizedAudioURL
        try await Task.detached(priority: .userInitiated) {
            try LocalTrackSynthesizer.synthesize(
                computerAudioURL: computerAudioURL,
                microphoneAudioURL: microphoneAudioURL,
                outputURL: synthesizedAudioURL
            )
        }.value

        let manifest = RecordingManifest(
            appVersion: appVersion,
            computerAudio: TrackMetadata(
                captureStartedAt: startedAt,
                captureStoppedAt: stoppedAt,
                sampleRate: LocalTrackAudioFormat.sampleRate,
                channelCount: LocalTrackAudioFormat.channelCount,
                codec: "aac",
                container: "m4a",
                firstSampleTime: 0
            ),
            microphoneAudio: TrackMetadata(
                captureStartedAt: startedAt,
                captureStoppedAt: stoppedAt,
                sampleRate: LocalTrackAudioFormat.sampleRate,
                channelCount: LocalTrackAudioFormat.channelCount,
                codec: "aac",
                container: "m4a",
                firstSampleTime: 0
            ),
            activityWindows: activitySampler.snapshot(stoppedAt: stoppedAt)
        )
        let payload = LocalRecordingUploadPayload(
            fallbackIntentId: fallbackIntentId,
            clientRecordingId: clientRecordingId,
            recordingStartedAt: startedAt,
            recordingStoppedAt: stoppedAt,
            computerAudioURL: computerAudioURL,
            microphoneAudioURL: microphoneAudioURL,
            synthesizedAudioURL: synthesizedAudioURL,
            manifest: manifest,
            screenshots: capturedScreenshots
        )

        return LocalRecordingCaptureResult(
            cleanupDirectoryURL: payload.computerAudioURL.deletingLastPathComponent(),
            payload: payload
        )
    }
}

@MainActor
final class AudioLevelTestSession {
    private let microphoneRecorder: MicrophoneTrackRecorder
    private let systemRecorder: SystemAudioTrackRecorder

    init(
        microphoneDeviceUID: String?,
        onAudioLevel: @escaping @Sendable (LocalRecorderAudioSource, Float) -> Void
    ) {
        self.microphoneRecorder = MicrophoneTrackRecorder(
            deviceUID: microphoneDeviceUID,
            fallsBackToDefaultDevice: false,
            onAudioLevel: { level in
                onAudioLevel(.microphone, level)
            }
        )
        self.systemRecorder = SystemAudioTrackRecorder(
            onAudioLevel: { level in
                onAudioLevel(.computerAudio, level)
            }
        )
    }

    func start() async throws {
        try microphoneRecorder.start()

        do {
            try await systemRecorder.start()
        } catch {
            microphoneRecorder.stop()
            await systemRecorder.stop()
            throw error
        }
    }

    func stop() async {
        await systemRecorder.stop()
        microphoneRecorder.stop()
    }
}

enum LocalRecorderFileLocations {
    static func uploadQueueDirectoryURL() -> URL {
        applicationSupportDirectoryURL()
            .appending(path: "PendingUploads", directoryHint: .isDirectory)
    }

    static func recordingsDirectoryURL() -> URL {
        applicationSupportDirectoryURL()
            .appending(path: "Recordings", directoryHint: .isDirectory)
    }

    private static func applicationSupportDirectoryURL() -> URL {
        let baseURL = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? FileManager.default.temporaryDirectory

        return baseURL
            .appending(path: Bundle.main.bundleIdentifier?.hasSuffix(".dev") == true ? "MeetingNoteLocalRecorderDev" : "MeetingNoteLocalRecorder", directoryHint: .isDirectory)
    }
}

enum LocalTrackAudioFormat {
    static let sampleRate = 48_000.0
    static let channelCount = 1

    static var avFormat: AVAudioFormat {
        AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: sampleRate,
            channels: AVAudioChannelCount(channelCount),
            interleaved: false
        )!
    }

    static var processingFormat: AVAudioFormat {
        AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: AVAudioChannelCount(channelCount),
            interleaved: false
        )!
    }
}

enum LocalTrackSynthesizer {
    private static let frameCapacity: AVAudioFrameCount = 4096

    static func synthesize(
        computerAudioURL: URL,
        microphoneAudioURL: URL,
        outputURL: URL
    ) throws {
        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }

        let computerFile = try AVAudioFile(forReading: computerAudioURL)
        let microphoneFile = try AVAudioFile(forReading: microphoneAudioURL)
        let writer = try CompressedAudioWriter(outputURL: outputURL)
        defer {
            writer.close()
        }

        let mixFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: LocalTrackAudioFormat.sampleRate,
            channels: AVAudioChannelCount(LocalTrackAudioFormat.channelCount),
            interleaved: false
        )!

        while true {
            let computerBuffer = try readChunk(from: computerFile, format: mixFormat)
            let microphoneBuffer = try readChunk(from: microphoneFile, format: mixFormat)
            guard computerBuffer != nil || microphoneBuffer != nil else {
                break
            }

            let mixed = try mix(
                computerBuffer: computerBuffer,
                microphoneBuffer: microphoneBuffer,
                format: mixFormat
            )
            writer.write(mixed)
        }

        try writer.finish()
    }

    private static func readChunk(
        from file: AVAudioFile,
        format: AVAudioFormat
    ) throws -> AVAudioPCMBuffer? {
        guard file.framePosition < file.length else {
            return nil
        }

        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: file.processingFormat,
            frameCapacity: frameCapacity
        ) else {
            throw LocalRecordingCaptureError.audioBufferUnavailable
        }

        try file.read(into: buffer, frameCount: frameCapacity)
        guard buffer.frameLength > 0 else {
            return nil
        }

        return try LocalAudioBufferConverter.convert(buffer, to: format)
    }

    private static func mix(
        computerBuffer: AVAudioPCMBuffer?,
        microphoneBuffer: AVAudioPCMBuffer?,
        format: AVAudioFormat
    ) throws -> AVAudioPCMBuffer {
        let frameLength = max(
            computerBuffer?.frameLength ?? 0,
            microphoneBuffer?.frameLength ?? 0
        )
        guard
            frameLength > 0,
            let mixed = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: frameLength
            ),
            let mixedChannels = mixed.floatChannelData
        else {
            throw LocalRecordingCaptureError.audioBufferUnavailable
        }

        mixed.frameLength = frameLength
        for channel in 0..<Int(format.channelCount) {
            let output = mixedChannels[channel]
            let computerChannel = channelData(from: computerBuffer, channel: channel)
            let microphoneChannel = channelData(from: microphoneBuffer, channel: channel)

            for frame in 0..<Int(frameLength) {
                let computerSample = sample(
                    from: computerChannel,
                    frame: frame,
                    frameLength: computerBuffer?.frameLength
                )
                let microphoneSample = sample(
                    from: microphoneChannel,
                    frame: frame,
                    frameLength: microphoneBuffer?.frameLength
                )
                output[frame] = max(-1, min(1, computerSample + microphoneSample))
            }
        }

        return mixed
    }

    private static func channelData(
        from buffer: AVAudioPCMBuffer?,
        channel: Int
    ) -> UnsafeMutablePointer<Float>? {
        guard
            let buffer,
            let channels = buffer.floatChannelData,
            buffer.format.channelCount > 0
        else {
            return nil
        }

        let clampedChannel = min(channel, Int(buffer.format.channelCount) - 1)
        return channels[clampedChannel]
    }

    private static func sample(
        from channelData: UnsafeMutablePointer<Float>?,
        frame: Int,
        frameLength: AVAudioFrameCount?
    ) -> Float {
        guard
            let channelData,
            let frameLength,
            frame < Int(frameLength)
        else {
            return 0
        }

        return channelData[frame]
    }
}

final class MicrophoneTrackRecorder {
    private let deviceUID: String?
    private var engine = AVAudioEngine()
    private var hasInputTap = false
    private let fallsBackToDefaultDevice: Bool
    private let onAudioLevel: @Sendable (Float) -> Void
    private let writer: CompressedAudioWriter?

    init(
        outputURL: URL,
        deviceUID: String?,
        fallsBackToDefaultDevice: Bool = true,
        onAudioLevel: @escaping @Sendable (Float) -> Void
    ) throws {
        self.deviceUID = deviceUID
        self.fallsBackToDefaultDevice = fallsBackToDefaultDevice
        self.onAudioLevel = onAudioLevel
        self.writer = try CompressedAudioWriter(outputURL: outputURL)
    }

    /// Meter-only mode: reports levels without writing audio to disk.
    init(
        deviceUID: String?,
        fallsBackToDefaultDevice: Bool = true,
        onAudioLevel: @escaping @Sendable (Float) -> Void
    ) {
        self.deviceUID = deviceUID
        self.fallsBackToDefaultDevice = fallsBackToDefaultDevice
        self.onAudioLevel = onAudioLevel
        self.writer = nil
    }

    func start() throws {
        do {
            try startEngine(voiceProcessing: writer != nil)
        } catch {
            resetEngine()
            guard writer != nil else { throw error }
            LocalRecorderTelemetry.capture(error, operation: .audioProcessingStart)
            // Some audio routes cannot initialize VoiceProcessingIO. Retry with
            // a fresh, unprocessed engine while preserving the selected input.
            do {
                try startEngine(voiceProcessing: false)
            } catch {
                resetEngine()
                throw error
            }
        }
    }

    private func startEngine(voiceProcessing: Bool) throws {
        let input = engine.inputNode

        if let deviceUID {
            let applied = applyInputDevice(uid: deviceUID, to: input)
            if !applied, !fallsBackToDefaultDevice {
                throw LocalRecordingCaptureError.writerFailed(
                    "Selected microphone is unavailable"
                )
            }
        }

        if voiceProcessing {
            try input.setVoiceProcessingEnabled(true)
            if let deviceUID, !applyInputDevice(uid: deviceUID, to: input) {
                throw LocalRecordingCaptureError.writerFailed("Could not use the selected microphone with noise suppression")
            }
            input.isVoiceProcessingAGCEnabled = false
            input.voiceProcessingOtherAudioDuckingConfiguration = .init(
                enableAdvancedDucking: false, duckingLevel: .min
            )
        }

        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
            throw LocalRecordingCaptureError.writerFailed(
                "Microphone is unavailable. Check microphone permission in System Settings."
            )
        }

        input.installTap(
            onBus: 0,
            bufferSize: 4096,
            format: inputFormat
        ) { [onAudioLevel, writer] buffer, _ in
            onAudioLevel(LocalAudioLevelMeter.rmsLevel(from: buffer))
            writer?.write(buffer)
        }
        hasInputTap = true
        engine.prepare()
        try engine.start()
    }

    private func resetEngine() {
        engine.stop()
        if hasInputTap {
            engine.inputNode.removeTap(onBus: 0)
            hasInputTap = false
        }
        engine = AVAudioEngine()
    }

    func stop() {
        resetEngine()
        writer?.close()
    }

    func finish() throws { try writer?.finish() }

    private func applyInputDevice(uid: String, to input: AVAudioInputNode) -> Bool {
        guard let deviceID = AudioInputDeviceList.deviceID(forUID: uid),
              let audioUnit = input.audioUnit else {
            return false
        }

        var mutableDeviceID = deviceID
        let status = AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &mutableDeviceID,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )
        return status == noErr
    }
}

final class SystemAudioTrackRecorder: NSObject, @unchecked Sendable, SCStreamOutput, SCStreamDelegate {
    private let onAudioLevel: @Sendable (Float) -> Void
    private let queue = DispatchQueue(label: "tech.inevitable.meeting-note.local-recorder.system-audio")
    private let writer: CompressedAudioWriter?
    private var stream: SCStream?

    init(
        outputURL: URL,
        onAudioLevel: @escaping @Sendable (Float) -> Void
    ) throws {
        self.onAudioLevel = onAudioLevel
        self.writer = try CompressedAudioWriter(outputURL: outputURL)
        super.init()
    }

    /// Meter-only mode: reports levels without writing audio to disk.
    init(onAudioLevel: @escaping @Sendable (Float) -> Void) {
        self.onAudioLevel = onAudioLevel
        self.writer = nil
        super.init()
    }

    @MainActor
    func start(filter selectedFilter: SCContentFilter? = nil) async throws {
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

        let filter = selectedFilter ?? SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try await stream.startCapture()
        self.stream = stream
    }

    func stop() async {
        guard let stream else {
            writer?.close()
            return
        }

        try? await stream.stopCapture()
        self.stream = nil
        writer?.close()
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
            onAudioLevel(LocalAudioLevelMeter.rmsLevel(from: buffer))
            writer?.write(buffer)
        } catch {
            writer?.record(error)
        }
    }

    func finish() throws { try writer?.finish() }

    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        writer?.record(error)
    }
}

final class CompressedAudioWriter: @unchecked Sendable {
    private var file: AVAudioFile?
    private let lock = NSLock()
    private var error: Error?

    init(outputURL: URL) throws {
        file = try AVAudioFile(forWriting: outputURL, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: LocalTrackAudioFormat.sampleRate,
            AVNumberOfChannelsKey: LocalTrackAudioFormat.channelCount,
            AVEncoderBitRateKey: 64_000,
            AVEncoderBitRateStrategyKey: AVAudioBitRateStrategy_VariableConstrained,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ], commonFormat: .pcmFormatFloat32, interleaved: false)
    }

    func write(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard let file, error == nil else { return }
        do {
            let converted = try LocalAudioBufferConverter.convert(buffer, to: file.processingFormat)
            try file.write(from: converted)
        } catch {
            self.error = error
            LocalRecorderTelemetry.capture(error, operation: .audioWrite)
        }
    }

    func record(_ error: Error) {
        lock.lock()
        let firstFailure = self.error == nil
        self.error = error
        lock.unlock()
        if firstFailure { LocalRecorderTelemetry.capture(error, operation: .audioStream) }
    }

    func close() {
        lock.lock()
        file = nil
        lock.unlock()
    }

    func finish() throws {
        lock.lock()
        file = nil
        let recordedError = error
        lock.unlock()
        if let recordedError { throw recordedError }
    }
}

enum LocalAudioBufferConverter {
    static func convert(
        _ buffer: AVAudioPCMBuffer,
        to outputFormat: AVAudioFormat
    ) throws -> AVAudioPCMBuffer {
        if buffer.format == outputFormat {
            return buffer
        }

        guard let converter = AVAudioConverter(from: buffer.format, to: outputFormat) else {
            throw LocalRecordingCaptureError.audioFormatUnavailable
        }

        let frameCapacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * outputFormat.sampleRate / buffer.format.sampleRate))
        guard let converted = AVAudioPCMBuffer(
            pcmFormat: outputFormat,
            frameCapacity: frameCapacity
        ) else {
            throw LocalRecordingCaptureError.audioBufferUnavailable
        }

        if buffer.format.sampleRate == outputFormat.sampleRate {
            try converter.convert(to: converted, from: buffer)
            return converted
        }
        converter.primeMethod = .none
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
            status.pointee = .endOfStream
            return nil
        }

        didProvideBuffer = true
        status.pointee = .haveData
        return buffer
    }
}

enum LocalAudioLevelMeter {
    static func rmsLevel(from buffer: AVAudioPCMBuffer) -> Float {
        guard buffer.frameLength > 0, buffer.format.channelCount > 0 else {
            return 0
        }

        guard let measurableBuffer = makeFloatBuffer(from: buffer),
              let channels = measurableBuffer.floatChannelData else {
            return 0
        }

        let channelCount = Int(measurableBuffer.format.channelCount)
        let frameLength = Int(measurableBuffer.frameLength)
        var squareSum: Float = 0
        var sampleCount = 0

        for channel in 0..<channelCount {
            let channelData = channels[channel]
            for frame in 0..<frameLength {
                let sample = channelData[frame]
                squareSum += sample * sample
                sampleCount += 1
            }
        }

        guard sampleCount > 0 else {
            return 0
        }

        return sqrt(squareSum / Float(sampleCount))
    }

    private static func makeFloatBuffer(from buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        if buffer.format.commonFormat == .pcmFormatFloat32,
           !buffer.format.isInterleaved {
            return buffer
        }

        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: buffer.format.sampleRate,
            channels: buffer.format.channelCount,
            interleaved: false
        ) else {
            return nil
        }

        return try? LocalAudioBufferConverter.convert(buffer, to: format)
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
