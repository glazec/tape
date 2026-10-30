import AppKit
import ApplicationServices
import AVFoundation
import Foundation
import LocalRecorderCore
import OSLog
@preconcurrency import ScreenCaptureKit
import ServiceManagement
import Sparkle
import SwiftUI
@preconcurrency import UserNotifications

private let activationLogger = Logger(
    subsystem: "tech.inevitable.meeting-note.local-recorder",
    category: "activation"
)

private enum LocalRecorderAppVersion {
    static var current: String {
        let version = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "development"
        let build = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleVersion"
        ) as? String

        guard let build, !build.isEmpty else {
            return version
        }

        return "\(version)+\(build)"
    }
}

@MainActor
private let externalURLDispatcher = LocalRecorderExternalURLDispatcher()

@MainActor
private final class LocalRecorderUpdater {
    static let shared = LocalRecorderUpdater()

    private let controller = SPUStandardUpdaterController(
        startingUpdater: true,
        updaterDelegate: nil,
        userDriverDelegate: nil
    )

    func checkForUpdates() {
        controller.checkForUpdates(nil)
    }
}

private final class LocalRecorderAppDelegate: NSObject, NSApplicationDelegate {
    private var recorderWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        activationLogger.notice("Recorder launched")
        showRecorderWindow()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        recorderAppModel.canCloseApp(allowPendingUploads: true) ? .terminateNow : .terminateCancel
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showRecorderWindow()
        return true
    }

    @MainActor
    private func showRecorderWindow() {
        if recorderWindow == nil {
            let controller = NSHostingController(rootView: RecorderMenuView(model: recorderAppModel, showsWindowChrome: true))
            controller.safeAreaRegions = []
            let window = NSWindow(contentViewController: controller)
            window.title = "Tape Desktop"
            window.styleMask = [.titled, .closable, .miniaturizable]
            RecorderWindowChrome.apply(to: window)
            window.isReleasedWhenClosed = false
            window.center()
            recorderWindow = window
        }
        recorderWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        activationLogger.notice("Recorder setup window shown")
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        Task { @MainActor in
            externalURLDispatcher.openURLs(urls)
            self.showRecorderWindow()
        }
    }
}

enum ActiveRecordingBackend: Equatable {
    case recallDesktopSDK
    case localUpload
}

enum RecorderPermissionStep {
    case microphone
    case accessibility
    case screenAndSystemAudio
    case alerts

    init(_ permission: OperationalPermission) {
        switch permission {
        case .microphone:
            self = .microphone
        case .screenCapture:
            self = .screenAndSystemAudio
        case .accessibility:
            self = .accessibility
        case .notifications:
            self = .alerts
        }
    }

    var actionTitle: String {
        switch self {
        case .microphone:
            return "Grant microphone"
        case .accessibility:
            return "Grant accessibility"
        case .screenAndSystemAudio:
            return "Grant screen and audio"
        case .alerts:
            return "Allow alerts"
        }
    }

    var statusTitle: String {
        switch self {
        case .microphone:
            return "Microphone needed"
        case .accessibility:
            return "Accessibility needed"
        case .screenAndSystemAudio:
            return "Screen access needed"
        case .alerts:
            return "Alerts needed"
        }
    }

    var statusDetail: String {
        switch self {
        case .microphone:
            return "Allow microphone access"
        case .accessibility:
            return "Allow meeting window detection"
        case .alerts:
            return "Allow meeting notifications"
        case .screenAndSystemAudio:
            return "Allow screen and system audio capture"
        }
    }

    var systemImage: String {
        switch self {
        case .microphone:
            return "mic.badge.plus"
        case .accessibility:
            return "figure.wave"
        case .screenAndSystemAudio:
            return "speaker.wave.2"
        case .alerts:
            return "bell.badge"
        }
    }
}

@MainActor
private let recorderAppModel = RecorderAppModel()

@main
enum MeetingNoteLocalRecorderEntry {
    @MainActor
    static func main() {
        TapeType.register()
        #if DEBUG
        if let directory = ProcessInfo.processInfo.environment["TAPE_DESKTOP_SNAPSHOT_DIR"] {
            LocalRecorderSnapshot.render(to: URL(fileURLWithPath: directory))
            return
        }
        #endif
        LocalRecorderTelemetry.start(
            dsn: Bundle.main.object(forInfoDictionaryKey: "SentryDSN") as? String,
            environment: Bundle.main.object(forInfoDictionaryKey: "SentryEnvironment") as? String ?? "development",
            release: "tape-desktop@\(LocalRecorderAppVersion.current)"
        )
        MeetingNoteLocalRecorderApp.main()
    }
}

struct MeetingNoteLocalRecorderApp: App {
    @NSApplicationDelegateAdaptor(LocalRecorderAppDelegate.self) private var appDelegate
    @StateObject private var model = recorderAppModel
    private let updater = LocalRecorderUpdater.shared

    var body: some Scene {
        MenuBarExtra("Tape Desktop", systemImage: model.menuBarImage) {
            RecorderMenuView(model: model)
        }
        .menuBarExtraStyle(.window)
    }
}

