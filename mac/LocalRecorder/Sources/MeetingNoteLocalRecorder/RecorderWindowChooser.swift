import AppKit
import LocalRecorderCore
@preconcurrency import ScreenCaptureKit
import SwiftUI
@preconcurrency import UserNotifications

extension RecorderAppModel {
    private static let windowChoiceNotificationID = "recorder.window-choice"

    /// Waits for the person to pick a window on the chooser page. Throws
    /// `CancellationError` when they cancel, so the start cleans up like any failed start.
    func chooseMeetingWindow() async throws -> SelectedMeetingWindow {
        guard windowChoiceContinuation == nil else { throw LocalRecordingCaptureError.alreadyRecording }
        defer {
            isChoosingWindow = false
            windowChoices = []
            shareableWindows = [:]
            windowChooserError = nil
            isLoadingWindowChoices = false
            windowChoiceGeneration += 1
            notificationCenter.removeDeliveredNotifications(withIdentifiers: [Self.windowChoiceNotificationID])
        }
        statusText = "Choose a window to record"
        refreshWindowChoices()
        notifyWindowChoiceIfPanelClosed()
        while true {
            isChoosingWindow = true
            let id: UInt32 = try await withCheckedThrowingContinuation { windowChoiceContinuation = $0 }
            if let window = shareableWindows[id] {
                statusText = "Starting audio capture"
                return MeetingWindowCatalog.selection(for: window)
            }
            refreshWindowChoices()
            windowChooserError = "That window closed. Choose another."
        }
    }

    func chooseWindow(_ id: UInt32) {
        guard let continuation = windowChoiceContinuation else { return }
        windowChoiceContinuation = nil
        // Leave the page at once; the start shows its progress on the summary.
        isChoosingWindow = false
        continuation.resume(returning: id)
    }

    func cancelWindowChoice() {
        guard let continuation = windowChoiceContinuation else { return }
        windowChoiceContinuation = nil
        isChoosingWindow = false
        isCancellingStart = true
        statusText = "Cancelling…"
        continuation.resume(throwing: CancellationError())
    }

    func refreshWindowChoices() {
        windowChoiceGeneration += 1
        let generation = windowChoiceGeneration
        isLoadingWindowChoices = true
        windowChooserError = nil
        Task {
            do {
                let listing = try await MeetingWindowCatalog.load()
                guard generation == windowChoiceGeneration else { return }
                windowChoices = listing.choices
                shareableWindows = listing.windows
            } catch {
                guard generation == windowChoiceGeneration else { return }
                LocalRecorderTelemetry.capture(error, operation: .recordingStart)
                windowChooserError = "Couldn't list windows. Check Screen & System Audio Recording access, then refresh."
            }
            isLoadingWindowChoices = false
        }
    }

    /// Quit waits on this so a start cancelled at the chooser can fail its intent first.
    func waitForCancelledStart(timeout: Duration) async {
        let deadline = ContinuousClock.now + timeout
        while isStartingRecording, ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(50))
        }
    }

    /// A start that follows an ended SDK capture runs without a click, often with the
    /// panel closed. The chooser lives in the panel, so say where to find it.
    private func notifyWindowChoiceIfPanelClosed() {
        guard NSApp.keyWindow == nil else { return }
        let content = UNMutableNotificationContent()
        content.title = "Choose a window to keep recording"
        content.body = "Open Tape from the menu bar and pick the window showing your meeting."
        let request = UNNotificationRequest(identifier: Self.windowChoiceNotificationID, content: content, trigger: nil)
        Task { try? await notificationCenter.add(request) }
    }
}

/// Picks the window a local recording captures. A page inside the panel, like the meeting
/// picker, because the system content-sharing picker can stop answering (see MeetingWindowCatalog).
struct RecorderWindowChooser: View {
    @ObservedObject var model: RecorderAppModel
    @State private var hoveredID: UInt32?

    private static let rowHeight: CGFloat = 42

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    StatusDot(tone: TapePalette.amber, isLive: false)
                    Text("Starting · \(model.startingRecordingTitle)")
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .font(TapeType.mono(11))
                .tracking(TapeType.eyebrowTracking(11))
                .textCase(.uppercase)
                .foregroundStyle(TapePalette.ash)

