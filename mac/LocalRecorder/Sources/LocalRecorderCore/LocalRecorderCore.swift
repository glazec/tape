import Foundation
import Security

public enum PermissionGrant: Sendable {
    case unknown
    case granted
    case denied
}

public enum PermissionSetupState: Sendable {
    case ready
    case blocked
    case degraded
}

public struct PermissionChecklist: Sendable, Equatable {
    public var microphone: PermissionGrant
    public var screenCapture: PermissionGrant
    public var notifications: PermissionGrant
    public var startAtLogin: PermissionGrant

    public init(
        microphone: PermissionGrant,
        screenCapture: PermissionGrant,
        notifications: PermissionGrant,
        startAtLogin: PermissionGrant
    ) {
        self.microphone = microphone
        self.screenCapture = screenCapture
        self.notifications = notifications
        self.startAtLogin = startAtLogin
    }

    public var canMonitor: Bool {
        microphone == .granted
    }

    public var setupState: PermissionSetupState {
        if !canMonitor {
            return .blocked
        }

        return notifications == .granted && startAtLogin == .granted
            ? .ready
            : .degraded
    }
}

public enum SilencePromptDecision: Equatable, Sendable {
    case prompt
}

public struct SilencePromptTracker: Equatable, Sendable {
    public var activityThreshold: Float
    public var silenceDuration: TimeInterval
    public var dismissalSnoozeDuration: TimeInterval

    private var silenceStartedAt: Date?
    private var snoozedUntil: Date?
    private var hasPromptPending = false

    public init(
        activityThreshold: Float = 0.005,
        silenceDuration: TimeInterval = 60,
        dismissalSnoozeDuration: TimeInterval = 300
    ) {
        self.activityThreshold = activityThreshold
        self.silenceDuration = silenceDuration
        self.dismissalSnoozeDuration = dismissalSnoozeDuration
    }

    public mutating func observe(
        level: Float,
        at date: Date = Date()
    ) -> SilencePromptDecision? {
        if level > activityThreshold {
            silenceStartedAt = nil
            return nil
        }

        if silenceStartedAt == nil {
            silenceStartedAt = date
        }

        if hasPromptPending {
            return nil
        }

        if let snoozedUntil, date < snoozedUntil {
            return nil
        }

        guard
            let silenceStartedAt,
            date.timeIntervalSince(silenceStartedAt) >= silenceDuration
        else {
            return nil
        }

        hasPromptPending = true
        return .prompt
    }

    public mutating func dismissPrompt(at date: Date = Date()) {
        hasPromptPending = false
        snoozedUntil = date.addingTimeInterval(dismissalSnoozeDuration)
    }

    public mutating func finishAfterPrompt() {
        silenceStartedAt = nil
        snoozedUntil = nil
        hasPromptPending = false
    }
}

public enum LocalRecorderAudioSource: String, Codable, Equatable, Sendable {
    case microphone
    case computerAudio
}

public struct LocalRecorderActivityWindow: Codable, Equatable, Sendable {
    public var startsAt: TimeInterval
    public var endsAt: TimeInterval
    public var microphoneActive: Bool
    public var computerAudioActive: Bool
    public var microphoneLevel: Float
    public var computerAudioLevel: Float

    public init(
        startsAt: TimeInterval,
        endsAt: TimeInterval,
        microphoneActive: Bool,
        computerAudioActive: Bool,
        microphoneLevel: Float,
        computerAudioLevel: Float
    ) {
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.microphoneActive = microphoneActive
        self.computerAudioActive = computerAudioActive
        self.microphoneLevel = microphoneLevel
        self.computerAudioLevel = computerAudioLevel
    }
}

public final class LocalRecorderActivitySampler: @unchecked Sendable {
    private let activityThreshold: Float
    private let lock = NSLock()
    private let startedAt: Date
    private let windowDuration: TimeInterval
    private var windowsByIndex: [Int: LocalRecorderActivityWindow] = [:]

    public init(
        startedAt: Date,
        windowDuration: TimeInterval = 0.5,
        activityThreshold: Float = 0.005
    ) {
        self.startedAt = startedAt
        self.windowDuration = max(0.1, windowDuration)
        self.activityThreshold = max(0, activityThreshold)
    }

