import AppKit
import AVFoundation
import Foundation
import LocalRecorderCore
import ServiceManagement
import SwiftUI
import UserNotifications

@main
struct MeetingNoteLocalRecorderApp: App {
    @StateObject private var model = RecorderAppModel()

    var body: some Scene {
        MenuBarExtra("Meeting Note Recorder", systemImage: model.menuBarImage) {
            RecorderMenuView(model: model)
        }
        .menuBarExtraStyle(.window)
    }
}

@MainActor
final class RecorderAppModel: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    @Published var permissionChecklist = PermissionChecklist(
        microphone: .unknown,
        screenCapture: .unknown,
        notifications: .unknown,
        startAtLogin: .unknown
    )
    @Published var statusText = "Sign in to start monitoring"
    @Published var serverURLText = "https://meeting-note-swart.vercel.app"
    @Published var bearerToken = ""
    @Published var isRecording = false
    @Published var pendingMeetings: [MissedMeeting] = []

    private let appVersion = "0.1.0"
    private let captureController = LocalRecordingCaptureController()
    private let deviceIdStore = DeviceIdStore()
    private let notificationCenter = UNUserNotificationCenter.current()
    private var activeClient: LocalRecorderAPIClient?

    override init() {
        super.init()
        notificationCenter.delegate = self
    }

    var menuBarImage: String {
        isRecording ? "record.circle.fill" : "waveform"
    }

    var canMonitor: Bool {
        !bearerToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            permissionChecklist.canMonitor
    }

    func signIn() {
        guard let serverURL = URL(string: serverURLText) else {
            statusText = "Enter a valid server URL"
            return
        }

        var components = URLComponents(
            url: serverURL.appending(path: "/api/local-recorder/device-login"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "deviceId", value: deviceIdStore.deviceId),
            URLQueryItem(name: "callbackUrl", value: "meetingnote-local-recorder://login"),
        ]

        if let url = components?.url {
            NSWorkspace.shared.open(url)
            statusText = "Complete login in your browser"
        }
    }

    func requestPermissions() {
        Task {
            let microphone = await requestMicrophonePermission()
            let notifications = await requestNotificationPermission()
            let screenCapture = CGPreflightScreenCaptureAccess() ? PermissionGrant.granted : .denied

            permissionChecklist = PermissionChecklist(
                microphone: microphone,
                screenCapture: screenCapture,
                notifications: notifications,
                startAtLogin: configureStartAtLogin()
            )
            statusText = permissionChecklist.canMonitor
                ? "Monitoring missed bot joins"
                : "Permissions needed before monitoring"
        }
    }

    func startRecording() {
        startRecording(fallbackIntentId: nil)
    }

    func startRecording(fallbackIntentId: String?) {
        let meeting = fallbackIntentId
            .flatMap { intentId in
                pendingMeetings.first { $0.fallbackIntentId == intentId }
            } ?? pendingMeetings.first
        guard let intentId = fallbackIntentId ?? meeting?.fallbackIntentId else {
            statusText = "No pending fallback meeting"
            return
        }
        let title = meeting?.title ?? "meeting"

        Task {
            await claimAndStart(fallbackIntentId: intentId, title: title)
        }
    }

    func checkNow() {
        guard canMonitor else {
            statusText = "Login and permissions are needed first"
            return
        }

        guard let serverURL = URL(string: serverURLText) else {
            statusText = "Enter a valid server URL"
            return
        }

        Task {
            do {
                let client = LocalRecorderAPIClient(
                    serverURL: serverURL,
                    bearerToken: bearerToken,
                    deviceId: deviceIdStore.deviceId
                )
                pendingMeetings = try await client.fetchMissedMeetings()
                statusText = pendingMeetings.isEmpty
                    ? "No missed bot meetings"
                    : "Fallback recording available"
                if let first = pendingMeetings.first {
                    try await notify(meeting: first)
                }
            } catch {
                statusText = "Could not check missed meetings"
            }
        }
    }

    private func claimAndStart(fallbackIntentId: String, title: String) async {
        guard let serverURL = URL(string: serverURLText) else {
            statusText = "Enter a valid server URL"
            return
        }

        do {
            let client = LocalRecorderAPIClient(
                serverURL: serverURL,
                bearerToken: bearerToken,
                deviceId: deviceIdStore.deviceId
            )
            let claim = try await client.claimIntent(fallbackIntentId: fallbackIntentId)

            guard claim.claimed else {
                statusText = claimFailureStatus(reason: claim.reason)
                return
            }

            try await captureController.start(
                fallbackIntentId: fallbackIntentId,
                appVersion: appVersion
            )
            activeClient = client
            isRecording = true
            statusText = "Recording \(claim.meetingTitle ?? title)"
        } catch {
            statusText = "Could not start recording"
        }
    }

    private func notify(meeting: MissedMeeting) async throws {
        let content = UNMutableNotificationContent()
        content.title = "Bot did not join"
        content.body = "Start local recording for \(meeting.title)?"
        content.sound = .default
        content.userInfo = ["fallbackIntentId": meeting.fallbackIntentId]
        let request = UNNotificationRequest(
            identifier: meeting.fallbackIntentId,
            content: content,
            trigger: nil
        )

        try await notificationCenter.add(request)
    }

    func stopRecording() {
        guard isRecording else {
            statusText = "No active recording"
            return
        }

        statusText = "Stopping recording"
        Task {
            do {
                let result = try await captureController.stop()
                isRecording = false
                statusText = "Uploading recording"
                guard let client = activeClient else {
                    throw LocalRecorderAPIError.invalidResponse
                }

                try await uploadWithRetry(
                    client: client,
                    payload: result.payload
                )
                try? FileManager.default.removeItem(at: result.cleanupDirectoryURL)
                activeClient = nil
                statusText = "Recording uploaded"
            } catch {
                isRecording = false
                activeClient = nil
                statusText = "Could not upload recording. Files kept locally."
            }
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let fallbackIntentId = response.notification.request.content
            .userInfo["fallbackIntentId"] as? String

        Task { @MainActor in
            self.startRecording(fallbackIntentId: fallbackIntentId)
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

    private func claimFailureStatus(reason: String?) -> String {
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

    private func requestMicrophonePermission() async -> PermissionGrant {
        await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                continuation.resume(returning: granted ? .granted : .denied)
            }
        }
    }

    private func requestNotificationPermission() async -> PermissionGrant {
        do {
            let granted = try await notificationCenter.requestAuthorization(options: [.alert, .sound])
            return granted ? .granted : .denied
        } catch {
            return .denied
        }
    }

    private func configureStartAtLogin() -> PermissionGrant {
        do {
            try SMAppService.mainApp.register()
            return .granted
        } catch {
            return .denied
        }
    }

    private func uploadWithRetry(
        client: LocalRecorderAPIClient,
        payload: LocalRecordingUploadPayload
    ) async throws {
        var lastError: Error?

        for attempt in 1...3 {
            do {
                _ = try await client.uploadRecording(payload: payload)
                return
            } catch {
                lastError = error
                if attempt < 3 {
                    try await Task.sleep(for: .seconds(5))
                }
            }
        }

        throw lastError ?? LocalRecorderAPIError.invalidResponse
    }
}

struct RecorderMenuView: View {
    @ObservedObject var model: RecorderAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Meeting Note Recorder")
                .font(.headline)

            Text(model.statusText)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            TextField("Server URL", text: $model.serverURLText)
                .textFieldStyle(.roundedBorder)

            SecureField("Device token", text: $model.bearerToken)
                .textFieldStyle(.roundedBorder)

            HStack {
                Button("Sign in", action: model.signIn)
                Button("Permissions", action: model.requestPermissions)
                Button("Check", action: model.checkNow)
            }

            Divider()

            if model.isRecording {
                Button("Stop recording", action: model.stopRecording)
            } else {
                Button("Start recording", action: model.startRecording)
                    .disabled(!model.canMonitor)
            }

            if !model.pendingMeetings.isEmpty {
                Divider()
                ForEach(model.pendingMeetings) { meeting in
                    Text(meeting.title)
                        .font(.subheadline)
                }
            }

            PermissionList(checklist: model.permissionChecklist)
        }
        .frame(width: 320)
        .padding(16)
    }
}

struct PermissionList: View {
    var checklist: PermissionChecklist

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
            PermissionRow(title: "Microphone", grant: checklist.microphone)
            PermissionRow(title: "Screen audio", grant: checklist.screenCapture)
            PermissionRow(title: "Notifications", grant: checklist.notifications)
            PermissionRow(title: "Start at login", grant: checklist.startAtLogin)
        }
    }
}

struct PermissionRow: View {
    var title: String
    var grant: PermissionGrant

    var body: some View {
        GridRow {
            Text(title)
            Text(label)
                .foregroundStyle(grant == .granted ? .green : .secondary)
        }
    }

    private var label: String {
        switch grant {
        case .unknown:
            return "Not checked"
        case .granted:
            return "Ready"
        case .denied:
            return "Needed"
        }
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
