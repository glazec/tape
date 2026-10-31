import Foundation

public struct RecordingMeeting: Codable, Equatable, Identifiable, Sendable {
    public var meetingId: String
    public var title: String
    public var startsAt: Date?
    public var endsAt: Date?
    public var status: String
    public var createdAt: Date?
    public var unavailableReason: String?
    public var id: String { meetingId }
    public var displayDate: Date? { startsAt ?? createdAt }

    private enum CodingKeys: String, CodingKey {
        case meetingId, title, startsAt, endsAt, status, createdAt, unavailableReason
    }

    /// One unreadable date drops that date, not the whole meeting list.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        meetingId = try container.decode(String.self, forKey: .meetingId)
        title = try container.decode(String.self, forKey: .title)
        status = (try? container.decodeIfPresent(String.self, forKey: .status)) ?? "scheduled"
        unavailableReason = try? container.decodeIfPresent(String.self, forKey: .unavailableReason)
        startsAt = (try? container.decodeIfPresent(Date.self, forKey: .startsAt)) ?? nil
        endsAt = (try? container.decodeIfPresent(Date.self, forKey: .endsAt)) ?? nil
        createdAt = (try? container.decodeIfPresent(Date.self, forKey: .createdAt)) ?? nil
    }
    public var dateIsCreationDate: Bool { startsAt == nil }
    public var statusLabel: String {
        switch status {
        case "ready", "completed": "Transcript ready"
        case "processing": "Processing transcript"
        case "recording": "Recording"
        case "failed": "Needs attention"
        case "missed": "Not recorded"
        default: "Scheduled"
        }
    }
}

public func localRecorderTargetWasRejected(_ error: Error) -> Bool {
    guard case LocalRecorderAPIError.httpStatus(let status, _, _) = error else { return false }
    return (400..<500).contains(status) && status != 408 && status != 429
}

public enum RecorderStartFailure: Equatable, Sendable {
    case serviceUnavailable, meetingUnavailable, signInRequired, accessDenied, retrySameMeeting

    public init(error: Error) {
        if let apiError = error as? LocalRecorderAPIError, apiError == .recordingWorkflowUnavailable {
            self = .serviceUnavailable
        } else if localRecorderRequiresSignIn(error) {
            self = .signInRequired
        } else if case LocalRecorderAPIError.httpStatus(let status, _, _) = error, status == 404 || status == 409 {
            self = .meetingUnavailable
        } else {
            self = localRecorderTargetWasRejected(error) ? .accessDenied : .retrySameMeeting
        }
    }

    public var message: String {
        switch self {
        case .serviceUnavailable: "Tape can't start a recording right now. Nothing was recorded."
        case .meetingUnavailable: "This meeting can't take a recording. Record it as a new meeting instead."
        case .signInRequired: "Sign in again to start recording."
        case .accessDenied: "Couldn't start recording. Check your workspace access and credit."
        case .retrySameMeeting: "Couldn't start recording. Try again to keep the same meeting."
        }
    }

    public var actionTitle: String {
        switch self {
        case .meetingUnavailable: "Record a separate meeting"
        case .signInRequired: "Sign in again"
        default: "Try again"
        }
    }
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

public struct RecordingUploadReceipt: Identifiable {
    public let id: String
    public var target: RecordingTarget?
    public var message: String
    public var meetingURL: URL?
    public var isTerminal = false
    public var needsAttention = false

    public init(id: String, message: String) { self.id = id; self.message = message }

    public mutating func update(target: RecordingTarget?, message: String, serverURL: URL?, terminal: Bool, failed: Bool = false) {
        // A late destination confirmation must not turn an uploaded receipt back
        // into Uploading. Metadata can still arrive after the upload completes.
        if !isTerminal || terminal { self.message = message }
        isTerminal = isTerminal || terminal
        if terminal { needsAttention = failed }
        if let target, let serverURL {
            self.target = target
            meetingURL = serverURL.appending(path: "meetings/\(target.meetingId)")
        }
    }
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
        return try JSONDecoder.localRecorderWorkflow.decode(T.self, from: data)
    }
}

public extension JSONDecoder {
    static var localRecorderWorkflow: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            guard let date = localRecorderDate(from: value) else { throw LocalRecorderAPIError.invalidResponse }
            return date
        }
        return decoder
    }
}

/// Accepts ISO 8601 and the Postgres text form the server can pass through
/// ("2026-10-30 18:00:00.123456+00"), with any number of fractional digits.
public func localRecorderDate(from value: String) -> Date? {
    var text = value.trimmingCharacters(in: .whitespaces)
    if text.count > 10, text[text.index(text.startIndex, offsetBy: 10)] == " " {
        text.replaceSubrange(text.index(text.startIndex, offsetBy: 10)...text.index(text.startIndex, offsetBy: 10), with: "T")
    }
    // A bare "+00" or "-05" offset needs minutes for ISO 8601.
    if let match = text.range(of: #"[+-]\d{2}$"#, options: .regularExpression) {
        text.replaceSubrange(match, with: text[match] + ":00")
    }
    // ISO8601DateFormatter reads milliseconds only; trim microseconds.
    if let match = text.range(of: #"\.\d+"#, options: .regularExpression) {
        let digits = text[match].dropFirst()
        text.replaceSubrange(match, with: "." + String((digits + "000").prefix(3)))
    }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: text) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: text)
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
