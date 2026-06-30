import Foundation
import Testing
@testable import LocalRecorderCore

@Test func permissionChecklistRequiresRecordingAndNotifications() {
    let ready = PermissionChecklist(
        microphone: .granted,
        screenCapture: .granted,
        notifications: .granted,
        startAtLogin: .denied
    )
    let blocked = PermissionChecklist(
        microphone: .granted,
        screenCapture: .denied,
        notifications: .granted,
        startAtLogin: .granted
    )

    #expect(ready.canMonitor)
    #expect(!blocked.canMonitor)
    #expect(ready.setupState == .degraded)
}

@Test func missedMeetingRequestIncludesBearerTokenAndDeviceId() throws {
    let client = LocalRecorderAPIClient(
        serverURL: URL(string: "https://app.example.com")!,
        bearerToken: "token_123",
        deviceId: "device_123"
    )
    let request = try client.missedMeetingsRequest()

    #expect(request.url?.absoluteString == "https://app.example.com/api/local-recorder/missed-meetings")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token_123")
    #expect(request.value(forHTTPHeaderField: "x-local-recorder-device-id") == "device_123")
}

@Test func decodesMissedMeetingResponse() throws {
    let data = """
    {
      "meetings": [
        {
          "fallbackIntentId": "intent_123",
          "title": "Weekly sync",
          "expiresAt": "2026-06-30T13:15:00.000Z",
          "displayTimeWindow": {
            "startsAt": "2026-06-30T12:00:00.000Z",
            "endsAt": "2026-06-30T13:00:00.000Z"
          }
        }
      ]
    }
    """.data(using: .utf8)!

    let response = try JSONDecoder.localRecorder.decode(MissedMeetingsResponse.self, from: data)

    #expect(response.meetings.first?.fallbackIntentId == "intent_123")
    #expect(response.meetings.first?.title == "Weekly sync")
}

@Test func recordingManifestKeepsSeparateTrackMetadata() throws {
    let manifest = RecordingManifest(
        appVersion: "0.1.0",
        computerAudio: .init(
            captureStartedAt: Date(timeIntervalSince1970: 10),
            captureStoppedAt: Date(timeIntervalSince1970: 20),
            sampleRate: 48_000,
            channelCount: 2,
            codec: "pcm_s16le",
            container: "wav",
            firstSampleTime: 0
        ),
        microphoneAudio: .init(
            captureStartedAt: Date(timeIntervalSince1970: 11),
            captureStoppedAt: Date(timeIntervalSince1970: 20),
            sampleRate: 48_000,
            channelCount: 1,
            codec: "pcm_s16le",
            container: "wav",
            firstSampleTime: 0
        )
    )
    let data = try JSONEncoder.localRecorder.encode(manifest)
    let decoded = try JSONDecoder.localRecorder.decode(RecordingManifest.self, from: data)

    #expect(decoded.computerAudio.channelCount == 2)
    #expect(decoded.microphoneAudio.channelCount == 1)
}

@Test func uploadRecordingRequestBuildsMultipartFormWithTwoTracks() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
        .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    try FileManager.default.createDirectory(
        at: temporaryDirectory,
        withIntermediateDirectories: true
    )
    defer {
        try? FileManager.default.removeItem(at: temporaryDirectory)
    }

    let computerAudioURL = temporaryDirectory.appending(path: "computer.wav")
    let microphoneAudioURL = temporaryDirectory.appending(path: "microphone.wav")
    try Data("computer".utf8).write(to: computerAudioURL)
    try Data("microphone".utf8).write(to: microphoneAudioURL)

    let payload = LocalRecordingUploadPayload(
        fallbackIntentId: "intent_123",
        clientRecordingId: "recording_123",
        recordingStartedAt: Date(timeIntervalSince1970: 10),
        recordingStoppedAt: Date(timeIntervalSince1970: 20),
        computerAudioURL: computerAudioURL,
        microphoneAudioURL: microphoneAudioURL,
        manifest: RecordingManifest(
            appVersion: "0.1.0",
            computerAudio: .init(
                captureStartedAt: Date(timeIntervalSince1970: 10),
                captureStoppedAt: Date(timeIntervalSince1970: 20),
                sampleRate: 48_000,
                channelCount: 2,
                codec: "pcm_s16le",
                container: "wav",
                firstSampleTime: 0
            ),
            microphoneAudio: .init(
                captureStartedAt: Date(timeIntervalSince1970: 10),
                captureStoppedAt: Date(timeIntervalSince1970: 20),
                sampleRate: 48_000,
                channelCount: 1,
                codec: "pcm_s16le",
                container: "wav",
                firstSampleTime: 0
            )
        )
    )
    let client = LocalRecorderAPIClient(
        serverURL: URL(string: "https://app.example.com")!,
        bearerToken: "token_123",
        deviceId: "device_123"
    )
    let request = try client.uploadRecordingRequest(
        payload: payload,
        boundary: "boundary_123"
    )
    let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)

    #expect(request.url?.absoluteString == "https://app.example.com/api/local-recorder/recordings")
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token_123")
    #expect(request.value(forHTTPHeaderField: "x-local-recorder-device-id") == "device_123")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "multipart/form-data; boundary=boundary_123")
    #expect(body.contains("name=\"fallbackIntentId\""))
    #expect(body.contains("intent_123"))
    #expect(body.contains("name=\"computerAudio\"; filename=\"computer.wav\""))
    #expect(body.contains("computer"))
    #expect(body.contains("name=\"microphoneAudio\"; filename=\"microphone.wav\""))
    #expect(body.contains("microphone"))
    #expect(body.contains("\"appVersion\":\"0.1.0\""))
}