                HStack(spacing: 6) {
                    Text("Choose the meeting window")
                        .font(TapeType.serif(18))
                        .tracking(-0.2)
                    Spacer(minLength: 0)
                    Button(action: model.refreshWindowChoices) {
                        Group {
                            if model.isLoadingWindowChoices {
                                ProgressView().controlSize(.mini)
                            } else {
                                Image(systemName: "arrow.clockwise").font(TapeType.sans(11.5))
                            }
                        }
                        .foregroundStyle(TapePalette.ash)
                        .frame(width: 22, height: 20)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isLoadingWindowChoices)
                    .help("Refresh windows")
                    .accessibilityLabel("Refresh windows")
                }

                if let error = model.windowChooserError {
                    Text(error)
                        .font(TapeType.sans(11.5))
                        .foregroundStyle(TapePalette.coralInk)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("Tape records this window's sound and your mic. Keep the meeting visible for screenshots.")
                        .font(TapeType.sans(11))
                        .foregroundStyle(TapePalette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)
            .padding(.bottom, 6)

            ScrollView {
                list.padding(.horizontal, 8).padding(.bottom, 6)
            }
            .frame(height: listHeight)

            HStack {
                Spacer()
                Button("Cancel", action: model.cancelWindowChoice)
                    .buttonStyle(RecorderActionButtonStyle(kind: .quiet, height: 26))
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 14)
            .padding(.top, 4)
            .padding(.bottom, 12)
        }
        .frame(maxWidth: .infinity)
        .background(TapePalette.paper)
        .foregroundStyle(TapePalette.ink)
        .font(TapeType.sans(12.5))
        .onExitCommand(perform: model.cancelWindowChoice)
    }

    @ViewBuilder
    private var list: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            if model.windowChoices.isEmpty && model.isLoadingWindowChoices {
                ProgressView()
                    .controlSize(.small)
                    .frame(maxWidth: .infinity, minHeight: 96)
                    .accessibilityLabel("Loading windows")
            } else if model.windowChoices.isEmpty {
                VStack(spacing: 4) {
                    Text("No windows to record")
                        .font(TapeType.sans(12, .medium))
                        .foregroundStyle(TapePalette.graphite)
                    Text("Open the meeting window, then refresh.")
                        .font(TapeType.sans(11.5))
                        .foregroundStyle(TapePalette.muted)
                }
                .frame(maxWidth: .infinity, minHeight: 96)
            } else {
                ForEach(model.windowChoices) { choice in
                    row(choice)
                }
            }
        }
    }

    private func row(_ choice: CaptureWindowChoice) -> some View {
        Button { model.chooseWindow(choice.id) } label: {
            HStack(spacing: 9) {
                AppIcon(bundleID: choice.bundleID)
                VStack(alignment: .leading, spacing: 1) {
                    Text(choice.title)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .foregroundStyle(TapePalette.ink)
                    Text(choice.appName)
                        .font(TapeType.sans(11))
                        .lineLimit(1)
                        .foregroundStyle(TapePalette.muted)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(height: Self.rowHeight)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(hoveredID == choice.id ? TapePalette.mist : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hoveredID = $0 ? choice.id : (hoveredID == choice.id ? nil : hoveredID) }
        .help(choice.title)
        .accessibilityLabel("\(choice.title), \(choice.appName)")
        .accessibilityHint("Record this window")
    }

    private var listHeight: CGFloat {
        guard !model.windowChoices.isEmpty else { return 108 }
        return min(max(CGFloat(model.windowChoices.count) * Self.rowHeight + 6, 96), 260)
    }
}

/// The owning app's icon, so a window is recognised before its title is read.
private struct AppIcon: View {
    var bundleID: String
    @MainActor private static var cache: [String: NSImage] = [:]

    var body: some View {
        Group {
            if let image = Self.icon(for: bundleID) {
                Image(nsImage: image).resizable().interpolation(.high)
            } else {
                Image(systemName: "macwindow")
                    .font(TapeType.sans(13))
                    .foregroundStyle(TapePalette.ash)
            }
        }
        .frame(width: 20, height: 20)
        .accessibilityHidden(true)
    }

    @MainActor private static func icon(for bundleID: String) -> NSImage? {
        if let cached = cache[bundleID] { return cached }
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else { return nil }
        let image = NSWorkspace.shared.icon(forFile: url.path)
        cache[bundleID] = image
        return image
    }
}
