import Foundation
import Testing
@testable import LocalRecorderCore

@Test func permissionChecklistRequiresMicrophonePermission() {
    let ready = PermissionChecklist(
        microphone: .granted,
        screenCapture: .granted,
        notifications: .granted,
        startAtLogin: .denied
    )
    let blocked = PermissionChecklist(
        microphone: .denied,
        screenCapture: .granted,
        notifications: .granted,
        startAtLogin: .granted
    )
    let degraded = PermissionChecklist(
        microphone: .granted,
        screenCapture: .denied,
        notifications: .denied,
        startAtLogin: .granted
    )

    #expect(ready.canMonitor)
    #expect(!blocked.canMonitor)
    #expect(degraded.canMonitor)
    #expect(ready.setupState == .degraded)
    #expect(degraded.setupState == .degraded)
}

@Test func silencePromptAppearsAfterOneMinuteOfSilence() {
    var tracker = SilencePromptTracker()
    let startedAt = Date(timeIntervalSince1970: 100)

    #expect(tracker.observe(level: 0, at: startedAt) == nil)
    #expect(tracker.observe(level: 0, at: startedAt.addingTimeInterval(59)) == nil)
    #expect(tracker.observe(level: 0, at: startedAt.addingTimeInterval(60)) == .prompt)
}

@Test func silencePromptResetsWhenAudioReturns() {
    var tracker = SilencePromptTracker()
    let startedAt = Date(timeIntervalSince1970: 100)

    #expect(tracker.observe(level: 0, at: startedAt) == nil)
    #expect(tracker.observe(level: 0, at: startedAt.addingTimeInterval(45)) == nil)
    #expect(tracker.observe(level: 0.02, at: startedAt.addingTimeInterval(46)) == nil)
    #expect(tracker.observe(level: 0, at: startedAt.addingTimeInterval(47)) == nil)
    #expect(tracker.observe(level: 0, at: startedAt.addingTimeInterval(106)) == nil)
    #expect(tracker.observe(level: 0, at: startedAt.addingTimeInterval(107)) == .prompt)
}

@Test func dismissedSilencePromptDoesNotRepeatForFiveMinutes() {
    var tracker = SilencePromptTracker()
    let startedAt = Date(timeIntervalSince1970: 100)

    #expect(tracker.observe(level: 0, at: startedAt) == nil)
    #expect(tracker.observe(level: 0, at: startedAt.addingTimeInterval(60)) == .prompt)

    tracker.dismissPrompt(at: startedAt.addingTimeInterval(60))

    #expect(tracker.observe(level: 0, at: startedAt.addingTimeInterval(359)) == nil)
    #expect(tracker.observe(level: 0, at: startedAt.addingTimeInterval(360)) == .prompt)
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

@Test func monitoringRequestIncludesBearerTokenAndDeviceId() throws {
    let client = LocalRecorderAPIClient(
        serverURL: URL(string: "https://app.example.com")!,
        bearerToken: "token_123",
        deviceId: "device_123"
    )
    let request = try client.monitoringRequest()

    #expect(request.url?.absoluteString == "https://app.example.com/api/local-recorder/monitoring")
    #expect(request.httpMethod == "GET")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token_123")
    #expect(request.value(forHTTPHeaderField: "x-local-recorder-device-id") == "device_123")
}

@Test func monitoringPollScheduleChecksAtFallbackGraceWindow() {
    let now = Date(timeIntervalSince1970: 100)
    let meeting = LocalRecorderMonitoringMeeting(
        botStatus: "planned",
        botStatusDetail: "Bot is scheduled",
        botStatusLabel: "Planned",
        endsAt: Date(timeIntervalSince1970: 300),
        meetingId: "meeting_123",
        startsAt: Date(timeIntervalSince1970: 160),
        title: "Weekly sync"
    )

    let delay = LocalRecorderMonitoringPollSchedule.nextDelay(
        now: now,
        nextMeeting: meeting,
        pendingMeetings: []
    )

    #expect(delay == 130)
}

@Test func notificationBackoffDoublesUntilOneHour() {
    let now = Date(timeIntervalSince1970: 100)
    let meeting = MissedMeeting(
        fallbackIntentId: "intent_123",
        title: "Weekly sync",
        expiresAt: Date(timeIntervalSince1970: 20_000),
        displayTimeWindow: DisplayTimeWindow(
            startsAt: Date(timeIntervalSince1970: 0),
            endsAt: Date(timeIntervalSince1970: 20_000)
        )
    )

    let delays = (1...7).compactMap { notificationCount in
        LocalRecorderNotificationBackoffSchedule.nextDelay(
            afterNotificationCount: notificationCount,
            now: now,
            meeting: meeting
        )
    }

    #expect(delays == [120, 240, 480, 960, 1_920, 3_840, 3_840])
}

@Test func notificationBackoffStopsAfterMeetingEnd() {
    let meeting = MissedMeeting(
        fallbackIntentId: "intent_123",
        title: "Weekly sync",
        expiresAt: Date(timeIntervalSince1970: 20_000),
        displayTimeWindow: DisplayTimeWindow(
            startsAt: Date(timeIntervalSince1970: 0),
            endsAt: Date(timeIntervalSince1970: 500)
        )
    )

    #expect(
        LocalRecorderNotificationBackoffSchedule.nextDelay(
            afterNotificationCount: 1,
            now: Date(timeIntervalSince1970: 500),
            meeting: meeting
        ) == nil
    )
}

