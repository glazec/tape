import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const inputFormats = [
  [48_000, 1, false],
  [48_000, 2, false],
  [44_100, 2, false],
  [44_100, 4, true],
  [48_000, 9, false],
  [48_000, 2, false, true],
];

for (const [sampleRate, channels, interleaved, oppositePolarity = false] of inputFormats) test(`Meters and AAC agree for ${sampleRate} Hz with ${channels} channels${oppositePolarity ? " in opposite polarity" : ""}`, () => {
  const directory = mkdtempSync(join(tmpdir(), "tape-aac-"));
  try {
    const source = readFileSync(new URL("../Sources/MeetingNoteLocalRecorder/LocalAudioCapture.swift", import.meta.url), "utf8");
    const definitions = source.slice(source.indexOf("enum LocalTrackAudioFormat"), source.indexOf("final class MicrophoneTrackRecorder"))
      + source.slice(source.indexOf("final class SystemAudioTrackRecorder"), source.indexOf("final class CompressedAudioWriter"))
      + source.slice(source.indexOf("final class CompressedAudioWriter"));
    const probe = `
import AVFoundation
import Foundation
import ScreenCaptureKit
enum LocalRecordingCaptureError: Error { case audioBufferUnavailable, audioFormatUnavailable, noDisplayAvailable, writerFailed(String) }
enum LocalRecorderTelemetry {
    enum Operation { case audioWrite, audioStream }
    static func capture(_ error: Error, operation: Operation) {}
}
${definitions}
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
let channelCount: AVAudioChannelCount = ${channels}
let layoutTag: AudioChannelLayoutTag
switch channelCount {
case 1: layoutTag = kAudioChannelLayoutTag_Mono
case 2: layoutTag = kAudioChannelLayoutTag_Stereo
default: layoutTag = kAudioChannelLayoutTag_DiscreteInOrder | channelCount
}
let layout = AVAudioChannelLayout(layoutTag: layoutTag)!
let sourceFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: ${sampleRate}, interleaved: ${interleaved}, channelLayout: layout)
let buffer = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: ${sampleRate / 10})!
buffer.frameLength = ${sampleRate / 10}
let oppositePolarity = ${oppositePolarity}
for frame in 0..<${sampleRate / 10} {
    for channel in 0..<${channels} {
        let frequency = oppositePolarity ? 440 : Double(channel + 1) * 440
        let data = buffer.floatChannelData!
        let samples = buffer.format.isInterleaved ? data[0].advanced(by: channel) : data[channel]
        let amplitude: Float = oppositePolarity ? (channel == 0 ? 0.2 : -0.2) : (channelCount == 2 && channel == 0 ? 0 : 0.2)
        samples[frame * buffer.stride] = Float(sin(Double(frame) * 2 * .pi * frequency / ${sampleRate})) * amplitude
    }
}
let computer = directory.appendingPathComponent("computer.m4a")
let microphone = directory.appendingPathComponent("microphone.m4a")
let mixed = directory.appendingPathComponent("mixed.m4a")
let checkLevel = LocalAudioLevelMeter.captureLevel(from: buffer, writer: nil)
precondition(checkLevel > 0.02, "Audio Check lost the input signal")
for url in [computer, microphone] {
    let writer = try CompressedAudioWriter(outputURL: url)
    for _ in 0..<100 {
        let recordingLevel = LocalAudioLevelMeter.captureLevel(from: buffer, writer: writer)
        precondition(abs(recordingLevel - checkLevel) < 0.0001, "Audio Check and the recording meter disagree")
    }
    try writer.finish()
    precondition(LocalAudioLevelMeter.captureLevel(from: buffer, writer: writer) == 0)
}
let interrupted = directory.appendingPathComponent("interrupted.m4a")
let recorder = try SystemAudioTrackRecorder(outputURL: interrupted, onAudioLevel: { _ in })
let stream = SCStream(filter: SCContentFilter(), configuration: SCStreamConfiguration(), delegate: nil)
recorder.stream(stream, didStopWithError: SCStreamError(.noCaptureSource))
try recorder.finish()

try LocalTrackSynthesizer.synthesize(computerAudioURL: computer, microphoneAudioURL: microphone, outputURL: mixed)
for url in [computer, microphone, mixed] {
    let file = try AVAudioFile(forReading: url)
    let seconds = Double(file.length) / file.processingFormat.sampleRate
    let bytes = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize!
    precondition(file.processingFormat.channelCount == 1)
    precondition(file.processingFormat.sampleRate == 48_000)
    let decoded = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4_096)!
    try file.read(into: decoded)
    let samples = UnsafeBufferPointer(start: decoded.floatChannelData![0], count: Int(decoded.frameLength))
    precondition(samples.contains { abs($0) > 0.02 }, "AAC lost the input signal")
    if url != mixed {
        precondition(abs(LocalAudioLevelMeter.rmsLevel(from: decoded) - checkLevel) < 0.02, "Meter differs from decoded AAC")
    }
    precondition(abs(seconds - 10) < 0.1, "Duration changed: \\(seconds)")
    precondition(bytes < 150_000 && bytes > 30_000, "Unexpected size: \\(bytes)")
    print("\\(url.lastPathComponent): \\(bytes) bytes, \\(seconds) seconds")
}
`;
    const swift = join(directory, "main.swift");
    writeFileSync(swift, probe);
    execFileSync("swiftc", [swift, "-o", join(directory, "probe")], { timeout: 60_000 });
    const result = execFileSync(join(directory, "probe"), [directory], { encoding: "utf8", timeout: 60_000 });
    assert.match(result, /mixed.m4a:/);
    console.log(result.trim());
    const info = execFileSync("afinfo", [join(directory, "computer.m4a")], { encoding: "utf8" });
    const rate = Number(info.match(/bit rate: (\d+)/)?.[1]);
    assert.ok(rate > 20_000 && rate <= 80_000, `Unexpected AAC bitrate: ${rate}`);
    console.log(`Measured AAC bitrate: ${rate} bits per second`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