    public func observe(
        source: LocalRecorderAudioSource,
        level: Float,
        at date: Date = Date()
    ) {
        let elapsed = max(0, date.timeIntervalSince(startedAt))
        let index = Int(floor(elapsed / windowDuration))
        let startsAt = TimeInterval(index) * windowDuration
        let endsAt = startsAt + windowDuration

        lock.lock()
        var window = windowsByIndex[index] ?? LocalRecorderActivityWindow(
            startsAt: startsAt,
            endsAt: endsAt,
            microphoneActive: false,
            computerAudioActive: false,
            microphoneLevel: 0,
            computerAudioLevel: 0
        )

        switch source {
        case .microphone:
            window.microphoneLevel = max(window.microphoneLevel, level)
            window.microphoneActive = window.microphoneActive || level > activityThreshold
        case .computerAudio:
            window.computerAudioLevel = max(window.computerAudioLevel, level)
            window.computerAudioActive = window.computerAudioActive || level > activityThreshold
        }

        windowsByIndex[index] = window
        lock.unlock()
    }

    public func snapshot(stoppedAt: Date = Date()) -> [LocalRecorderActivityWindow] {
        let stoppedElapsed = max(0, stoppedAt.timeIntervalSince(startedAt))

        lock.lock()
        let windows = windowsByIndex
            .sorted { $0.key < $1.key }
            .map { _, value in
                var window = value
                window.endsAt = min(window.endsAt, max(window.startsAt, stoppedElapsed))
                return window
            }
        lock.unlock()

        return windows
    }
}

public struct LocalRecorderTranscriptSegmentWindow: Equatable, Sendable {
    public var startsAt: TimeInterval
    public var endsAt: TimeInterval

    public init(startsAt: TimeInterval, endsAt: TimeInterval) {
        self.startsAt = startsAt
        self.endsAt = endsAt
    }
}

public enum LocalRecorderSpeakerAttribution: String, Codable, Equatable, Sendable {
    case localUser
    case remoteSpeaker
    case overlap
    case silence
    case unknown
}

public struct LocalRecorderActivityAttributor: Equatable, Sendable {
    public var minimumCoverageRatio: Double

    public init(minimumCoverageRatio: Double = 0.2) {
        self.minimumCoverageRatio = minimumCoverageRatio
    }

    public func attribution(
        for segment: LocalRecorderTranscriptSegmentWindow,
        activityWindows: [LocalRecorderActivityWindow]
    ) -> LocalRecorderSpeakerAttribution {
        let segmentDuration = segment.endsAt - segment.startsAt
        guard segmentDuration > 0 else {
            return .unknown
        }

        var localUserDuration: TimeInterval = 0
        var remoteSpeakerDuration: TimeInterval = 0
        var overlapDuration: TimeInterval = 0
        var silenceDuration: TimeInterval = 0
        var coveredDuration: TimeInterval = 0

        for window in activityWindows {
            let startsAt = max(segment.startsAt, window.startsAt)
            let endsAt = min(segment.endsAt, window.endsAt)
            let overlap = endsAt - startsAt

            guard overlap > 0 else {
                continue
            }

            coveredDuration += overlap

            switch (window.microphoneActive, window.computerAudioActive) {
            case (true, false):
                localUserDuration += overlap
            case (false, true):
                remoteSpeakerDuration += overlap
            case (true, true):
                overlapDuration += overlap
            case (false, false):
                silenceDuration += overlap
            }
        }

        guard coveredDuration / segmentDuration >= minimumCoverageRatio else {
            return .unknown
        }

        let candidates: [(duration: TimeInterval, attribution: LocalRecorderSpeakerAttribution)] = [
            (localUserDuration, .localUser),
            (remoteSpeakerDuration, .remoteSpeaker),
            (overlapDuration, .overlap),
            (silenceDuration, .silence),
        ]
        guard let winner = candidates.max(by: { $0.duration < $1.duration }),
              winner.duration > 0 else {
            return .unknown
        }

        return winner.attribution
    }
}

public struct LocalRecorderAPIClient: Sendable {
    public var serverURL: URL
    public var bearerToken: String
    public var deviceId: String

    public init(serverURL: URL, bearerToken: String, deviceId: String) {
        self.serverURL = serverURL
        self.bearerToken = bearerToken
        self.deviceId = deviceId
    }

    public func missedMeetingsRequest() throws -> URLRequest {
        var request = URLRequest(
            url: serverURL.appending(path: "/api/local-recorder/missed-meetings")
        )
        request.httpMethod = "GET"
        applyRecorderHeaders(to: &request)
        return request
    }

