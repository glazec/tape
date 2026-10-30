import Foundation
import Testing
@testable import LocalRecorderCore

@Test func recordingTargetRequestPreservesExactDestinationAndRetryID() throws {
    let client = LocalRecorderAPIClient(serverURL: URL(string: "https://example.com")!, bearerToken: "secret", deviceId: "device")
    let request = try client.recordingTargetRequest(RecordingTargetRequest(clientRequestId: "retry", meetingId: "displayed"))
    let body = try #require(request.httpBody)
    let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
    #expect(json == ["clientRequestId": "retry", "meetingId": "displayed"])
    #expect(request.value(forHTTPHeaderField: "x-local-recorder-device-id") == "device")
    let move = try client.recordingTargetRequest(RecordingTargetRequest(fallbackIntentId: "active", meetingId: "other"))
    let moveBody = try #require(move.httpBody)
    let moveJSON = try #require(JSONSerialization.jsonObject(with: moveBody) as? [String: String])
    #expect(moveJSON == ["fallbackIntentId": "active", "meetingId": "other"])
}

@Test func meetingSearchEncodesQueryAndPagination() throws {
    let client = LocalRecorderAPIClient(serverURL: URL(string: "https://example.com")!, bearerToken: "secret", deviceId: "device")
    let request = try client.recordingMeetingsRequest(query: "A & B", offset: 100)
    let url = try #require(request.url)
    let items = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
    #expect(items.first(where: { $0.name == "q" })?.value == "A & B")
    #expect(items.first(where: { $0.name == "offset" })?.value == "100")
}

@Test func scheduledSilenceStartsOnlyAfterOriginalEnd() {
    let start = Date(timeIntervalSince1970: 1000)
    var policy = RecorderEndPromptPolicy(scheduledEnd: start.addingTimeInterval(120))
    for second in 0..<180 {
        let now = start.addingTimeInterval(Double(second))
        let result31 = policy.observe(source: .microphone, level: 0, at: now) == false
        #expect(result31)
        let result32 = policy.observe(source: .computerAudio, level: 0, at: now) == false
        #expect(result32)
    }
    let end = start.addingTimeInterval(180)
    let result35 = policy.observe(source: .microphone, level: 0, at: end)
    #expect(result35)
    let result36 = !policy.observe(source: .computerAudio, level: 0, at: end)
    #expect(result36)
}

@Test func adHocNeedsFiveMinutesAndBothFreshSources() {
    let start = Date(timeIntervalSince1970: 1000)
    var policy = RecorderEndPromptPolicy(scheduledEnd: nil)
    for second in 0..<300 {
        let now = start.addingTimeInterval(Double(second))
        let result44 = !policy.observe(source: .microphone, level: 0, at: now)
        #expect(result44)
        let result45 = !policy.observe(source: .computerAudio, level: 0, at: now)
        #expect(result45)
    }
    let result47 = policy.observe(source: .microphone, level: 0, at: start.addingTimeInterval(300))
    #expect(result47)
    policy.snooze(at: start.addingTimeInterval(300))
    let result49 = !policy.meetingClosed(at: start.addingTimeInterval(301))
    #expect(result49)
    let result50 = policy.meetingClosed(at: start.addingTimeInterval(601))
    #expect(result50)
}

@Test func staleOrActiveOtherSourceCannotProduceSilencePrompt() {
    let start = Date(timeIntervalSince1970: 1000)
    var policy = RecorderEndPromptPolicy(scheduledEnd: start)
    _ = policy.observe(source: .computerAudio, level: 0, at: start)
    for second in 0...400 {
        let result58 = !policy.observe(source: .microphone, level: 0, at: start.addingTimeInterval(Double(second)))
        #expect(result58)
    }
    for second in 401...500 {
        let now = start.addingTimeInterval(Double(second))
        let result62 = !policy.observe(source: .computerAudio, level: 0.1, at: now)
        #expect(result62)
        let result63 = !policy.observe(source: .microphone, level: 0, at: now)
        #expect(result63)
    }
}

@Test func sdkEventsRequireMatchingWindowAndNaturalLifecycle() throws {
    var lifecycle = RecorderSDKLifecycle(windowID: "ours")
    let result69 = lifecycle.observe(event: "meeting-closed", windowID: "other") == nil
    #expect(result69)
    let result70 = lifecycle.observe(event: "meeting-closed", windowID: "ours") == .meetingClosed
    #expect(result70)
    let result71 = lifecycle.observe(event: "recording-ended", windowID: "ours") == .recordingEnded
    #expect(result71)
    lifecycle.explicitStopRequested = true
    let result73 = lifecycle.observe(event: "recording-ended", windowID: "ours") == nil
    #expect(result73)
}

@Test func emptyCalendarAndDistantEventsPollWithinOneMinute() throws {
    let now = Date()
    #expect(LocalRecorderMonitoringPollSchedule.nextDelay(now: now, nextMeeting: nil, pendingMeetings: []) <= 60)
    let json = "{\"botStatus\":\"scheduled\",\"botStatusDetail\":\"\",\"botStatusLabel\":\"Scheduled\",\"meetingId\":\"later\",\"title\":\"Later\",\"startsAt\":\"2099-01-01T12:00:00Z\"}"
    let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
    let meeting = try decoder.decode(LocalRecorderMonitoringMeeting.self, from: Data(json.utf8))
    #expect(LocalRecorderMonitoringPollSchedule.nextDelay(now: now, nextMeeting: meeting, pendingMeetings: []) <= 60)
}

@Test func monitoringDoesNotSealTheTargetWhileSDKStartupAwaits() {
    #expect(!RecorderRecoveryPolicy.shouldRecover(intentID: "starting", activeTargetID: "starting", isStarting: true, isRecording: false))
    #expect(!RecorderRecoveryPolicy.shouldRecover(intentID: "active", activeTargetID: "active", isStarting: false, isRecording: true))
    #expect(RecorderRecoveryPolicy.shouldRecover(intentID: "prior", activeTargetID: "new", isStarting: true, isRecording: false))
    #expect(RecorderRecoveryPolicy.shouldRecover(intentID: "prior", activeTargetID: nil, isStarting: false, isRecording: false))
}

@Test func failedAndCompletedAttemptsAreReleasableWithoutSealing() throws {
    for state in ["failed", "completed"] {
        let response = try JSONDecoder().decode(RecordingTargetStatus.self, from: Data("{\"state\":\"\(state)\"}".utf8))
        #expect(response.isTerminal)
    }
    for state in ["started", "sealed", "uploading"] {
        let response = try JSONDecoder().decode(RecordingTargetStatus.self, from: Data("{\"state\":\"\(state)\"}".utf8))
        #expect(!response.isTerminal)
    }
}
