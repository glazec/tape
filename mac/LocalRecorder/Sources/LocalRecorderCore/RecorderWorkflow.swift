import Foundation

public struct RecordingMeeting: Codable, Equatable, Identifiable, Sendable {
    public var meetingId: String
    public var title: String
    public var startsAt: Date?
    public var endsAt: Date?
    public var status: String
    public var id: String { meetingId }
}

public struct RecordingMeetingsResponse: Codable, Sendable {
    public var meetings: [RecordingMeeting]
    public var hasMore: Bool
}

public struct RecordingTargetRequest: Codable, Equatable, Sendable {
    public var clientRequestId: String?
    public var fallbackIntentId: String?
    public var meetingId: String?
    public var title: String?
    public init(clientRequestId: String? = nil, fallbackIntentId: String? = nil, meetingId: String? = nil, title: String? = nil) {
        self.clientRequestId = clientRequestId
        self.fallbackIntentId = fallbackIntentId
        self.meetingId = meetingId
        self.title = title
    }
}

public struct RecordingTarget: Codable, Equatable, Sendable {
    public var fallbackIntentId: String
    public var meetingId: String
    public var meetingTitle: String
    public var startsAt: Date?
    public var endsAt: Date?
    public init(fallbackIntentId: String, meetingId: String, meetingTitle: String, startsAt: Date? = nil, endsAt: Date? = nil) {
        self.fallbackIntentId = fallbackIntentId
        self.meetingId = meetingId
        self.meetingTitle = meetingTitle
        self.startsAt = startsAt
        self.endsAt = endsAt
    }
}

public struct RecordingTargetStatus: Codable, Sendable {
    public var state: String
    public var isTerminal: Bool { state == "completed" || state == "failed" }
}

extension LocalRecorderAPIClient {
    public func recordingMeetingsRequest(query: String, offset: Int) throws -> URLRequest {
        var components = URLComponents(url: serverURL.appending(path: "/api/local-recorder/recording-meetings"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "offset", value: String(offset))]
        guard let url = components.url else { throw LocalRecorderAPIError.invalidResponse }
        var request = URLRequest(url: url)
        applyRecorderHeaders(to: &request)
        return request
    }

    public func recordingTargetRequest(_ target: RecordingTargetRequest) throws -> URLRequest {
        try workflowRequest(path: "recording-target", body: target)
    }

    public func recordingTargetFinishRequest(fallbackIntentId: String) throws -> URLRequest {
        try workflowRequest(path: "recording-target/finish", body: ["fallbackIntentId": fallbackIntentId])
    }

    public func fetchRecordingMeetings(query: String, offset: Int) async throws -> RecordingMeetingsResponse {
        try await workflowResponse(for: recordingMeetingsRequest(query: query, offset: offset))
    }

    public func setRecordingTarget(_ target: RecordingTargetRequest) async throws -> RecordingTarget {
        try await workflowResponse(for: recordingTargetRequest(target))
    }

    public func finishRecordingTarget(fallbackIntentId: String) async throws -> RecordingTarget {
        try await workflowResponse(for: recordingTargetFinishRequest(fallbackIntentId: fallbackIntentId))
    }

    public func recordingTargetStatus(fallbackIntentId: String) async throws -> RecordingTargetStatus {
        try await workflowResponse(for: workflowRequest(path: "recording-target/status", body: ["fallbackIntentId": fallbackIntentId]))
    }

    private func workflowRequest<T: Encodable>(path: String, body: T) throws -> URLRequest {
        var request = URLRequest(url: serverURL.appending(path: "/api/local-recorder/\(path)"))
        request.httpMethod = "POST"
        applyRecorderHeaders(to: &request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return request
    }

    private func workflowResponse<T: Decodable>(for request: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        try validateHTTPResponse(data: data, response: response)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: value) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: value) else { throw LocalRecorderAPIError.invalidResponse }
            return date
        }
        return try decoder.decode(T.self, from: data)
    }
}

/// Silence is evidence only while BOTH independent streams keep reporting.
public struct RecorderEndPromptPolicy: Equatable, Sendable {
    public var scheduledEnd: Date?
    private var microphone: Sample?
    private var computer: Sample?
    private var silentSince: Date?
    private var snoozedUntil: Date?
    private var pending = false
    private struct Sample: Equatable, Sendable { var level: Float; var at: Date }
    public init(scheduledEnd: Date?) { self.scheduledEnd = scheduledEnd }

    public mutating func observe(source: LocalRecorderAudioSource, level: Float, at now: Date = Date()) -> Bool {
        let sample = Sample(level: level, at: now)
        if source == .microphone { microphone = sample } else { computer = sample }
        guard let microphone, let computer,
              now.timeIntervalSince(microphone.at) <= 2,
              now.timeIntervalSince(computer.at) <= 2,
              microphone.level <= 0.005, computer.level <= 0.005,
              scheduledEnd.map({ now >= $0 }) ?? true else {
            silentSince = nil
            return false
        }
        if silentSince == nil { silentSince = now }
        guard !pending, snoozedUntil.map({ now >= $0 }) ?? true,
              now.timeIntervalSince(silentSince!) >= (scheduledEnd == nil ? 300 : 60) else { return false }
        pending = true
        return true
    }

    public mutating func meetingClosed(at now: Date = Date()) -> Bool {
        guard !pending, snoozedUntil.map({ now >= $0 }) ?? true else { return false }
        pending = true
        return true
    }

    public mutating func snooze(at now: Date = Date()) {
        pending = false
        silentSince = nil
        snoozedUntil = now.addingTimeInterval(300)
    }
}

public enum RecorderSDKEvent: Equatable, Sendable { case meetingClosed, recordingEnded }
public struct RecorderSDKLifecycle: Sendable {
    public var windowID: String
    public var explicitStopRequested = false
    public init(windowID: String) { self.windowID = windowID }
    public mutating func observe(event: String, windowID: String?) -> RecorderSDKEvent? {
        guard !explicitStopRequested, windowID == self.windowID else { return nil }
        switch event {
        case "meeting-closed": return .meetingClosed
        case "recording-ended": return .recordingEnded
        default: return nil
        }
    }
}

public enum RecorderRecoveryPolicy {
    public static func shouldRecover(intentID: String, activeTargetID: String?, isStarting: Bool, isRecording: Bool) -> Bool {
        !(intentID == activeTargetID && (isStarting || isRecording))
    }
}