    public func fetchMissedMeetings() async throws -> [MissedMeeting] {
        let (data, response) = try await URLSession.shared.data(
            for: missedMeetingsRequest()
        )
        try validateHTTPResponse(response)

        return try JSONDecoder.localRecorder
            .decode(MissedMeetingsResponse.self, from: data)
            .meetings
    }

    public func monitoringRequest() throws -> URLRequest {
        var request = URLRequest(
            url: serverURL.appending(path: "/api/local-recorder/monitoring")
        )
        request.httpMethod = "GET"
        applyRecorderHeaders(to: &request)
        return request
    }

    public func fetchMonitoringStatus() async throws -> LocalRecorderMonitoringResponse {
        let (data, response) = try await URLSession.shared.data(
            for: monitoringRequest()
        )
        try validateHTTPResponse(response)

        return try JSONDecoder.localRecorder.decode(
            LocalRecorderMonitoringResponse.self,
            from: data
        )
    }

    public func manualIntentRequest() throws -> URLRequest {
        var request = URLRequest(
            url: serverURL.appending(path: "/api/local-recorder/manual-intents")
        )
        request.httpMethod = "POST"
        applyRecorderHeaders(to: &request)
        return request
    }

    public func createManualIntent() async throws -> ManualRecordingIntentResponse {
        let (data, response) = try await URLSession.shared.data(
            for: manualIntentRequest()
        )
        try validateHTTPResponse(response)

        return try JSONDecoder.localRecorder.decode(
            ManualRecordingIntentResponse.self,
            from: data
        )
    }

    public func claimRequest(fallbackIntentId: String) throws -> URLRequest {
        var request = URLRequest(
            url: serverURL.appending(
                path: "/api/local-recorder/intents/\(fallbackIntentId)/start"
            )
        )
        request.httpMethod = "POST"
        applyRecorderHeaders(to: &request)
        return request
    }

    public func claimIntent(fallbackIntentId: String) async throws -> ClaimIntentResponse {
        let (data, response) = try await URLSession.shared.data(
            for: claimRequest(fallbackIntentId: fallbackIntentId)
        )
        try validateHTTPResponse(response)

        return try JSONDecoder.localRecorder.decode(ClaimIntentResponse.self, from: data)
    }