@Test func notificationBackoffDoesNotSchedulePastIntentExpiry() {
    let now = Date(timeIntervalSince1970: 100)
    let meeting = MissedMeeting(
        fallbackIntentId: "intent_123",
        title: "Weekly sync",
        expiresAt: Date(timeIntervalSince1970: 400),
        displayTimeWindow: DisplayTimeWindow(
            startsAt: Date(timeIntervalSince1970: 0),
            endsAt: Date(timeIntervalSince1970: 20_000)
        )
    )

    #expect(
        LocalRecorderNotificationBackoffSchedule.nextDelay(
            afterNotificationCount: 7,
            now: now,
            meeting: meeting
        ) == 300
    )
}

@Test func monitoringMeetingIsOngoingOnlyInsideItsWindow() {
    let meeting = LocalRecorderMonitoringMeeting(
        botStatus: "joined",
        botStatusDetail: "Bot joined the call",
        botStatusLabel: "Joined",
        endsAt: Date(timeIntervalSince1970: 300),
        meetingId: "meeting_123",
        startsAt: Date(timeIntervalSince1970: 100),
        title: "Weekly sync"
    )

    #expect(!meeting.isOngoing(at: Date(timeIntervalSince1970: 99)))
    #expect(meeting.isOngoing(at: Date(timeIntervalSince1970: 100)))
    #expect(meeting.isOngoing(at: Date(timeIntervalSince1970: 300)))
    #expect(!meeting.isOngoing(at: Date(timeIntervalSince1970: 301)))
}

@Test func monitoringMeetingWithoutEndIsOngoingAfterStart() {
    let meeting = LocalRecorderMonitoringMeeting(
        botStatus: "joined",
        botStatusDetail: "Bot joined the call",
        botStatusLabel: "Joined",
        endsAt: nil,
        meetingId: "meeting_123",
        startsAt: Date(timeIntervalSince1970: 100),
        title: "Weekly sync"
    )

    #expect(meeting.isOngoing(at: Date(timeIntervalSince1970: 500)))
    #expect(!meeting.isOngoing(at: Date(timeIntervalSince1970: 50)))
}

