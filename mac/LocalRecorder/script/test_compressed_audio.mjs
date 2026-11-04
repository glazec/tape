import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

for (const sampleRate of [48_000, 44_100]) test(`AAC preserves duration through synthesis from ${sampleRate} Hz stereo`, () => {
  const directory = mkdtempSync(join(tmpdir(), "tape-aac-"));
  try {
    const source = readFileSync(new URL("../Sources/MeetingNoteLocalRecorder/LocalAudioCapture.swift", import.meta.url), "utf8");
    const definitions = source.slice(source.indexOf("enum LocalTrackAudioFormat"), source.indexOf("final class MicrophoneTrackRecorder"))
      + source.slice(source.indexOf("final class CompressedAudioWriter"), source.indexOf("enum LocalAudioLevelMeter"));
    const probe = `
import AVFoundation
import Foundation
enum LocalRecordingCaptureError: Error { case audioBufferUnavailable, audioFormatUnavailable, writerFailed(String) }
enum LocalRecorderTelemetry {
    enum Operation { case audioWrite, audioStream }
    static func capture(_ error: Error, operation: Operation) {}
}
${definitions}
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
let sourceFormat = AVAudioFormat(standardFormatWithSampleRate: ${sampleRate}, channels: 2)!
let buffer = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: ${sampleRate / 10})!
buffer.frameLength = ${sampleRate / 10}
for frame in 0..<${sampleRate / 10} {
    buffer.floatChannelData![0][frame] = Float(sin(Double(frame) * 2 * .pi * 440 / ${sampleRate})) * 0.2
    buffer.floatChannelData![1][frame] = Float(sin(Double(frame) * 2 * .pi * 880 / ${sampleRate})) * 0.2
}
let computer = directory.appendingPathComponent("computer.m4a")
let microphone = directory.appendingPathComponent("microphone.m4a")
let mixed = directory.appendingPathComponent("mixed.m4a")
for url in [computer, microphone] {
    let writer = try CompressedAudioWriter(outputURL: url)
    for _ in 0..<100 { writer.write(buffer) }
    try writer.finish()
}
try LocalTrackSynthesizer.synthesize(computerAudioURL: computer, microphoneAudioURL: microphone, outputURL: mixed)
for url in [computer, microphone, mixed] {
    let file = try AVAudioFile(forReading: url)
    let seconds = Double(file.length) / file.processingFormat.sampleRate
    let bytes = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize!
    precondition(file.processingFormat.channelCount == 1)
    precondition(file.processingFormat.sampleRate == 48_000)
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