    public func failIntentRequest(
        fallbackIntentId: String,
        errorMessage: String
    ) throws -> URLRequest {
        var request = URLRequest(
            url: serverURL.appending(
                path: "/api/local-recorder/intents/\(fallbackIntentId)/fail"
            )
        )
        request.httpMethod = "POST"
        applyRecorderHeaders(to: &request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.localRecorder.encode(
            FailIntentRequest(errorMessage: errorMessage)
        )
        return request
    }

    public func failIntent(
        fallbackIntentId: String,
        errorMessage: String
    ) async throws {
        let request = try failIntentRequest(
            fallbackIntentId: fallbackIntentId,
            errorMessage: errorMessage
        )
        let (_, response) = try await URLSession.shared.data(for: request)
        try validateHTTPResponse(response)
    }

    public func prepareUploadRequest(payload: LocalRecordingUploadPayload) throws -> URLRequest {
        var request = URLRequest(
            url: serverURL.appending(path: "/api/local-recorder/recordings/prepare")
        )
        request.httpMethod = "POST"
        applyRecorderHeaders(to: &request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.localRecorder.encode(
            UploadMetadataRequest(payload: payload)
        )
        return request
    }

    public func prepareRecordingUpload(
        payload: LocalRecordingUploadPayload
    ) async throws -> PreparedLocalRecordingUploadResponse {
        let request = try prepareUploadRequest(payload: payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validateHTTPResponse(response)

        return try JSONDecoder.localRecorder.decode(
            PreparedLocalRecordingUploadResponse.self,
            from: data
        )
    }

    public func recallSDKUploadRequest(
        fallbackIntentId: String,
        clientRecordingId: String
    ) throws -> URLRequest {
        var request = URLRequest(
            url: serverURL.appending(path: "/api/local-recorder/recordings/sdk-upload")
        )
        request.httpMethod = "POST"
        applyRecorderHeaders(to: &request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.localRecorder.encode(
            RecallSDKUploadRequest(
                fallbackIntentId: fallbackIntentId,
                clientRecordingId: clientRecordingId
            )
        )
        return request
    }

    public func createRecallSDKUpload(
        fallbackIntentId: String,
        clientRecordingId: String
    ) async throws -> RecallSDKUploadResponse {
        let request = try recallSDKUploadRequest(
            fallbackIntentId: fallbackIntentId,
            clientRecordingId: clientRecordingId
        )
        let (data, response) = try await URLSession.shared.data(for: request)
        try validateHTTPResponse(response)

        return try JSONDecoder.localRecorder.decode(
            RecallSDKUploadResponse.self,
            from: data
        )
    }

    public func recallSDKFallbackRequest(
        fallbackIntentId: String
    ) throws -> URLRequest {
        var request = URLRequest(
            url: serverURL.appending(
                path: "/api/local-recorder/recordings/sdk-upload/fallback"
            )
        )
        request.httpMethod = "POST"
        applyRecorderHeaders(to: &request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.localRecorder.encode(
            RecallSDKFallbackRequest(fallbackIntentId: fallbackIntentId)
        )
        return request
    }

    public func markRecallSDKFallback(fallbackIntentId: String) async throws {
        let request = try recallSDKFallbackRequest(
            fallbackIntentId: fallbackIntentId
        )
        let (_, response) = try await URLSession.shared.data(for: request)
        try validateHTTPResponse(response)
    }

    public func directUploadRequest(
        uploadURL: URL,
        contentType: String
    ) -> URLRequest {
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        return request
    }

    public func uploadPreparedRecordingAssets(
        payload: LocalRecordingUploadPayload,
        preparedUpload: PreparedLocalRecordingUploadResponse
    ) async throws {
        try await uploadPreparedAsset(
            fileURL: payload.computerAudioURL,
            asset: preparedUpload.assets.computerAudio
        )
        try await uploadPreparedAsset(
            fileURL: payload.microphoneAudioURL,
            asset: preparedUpload.assets.microphoneAudio
        )
        try await uploadPreparedAsset(
            fileURL: payload.synthesizedAudioURL,
            asset: preparedUpload.assets.synthesizedAudio
        )
    }

    public func completeUploadRequest(payload: LocalRecordingUploadPayload) throws -> URLRequest {
        guard let uploadAssets = payload.uploadAssets else {
            throw LocalRecorderAPIError.missingPreparedUpload
        }

        var request = URLRequest(
            url: serverURL.appending(path: "/api/local-recorder/recordings/complete")
        )
        request.httpMethod = "POST"
        applyRecorderHeaders(to: &request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.localRecorder.encode(
            CompleteUploadRequest(payload: payload, assets: uploadAssets)
        )
        return request
    }

    public func completeRecordingUpload(
        payload: LocalRecordingUploadPayload
    ) async throws -> LocalRecordingUploadResponse {
        let request = try completeUploadRequest(payload: payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validateHTTPResponse(response)

        return try JSONDecoder.localRecorder.decode(
            LocalRecordingUploadResponse.self,
            from: data
        )
    }

    private func applyRecorderHeaders(to request: inout URLRequest) {
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        request.setValue(deviceId, forHTTPHeaderField: "x-local-recorder-device-id")
    }

    private func validateHTTPResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LocalRecorderAPIError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw LocalRecorderAPIError.httpStatus(httpResponse.statusCode)
        }
    }

    private func uploadPreparedAsset(
        fileURL: URL,
        asset: PreparedLocalRecordingUploadAsset
    ) async throws {
        let request = directUploadRequest(
            uploadURL: asset.uploadUrl,
            contentType: asset.contentType
        )
        let (_, response) = try await URLSession.shared.upload(
            for: request,
            fromFile: fileURL
        )
        try validateHTTPResponse(response)
    }
}

public enum LocalRecorderAPIError: Error, Equatable {
    case invalidResponse
    case httpStatus(Int)
    case missingPreparedUpload
}

public enum LocalRecorderLoginCallbackError: Error, Equatable {
    case invalidCallback
}

@MainActor
public final class LocalRecorderExternalURLDispatcher {
    private var handler: ((URL) -> Void)?
    private var queuedURLs: [URL] = []

    public init() {}

    public func setHandler(_ handler: @escaping (URL) -> Void) {
        self.handler = handler
        let urls = queuedURLs
        queuedURLs.removeAll()
        urls.forEach(handler)
    }

    public func openURLs(_ urls: [URL]) {
        guard let handler else {
            queuedURLs.append(contentsOf: urls)
            return
        }

        urls.forEach(handler)
    }
}

public func makeLocalRecorderBrowserLoginURL(serverURL: URL, deviceId: String) -> URL? {
    var deviceLoginComponents = URLComponents()
    deviceLoginComponents.path = "/api/local-recorder/device-login"
    deviceLoginComponents.percentEncodedQuery = [
        "deviceId=\(percentEncodeQueryValue(deviceId))",
        "callbackUrl=meetingnote-local-recorder%3A%2F%2Flogin",
    ].joined(separator: "&")

    guard let deviceLoginCallback = deviceLoginComponents.string else {
        return nil
    }

    var signInComponents = URLComponents(
        url: serverURL.appending(path: "/auth/sign-in"),
        resolvingAgainstBaseURL: false
    )
    signInComponents?.percentEncodedQuery =
        "callbackUrl=\(percentEncodeQueryValue(deviceLoginCallback))"

    return signInComponents?.url
}

private let queryValueAllowedCharacters = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
)

private func percentEncodeQueryValue(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: queryValueAllowedCharacters) ?? ""
}

public struct LocalRecorderLoginCallback: Equatable, Sendable {
    public var serverURL: URL
    public var token: String

    public init(url: URL) throws {
        guard
            url.scheme == "meetingnote-local-recorder",
            url.host == "login",
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else {
            throw LocalRecorderLoginCallbackError.invalidCallback
        }

        let queryItems = components.queryItems ?? []
        let token = queryItems.first { $0.name == "token" }?.value?.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        let server = queryItems.first { $0.name == "server" }?.value?.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        guard
            let token,
            !token.isEmpty,
            let server,
            let serverURL = URL(string: server),
            serverURL.scheme == "https"
        else {
            throw LocalRecorderLoginCallbackError.invalidCallback
        }

        self.serverURL = serverURL
        self.token = token
    }
}

public struct LocalRecorderCredentials: Codable, Equatable, Sendable {
    public var serverURLText: String
    public var bearerToken: String

    public init(serverURLText: String, bearerToken: String) {
        self.serverURLText = serverURLText
        self.bearerToken = bearerToken
    }
}

public enum LocalRecorderKeychainCredentialStoreError: Error, Equatable {
    case invalidKeychainData
    case keychainStatus(OSStatus)
}

public struct LocalRecorderKeychainCredentialStore: Sendable {
    public var service: String
    public var account: String

    public init(
        service: String = "tech.inevitable.meeting-note.local-recorder",
        account: String = "device-session"
    ) {
        self.service = service
        self.account = account
    }

    public func load() throws -> LocalRecorderCredentials? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound {
            return nil
        }

        guard status == errSecSuccess else {
            throw LocalRecorderKeychainCredentialStoreError.keychainStatus(status)
        }

        guard let data = item as? Data else {
            throw LocalRecorderKeychainCredentialStoreError.invalidKeychainData
        }

        do {
            return try JSONDecoder.localRecorder.decode(LocalRecorderCredentials.self, from: data)
        } catch {
            throw LocalRecorderKeychainCredentialStoreError.invalidKeychainData
        }
    }

    public func save(_ credentials: LocalRecorderCredentials) throws {
        let data = try JSONEncoder.localRecorder.encode(credentials)
        try delete()

        var attributes = baseQuery()
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        attributes[kSecValueData as String] = data

        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw LocalRecorderKeychainCredentialStoreError.keychainStatus(status)
        }
    }

    public func delete() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw LocalRecorderKeychainCredentialStoreError.keychainStatus(status)
        }
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

public struct MissedMeetingsResponse: Codable, Equatable, Sendable {
    public var meetings: [MissedMeeting]
}

public struct LocalRecorderMonitoringResponse: Codable, Equatable, Sendable {
    public var nextMeeting: LocalRecorderMonitoringMeeting?
    public var missedMeetings: [MissedMeeting]
}

public struct LocalRecorderMonitoringMeeting: Codable, Identifiable, Equatable, Sendable {
    public var botStatus: String
    public var botStatusDetail: String
    public var botStatusLabel: String
    public var endsAt: Date?
    public var meetingId: String
    public var startsAt: Date
    public var title: String