@MainActor
final class RecorderAppModel: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    private static let audioLevelSampleCount = 36

    @Published var audioLevels = Array(repeating: Float(0), count: audioLevelSampleCount)
    @Published var activeRecordingTitle: String?
    @Published var permissionChecklist = PermissionChecklist(
        microphone: .unknown,
        screenCapture: .unknown,
        accessibility: .unknown,
        notifications: .unknown,
        startAtLogin: .unknown
    )
    @Published var statusText = "Sign in to start monitoring"
    @Published var serverURLText: String
    @Published var account: LocalRecorderAccount?
    @Published var bearerToken: String
    @Published var isRecording = false {
        didSet {
            recordingStartedAt = isRecording ? (recordingStartedAt ?? Date()) : nil
        }
    }
    @Published var recordingStartedAt: Date?
    @Published var isTestingLevels = false
    @Published var isRequestingPermissions = false
    @Published var isRestarting = false
    @Published var availableMicrophones: [AudioInputDevice] = []
    @Published var selectedMicrophoneUID: String?
    @Published var microphoneLevel: Float = 0
    @Published var systemAudioLevel: Float = 0
    @Published var isFinishingRecording = false
    @Published var isRefreshingSchedule = false
    @Published var isAdvancedExpanded = false
    @Published var nextScheduleMeeting: LocalRecorderMonitoringMeeting?
    @Published var pendingMeetings: [MissedMeeting] = []

    private static let microphoneDefaultsKey = "meeting-note-local-recorder-microphone-uid"
    private static let builtInMicrophoneUID = "BuiltInMicrophoneDevice"
    private static let pendingMeetingsDefaultsKey =
        "meeting-note-local-recorder-pending-meetings"

    let appVersion = LocalRecorderAppVersion.current
    let captureController = LocalRecordingCaptureController()
    let recallSDKController = RecallDesktopSDKRecordingController()
    private let credentialStore: LocalRecorderKeychainCredentialStore
    private let deviceIdStore = DeviceIdStore()
    lazy var notificationCenter = UNUserNotificationCenter.current()
    let uploadQueue: LocalRecordingUploadQueue
    var activeClient: LocalRecorderAPIClient?
    var activeFallbackIntentId: String?
    var activeRecordingBackend: ActiveRecordingBackend?
    var isUploadingQueuedRecordings = false
    private var queuedUploadRetryAfter: Date?
    private var appActivationObserver: NSObjectProtocol?
    private var levelTestSession: AudioLevelTestSession?
    private var levelTestTimeoutTask: Task<Void, Never>?
    private var recallSDKMeterSession: AudioLevelTestSession?
    var recallSDKMeterGeneration = 0
    private var monitoringTimer: Timer?
    private var permissionRefreshTask: Task<Void, Never>?
    private var fallbackNotificationCountsByIntentId: [String: Int] = [:]
    private var fallbackNotificationNextDatesByIntentId: [String: Date] = [:]
    var endPromptPolicy = RecorderEndPromptPolicy(scheduledEnd: nil)
    @Published var isStartingRecording = false
    @Published var isSwitchingMeeting = false
    @Published var destinationUnconfirmed = false
    @Published var isMeetingPickerPresented = false
    @Published var meetingChoices: [RecordingMeeting] = []
    @Published var meetingSearch = ""
    @Published var meetingChoicesHaveMore = false
    @Published var isLoadingMeetingChoices = false
    @Published var meetingPickerError: String?
    @Published var endPrompt: RecorderEndPrompt?
    @Published var pendingUploadCount = 0
    @Published var uploadStatusText: String?
    var activeTarget: RecordingTarget?
    var captureSessionID: String?
    var captureNaturallyEnded = false
    var recoveryState = RecorderCaptureRecovery()
    var sdkDrainTasks: [String: Task<Void, Never>] = [:]
    var meetingSearchGeneration = 0
    var recordingAudioGeneration = 0
    var retainedStoppedPayload: LocalRecordingUploadPayload?


    #if DEBUG
    init(snapshotBearerToken: String) {
        self.credentialStore = LocalRecorderKeychainCredentialStore(service: "snapshot", account: "snapshot")
        self.uploadQueue = LocalRecordingUploadQueue(
            directoryURL: FileManager.default.temporaryDirectory.appendingPathComponent("tape-snapshot-queue")
        )
        self.serverURLText = "https://tape.example"
        self.bearerToken = snapshotBearerToken
        super.init()
    }
    #endif

    override init() {
        let credentialStore = LocalRecorderKeychainCredentialStore()
        let credentials = recoverLocalRecorderCredentials(try? credentialStore.load())
        self.credentialStore = credentialStore
        self.uploadQueue = LocalRecordingUploadQueue(
            directoryURL: LocalRecorderFileLocations.uploadQueueDirectoryURL()
        )
        self.serverURLText = initialLocalRecorderServerURLText(credentials: credentials)
        self.bearerToken = credentials?.bearerToken ?? ""
        super.init()
        loadPersistedPendingMeetings()
        recallSDKController.onUnexpectedTermination = { [weak self] id in
            Task { @MainActor in
                guard self?.captureSessionID == id else { return }
                await self?.recoverFromUnexpectedRecallSDKStop()
            }
        }
        loadMicrophoneSelection()
        externalURLDispatcher.setHandler { [weak self] url in
            self?.handleLoginCallback(url)
        }
        notificationCenter.delegate = self
        configureRecordingWorkflow()
        appActivationObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                await self?.refreshPermissionsAndStartIfReady()
            }
        }
        if !bearerToken.isEmpty {
            statusText = "Finish access setup"
            Task {
                await refreshPermissionsAndStartIfReady()
            }
            Task {
                await retryQueuedUploadsIfPossible()
            }
        } else {
            Task {
                await refreshPermissions()
            }
        }
    }

    var menuBarImage: String {
        isRecording ? "record.circle.fill" : "waveform"
    }

    var isSignedIn: Bool {
        !bearerToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var hasAudioCapturePermissions: Bool {
        permissionChecklist.canCaptureAudio
    }

    var nextPermissionStep: RecorderPermissionStep? {
        guard isSignedIn else {
            return nil
        }

        return permissionChecklist.nextRequiredPermission.map(RecorderPermissionStep.init)
    }

    var canMonitor: Bool {
        isSignedIn && permissionChecklist.canMonitor
    }

    func signIn() {
        guard let serverURL = URL(string: serverURLText) else {
            statusText = "Enter a valid server URL"
            return
        }

        guard
            let url = makeLocalRecorderBrowserLoginURL(
                serverURL: serverURL,
                deviceId: deviceIdStore.deviceId
            )
        else {
            statusText = "Enter a valid server URL"
            return
        }

        if NSWorkspace.shared.open(url) {
            activationLogger.notice("Browser sign in opened")
            statusText = "Complete login in your browser"
        } else {
            activationLogger.error("Browser sign in could not open")
            statusText = "Could not open your browser. Try again."
        }
    }

    func handleLoginCallback(_ url: URL) {
        do {
            let callback = try LocalRecorderLoginCallback(url: url)
            try credentialStore.save(
                LocalRecorderCredentials(
                    serverURLText: callback.serverURL.absoluteString,
                    bearerToken: callback.token
                )
            )
            account = nil
            serverURLText = callback.serverURL.absoluteString
            bearerToken = callback.token
            activationLogger.notice("Sign in saved")
            statusText = "Finish access setup"
            Task {
                await refreshPermissionsAndStartIfReady()
            }
        } catch {
            activationLogger.error("Sign in callback could not be saved")
            statusText = "Could not finish login. Try signing in again."
        }
    }

    func makeClient() -> LocalRecorderAPIClient? {
        guard let serverURL = URL(string: serverURLText) else {
            return nil
        }

        return LocalRecorderAPIClient(
            serverURL: serverURL,
            bearerToken: bearerToken,
            deviceId: deviceIdStore.deviceId,
            appVersion: appVersion,
            permissionReadiness: permissionReadinessReport
        )
    }

    private var permissionReadinessReport: [String: String] {
        [
            "microphone": permissionChecklist.microphone.reportValue,
            "screenCapture": permissionChecklist.screenCapture.reportValue,
            "accessibility": permissionChecklist.accessibility.reportValue,
            "notifications": permissionChecklist.notifications.reportValue,
            "startAtLogin": permissionChecklist.startAtLogin.reportValue,
        ]
    }

    private func retryQueuedUploadsIfPossible() async {
        guard let client = makeClient() else {
            return
        }

        await uploadQueuedRecordings(client: client)
    }

    func uploadQueuedRecordings(client: LocalRecorderAPIClient) async {
        guard !isUploadingQueuedRecordings else {
            return
        }
        if let queuedUploadRetryAfter, queuedUploadRetryAfter > Date() {
            return
        }

        let queuedPayloads: [LocalRecordingUploadPayload]
        do {
            queuedPayloads = try uploadQueue.load()
        } catch {
            uploadStatusText = "Could not read saved recordings"
            return
        }

        guard !queuedPayloads.isEmpty else {
            return
        }

        isUploadingQueuedRecordings = true
        defer {
            isUploadingQueuedRecordings = false
            refreshPendingUploadCount()
        }

        uploadStatusText = "Uploading saved recordings"
        for payload in queuedPayloads {
            let client = makeClient() ?? client
            do {
                try await uploadWithRetry(client: client, payload: payload)
                try uploadQueue.remove(clientRecordingId: payload.clientRecordingId)
                cleanupRecordingFiles(for: payload)
            } catch {
                await handleUploadFailure(
                    client: client,
                    payload: payload,
                    error: error
                )
                return
            }
        }

        queuedUploadRetryAfter = nil
        uploadStatusText = "Saved recordings uploaded"
    }

    private func cleanupRecordingFiles(for payload: LocalRecordingUploadPayload) {
        try? FileManager.default.removeItem(
            at: payload.computerAudioURL.deletingLastPathComponent()
        )
    }

    func requestNextPermission() {
        requestPermission(nextPermissionStep)
    }

    func requestPermission(_ permission: OperationalPermission) {
        requestPermission(RecorderPermissionStep(permission))
    }

    func setStartAtLoginEnabled(_ isEnabled: Bool) {
        let service = SMAppService.mainApp

        do {
            if isEnabled {
                if service.status == .notRegistered || service.status == .notFound {
                    try service.register()
                }
            } else if service.status == .enabled || service.status == .requiresApproval {
                try service.unregister()
            }
        } catch {
            permissionChecklist.startAtLogin = currentStartAtLoginPermission()
            statusText = isEnabled
                ? "Could not enable start at login"
                : "Could not disable start at login"
            if service.status == .requiresApproval {
                openLoginItemsSettings()
            }
            return
        }

        permissionChecklist.startAtLogin = currentStartAtLoginPermission()
        if isEnabled, service.status == .requiresApproval {
            statusText = "Allow Tape Desktop in Login Items"
            openLoginItemsSettings()
        } else {
            statusText = isEnabled ? "Starts at login" : "Start at login off"
        }
    }

    private func requestPermission(_ requestedStep: RecorderPermissionStep?) {
        Task {
            guard !isRequestingPermissions else {
                return
            }

            isRequestingPermissions = true
            defer {
                isRequestingPermissions = false
            }

            await refreshPermissions()

            switch requestedStep ?? nextPermissionStep {
            case .microphone:
                if permissionChecklist.microphone == .denied {
                    openMicrophoneSettings()
                    statusText = "Enable microphone in Settings"
                } else {
                    let microphonePermission = await requestMicrophonePermission()
                    permissionChecklist.microphone = microphonePermission
                    statusText = microphonePermission == .granted
                        ? "Microphone ready"
                        : "Microphone access needed"
                }
            case .accessibility:
                let accessibilityPermission = requestAccessibilityPermission()
                permissionChecklist.accessibility = accessibilityPermission
                statusText = accessibilityPermission == .granted
                    ? "Accessibility ready"
                    : "Enable accessibility in Settings"
            case .screenAndSystemAudio:
                let screenCapturePermission = await requestScreenCapturePermission()
                permissionChecklist.screenCapture = screenCapturePermission
                if screenCapturePermission == .granted {
                    statusText = "Screen and audio ready"
                } else {
                    openScreenCaptureSettings()
                    statusText = "Enable screen and audio in Settings"
                }
            case .alerts:
                if permissionChecklist.notifications == .denied {
                    openNotificationSettings()
                    statusText = "Enable alerts in Settings"
                } else {
                    let notificationPermission = await requestNotificationPermission()
                    permissionChecklist.notifications = notificationPermission
                    statusText = notificationPermission == .granted
                        ? "Alerts ready"
                        : "Alerts access needed"
                }
            case nil:
                statusText = "Permissions ready"
            }

            await refreshPermissions()
            if canMonitor {
                startMonitoring()
            }
        }
    }

    func startRecording() {
        beginRecording(meetingId: nextScheduleMeeting?.meetingId, title: nil)
    }

    func startRecording(fallbackIntentId: String?) {
        guard let fallbackIntentId else { return }
        beginRecording(legacyIntent: fallbackIntentId)
    }

    func checkNow() {
        guard !isRefreshingSchedule else {
            return
        }

        guard isSignedIn else {
            statusText = "Sign in to connect Tape Desktop"
            return
        }

        guard let serverURL = URL(string: serverURLText) else {
            statusText = "Enter a valid server URL"
            return
        }

        isRefreshingSchedule = true
        Task {
            defer {
                isRefreshingSchedule = false
            }

            do {
                let client = LocalRecorderAPIClient(
                    serverURL: serverURL,
                    bearerToken: bearerToken,
                    deviceId: deviceIdStore.deviceId,
                    appVersion: appVersion,
                    permissionReadiness: permissionReadinessReport
                )
                let monitoringStatus = try await client.fetchMonitoringStatus()
                account = monitoringStatus.account
                activationLogger.info("Device connected; permissions ready: \(self.canMonitor)")
                guard canMonitor else {
                    statusText = "Finish access setup"
                    scheduleNextMonitoringCheck(after: 5 * 60)
                    return
                }
                try? await sealRecoveredCaptures(client: client)
                Task { await uploadQueuedRecordings(client: client) }
                let now = Date()
                nextScheduleMeeting = monitoringStatus.nextMeeting
                pendingMeetings = LocalRecorderPendingMeetingQueue.merge(
                    existing: pendingMeetings,
                    incoming: monitoringStatus.missedMeetings,
                    at: now
                )
                pruneFallbackNotificationCounts()
                let notificationsDelivered = await deliverDueFallbackNotifications(
                    client: client,
                    now: now
                )
                persistPendingMeetings()
                if notificationsDelivered {
                    statusText = nextScheduleMeeting == nil
                        ? "No upcoming meetings"
                        : "Watching your calendar"
                } else {
                    statusText = "Could not deliver a meeting notification"
                }
                scheduleNextMonitoringCheck(
                    after: LocalRecorderMonitoringPollSchedule.nextDelay(
                        now: Date(),
                        nextMeeting: monitoringStatus.nextMeeting,
                        pendingMeetings: pendingMeetings
                    )
                )
            } catch {
                if !requireSignInIfExpired(error) {
                    statusText = "Could not connect. Retrying shortly."
                    scheduleNextMonitoringCheck(after: 5 * 60)
                }
            }
        }
    }

    @discardableResult
    private func requireSignInIfExpired(_ error: Error) -> Bool {
        guard localRecorderRequiresSignIn(error) else { return false }
        account = nil
        bearerToken = ""
        try? credentialStore.delete()
        monitoringTimer?.invalidate()
        statusText = "Session expired. Sign in to reconnect."
        activationLogger.notice("Saved session expired; sign in required")
        return true
    }

    private func startMonitoring() {
        monitoringTimer?.invalidate()
        statusText = "Checking your calendar"
        checkNow()
    }

    private func scheduleNextMonitoringCheck(after delay: TimeInterval) {
        monitoringTimer?.invalidate()
        monitoringTimer = Timer.scheduledTimer(withTimeInterval: max(1, delay), repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.checkNow()
            }
        }
    }

    private func pruneFallbackNotificationCounts() {
        let activeIntentIds = Set(pendingMeetings.map(\.fallbackIntentId))
        fallbackNotificationCountsByIntentId =
            fallbackNotificationCountsByIntentId.filter {
                activeIntentIds.contains($0.key)
            }
        fallbackNotificationNextDatesByIntentId =
            fallbackNotificationNextDatesByIntentId.filter {
                activeIntentIds.contains($0.key)
            }
    }

    private func recordFallbackNotification(for meeting: MissedMeeting) -> Int {
        let count = (fallbackNotificationCountsByIntentId[meeting.fallbackIntentId] ?? 0) + 1
        fallbackNotificationCountsByIntentId[meeting.fallbackIntentId] = count
        return count
    }

    private func deliverDueFallbackNotifications(
        client: LocalRecorderAPIClient,
        now: Date
    ) async -> Bool {
        guard !isRecording, !isStartingRecording else { return true }
        let dueMeetings = pendingMeetings.filter { meeting in
            guard let nextDate = fallbackNotificationNextDatesByIntentId[
                meeting.fallbackIntentId
            ] else {
                return true
            }

            return nextDate <= now
        }
        var removedIntentIds = Set<String>()
        var allDelivered = true

        for meeting in dueMeetings {
            do {
                let authorization = try await client.authorizeNotification(
                    fallbackIntentId: meeting.fallbackIntentId
                )

                guard authorization.allowed else {
                    removedIntentIds.insert(meeting.fallbackIntentId)
                    continue
                }

                guard !isRecording, !isStartingRecording else { return true }
                try await notify(meeting: meeting)
                let delivery = try await client.markNotificationDelivered(
                    fallbackIntentId: meeting.fallbackIntentId
                )

                guard delivery.marked else {
                    throw URLError(.badServerResponse)
                }

                let notificationCount = recordFallbackNotification(for: meeting)
                if let delay = LocalRecorderNotificationBackoffSchedule.nextDelay(
                    afterNotificationCount: notificationCount,
                    now: Date(),
                    meeting: meeting
                ) {
                    fallbackNotificationNextDatesByIntentId[
                        meeting.fallbackIntentId
                    ] = Date().addingTimeInterval(delay)
                } else {
                    removedIntentIds.insert(meeting.fallbackIntentId)
                }
            } catch {
                allDelivered = false
                fallbackNotificationNextDatesByIntentId[
                    meeting.fallbackIntentId
                ] = Date().addingTimeInterval(
                    LocalRecorderMonitoringPollSchedule.activeMeetingInterval
                )
            }
        }

        if !removedIntentIds.isEmpty {
            pendingMeetings.removeAll {
                removedIntentIds.contains($0.fallbackIntentId)
            }
        }
        pruneFallbackNotificationCounts()

        return allDelivered
    }

    private func loadPersistedPendingMeetings() {
        guard
            let data = UserDefaults.standard.data(
                forKey: Self.pendingMeetingsDefaultsKey
            ),
            let meetings = try? JSONDecoder.localRecorder.decode(
                [MissedMeeting].self,
                from: data
            )
        else {
            return
        }

        pendingMeetings = LocalRecorderPendingMeetingQueue.merge(
            existing: [],
            incoming: meetings,
            at: Date()
        )
    }

    func persistPendingMeetings() {
        guard
            let data = try? JSONEncoder.localRecorder.encode(pendingMeetings)
        else {
            return
        }

        UserDefaults.standard.set(data, forKey: Self.pendingMeetingsDefaultsKey)
    }

    func startCapture(
        client: LocalRecorderAPIClient,
        fallbackIntentId: String,
        title: String,
        nativeOnly: Bool = false
    ) async {
        stopLevelTest()
        isAdvancedExpanded = false
        var intentID = fallbackIntentId
        var confirmedTitle = title
        let clientRecordingId = captureSessionID ?? UUID().uuidString
        var startedWithRecallSDK = false
        var captureStateUnknown = false
        if !nativeOnly {
            do {
                try await startRecallSDKCapture(client: client, clientRecordingId: clientRecordingId, fallbackIntentId: intentID)
                startedWithRecallSDK = true
            } catch RecallDesktopSDKRecordingError.captureStateUnknown {
                startedWithRecallSDK = true
                captureStateUnknown = true
            } catch {
                LocalRecorderTelemetry.capture(error, operation: .sdkStart)
                guard let target = activeTarget else { return }
                do {
                    let replacement = try await replaceSDKAttemptForNative(client: client, target: target, recordingID: clientRecordingId)
                    intentID = replacement.fallbackIntentId
                    confirmedTitle = replacement.meetingTitle
                } catch {
                    statusText = "Could not prepare local recording. Retry to recover this meeting."
                    return
                }
            }
        }
        if startedWithRecallSDK {
            activeRecordingBackend = .recallDesktopSDK
        } else {
            do {
                try await startLocalCapture(fallbackIntentId: intentID)
                activeRecordingBackend = .localUpload
            } catch {
                LocalRecorderTelemetry.capture(error, operation: .recordingStart)
                try? await client.failIntent(fallbackIntentId: intentID, errorMessage: error.localizedDescription)
                statusText = "Could not start recording: \(error.localizedDescription)"
                await refreshPermissions()
                return
            }
        }
        activeClient = client
        activeFallbackIntentId = intentID
        activeRecordingTitle = confirmedTitle
        pendingMeetings.removeAll { $0.fallbackIntentId == fallbackIntentId }
        fallbackNotificationCountsByIntentId.removeValue(forKey: fallbackIntentId)
        fallbackNotificationNextDatesByIntentId.removeValue(forKey: fallbackIntentId)
        persistPendingMeetings()
        isRecording = true
        statusText = captureStateUnknown ? "Capture state is unconfirmed. Use Stop before recording again." : "Recording \(confirmedTitle)"
        if activeRecordingBackend == .recallDesktopSDK && !captureStateUnknown {
            if recallSDKController.activeCaptureEnded {
                captureNaturallyEnded = true
                presentEndPrompt(reason: .captureEnded)
            } else {
                startRecallSDKLevelMetering()
            }
        }
    }

    /// The Recall Desktop SDK records in a separate process and reports no
    /// audio levels, so run a meter-only capture alongside it to keep the
    /// level bars, waveform, and silence detection alive.
    func startRecallSDKLevelMetering() {
        endPromptPolicy = RecorderEndPromptPolicy(scheduledEnd: activeTarget?.endsAt)
        audioLevels = Array(repeating: 0, count: Self.audioLevelSampleCount)

        // The session takes ~1s to spin up (SCStream). A stop or a second
        // start can land during that window, so tag this attempt with a
        // generation token and stop any prior session; if the token is stale
        // (or recording has since ended) once startup finishes, tear the new
        // session down instead of leaking a live mic tap / SCStream.
        recallSDKMeterGeneration += 1
        let generation = recallSDKMeterGeneration
        recordingAudioGeneration += 1
        let audioGeneration = recordingAudioGeneration
        let captureID = captureSessionID
        let previousSession = recallSDKMeterSession
        recallSDKMeterSession = nil

        Task {
            if let previousSession {
                await previousSession.stop()
            }

            let session = AudioLevelTestSession(
                microphoneDeviceUID: selectedMicrophoneUID,
                onAudioLevel: { [weak self] source, level in
                    let observedAt = Date()
                    Task { @MainActor in
                        guard self?.captureSessionID == captureID, self?.recordingAudioGeneration == audioGeneration else { return }
                        self?.observeAudioLevel(source: source, level: level, at: observedAt)
                    }
                }
            )

            do {
                try await session.start()
            } catch {
                LocalRecorderTelemetry.capture(error, operation: .audioMeterStart)
                // Metering is best-effort; the SDK keeps recording without it.
                return
            }

            guard
                generation == recallSDKMeterGeneration,
                isRecording,
                !isFinishingRecording,
                activeRecordingBackend == .recallDesktopSDK
            else {
                await session.stop()
                return
            }

            recallSDKMeterSession = session
        }
    }

    func stopRecallSDKLevelMetering() async {
        // Invalidate any metering start still spinning up so it tears itself
        // down when it finishes instead of resurrecting a stopped session.
        recallSDKMeterGeneration += 1
        recordingAudioGeneration += 1

        guard let session = recallSDKMeterSession else {
            return
        }

        recallSDKMeterSession = nil
        await session.stop()
    }

    private func startRecallSDKCapture(
        client: LocalRecorderAPIClient,
        clientRecordingId: String,
        fallbackIntentId: String
    ) async throws {
        let upload = try await client.createRecallSDKUpload(fallbackIntentId: fallbackIntentId, clientRecordingId: clientRecordingId)
        if let target = activeTarget {
            recoveryState.sdkDrains.append(.init(recordingID: clientRecordingId, target: target))
            try persistCaptureRecovery()
        }
        try await recallSDKController.start(upload: upload, clientRecordingId: clientRecordingId)
    }

    func startLocalCapture(fallbackIntentId: String) async throws {
        endPromptPolicy = RecorderEndPromptPolicy(scheduledEnd: activeTarget?.endsAt)
        audioLevels = Array(repeating: 0, count: Self.audioLevelSampleCount)
        recordingAudioGeneration += 1
        let audioGeneration = recordingAudioGeneration
        let captureID = captureSessionID
        try await captureController.start(
            fallbackIntentId: fallbackIntentId,
            appVersion: appVersion,
            microphoneDeviceUID: selectedMicrophoneUID,
            onAudioLevel: { [weak self] source, level in
                    let observedAt = Date()
                Task { @MainActor in
                    guard self?.captureSessionID == captureID, self?.recordingAudioGeneration == audioGeneration else { return }
                    self?.observeAudioLevel(source: source, level: level, at: observedAt)
                }
            }
        )
    }

    private func recoverFromUnexpectedRecallSDKStop() async {
        guard isRecording, !isFinishingRecording, activeRecordingBackend == .recallDesktopSDK,
              let client = activeClient, let target = activeTarget, let recordingID = captureSessionID else { return }
        isFinishingRecording = true
        await stopRecallSDKLevelMetering()
        // The SDK process is gone. Its token may already be terminal, so a
        // replacement capture always receives its own attempt on this meeting.
        startSDKDrain(client: client, target: target, recordingID: recordingID)
        isRecording = false
        captureSessionID = nil
        activeClient = nil
        activeFallbackIntentId = nil
        activeRecordingBackend = nil
        activeTarget = nil
        activeRecordingTitle = nil
        endPrompt = nil
        resetAudioLevels()
        isFinishingRecording = false
        beginRecording(meetingId: target.meetingId, nativeOnly: true)
    }

    private func observeAudioLevel(source: LocalRecorderAudioSource, level: Float, at observedAt: Date = Date()) {
        guard Date().timeIntervalSince(observedAt) <= 2 else { return }
        guard isRecording || isTestingLevels else {
            return
        }

        let scaled = max(0, min(1, level * 16))
        switch source {
        case .microphone:
            microphoneLevel = scaled
        case .computerAudio:
            systemAudioLevel = scaled
        }

        guard isRecording else {
            return
        }

        audioLevels.append(max(microphoneLevel, systemAudioLevel))
        if audioLevels.count > Self.audioLevelSampleCount {
            audioLevels.removeFirst(audioLevels.count - Self.audioLevelSampleCount)
        }

        if endPromptPolicy.observe(source: source, level: level, at: observedAt) {
            showSilencePrompt()
        }
    }

    func toggleLevelTest() {
        if isTestingLevels {
            stopLevelTest()
        } else {
            startLevelTest()
        }
    }

    func refreshMicrophones() {
        availableMicrophones = AudioInputDeviceList.inputDevices()
    }

    func selectMicrophone(uid: String?) {
        guard uid != selectedMicrophoneUID else {
            return
        }

        selectedMicrophoneUID = uid
        UserDefaults.standard.set(uid ?? "", forKey: Self.microphoneDefaultsKey)

        if isTestingLevels {
            stopLevelTest()
            startLevelTest()
        }
    }

    private func loadMicrophoneSelection() {
        refreshMicrophones()

        guard let stored = UserDefaults.standard.string(forKey: Self.microphoneDefaultsKey) else {
            // First run: prefer the built-in microphone. The system default can
            // be a virtual device (remote desktop, loopback) that captures
            // nothing in a real meeting.
            if availableMicrophones.contains(where: { $0.uid == Self.builtInMicrophoneUID }) {
                selectedMicrophoneUID = Self.builtInMicrophoneUID
                UserDefaults.standard.set(Self.builtInMicrophoneUID, forKey: Self.microphoneDefaultsKey)
            }
            return
        }

        selectedMicrophoneUID = stored.isEmpty ? nil : stored
    }

    private func startLevelTest() {
        guard !isRecording, !isFinishingRecording, levelTestSession == nil else {
            return
        }

        guard hasAudioCapturePermissions else {
            statusText = "Grant permissions to test audio"
            return
        }

        Task {
            do {
                let session = AudioLevelTestSession(
                    microphoneDeviceUID: selectedMicrophoneUID,
                    onAudioLevel: { [weak self] source, level in
                        Task { @MainActor in
                            self?.observeAudioLevel(source: source, level: level)
                        }
                    }
                )
                try await session.start()
                levelTestSession = session
                isTestingLevels = true
                statusText = "Testing audio levels"
                levelTestTimeoutTask = Task { @MainActor [weak self] in
                    try? await Task.sleep(for: .seconds(30))
                    guard !Task.isCancelled else {
                        return
                    }

                    self?.stopLevelTest()
                }
            } catch {
                LocalRecorderTelemetry.capture(error, operation: .audioTestStart)
                statusText = "Could not test audio: \(error.localizedDescription)"
                await refreshPermissions()
            }
        }
    }

    private func stopLevelTest() {
        levelTestTimeoutTask?.cancel()
        levelTestTimeoutTask = nil

        guard let session = levelTestSession else {
            return
        }

        levelTestSession = nil
        isTestingLevels = false
        Task {
            await session.stop()
            microphoneLevel = 0
            systemAudioLevel = 0
            if canMonitor, !isRecording {
                statusText = "Watching your calendar"
            }
        }
    }

    private func showSilencePrompt() {
        presentEndPrompt(reason: .silence)
    }

    private func notify(meeting: MissedMeeting) async throws {
        let content = UNMutableNotificationContent()
        content.title = "Bot did not join"
        content.body = "Start local recording for \(meeting.title)?"
        content.sound = .default
        content.categoryIdentifier = RecorderNotificationAction.missingBotCategory
        content.userInfo = ["fallbackIntentId": meeting.fallbackIntentId]
        let request = UNNotificationRequest(
            identifier: meeting.fallbackIntentId,
            content: content,
            trigger: nil
        )

        try await notificationCenter.add(request)
    }

    func stopRecording() {
        guard isRecording, !isFinishingRecording else { return }
        isFinishingRecording = true
        endPrompt = nil
        Task { await finishCapture() }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let action = response.actionIdentifier
        let info = response.notification.request.content.userInfo
        let intentID = info["fallbackIntentId"] as? String
        let sessionID = info["captureSessionID"] as? String
        let promptID = info["promptID"] as? String
        Task { @MainActor in
            if action == RecorderNotificationAction.start, let intentID {
                self.startRecording(fallbackIntentId: intentID)
            } else if action == RecorderNotificationAction.stop || action == RecorderNotificationAction.keep {
                self.respondToEndPrompt(sessionID: sessionID, promptID: promptID, stop: action == RecorderNotificationAction.stop)
            }
        }
        completionHandler()
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func claimFailureStatus(reason: String?) -> String {
        switch reason {
        case "already_recording":
            return "Another user is already recording"
        case "no_longer_eligible":
            return "Bot recording is available"
        case "expired_or_missing":
            return "Recording window expired"
        default:
            return "Could not start recording"
        }
    }

    func checkForUpdates() {
        LocalRecorderUpdater.shared.checkForUpdates()
    }

    func signOut() {
        guard canCloseApp() else {
            return
        }

        stopLevelTest()
        monitoringTimer?.invalidate()
        monitoringTimer = nil
        permissionRefreshTask?.cancel()
        permissionRefreshTask = nil
        activeClient = nil
        activeRecordingTitle = nil
        resetAudioLevels()
        isFinishingRecording = false
        isRefreshingSchedule = false
        nextScheduleMeeting = nil
        pendingMeetings = []
        fallbackNotificationCountsByIntentId = [:]
        fallbackNotificationNextDatesByIntentId = [:]
        UserDefaults.standard.removeObject(forKey: Self.pendingMeetingsDefaultsKey)
        account = nil
        bearerToken = ""
        try? credentialStore.delete()
        statusText = "Signed out"
    }

    func resetAudioLevels() {
        audioLevels = Array(repeating: 0, count: Self.audioLevelSampleCount)
        microphoneLevel = 0
        systemAudioLevel = 0
    }

    func restartApp() {
        guard !isRestarting, canCloseApp() else {
            return
        }
        isRestarting = true
        Task {
            defer { isRestarting = false }
            do {
                try await RecorderSystemActions.launchReplacement(at: Bundle.main.bundleURL)
                stopLevelTest()
                NSApp.terminate(nil)
            } catch {
                statusText = "Could not restart. Quit and reopen Tape Desktop."
            }
        }
    }

    func repairAccessibility() {
        guard !isRequestingPermissions, canCloseApp(),
              let bundleIdentifier = Bundle.main.bundleIdentifier else { return }
        let alert = NSAlert()
        alert.messageText = "Reset Accessibility access?"
        alert.informativeText = "This removes the old permission entry for Tape Desktop and requests access for this copy. Enable Tape Desktop again in System Settings."
        alert.addButton(withTitle: "Reset access")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        isRequestingPermissions = true
        Task {
            defer { isRequestingPermissions = false }
            do {
                try await RecorderSystemActions.resetAccessibility(bundleIdentifier: bundleIdentifier)
                permissionChecklist.accessibility = requestAccessibilityPermission()
                statusText = "Access reset. Enable Tape Desktop in Accessibility settings."
            } catch {
                statusText = "Reset failed. Remove the old Accessibility entry, then add this app."
                openAccessibilitySettings()
            }
        }
    }

    func showAppInFinder() {
        NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL])
    }

    func exitApp() {
        // The delegate also catches Cmd Q and system termination requests.
        NSApp.terminate(nil)
    }

    func canCloseApp(allowPendingUploads: Bool = false) -> Bool {
        let captureBusy = isRecording || isFinishingRecording || isStartingRecording
        let pending = pendingUploadCount > 0 || !recoveryState.targets.isEmpty || recoveryState.pendingStart != nil || recoveryState.pendingLegacyIntent != nil
        guard captureBusy || pending else { return true }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = captureBusy ? "Recording is active" : "Recordings are still saving"
        if captureBusy {
            alert.informativeText = "Stop recording before closing the recorder."
            alert.addButton(withTitle: "OK")
            alert.runModal()
            return false
        }
        alert.informativeText = "Keep Tape open while recordings finish uploading. Saved local files will remain on this Mac. If you quit now, reopen Tape to confirm the remaining uploads."
        alert.addButton(withTitle: "Keep open")
        if allowPendingUploads { alert.addButton(withTitle: "Quit anyway") }
        return alert.runModal() == .alertSecondButtonReturn && allowPendingUploads
    }

    private func refreshPermissions() async {
        permissionChecklist = PermissionChecklist(
            microphone: currentMicrophonePermission(),
            screenCapture: currentScreenCapturePermission(),
            accessibility: currentAccessibilityPermission(),
            notifications: await currentNotificationPermission(),
            startAtLogin: currentStartAtLoginPermission()
        )
    }

    private func refreshPermissionsAndStartIfReady() async {
        await refreshPermissions()
        if isSignedIn {
            startMonitoring()
        }
    }

    private func requestMicrophonePermission() async -> PermissionGrant {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return .granted
        case .denied, .restricted:
            return .denied
        case .notDetermined:
            break
        @unknown default:
            return .denied
        }

        // AVFoundation may complete on a background queue. Its async API
        // resumes this main-actor method safely after the permission decision.
        let granted = await AVCaptureDevice.requestAccess(for: .audio)
        return granted ? .granted : .denied
    }

    private func requestNotificationPermission() async -> PermissionGrant {
        do {
            let granted = try await notificationCenter.requestAuthorization(options: [.alert, .sound])
            return granted ? .granted : .denied
        } catch {
            return .denied
        }
    }

    private func requestScreenCapturePermission() async -> PermissionGrant {
        if currentScreenCapturePermission() == .granted {
            return .granted
        }

        do {
            _ = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )
        } catch {
            _ = CGRequestScreenCaptureAccess()
        }

        return currentScreenCapturePermission()
    }

    private func requestAccessibilityPermission() -> PermissionGrant {
        // Literal key avoids kAXTrustedCheckOptionPrompt, a global var that
        // Swift 6 strict concurrency rejects on the main actor.
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary

        if AXIsProcessTrustedWithOptions(options) {
            return .granted
        }

        openAccessibilitySettings()
        return .denied
    }

    private func openAccessibilitySettings() {
        openPrivacySettings(
            pane: "Privacy_Accessibility",
            until: { $0.accessibility == .granted }
        )
    }

    private func openMicrophoneSettings() {
        openPrivacySettings(
            pane: "Privacy_Microphone",
            until: { $0.microphone == .granted }
        )
    }

    private func openScreenCaptureSettings() {
        openPrivacySettings(
            pane: "Privacy_ScreenCapture",
            until: { $0.screenCapture == .granted }
        )
    }

    private func openPrivacySettings(
        pane: String,
        until isSatisfied: @escaping (PermissionChecklist) -> Bool
    ) {
        let value = "x-apple.systempreferences:com.apple.preference.security?\(pane)"
        guard let url = URL(string: value), NSWorkspace.shared.open(url) else {
            return
        }

        pollPermissionsUntil(isSatisfied)
    }

    private func openNotificationSettings() {
        let urls = [
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
            "x-apple.systempreferences:com.apple.preference.notifications",
        ]

        for value in urls {
            guard let url = URL(string: value) else {
                continue
            }

            if NSWorkspace.shared.open(url) {
                pollPermissionsUntil { $0.notifications == .granted }
                return
            }
        }
    }

    private func openLoginItemsSettings() {
        guard let url = URL(
            string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"
        ) else {
            return
        }

        NSWorkspace.shared.open(url)
    }

    private func pollPermissionsUntil(
        _ isSatisfied: @escaping (PermissionChecklist) -> Bool
    ) {
        permissionRefreshTask?.cancel()
        permissionRefreshTask = Task { @MainActor in
            for _ in 0..<30 {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else {
                    return
                }

                await refreshPermissionsAndStartIfReady()
                if isSatisfied(permissionChecklist) {
                    return
                }
            }
        }
    }

    private func currentScreenCapturePermission() -> PermissionGrant {
        CGPreflightScreenCaptureAccess() ? .granted : .denied
    }

    private func currentAccessibilityPermission() -> PermissionGrant {
        AXIsProcessTrusted() ? .granted : .denied
    }

    private func currentMicrophonePermission() -> PermissionGrant {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return .granted
        case .notDetermined:
            return .unknown
        case .denied, .restricted:
            return .denied
        @unknown default:
            return .denied
        }
    }

    private func currentNotificationPermission() async -> PermissionGrant {
        let settings = await notificationCenter.notificationSettings()

        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return .granted
        case .notDetermined:
            return .unknown
        case .denied:
            return .denied
        @unknown default:
            return .denied
        }
    }

    private func currentStartAtLoginPermission() -> PermissionGrant {
        switch SMAppService.mainApp.status {
        case .enabled:
            return .granted
        case .notRegistered:
            return .unknown
        case .requiresApproval, .notFound:
            return .denied
        @unknown default:
            return .denied
        }
    }

    private func uploadWithRetry(
        client: LocalRecorderAPIClient,
        payload: LocalRecordingUploadPayload
    ) async throws {
        var payload = payload
        var lastError: Error?

        for attempt in 1...3 {
            do {
                payload = try await uploadOnce(client: client, payload: payload)
                return
            } catch {
                lastError = error
                switch localRecorderUploadRetryDecision(
                    error: error,
                    attempt: attempt
                ) {
                case let .retry(afterSeconds):
                    try await Task.sleep(for: .seconds(afterSeconds))
                case .wait, .stop:
                    throw error
                }
            }
        }

        throw lastError ?? LocalRecorderAPIError.invalidResponse
    }

    private func uploadOnce(
        client: LocalRecorderAPIClient,
        payload: LocalRecordingUploadPayload
    ) async throws -> LocalRecordingUploadPayload {
        var payload = payload

        if payload.uploadAssets != nil {
            do {
                _ = try await client.completeRecordingUpload(payload: payload)
                return payload
            } catch let LocalRecorderAPIError.httpStatus(statusCode, _, _)
                where statusCode == 409 {
                payload.uploadAssets = nil
                try uploadQueue.save(payload)
            }
        }

        let preparedUpload = try await client.prepareRecordingUpload(payload: payload)
        payload.uploadAssets = preparedUpload.assets.assetIds
        try uploadQueue.save(payload)
        try await client.uploadPreparedRecordingAssets(
            payload: payload,
            preparedUpload: preparedUpload
        )

        do {
            _ = try await client.completeRecordingUpload(payload: payload)
            return payload
        } catch let LocalRecorderAPIError.httpStatus(
            statusCode,
            message,
            retryAfterSeconds
        )
            where statusCode == 409 {
            payload.uploadAssets = nil
            try uploadQueue.save(payload)
            throw LocalRecorderAPIError.httpStatus(
                statusCode,
                message: message,
                retryAfterSeconds: retryAfterSeconds
            )
        }
    }

    private func handleUploadFailure(
        client: LocalRecorderAPIClient,
        payload: LocalRecordingUploadPayload,
        error: Error
    ) async {
        LocalRecorderTelemetry.capture(error, operation: .recordingUpload)
        if localRecorderRequiresSignIn(error) {
            uploadStatusText = "Upload needs sign in. Reconnect to continue."
            return
        }
        if case let .wait(retryAfterSeconds) = localRecorderUploadRetryDecision(
            error: error,
            attempt: 1
        ) {
            queuedUploadRetryAfter = Date().addingTimeInterval(
                TimeInterval(retryAfterSeconds)
            )
            uploadStatusText = "Upload paused. Retrying later."
            return
        }

        guard isPermanentLocalRecorderUploadError(error) else {
            uploadStatusText = "Could not upload recording. Files kept locally."
            return
        }

        let message = localRecorderUploadErrorMessage(error)
        try? await client.failIntent(
            fallbackIntentId: payload.fallbackIntentId,
            errorMessage: message
        )
        try? uploadQueue.quarantine(
            clientRecordingId: payload.clientRecordingId
        )
        uploadStatusText = "Upload stopped: \(message). Files kept locally."
    }
}

struct DeviceIdStore {
    private let defaultsKey = "meeting-note-local-recorder-device-id"

    var deviceId: String {
        if let existing = UserDefaults.standard.string(forKey: defaultsKey) {
            return existing
        }

        let value = UUID().uuidString
        UserDefaults.standard.set(value, forKey: defaultsKey)
        return value
    }
}