@Test func manualIntentRequestIncludesBearerTokenAndDeviceId() throws {
    let client = LocalRecorderAPIClient(
        serverURL: URL(string: "https://app.example.com")!,
        bearerToken: "token_123",
        deviceId: "device_123"
    )
    let request = try client.manualIntentRequest()

    #expect(request.url?.absoluteString == "https://app.example.com/api/local-recorder/manual-intents")
    #expect(request.httpMethod == "POST")
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
          "expiresAt": "2026-06-30T13:15:00.123Z",
          "displayTimeWindow": {
            "startsAt": "2026-06-30T12:00:00.456Z",
            "endsAt": "2026-06-30T13:00:00.789Z"
          }
        }
      ]
    }
    """.data(using: .utf8)!

    let response = try JSONDecoder.localRecorder.decode(MissedMeetingsResponse.self, from: data)

    #expect(response.meetings.first?.fallbackIntentId == "intent_123")
    #expect(response.meetings.first?.title == "Weekly sync")
    #expect(response.meetings.first?.expiresAt.timeIntervalSince1970 == 1782825300.123)
    #expect(response.meetings.first?.displayTimeWindow.startsAt.timeIntervalSince1970 == 1782820800.456)
    #expect(response.meetings.first?.displayTimeWindow.endsAt?.timeIntervalSince1970 == 1782824400.789)
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

@Test func activitySamplerStoresTrackActivityWindows() {
    let startedAt = Date(timeIntervalSince1970: 100)
    let sampler = LocalRecorderActivitySampler(
        startedAt: startedAt,
        windowDuration: 1,
        activityThreshold: 0.01
    )

    sampler.observe(source: .microphone, level: 0.02, at: startedAt.addingTimeInterval(0.25))
    sampler.observe(source: .computerAudio, level: 0.03, at: startedAt.addingTimeInterval(0.75))
    sampler.observe(source: .microphone, level: 0.001, at: startedAt.addingTimeInterval(1.25))

    let windows = sampler.snapshot(stoppedAt: startedAt.addingTimeInterval(2))

    #expect(windows.count == 2)
    #expect(windows[0].startsAt == 0)
    #expect(windows[0].endsAt == 1)
    #expect(windows[0].microphoneActive)
    #expect(windows[0].computerAudioActive)
    #expect(abs(windows[0].microphoneLevel - 0.02) < 0.0001)
    #expect(abs(windows[0].computerAudioLevel - 0.03) < 0.0001)
    #expect(windows[1].startsAt == 1)
    #expect(windows[1].endsAt == 2)
    #expect(!windows[1].microphoneActive)
    #expect(!windows[1].computerAudioActive)
}

@Test func activityAttributorLabelsTranscriptSegmentsFromTrackActivity() {
    let windows = [
        LocalRecorderActivityWindow(
            startsAt: 0,
            endsAt: 1,
            microphoneActive: true,
            computerAudioActive: false,
            microphoneLevel: 0.02,
            computerAudioLevel: 0
        ),
        LocalRecorderActivityWindow(
            startsAt: 1,
            endsAt: 2,
            microphoneActive: false,
            computerAudioActive: true,
            microphoneLevel: 0,
            computerAudioLevel: 0.03
        ),
        LocalRecorderActivityWindow(
            startsAt: 2,
            endsAt: 3,
            microphoneActive: true,
            computerAudioActive: true,
            microphoneLevel: 0.02,
            computerAudioLevel: 0.03
        ),
        LocalRecorderActivityWindow(
            startsAt: 3,
            endsAt: 4,
            microphoneActive: false,
            computerAudioActive: false,
            microphoneLevel: 0,
            computerAudioLevel: 0
        ),
    ]
    let attributor = LocalRecorderActivityAttributor()

    #expect(
        attributor.attribution(
            for: LocalRecorderTranscriptSegmentWindow(startsAt: 0.1, endsAt: 0.9),
            activityWindows: windows
        ) == .localUser
    )
    #expect(
        attributor.attribution(
            for: LocalRecorderTranscriptSegmentWindow(startsAt: 1.1, endsAt: 1.9),
            activityWindows: windows
        ) == .remoteSpeaker
    )
    #expect(
        attributor.attribution(
            for: LocalRecorderTranscriptSegmentWindow(startsAt: 2.1, endsAt: 2.9),
            activityWindows: windows
        ) == .overlap
    )
    #expect(
        attributor.attribution(
            for: LocalRecorderTranscriptSegmentWindow(startsAt: 3.1, endsAt: 3.9),
            activityWindows: windows
        ) == .silence
    )
    #expect(
        attributor.attribution(
            for: LocalRecorderTranscriptSegmentWindow(startsAt: 4.1, endsAt: 4.9),
            activityWindows: windows
        ) == .unknown
    )
}

@Test func recordingManifestIncludesActivityWindowsForLaterAttribution() throws {
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
            captureStartedAt: Date(timeIntervalSince1970: 10),
            captureStoppedAt: Date(timeIntervalSince1970: 20),
            sampleRate: 48_000,
            channelCount: 1,
            codec: "pcm_s16le",
            container: "wav",
            firstSampleTime: 0
        ),
        activityWindows: [
            LocalRecorderActivityWindow(
                startsAt: 0,
                endsAt: 1,
                microphoneActive: true,
                computerAudioActive: false,
                microphoneLevel: 0.02,
                computerAudioLevel: 0
            ),
        ]
    )
    let data = try JSONEncoder.localRecorder.encode(manifest)
    let decoded = try JSONDecoder.localRecorder.decode(RecordingManifest.self, from: data)

    #expect(decoded.activityWindows.count == 1)
    #expect(decoded.activityWindows.first?.microphoneActive == true)
}

@Test func recordingManifestDefaultsMissingActivityWindowsToEmpty() throws {
    let data = """
    {
      "appVersion": "0.1.0",
      "computerAudio": {
        "captureStartedAt": "1970-01-01T00:00:10Z",
        "captureStoppedAt": "1970-01-01T00:00:20Z",
        "sampleRate": 48000,
        "channelCount": 2,
        "codec": "pcm_s16le",
        "container": "wav",
        "firstSampleTime": 0
      },
      "microphoneAudio": {
        "captureStartedAt": "1970-01-01T00:00:10Z",
        "captureStoppedAt": "1970-01-01T00:00:20Z",
        "sampleRate": 48000,
        "channelCount": 1,
        "codec": "pcm_s16le",
        "container": "wav",
        "firstSampleTime": 0
      }
    }
    """.data(using: .utf8)!

    let manifest = try JSONDecoder.localRecorder.decode(RecordingManifest.self, from: data)

    #expect(manifest.activityWindows.isEmpty)
}

@Test func prepareUploadRequestBuildsJSONBodyForThreeAudioAssets() throws {
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
    let synthesizedAudioURL = temporaryDirectory.appending(path: "synthesized.wav")
    try Data("computer".utf8).write(to: computerAudioURL)
    try Data("microphone".utf8).write(to: microphoneAudioURL)
    try Data("synthesized".utf8).write(to: synthesizedAudioURL)

    let payload = LocalRecordingUploadPayload(
        fallbackIntentId: "intent_123",
        clientRecordingId: "recording_123",
        recordingStartedAt: Date(timeIntervalSince1970: 10),
        recordingStoppedAt: Date(timeIntervalSince1970: 20),
        computerAudioURL: computerAudioURL,
        microphoneAudioURL: microphoneAudioURL,
        synthesizedAudioURL: synthesizedAudioURL,
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
            ),
            activityWindows: [
                LocalRecorderActivityWindow(
                    startsAt: 0,
                    endsAt: 1,
                    microphoneActive: true,
                    computerAudioActive: false,
                    microphoneLevel: 0.02,
                    computerAudioLevel: 0
                ),
            ]
        )
    )
    let client = LocalRecorderAPIClient(
        serverURL: URL(string: "https://app.example.com")!,
        bearerToken: "token_123",
        deviceId: "device_123"
    )
    let request = try client.prepareUploadRequest(payload: payload)
    let body = try #require(request.httpBody)
    let json = try JSONSerialization.jsonObject(with: body) as? [String: Any]

    #expect(request.url?.absoluteString == "https://app.example.com/api/local-recorder/recordings/prepare")
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token_123")
    #expect(request.value(forHTTPHeaderField: "x-local-recorder-device-id") == "device_123")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(json?["fallbackIntentId"] as? String == "intent_123")
    #expect(json?["clientRecordingId"] as? String == "recording_123")
    let manifest = json?["manifest"] as? [String: Any]
    let activityWindows = manifest?["activityWindows"] as? [[String: Any]]
    #expect(manifest?["appVersion"] as? String == "0.1.0")
    #expect(activityWindows?.first?["microphoneActive"] as? Bool == true)
}

@Test func completeUploadRequestIncludesPreparedAssetIds() throws {
    let payload = makeUploadPayload(
        clientRecordingId: "recording_123",
        recordingStartedAt: Date(timeIntervalSince1970: 10),
        directoryURL: FileManager.default.temporaryDirectory,
        uploadAssets: LocalRecordingUploadAssetIds(
            computerAudioAssetId: "asset_computer",
            microphoneAudioAssetId: "asset_microphone",
            synthesizedAudioAssetId: "asset_synthesized"
        )
    )
    let client = LocalRecorderAPIClient(
        serverURL: URL(string: "https://app.example.com")!,
        bearerToken: "token_123",
        deviceId: "device_123"
    )
    let request = try client.completeUploadRequest(payload: payload)
    let body = try #require(request.httpBody)
    let json = try JSONSerialization.jsonObject(with: body) as? [String: Any]
    let assets = json?["assets"] as? [String: String]

    #expect(request.url?.absoluteString == "https://app.example.com/api/local-recorder/recordings/complete")
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token_123")
    #expect(request.value(forHTTPHeaderField: "x-local-recorder-device-id") == "device_123")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(assets?["computerAudioAssetId"] == "asset_computer")
    #expect(assets?["microphoneAudioAssetId"] == "asset_microphone")
    #expect(assets?["synthesizedAudioAssetId"] == "asset_synthesized")
}

@Test func loginCallbackParsesTokenAndServerURL() throws {
    let callback = try LocalRecorderLoginCallback(
        url: URL(
            string: "meetingnote-local-recorder://login?token=token_123&server=https%3A%2F%2Fapp.example.com"
        )!
    )

    #expect(callback.token == "token_123")
    #expect(callback.serverURL.absoluteString == "https://app.example.com")
}

@MainActor
@Test func externalURLDispatcherQueuesCallbacksUntilHandlerIsRegistered() {
    let dispatcher = LocalRecorderExternalURLDispatcher()
    let queuedURL = URL(
        string: "meetingnote-local-recorder://login?token=token_123&server=https%3A%2F%2Fapp.example.com"
    )!
    let laterURL = URL(
        string: "meetingnote-local-recorder://login?token=token_456&server=https%3A%2F%2Fapp.example.com"
    )!
    var receivedURLs: [URL] = []

    dispatcher.openURLs([queuedURL])
    dispatcher.setHandler { url in
        receivedURLs.append(url)
    }
    dispatcher.openURLs([laterURL])

    #expect(receivedURLs == [queuedURL, laterURL])
}

@Test func loginCallbackRejectsUnexpectedScheme() {
    #expect(throws: LocalRecorderLoginCallbackError.self) {
        _ = try LocalRecorderLoginCallback(
            url: URL(string: "https://app.example.com/login?token=token_123")!
        )
    }
}

@Test func browserLoginURLStartsAtSignInWithEncodedDeviceCallback() throws {
    let url = try #require(
        makeLocalRecorderBrowserLoginURL(
            serverURL: URL(string: "https://app.example.com")!,
            deviceId: "device_123"
        )
    )

    #expect(
        url.absoluteString ==
            "https://app.example.com/auth/sign-in?callbackUrl=%2Fapi%2Flocal-recorder%2Fdevice-login%3FdeviceId%3Ddevice_123%26callbackUrl%3Dmeetingnote-local-recorder%253A%252F%252Flogin"
    )
}

@Test func failIntentRequestIncludesRecorderHeadersAndReason() throws {
    let client = LocalRecorderAPIClient(
        serverURL: URL(string: "https://app.example.com")!,
        bearerToken: "token_123",
        deviceId: "device_123"
    )
    let request = try client.failIntentRequest(
        fallbackIntentId: "intent_123",
        errorMessage: "Screen recording denied"
    )
    let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)

    #expect(request.url?.absoluteString == "https://app.example.com/api/local-recorder/intents/intent_123/fail")
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token_123")
    #expect(request.value(forHTTPHeaderField: "x-local-recorder-device-id") == "device_123")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(body.contains("Screen recording denied"))
}

@Test func keychainCredentialStoreSavesLoadsReplacesAndDeletes() throws {
    let store = LocalRecorderKeychainCredentialStore(
        service: "tech.inevitable.meeting-note.local-recorder.tests.\(UUID().uuidString)",
        account: "device-session"
    )
    defer {
        try? store.delete()
    }

    try store.save(
        LocalRecorderCredentials(
            serverURLText: "https://app.example.com",
            bearerToken: "token_123"
        )
    )
    #expect(
        try store.load() == LocalRecorderCredentials(
            serverURLText: "https://app.example.com",
            bearerToken: "token_123"
        )
    )

    try store.save(
        LocalRecorderCredentials(
            serverURLText: "https://app.example.com",
            bearerToken: "token_456"
        )
    )
    #expect(try store.load()?.bearerToken == "token_456")

    try store.delete()
    #expect(try store.load() == nil)
}

@Test func uploadQueuePersistsPayloadsOldestFirstAndRemovesThem() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
        .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let queueDirectory = temporaryDirectory.appending(path: "queue", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(
        at: temporaryDirectory,
        withIntermediateDirectories: true
    )
    defer {
        try? FileManager.default.removeItem(at: temporaryDirectory)
    }

    let queue = LocalRecordingUploadQueue(directoryURL: queueDirectory)
    let newerPayload = makeUploadPayload(
        clientRecordingId: "recording_new",
        recordingStartedAt: Date(timeIntervalSince1970: 20),
        directoryURL: temporaryDirectory.appending(path: "new", directoryHint: .isDirectory)
    )
    let olderPayload = makeUploadPayload(
        clientRecordingId: "recording_old",
        recordingStartedAt: Date(timeIntervalSince1970: 10),
        directoryURL: temporaryDirectory.appending(path: "old", directoryHint: .isDirectory)
    )

    try queue.save(newerPayload)
    try queue.save(olderPayload)

    let queued = try queue.load()
    #expect(queued.map(\.clientRecordingId) == ["recording_old", "recording_new"])
    #expect(queued.first?.computerAudioURL == olderPayload.computerAudioURL)
    #expect(queued.first?.uploadAssets?.computerAudioAssetId == "asset_recording_old_computer")

    try queue.remove(clientRecordingId: "recording_old")
    #expect(try queue.load().map(\.clientRecordingId) == ["recording_new"])
}

private func makeUploadPayload(
    clientRecordingId: String,
    recordingStartedAt: Date,
    directoryURL: URL,
    uploadAssets: LocalRecordingUploadAssetIds? = nil
) -> LocalRecordingUploadPayload {
    LocalRecordingUploadPayload(
        fallbackIntentId: "intent_123",
        clientRecordingId: clientRecordingId,
        recordingStartedAt: recordingStartedAt,
        recordingStoppedAt: recordingStartedAt.addingTimeInterval(60),
        computerAudioURL: directoryURL.appending(path: "computer.wav"),
        microphoneAudioURL: directoryURL.appending(path: "microphone.wav"),
        synthesizedAudioURL: directoryURL.appending(path: "synthesized.wav"),
        uploadAssets: uploadAssets ?? LocalRecordingUploadAssetIds(
            computerAudioAssetId: "asset_\(clientRecordingId)_computer",
            microphoneAudioAssetId: "asset_\(clientRecordingId)_microphone",
            synthesizedAudioAssetId: "asset_\(clientRecordingId)_synthesized"
        ),
        manifest: RecordingManifest(
            appVersion: "0.1.0",
            computerAudio: .init(
                captureStartedAt: recordingStartedAt,
                captureStoppedAt: recordingStartedAt.addingTimeInterval(60),
                sampleRate: 48_000,
                channelCount: 2,
                codec: "pcm_s16le",
                container: "wav",
                firstSampleTime: 0
            ),
            microphoneAudio: .init(
                captureStartedAt: recordingStartedAt,
                captureStoppedAt: recordingStartedAt.addingTimeInterval(60),
                sampleRate: 48_000,
                channelCount: 1,
                codec: "pcm_s16le",
                container: "wav",
                firstSampleTime: 0
            )
        )
    )
}