    public var id: String { meetingId }

    public func isOngoing(at date: Date) -> Bool {
        guard startsAt <= date else {
            return false
        }

        guard let endsAt else {
            return true
        }

        return endsAt >= date
    }
}

public enum LocalRecorderMonitoringPollSchedule {
    public static let fallbackGraceDuration: TimeInterval = 70
    public static let activeMeetingInterval: TimeInterval = 60
    public static let idleInterval: TimeInterval = 60 * 60

    public static func nextDelay(
        now: Date,
        nextMeeting: LocalRecorderMonitoringMeeting?,
        pendingMeetings: [MissedMeeting]
    ) -> TimeInterval {
        if !pendingMeetings.isEmpty {
            return activeMeetingInterval
        }

        guard let nextMeeting else {
            return idleInterval
        }

        let fallbackCheckAt = nextMeeting.startsAt.addingTimeInterval(
            fallbackGraceDuration
        )

        if now < fallbackCheckAt {
            return max(1, fallbackCheckAt.timeIntervalSince(now))
        }

        guard let endsAt = nextMeeting.endsAt else {
            return activeMeetingInterval
        }

        if endsAt >= now {
            return activeMeetingInterval
        }

        return idleInterval
    }
}

public enum LocalRecorderNotificationBackoffSchedule {
    public static let repeatedNotificationDelays: [TimeInterval] = [
        2 * 60,
        4 * 60,
        8 * 60,
        16 * 60,
        32 * 60,
        64 * 60,
    ]

