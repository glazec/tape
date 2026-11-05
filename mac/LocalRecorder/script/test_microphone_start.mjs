import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("microphone retries processing failures with a fresh engine and cleans failed taps", () => {
  const directory = mkdtempSync(join(tmpdir(), "tape-mic-"));
  try {
    const source = readFileSync(new URL("../Sources/MeetingNoteLocalRecorder/LocalAudioCapture.swift", import.meta.url), "utf8");
    const recorder = source.slice(source.indexOf("final class MicrophoneTrackRecorder"), source.indexOf("final class SystemAudioTrackRecorder"));
    const probe = `
import Foundation
typealias AudioDeviceID = UInt32
let kAudioOutputUnitProperty_CurrentDevice = 0
let kAudioUnitScope_Global = 0
let noErr = 0
var selectedDevices: [AudioDeviceID] = []
func AudioUnitSetProperty(_ unit: Int, _ property: Int, _ scope: Int, _ bus: Int, _ device: inout AudioDeviceID, _ size: UInt32) -> Int {
    selectedDevices.append(device); return noErr
}
enum AudioInputDeviceList { static func deviceID(forUID: String) -> AudioDeviceID? { 42 } }
enum LocalRecordingCaptureError: Error { case writerFailed(String) }
enum LocalRecorderTelemetry {
    enum Operation { case audioProcessingStart }
    static func capture(_ error: Error, operation: Operation) {}
}
struct Format { let sampleRate = 48_000.0; let channelCount = 1 }
struct Buffer {}
enum LocalAudioLevelMeter { static func rmsLevel(from: Buffer) -> Float { 0 } }
final class CompressedAudioWriter {
    var closed = false
    init(outputURL: URL) throws {}
    func write(_ buffer: Buffer) {}
    func close() { closed = true }
    func finish() throws {}
}
struct Ducking {
    enum Level { case min }
    var enableAdvancedDucking: Bool
    var duckingLevel: Level
}
var failEnable = false
var failStart = false
var failPlain = false
var engines: [AVAudioEngine] = []
final class AVAudioInputNode {
    var audioUnit: Int? = 1
    var processing = false
    var tapped = false
    var isVoiceProcessingAGCEnabled = true
    var voiceProcessingOtherAudioDuckingConfiguration = Ducking(enableAdvancedDucking: false, duckingLevel: .min)
    func setVoiceProcessingEnabled(_ enabled: Bool) throws {
        processing = enabled
        if failEnable { throw NSError(domain: "com.apple.coreaudio.avfaudio", code: -10875) }
    }
    func outputFormat(forBus: Int) -> Format { Format() }
    func installTap(onBus: Int, bufferSize: Int, format: Format, block: (Buffer, Int) -> Void) { precondition(!tapped); tapped = true }
    func removeTap(onBus: Int) { precondition(tapped); tapped = false }
}
final class AVAudioEngine {
    let inputNode = AVAudioInputNode()
    var running = false
    init() { engines.append(self) }
    func prepare() {}
    func start() throws {
        if (inputNode.processing && failStart) || (!inputNode.processing && failPlain) {
            throw NSError(domain: "com.apple.coreaudio.avfaudio", code: -10875)
        }
        running = true
    }
    func stop() { running = false }
}
${recorder}
func check(enable: Bool, start: Bool, plain: Bool, meter: Bool = false) throws {
    engines = []; selectedDevices = []
    failEnable = enable; failStart = start; failPlain = plain
    let recorder = meter
        ? MicrophoneTrackRecorder(deviceUID: "chosen", onAudioLevel: { _ in })
        : try MicrophoneTrackRecorder(outputURL: URL(fileURLWithPath: "/unused"), deviceUID: "chosen", onAudioLevel: { _ in })
    var failed = false
    do { try recorder.start() } catch { failed = true }
    precondition(failed == plain)
    let active = engines.filter { $0.running }
    precondition(active.count == (plain ? 0 : 1))
    if !plain {
        precondition(active[0].inputNode.processing == (!enable && !start && !meter))
    }
    precondition(engines.filter { !$0.running }.allSatisfy { !$0.inputNode.tapped })
    precondition(selectedDevices.allSatisfy { $0 == 42 })
    if !meter && (enable || start) { precondition(selectedDevices.count >= 2) }
    recorder.stop(); recorder.stop()
    precondition(engines.allSatisfy { !$0.running && !$0.inputNode.tapped })
}
try check(enable: true, start: false, plain: false)
try check(enable: false, start: false, plain: false)
try check(enable: false, start: true, plain: false)
try check(enable: false, start: true, plain: true)
try check(enable: true, start: false, plain: true, meter: true)
print("microphone startup cases passed")
`;
    const file = join(directory, "main.swift");
    writeFileSync(file, probe);
    execFileSync("swiftc", [file, "-o", join(directory, "probe")], { timeout: 60_000 });
    assert.match(execFileSync(join(directory, "probe"), { encoding: "utf8" }), /cases passed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
