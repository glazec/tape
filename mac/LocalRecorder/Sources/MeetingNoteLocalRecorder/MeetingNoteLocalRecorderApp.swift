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
final class RecorderAppModel: ObservableObject {
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

    private let deviceIdStore = DeviceIdStore()
    private let notificationCenter = UNUserNotificationCenter.current()

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
        guard let meeting = pendingMeetings.first else {
            statusText = "No pending fallback meeting"
            return
        }

        Task {
            await claimAndStart(meeting)
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

    private func claimAndStart(_ meeting: MissedMeeting) async {
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
            let claim = try await client.claimIntent(fallbackIntentId: meeting.fallbackIntentId)

            guard claim.claimed else {
                statusText = claimFailureStatus(reason: claim.reason)
                return
            }

            isRecording = true
            statusText = "Recording \(meeting.title)"
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
        isRecording = false
        statusText = "Recording stopped. Capture upload is not connected in this build."
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