    public static func nextDelay(
        afterNotificationCount notificationCount: Int,
        now: Date,
        meeting: MissedMeeting
    ) -> TimeInterval? {
        let windowEnd = notificationWindowEndsAt(for: meeting)
        guard now < windowEnd else {
            return nil
        }

        let delayIndex = min(
            max(notificationCount - 1, 0),
            repeatedNotificationDelays.count - 1
        )
        let delay = repeatedNotificationDelays[delayIndex]

        return min(delay, max(1, windowEnd.timeIntervalSince(now)))
    }

    public static func canNotify(meeting: MissedMeeting, at date: Date) -> Bool {
        date < notificationWindowEndsAt(for: meeting)
    }

    private static func notificationWindowEndsAt(for meeting: MissedMeeting) -> Date {
        guard let meetingEndsAt = meeting.displayTimeWindow.endsAt else {
            return meeting.expiresAt
        }

        return min(meetingEndsAt, meeting.expiresAt)
    }
}

public struct ManualRecordingIntentResponse: Codable, Equatable, Sendable {
    public var fallbackIntentId: String
    public var meetingTitle: String?
}

public struct MissedMeeting: Codable, Identifiable, Equatable, Sendable {
    public var fallbackIntentId: String
    public var title: String
    public var expiresAt: Date
    public var displayTimeWindow: DisplayTimeWindow

    public var id: String { fallbackIntentId }
}

public struct DisplayTimeWindow: Codable, Equatable, Sendable {
    public var startsAt: Date
    public var endsAt: Date?
}

public struct ClaimIntentResponse: Codable, Equatable, Sendable {
    public var claimed: Bool
    public var meetingTitle: String?
    public var reason: String?
}

public struct LocalRecordingUploadPayload: Codable, Equatable, Sendable {
    public var fallbackIntentId: String
    public var clientRecordingId: String
    public var recordingStartedAt: Date
    public var recordingStoppedAt: Date
    public var computerAudioURL: URL
    public var microphoneAudioURL: URL
    public var synthesizedAudioURL: URL
    public var uploadAssets: LocalRecordingUploadAssetIds?
    public var manifest: RecordingManifest

    public init(
        fallbackIntentId: String,
        clientRecordingId: String,
        recordingStartedAt: Date,
        recordingStoppedAt: Date,
        computerAudioURL: URL,
        microphoneAudioURL: URL,
        synthesizedAudioURL: URL,
        uploadAssets: LocalRecordingUploadAssetIds? = nil,
        manifest: RecordingManifest
    ) {
        self.fallbackIntentId = fallbackIntentId
        self.clientRecordingId = clientRecordingId
        self.recordingStartedAt = recordingStartedAt
        self.recordingStoppedAt = recordingStoppedAt
        self.computerAudioURL = computerAudioURL
        self.microphoneAudioURL = microphoneAudioURL
        self.synthesizedAudioURL = synthesizedAudioURL
        self.uploadAssets = uploadAssets
        self.manifest = manifest
    }
}

public struct LocalRecordingUploadQueue: Sendable {
    public var directoryURL: URL

    public init(directoryURL: URL) {
        self.directoryURL = directoryURL
    }

    public func save(_ payload: LocalRecordingUploadPayload) throws {
        try FileManager.default.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true
        )
        try JSONEncoder.localRecorder
            .encode(payload)
            .write(to: itemURL(clientRecordingId: payload.clientRecordingId), options: .atomic)
    }

    public func load() throws -> [LocalRecordingUploadPayload] {
        guard FileManager.default.fileExists(atPath: directoryURL.path) else {
            return []
        }

        let itemURLs = try FileManager.default.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: nil
        )
        let payloads = try itemURLs
            .filter { $0.pathExtension == "json" }
            .map { url in
                try JSONDecoder.localRecorder.decode(
                    LocalRecordingUploadPayload.self,
                    from: Data(contentsOf: url)
                )
            }

        return payloads.sorted {
            $0.recordingStartedAt < $1.recordingStartedAt
        }
    }

    public func remove(clientRecordingId: String) throws {
        let url = itemURL(clientRecordingId: clientRecordingId)
        guard FileManager.default.fileExists(atPath: url.path) else {
            return
        }

        try FileManager.default.removeItem(at: url)
    }

    private func itemURL(clientRecordingId: String) -> URL {
        let allowed = CharacterSet.alphanumerics.union(
            CharacterSet(charactersIn: "-_")
        )
        let filename = clientRecordingId.unicodeScalars
            .map { allowed.contains($0) ? String($0) : "_" }
            .joined()
        return directoryURL.appending(path: "\(filename.isEmpty ? "recording" : filename).json")
    }
}

public struct LocalRecordingUploadResponse: Codable, Equatable, Sendable {
    public var localRecordingId: String?
    public var meetingId: String
    public var queued: Bool
}

public struct LocalRecordingUploadAssetIds: Codable, Equatable, Sendable {
    public var computerAudioAssetId: String
    public var microphoneAudioAssetId: String
    public var synthesizedAudioAssetId: String

    public init(
        computerAudioAssetId: String,
        microphoneAudioAssetId: String,
        synthesizedAudioAssetId: String
    ) {
        self.computerAudioAssetId = computerAudioAssetId
        self.microphoneAudioAssetId = microphoneAudioAssetId
        self.synthesizedAudioAssetId = synthesizedAudioAssetId
    }
}

public struct PreparedLocalRecordingUploadResponse: Codable, Equatable, Sendable {
    public var assets: PreparedLocalRecordingUploadAssets
}

public struct PreparedLocalRecordingUploadAssets: Codable, Equatable, Sendable {
    public var computerAudio: PreparedLocalRecordingUploadAsset
    public var microphoneAudio: PreparedLocalRecordingUploadAsset
    public var synthesizedAudio: PreparedLocalRecordingUploadAsset

    public var assetIds: LocalRecordingUploadAssetIds {
        LocalRecordingUploadAssetIds(
            computerAudioAssetId: computerAudio.assetId,
            microphoneAudioAssetId: microphoneAudio.assetId,
            synthesizedAudioAssetId: synthesizedAudio.assetId
        )
    }
}

public struct PreparedLocalRecordingUploadAsset: Codable, Equatable, Sendable {
    public var assetId: String
    public var contentType: String
    public var uploadUrl: URL
}

private struct UploadMetadataRequest: Codable {
    var fallbackIntentId: String
    var clientRecordingId: String
    var recordingStartedAt: Date
    var recordingStoppedAt: Date
    var manifest: RecordingManifest

    init(payload: LocalRecordingUploadPayload) {
        self.fallbackIntentId = payload.fallbackIntentId
        self.clientRecordingId = payload.clientRecordingId
        self.recordingStartedAt = payload.recordingStartedAt
        self.recordingStoppedAt = payload.recordingStoppedAt
        self.manifest = payload.manifest
    }
}

private struct RecallSDKUploadRequest: Codable {
    var fallbackIntentId: String
    var clientRecordingId: String
}

private struct RecallSDKFallbackRequest: Codable {
    var fallbackIntentId: String
}

public struct RecallSDKUploadResponse: Codable, Equatable, Sendable {
    public var fallbackIntentId: String
    public var meetingId: String
    public var recallApiUrl: String
    public var sdkUploadId: String
    public var uploadToken: String
}

public enum RecallDesktopSDKStopAcknowledgementError: LocalizedError, Equatable {
    case failed(String)

    public var errorDescription: String? {
        switch self {
        case .failed(let message):
            return message
        }
    }
}

public enum RecallDesktopSDKStopAcknowledgement {
    public static func validate(output: String, terminationStatus: Int32) throws {
        var stopped = false
        var reportedError: String?

        for line in output.split(whereSeparator: \.isNewline) {
            guard
                let data = String(line).data(using: .utf8),
                let message = try? JSONDecoder().decode(SidecarMessage.self, from: data)
            else {
                continue
            }

            if message.type == "stopped" {
                stopped = true
            } else if message.type == "error", let detail = message.message, !detail.isEmpty {
                reportedError = detail
            }
        }

        if let reportedError {
            throw RecallDesktopSDKStopAcknowledgementError.failed(reportedError)
        }

        guard terminationStatus == 0, stopped else {
            throw RecallDesktopSDKStopAcknowledgementError.failed(
                "Recall Desktop SDK did not confirm that recording stopped"
            )
        }
    }

    private struct SidecarMessage: Decodable {
        var type: String
        var message: String?
    }
}

private struct CompleteUploadRequest: Codable {
    var fallbackIntentId: String
    var clientRecordingId: String
    var recordingStartedAt: Date
    var recordingStoppedAt: Date
    var manifest: RecordingManifest
    var assets: LocalRecordingUploadAssetIds

    init(payload: LocalRecordingUploadPayload, assets: LocalRecordingUploadAssetIds) {
        self.fallbackIntentId = payload.fallbackIntentId
        self.clientRecordingId = payload.clientRecordingId
        self.recordingStartedAt = payload.recordingStartedAt
        self.recordingStoppedAt = payload.recordingStoppedAt
        self.manifest = payload.manifest
        self.assets = assets
    }
}

private struct FailIntentRequest: Codable {
    var errorMessage: String
}

public struct RecordingManifest: Codable, Equatable, Sendable {
    public var appVersion: String
    public var computerAudio: TrackMetadata
    public var microphoneAudio: TrackMetadata
    public var activityWindows: [LocalRecorderActivityWindow]

    private enum CodingKeys: String, CodingKey {
        case appVersion
        case computerAudio
        case microphoneAudio
        case activityWindows
    }

    public init(
        appVersion: String,
        computerAudio: TrackMetadata,
        microphoneAudio: TrackMetadata,
        activityWindows: [LocalRecorderActivityWindow] = []
    ) {
        self.appVersion = appVersion
        self.computerAudio = computerAudio
        self.microphoneAudio = microphoneAudio
        self.activityWindows = activityWindows
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.appVersion = try container.decode(String.self, forKey: .appVersion)
        self.computerAudio = try container.decode(TrackMetadata.self, forKey: .computerAudio)
        self.microphoneAudio = try container.decode(TrackMetadata.self, forKey: .microphoneAudio)
        self.activityWindows =
            try container.decodeIfPresent([LocalRecorderActivityWindow].self, forKey: .activityWindows) ?? []
    }
}

public struct TrackMetadata: Codable, Equatable, Sendable {
    public var captureStartedAt: Date
    public var captureStoppedAt: Date
    public var sampleRate: Double
    public var channelCount: Int
    public var codec: String
    public var container: String
    public var firstSampleTime: Double

    public init(
        captureStartedAt: Date,
        captureStoppedAt: Date,
        sampleRate: Double,
        channelCount: Int,
        codec: String,
        container: String,
        firstSampleTime: Double
    ) {
        self.captureStartedAt = captureStartedAt
        self.captureStoppedAt = captureStoppedAt
        self.sampleRate = sampleRate
        self.channelCount = channelCount
        self.codec = codec
        self.container = container
        self.firstSampleTime = firstSampleTime
    }
}

public extension JSONEncoder {
    static var localRecorder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

public extension JSONDecoder {
    static var localRecorder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let fractionalFormatter = ISO8601DateFormatter()
            fractionalFormatter.formatOptions = [
                .withInternetDateTime,
                .withFractionalSeconds,
            ]
            let standardFormatter = ISO8601DateFormatter()
            standardFormatter.formatOptions = [.withInternetDateTime]

            if let date = fractionalFormatter.date(from: value) ??
                standardFormatter.date(from: value) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO8601 date"
            )
        }
        return decoder
    }
}
