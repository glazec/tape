import AppKit
import CoreText
import LocalRecorderCore
import SwiftUI

/// Warm paper and ink palette shared with the web workspace (see DESIGN.md).
enum TapePalette {
    static let paper = dynamic(light: 0xF9F8F6, dark: 0x1C1918)
    static let surface = dynamic(light: 0xFEFEFD, dark: 0x242020)
    static let mist = dynamic(light: 0xF2EEEB, dark: 0x2F2A28)
    static let ink = dynamic(light: 0x1D1918, dark: 0xF3EFEC)
    static let charcoal = dynamic(light: 0x2B2826, dark: 0xEDE8E5)
    static let graphite = dynamic(light: 0x5A4F4A, dark: 0xB3A8A3)
    static let ash = dynamic(light: 0x746963, dark: 0xA69B95)
    static let muted = dynamic(light: 0x786D68, dark: 0x9C918C)
    static let hairline = dynamic(light: 0xE9E4E1, dark: 0x3A3533)
    static let border = dynamic(light: 0xE4E0DC, dark: 0x403B39)
    static let coral = dynamic(light: 0xEC4F44, dark: 0xEF6157)
    static let coralInk = dynamic(light: 0xC23A30, dark: 0xF5978E)
    /// Text on a coral fill, in both appearances.
    static let onCoral = dynamic(light: 0xFEFEFD, dark: 0xFEFEFD)
    static let amber = dynamic(light: 0xC98A1B, dark: 0xE0A93F)
    static let green = dynamic(light: 0x3E9B5F, dark: 0x5DBB7E)

    static var paperNSColor: NSColor { nsColor(light: 0xF9F8F6, dark: 0x1C1918) }

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: nsColor(light: light, dark: dark))
    }

    private static func nsColor(light: UInt32, dark: UInt32) -> NSColor {
        NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            let hex = isDark ? dark : light
            return NSColor(
                srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1
            )
        }
    }
}

/// Brand type shared with the web workspace: Geist for interface text, Fraunces for titles.
enum TapeType {
    @MainActor private static var isRegistered = false

    @MainActor
    static func register() {
        guard !isRegistered else {
            return
        }
        isRegistered = true
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("Fonts")
        let source = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("../../Resources/Fonts")
        let directory = [bundled, source].compactMap { $0 }.first {
            FileManager.default.fileExists(atPath: $0.path)
        }
        guard
            let directory,
            let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        else {
            return
        }
        let fonts = files.filter { $0.pathExtension == "ttf" } as CFArray
        CTFontManagerRegisterFontURLs(fonts, .process, true, nil)
    }

    static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .medium:
            name = "Geist-Medium"
        case .semibold, .bold, .heavy, .black:
            name = "Geist-SemiBold"
        default:
            name = "Geist-Regular"
        }
        return .custom(name, fixedSize: size)
    }

    static func serif(_ size: CGFloat) -> Font {
        .custom("Fraunces-Regular", fixedSize: size)
    }
}

/// The interface copy is English, so dates follow it instead of mixing in the system language.
enum TapeFormat {
    static let locale = Locale(identifier: "en_US")
    static let time = Date.FormatStyle(date: .omitted, time: .shortened, locale: locale)
    static let timeRange = Date.IntervalFormatStyle.interval.hour().minute().locale(locale)
}

enum RecorderWindowChrome {
    /// Runs the paper canvas under a transparent titlebar so the window reads as one surface,
    /// keeping the native traffic lights.
    @MainActor
    static func apply(to window: NSWindow) {
        window.styleMask.insert(.fullSizeContentView)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.backgroundColor = TapePalette.paperNSColor
    }
}

struct RecorderMenuView: View {
    @ObservedObject var model: RecorderAppModel
    @FocusState private var isTitleFocused: Bool
    @State private var panelWindow = PanelWindowFitter()
    /// The setup window shares its titlebar row with the settings control;
    /// the menu bar panel has no titlebar and keeps the control beside the status line.
    var showsWindowChrome = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showsWindowChrome {
                HStack(spacing: 2) {
                    Spacer()
                    toolbarControls
                }
                .padding(.trailing, 6)
                .frame(height: 28)
            }

            if showsMeetingPicker {
                // A page inside the panel, not a popover: clicking into a popover
                // makes the menu bar panel resign key and close both.
                RecorderMeetingPicker(model: model)
                    .padding(.top, showsWindowChrome ? 0 : 8)
            } else {
                summary
                    .padding(.horizontal, 20)
                    .padding(.top, showsWindowChrome ? 8 : 18)
                    .padding(.bottom, 18)
            }

            if model.isAdvancedExpanded && !showsMeetingPicker {
                RecorderSettingsView(model: model, isSignedIn: isSignedIn)
            }
        }
        .frame(width: 340)
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { height in
            if !showsWindowChrome { panelWindow.fit(contentHeight: height) }
        }
        // While the panel and the content resize together, keep the content against the
        // top edge so sections open downward instead of the whole panel shifting. The
        // setup window sizes itself to the content, so it keeps the fixed height.
        .frame(maxHeight: showsWindowChrome ? nil : .infinity, alignment: .top)
        .background(HostingWindowReader { panelWindow.window = $0 })
        .background(TapePalette.paper.ignoresSafeArea())
        .foregroundStyle(TapePalette.ink)
    }

    // MARK: Summary

    private var summary: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                if let tone = state.tone {
                    StatusDot(tone: tone, isLive: model.isRecording)
                }
                if model.isRecording, let startedAt = model.recordingStartedAt {
                    TimelineView(.periodic(from: startedAt, by: 1)) { context in
                        Text("\(state.eyebrow ?? "") · \(elapsedText(from: startedAt, to: context.date))")
                            .monospacedDigit()
                    }
                } else {
                    Text(state.eyebrow ?? "")
                }
            }
            .font(TapeType.sans(11, .medium))
            .tracking(0.7)
            .textCase(.uppercase)
            .foregroundStyle(TapePalette.ash)
            .frame(height: 14)

            if model.isRecording {
                RecordingDestinationCard(model: model, togglePicker: toggleMeetingPicker)
                    .focused($isTitleFocused)
                    .padding(.top, 10)
                    .padding(.trailing, showsWindowChrome ? 0 : 24)

                RecordingLevelsView(
                    microphoneLevel: model.microphoneLevel,
                    systemAudioLevel: model.systemAudioLevel
                )
                .padding(.top, 14)
            } else {
                Text(state.title)
                    .lineLimit(2)
                    .font(TapeType.serif(22))
                    .tracking(-0.3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
                    .padding(.trailing, showsWindowChrome ? 0 : 24)

                Text(state.detail)
                    .font(TapeType.sans(12))
                    .foregroundStyle(TapePalette.muted)
                    .lineLimit(2)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: true)
                    .help(state.detailHelp ?? "")
                    .padding(.top, 4)

                if model.nextPermissionStep != nil {
                    SetupChecklist(checklist: model.permissionChecklist)
                        .padding(.top, 12)
                }

                if showsDestinationChip {
                    RecordingDestinationChip(model: model, togglePicker: toggleMeetingPicker)
                        .padding(.top, 12)
                    if showsConflictNote {
                        Text("Saved as a new meeting so the bot's recording stays intact.")
                            .font(TapeType.sans(11))
                            .foregroundStyle(TapePalette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 6)
                    }
                }
            }

            if let prompt = model.endPrompt {
                RecorderEndPromptView(model: model, prompt: prompt).padding(.top, 12)
            }

            uploadSection

            if let notice = statusNotice, uploadProblem == nil {
                Text(notice.text)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                .font(TapeType.sans(12, .medium))
                .foregroundStyle(notice.isProblem ? TapePalette.coralInk : TapePalette.muted)
                .padding(.top, 8)
            }

            if model.endPrompt == nil {
            Button(action: performPrimaryAction) {
                Text(state.actionTitle)
            }
            .buttonStyle(RecorderActionButtonStyle(kind: state.actionKind))
            .disabled(state.isActionDisabled)
            .fixedSize()
            .padding(.top, showsDestinationChip ? 12 : 16)
            }
        }
        // Short titles must not shrink the column: it would center in the panel
        // and slide under the toolbar overlay.
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: model.isMeetingPickerPresented) { _, expanded in
            if !expanded { isTitleFocused = true }
        }
        .overlay(alignment: .topTrailing) {
            if !showsWindowChrome {
                toolbarControls
                    .offset(x: 6, y: -4)
            }
        }
    }

    private var toolbarControls: some View {
        HStack(spacing: 2) {
            if isSignedIn, model.nextPermissionStep == nil, !model.isRecording, !model.isFinishingRecording {
                Button(action: model.checkNow) {
                    Group {
                        if model.isRefreshingSchedule {
                            ProgressView()
                                .controlSize(.mini)
                        } else {
                            Image(systemName: "arrow.clockwise")
                                .font(TapeType.sans(11.5))
                        }
                    }
                    .foregroundStyle(TapePalette.ash)
                    .frame(width: 22, height: 20)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!model.canMonitor || model.isRefreshingSchedule)
                .help("Refresh schedule")
            }
            settingsToggle
        }
    }

    @ViewBuilder
    private var uploadSection: some View {
            if isSignedIn, !model.visibleUploadReceipts.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(model.visibleUploadReceipts) { receipt in
                        RecordingReceiptCard(
                            title: receipt.target?.meetingTitle ?? "Stopped recording",
                            status: receipt.message,
                            phase: receipt.needsAttention ? .failed : (receipt.isTerminal ? .done : .working),
                            meetingURL: receipt.meetingURL,
                            retry: { model.retryUploadsNow() },
                            showFile: { model.showSavedRecordings() }
                        )
                    }
                }
                .padding(.top, 12)
            }
            if isSignedIn, model.pendingUploadCount > 1 {
                Text("\(model.pendingUploadCount) recordings still saving")
                    .font(TapeType.sans(11)).foregroundStyle(TapePalette.muted).padding(.top, 6)
            }
            if let problem = uploadProblem {
                RecordingReceiptCard(
                    title: model.uploadReceipts.last?.target?.meetingTitle ?? "Untitled recording",
                    status: problem,
                    phase: .failed,
                    meetingURL: nil,
                    retry: { model.retryUploadsNow() },
                    showFile: { model.showSavedRecordings() }
                )
                .padding(.top, 12)
            } else if isSignedIn, model.uploadReceipts.isEmpty && (model.pendingUploadCount > 0 || model.uploadStatusText != nil) {
                Text(model.uploadStatusText ?? "Uploading recording. Keep Tape open.")
                    .font(TapeType.sans(11))
                    .foregroundStyle(TapePalette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }

            if model.uploadStatusText?.localizedCaseInsensitiveContains("reconnect") == true || model.uploadStatusText?.localizedCaseInsensitiveContains("sign in") == true {
                Button("Reconnect", action: model.signIn).font(TapeType.sans(11, .medium)).padding(.top, 4)
            }
    }

    private var showsConflictNote: Bool {
        guard model.nextScheduleMeeting?.botStatus == "recording" else { return false }
        if case .newMeeting = model.recordingDestination { return true }
        return false
    }

    /// A failed upload gets a card with recovery actions instead of a status line.
    private var uploadProblem: String? {
        guard isSignedIn, !model.isRecording else { return nil }
        let text = model.uploadStatusText ?? model.statusText
        guard text.localizedCaseInsensitiveContains("upload"),
              ["could not", "stopped", "failed"].contains(where: { text.localizedCaseInsensitiveContains($0) })
        else { return nil }
        return "Upload failed · Saved on this Mac"
    }

    /// Surfaces the model's status line when it says something the summary does not,
    /// such as a failed upload, an expired session, or a fallback to local recording.
    private var statusNotice: (text: String, isProblem: Bool)? {
        let text = (model.recordingStartFailure?.message ?? model.statusText).trimmingCharacters(in: .whitespacesAndNewlines)
        let routine: Set<String> = [
            "", "Sign in to start monitoring", "Finish access setup", "Permissions ready",
            "Screen and audio ready", "Checking your calendar", "Watching your calendar",
            "No upcoming meetings", "Monitoring", "Recording \(model.activeRecordingTitle ?? "")",
            "Signed out", "Testing audio levels", "Recording", "Capture stopped", "Starting recording",
        ]
        guard !routine.contains(text), !model.isFinishingRecording, !model.isRequestingPermissions else {
            return nil
        }
        if model.nextPermissionStep != nil, text.hasPrefix("Enable") {
            return nil
        }
        let problemMarkers = ["could not", "stopped", "expired", "paused", "enter a valid", "enable", "allow", "failed"]
        let isProblem = model.recordingStartFailure != nil || problemMarkers.contains { text.localizedCaseInsensitiveContains($0) }
        return (text, isProblem)
    }

    private var settingsToggle: some View {
        Button(action: { model.isAdvancedExpanded.toggle() }) {
            Image(systemName: "gearshape")
                .font(TapeType.sans(12, .regular))
                .foregroundStyle(TapePalette.ash)
                .frame(width: 20, height: 20)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(model.isAdvancedExpanded ? "Close settings" : "Settings")
    }

    // MARK: State

    private var isSignedIn: Bool {
        !model.bearerToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Record always says where it will save, so nothing lands in a meeting the user did not see.
    private var showsDestinationChip: Bool {
        isSignedIn && model.nextPermissionStep == nil && model.endPrompt == nil
            && !model.isRecording && !model.isStartingRecording && !model.isFinishingRecording
            && !model.isRequestingPermissions && model.recordingStartFailure != .signInRequired
    }

    private var showsMeetingPicker: Bool {
        model.isMeetingPickerPresented && (model.isRecording || showsDestinationChip)
    }

    private func toggleMeetingPicker() {
        model.isMeetingPickerPresented.toggle()
        if model.isMeetingPickerPresented {
            model.meetingSearch = ""
            model.loadMeetingChoices()
        }
    }

    private var state: RecorderSummaryState {
        let title = model.destinationUnconfirmed ? "Confirm recording destination" : (model.activeRecordingTitle ?? "Untitled recording")

        if model.isRequestingPermissions {
            return RecorderSummaryState(
                eyebrow: "Setting up",
                tone: TapePalette.amber,
                title: "Waiting for macOS",
                detail: "Approve each permission prompt",
                actionTitle: "Requesting access",
                actionKind: .primary,
                isActionDisabled: true
            )
        }
        if model.isStartingRecording {
            return RecorderSummaryState(eyebrow: "Starting", tone: TapePalette.amber, title: model.startingRecordingTitle, detail: "Preparing audio capture", actionTitle: "Starting", actionKind: .quiet, isActionDisabled: true)
        }
        if model.isFinishingRecording {
            let isUploading = model.statusText.localizedCaseInsensitiveContains("upload")
            return RecorderSummaryState(
                eyebrow: isUploading ? "Uploading" : "Saving",
                tone: TapePalette.amber,
                title: title,
                detail: model.statusText,
                actionTitle: isUploading ? "Uploading" : "Saving",
                actionKind: .quiet,
                isActionDisabled: true
            )
        }
        if model.isRecording {
            return RecorderSummaryState(
                eyebrow: model.captureNaturallyEnded ? "Capture ended" : "Recording",
                tone: TapePalette.coral,
                title: title,
                detail: "",
                actionTitle: "Stop",
                actionKind: .stop,
                isActionDisabled: false
            )
        }
        if !isSignedIn {
            return RecorderSummaryState(
                eyebrow: "Tape for Mac",
                tone: nil,
                title: "Every meeting, on the record",
                detail: "Records your mic and Mac audio into your Tape workspace.",
                actionTitle: "Sign in with Google",
                actionKind: .primary,
                isActionDisabled: false
            )
        }
        if let step = model.nextPermissionStep {
            let opensSettings = step == .alerts && model.permissionChecklist.notifications == .denied
            return RecorderSummaryState(
                eyebrow: "Setup · \(model.permissionChecklist.grantedSetupCount + 1) of 4",
                tone: TapePalette.amber,
                title: step.statusTitle,
                detail: step.statusDetail,
                actionTitle: opensSettings ? "Open Alerts Settings" : step.actionTitle,
                actionKind: .primary,
                isActionDisabled: false
            )
        }
        if let meeting = model.nextScheduleMeeting {
            let isOngoing = meeting.isOngoing(at: Date())
            return RecorderSummaryState(
                eyebrow: isOngoing ? "Happening now" : "Coming up · \(dayText(meeting.startsAt))",
                tone: isOngoing ? TapePalette.green : nil,
                title: meeting.title,
                detail: isOngoing
                    ? "\(meeting.endsAt.map { "Until " + timeText($0) } ?? "Started at " + timeText(meeting.startsAt)) · \(notetakerText(meeting))"
                    : "\(rangeText(meeting)) · \(notetakerText(meeting))",
                detailHelp: meeting.botStatusDetail,
                actionTitle: model.recordingStartFailure?.actionTitle ?? (meeting.botStatus == "recording" ? "Record on this Mac" : "Record now"),
                actionKind: .primary,
                isActionDisabled: false
            )
        }
        return RecorderSummaryState(
            eyebrow: "Watching your calendar",
            tone: nil,
            title: "Nothing scheduled",
            detail: "Your next calendar meeting appears here.",
            actionTitle: model.recordingStartFailure?.actionTitle ?? "Record now",
            actionKind: .primary,
            isActionDisabled: false
        )
    }

    private func performPrimaryAction() {
        if model.isFinishingRecording || model.isStartingRecording {
            return
        } else if model.isRecording {
            model.stopRecording()
        } else if !isSignedIn || model.recordingStartFailure == .signInRequired {
            model.signIn()
        } else if model.nextPermissionStep != nil {
            model.requestNextPermission()
        } else {
            // The destination chip already excludes rejected or bot-recorded meetings.
            model.startRecording()
        }
    }

    // MARK: Formatting

    private func timeText(_ date: Date) -> String {
        date.formatted(TapeFormat.time)
    }

    private func rangeText(_ meeting: LocalRecorderMonitoringMeeting) -> String {
        guard let endsAt = meeting.endsAt else {
            return timeText(meeting.startsAt)
        }
        return (meeting.startsAt..<max(endsAt, meeting.startsAt)).formatted(TapeFormat.timeRange)
    }

    private func dayText(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return "Today"
        }
        if calendar.isDateInTomorrow(date) {
            return "Tomorrow"
        }
        return date.formatted(.dateTime.weekday(.wide).locale(TapeFormat.locale))
    }

    private func notetakerText(_ meeting: LocalRecorderMonitoringMeeting) -> String {
        switch meeting.botStatus {
        case "scheduled":
            return meeting.isOngoing(at: Date()) ? "Bot hasn't joined yet" : "Bot joins at \(timeText(meeting.startsAt))"
        case "recording":
            return "Bot is recording this meeting"
        case "joined":
            return "Tape is in the call"
        case "joining", "joining_call":
            return "Bot joining"
        case "not_planned", "unavailable", "not_scheduled", "none":
            return "No meeting bot"
        case "in_meeting_room":
            return "Tape is waiting to be let in"
        default:
            return meeting.botStatusLabel == "Not planned" ? "No meeting bot" : meeting.botStatusLabel
        }
    }

    private func elapsedText(from start: Date, to now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let remainder = seconds % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, remainder)
            : String(format: "%d:%02d", minutes, remainder)
    }
}

/// The menu bar panel grows with its content but does not shrink back, which leaves
/// an empty translucent band. Resize it to the content, keeping the top edge pinned
/// under the menu bar.
@MainActor
final class PanelWindowFitter {
    weak var window: NSWindow? {
        didSet { if let pendingHeight { fit(contentHeight: pendingHeight) } }
    }
    private var pendingHeight: CGFloat?

    func fit(contentHeight: CGFloat) {
        guard let window else { pendingHeight = contentHeight; return }
        pendingHeight = nil
        let chrome = window.frame.height - window.contentLayoutRect.height
        let height = (contentHeight + chrome).rounded()
        guard abs(window.frame.height - height) > 0.5 else { return }
        var frame = window.frame
        frame.origin.y += frame.height - height
        frame.size.height = height
        guard window.isVisible else {
            window.setFrame(frame, display: true)
            return
        }
        // Match TapeDisclosureStyle's timing so the panel edge moves with the content.
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.15
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            window.animator().setFrame(frame, display: true)
        }
    }
}

struct HostingWindowReader: NSViewRepresentable {
    var onWindow: (NSWindow?) -> Void

    func makeNSView(context: Context) -> NSView {
        let view = WindowReportingView()
        view.onWindow = onWindow
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {}

    private final class WindowReportingView: NSView {
        var onWindow: ((NSWindow?) -> Void)?
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            onWindow?(window)
        }
    }
}

private struct RecorderSummaryState {
    var eyebrow: String?
    var tone: Color?
    var title: String
    var detail: String
    var detailNote: String? = nil
    var detailSymbol: String? = nil
    var detailHelp: String? = nil
    var actionTitle: String
    var actionKind: RecorderActionButtonStyle.Kind
    var isActionDisabled: Bool
}

/// The system disclosure only toggles from its small arrow; here the whole label row does.
struct TapeDisclosureStyle: DisclosureGroupStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.15)) {
                    configuration.isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    configuration.label
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(TapeType.sans(10, .semibold))
                        .foregroundStyle(TapePalette.muted)
                        .rotationEffect(.degrees(configuration.isExpanded ? 90 : 0))
                }
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(configuration.isExpanded ? "Expanded" : "Collapsed")

            if configuration.isExpanded {
                configuration.content
                    .transition(.opacity)
            }
        }
    }
}

struct RecorderActionButtonStyle: ButtonStyle {
    enum Kind {
        case primary
        /// Quiet capsule with a coral square: the recording itself is the focus, not the button.
        case stop
        case quiet
    }

    var kind: Kind
    var height: CGFloat = 30
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let isQuiet = kind != .primary
        HStack(spacing: 7) {
            if kind == .stop {
                RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                    .fill(TapePalette.coral)
                    .frame(width: 8, height: 8)
            }
            configuration.label
        }
        .font(TapeType.sans(height < 30 ? 12 : 13, .medium))
        .foregroundStyle(isQuiet ? TapePalette.ink : TapePalette.onCoral)
        .padding(.horizontal, height < 30 ? 11 : 14)
        .frame(height: height)
        .background(
            // Coral is the brand's primary action color (DESIGN.md).
            Capsule().fill(isQuiet ? TapePalette.surface : TapePalette.coral)
        )
        .overlay(
            Capsule().inset(by: 0.5).stroke(isQuiet ? TapePalette.border : Color.clear, lineWidth: 1)
        )
        .opacity(configuration.isPressed ? 0.8 : (isEnabled ? 1 : 0.55))
        .contentShape(Capsule())
    }
}

/// Three coral dots that breathe in sequence while audio is being captured.
struct LiveDots: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 0.1, paused: !StatusDot.pulsesWhileLive)) { context in
            let phase = context.date.timeIntervalSinceReferenceDate * 2.4
            HStack(spacing: 3) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(TapePalette.coral)
                        .frame(width: 4, height: 4)
                        .opacity(StatusDot.pulsesWhileLive ? 0.35 + 0.65 * max(0, sin(phase - Double(index) * 0.8)) : 1)
                }
            }
        }
        .accessibilityLabel("Recording")
    }
}

struct LiveLevelMeter: View {
    var samples: [Float]

    var body: some View {
        GeometryReader { proxy in
            HStack(alignment: .center, spacing: 2) {
                ForEach(Array(samples.enumerated()), id: \.offset) { _, sample in
                    Rectangle()
                        .fill(TapePalette.coral.opacity(0.7))
                        .frame(height: max(2, proxy.size.height * CGFloat(min(1, sample))))
                }
            }
            .frame(maxHeight: .infinity, alignment: .center)
        }
        .animation(.linear(duration: 0.1), value: samples)
        .accessibilityLabel("Audio level")
    }
}

/// Where the current recording is saved. The whole card opens the meeting picker.
struct RecordingDestinationCard: View {
    @ObservedObject var model: RecorderAppModel
    var togglePicker: () -> Void
    @State private var isHovering = false

    var body: some View {
        let title = model.activeRecordingTitle ?? "Untitled recording"
        Button(action: togglePicker) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Saving to")
                    .font(TapeType.sans(11, .medium))
                    .foregroundStyle(TapePalette.muted)

                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title)
                        .font(TapeType.serif(18))
                        .tracking(-0.2)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .contentTransition(.opacity)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(TapeType.sans(11, .medium))
                        .foregroundStyle(TapePalette.ash)
                }
                .foregroundStyle(TapePalette.ink)

                if model.destinationUnconfirmed {
                    HStack(spacing: 5) {
                        Circle().fill(TapePalette.amber).frame(width: 5, height: 5)
                        Text("Couldn't move this recording · Choose again")
                            .foregroundStyle(TapePalette.coralInk)
                    }
                    .font(TapeType.sans(11.5, .medium))
                } else if let meta = meta {
                    Text(meta)
                        .font(TapeType.sans(11.5))
                        .foregroundStyle(TapePalette.muted)
                        .monospacedDigit()
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isHovering || model.isMeetingPickerPresented ? TapePalette.mist : TapePalette.surface, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(TapePalette.border, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.15), value: title)
        .help("Change which meeting this recording is saved to")
        .accessibilityLabel("Saving to \(title)")
        .accessibilityHint("Change which meeting this recording is saved to")
        .accessibilityValue(model.destinationUnconfirmed ? "Couldn't move this recording" : "")
    }

    private var meta: String? {
        guard let start = model.activeTarget?.startsAt else { return nil }
        let calendar = Calendar.current
        let day = calendar.isDateInToday(start) ? "Today"
            : calendar.isDateInYesterday(start) ? "Yesterday"
            : start.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().locale(TapeFormat.locale))
        guard let end = model.activeTarget?.endsAt, end > start else {
            return "\(day) · \(start.formatted(TapeFormat.time))"
        }
        return "\(day) · \((start..<end).formatted(TapeFormat.timeRange))"
    }
}

/// Before recording: states where Record will save, and opens the picker to change it.
struct RecordingDestinationChip: View {
    @ObservedObject var model: RecorderAppModel
    var togglePicker: () -> Void
    @State private var isHovering = false

    var body: some View {
        Button(action: togglePicker) {
            HStack(spacing: 6) {
                Image(systemName: isNewMeeting ? "plus.circle" : "doc.text")
                    .font(TapeType.sans(11))
                    .foregroundStyle(TapePalette.ash)
                Text("Saves to")
                    .foregroundStyle(TapePalette.muted)
                Text(label)
                    .foregroundStyle(TapePalette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(TapeType.sans(11, .medium))
                    .foregroundStyle(TapePalette.ash)
            }
            .font(TapeType.sans(12, .medium))
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(Capsule().fill(isHovering || model.isMeetingPickerPresented ? TapePalette.mist : TapePalette.surface))
            .overlay(Capsule().inset(by: 0.5).stroke(TapePalette.border, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .help("Choose which meeting this recording is saved to")
        .accessibilityLabel("Saves to \(label)")
        .accessibilityHint("Choose which meeting this recording is saved to")
    }

    private var label: String {
        switch model.recordingDestination {
        case .meeting(let id, let title):
            // The suggested meeting is the one titled right above the chip.
            return id == model.suggestedMeeting?.meetingId ? "This meeting" : title
        case .newMeeting(let title):
            return title ?? "New meeting"
        }
    }

    private var isNewMeeting: Bool {
        if case .newMeeting = model.recordingDestination { return true }
        return false
    }
}

/// Live proof that capture is working: one meter per source, so a silent microphone
/// or missing system audio is visible at a glance.
struct RecordingLevelsView: View {
    var microphoneLevel: Float
    var systemAudioLevel: Float
    @State private var lastHeard = Date()

    var body: some View {
        HStack(spacing: 18) {
            SourceLevel(title: "Mic", level: microphoneLevel)
            SourceLevel(title: "Mac sound", level: systemAudioLevel)
            Spacer(minLength: 0)
            TimelineView(.periodic(from: .now, by: 1)) { context in
                if context.date.timeIntervalSince(lastHeard) > 10 {
                    Text("No sound yet")
                        .font(TapeType.sans(11))
                        .foregroundStyle(TapePalette.ash)
                        .transition(.opacity)
                }
            }
        }
        .onChange(of: max(microphoneLevel, systemAudioLevel)) { _, level in
            if level > 0.02 { lastHeard = Date() }
        }
    }
}

struct SourceLevel: View {
    var title: String
    var level: Float

    var body: some View {
        HStack(spacing: 7) {
            Text(title)
                .font(TapeType.sans(11.5))
                .foregroundStyle(TapePalette.muted)
            AudioLevelBar(level: level, inkOpacity: 0.65, height: 6)
                .frame(width: 64)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title) level")
        .accessibilityValue("\(Int(min(1, max(0, level)) * 100)) percent")
    }
}

struct AudioLevelBar: View {
    var level: Float
    var inkOpacity: Double
    var height: CGFloat = 4

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(TapePalette.hairline)
                Capsule()
                    .fill(level > 0.9 ? TapePalette.amber : TapePalette.ink.opacity(inkOpacity))
                    .frame(width: proxy.size.width * CGFloat(min(1, max(0, level))))
            }
        }
        .frame(height: height)
        .animation(.linear(duration: 0.1), value: level)
    }
}

struct StatusDot: View {
    /// Snapshot rendering turns this off so captures show the dot at rest.
    @MainActor static var pulsesWhileLive = true

    /// No tone means nothing needs attention: a quiet ring instead of a filled dot.
    var tone: Color?
    var isLive: Bool

    var body: some View {
        Group {
            if let tone {
                Image(systemName: "circle.fill")
                    .font(TapeType.sans(6))
                    .foregroundStyle(tone)
                    .symbolEffect(.pulse, options: .repeating, isActive: isLive && Self.pulsesWhileLive)
            } else {
                Circle()
                    .strokeBorder(TapePalette.ash, lineWidth: 1)
                    .frame(width: 6, height: 6)
            }
        }
        .frame(width: 8, height: 8)
        .accessibilityHidden(true)
    }
}

// MARK: Settings

struct RecorderSettingsView: View {
    @ObservedObject var model: RecorderAppModel
    var isSignedIn: Bool
    @State private var showsAudioCheck = false
    @State private var showsPermissions = false
#if DEBUG
    @State private var showsDevelopmentServer = false
#endif

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            section("Permissions") {
                if model.permissionChecklist.allSetupGranted {
                    // Nothing to act on: one line, with the details a click away.
                    DisclosureGroup(isExpanded: $showsPermissions) {
                        permissionList.padding(.top, 8)
                    } label: {
                        HStack(spacing: 6) {
                            Text("All allowed")
                            Image(systemName: "checkmark")
                                .font(TapeType.sans(11, .semibold))
                                .foregroundStyle(TapePalette.green)
                        }
                    }
                } else {
                    permissionList
                }
            }

            if model.hasAudioCapturePermissions {
                DisclosureGroup("Audio check", isExpanded: $showsAudioCheck) {
                    audioCheck.padding(.top, 8)
                }
            }

            if isSignedIn, let account = model.account {
                section("Account") {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(account.email)
                        Text(account.workspaceName)
                            .foregroundStyle(TapePalette.muted)
                    }
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }

#if DEBUG
            if !isSignedIn {
                DisclosureGroup("Development server", isExpanded: $showsDevelopmentServer) {
                    TextField("Server", text: $model.serverURLText)
                        .textFieldStyle(.roundedBorder)
                        .controlSize(.small)
                        .padding(.top, 8)
                }
            }
#endif

            HStack(spacing: 14) {
                if isSignedIn {
                    textButton("Sign out", isDestructive: true, action: model.signOut)
                }
                textButton("Check for updates", action: model.checkForUpdates)
                // macOS applies some grants only after a relaunch.
                textButton(model.isRestarting ? "Restarting…" : "Restart", action: model.restartApp)
                    .disabled(model.isRestarting || model.isRequestingPermissions)
                Spacer()
                textButton("Quit", isDestructive: true, action: model.exitApp)
            }
        }
        .font(TapeType.sans(12))
        .tint(TapePalette.graphite)
        .disclosureGroupStyle(TapeDisclosureStyle())
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .transition(.opacity)
    }

    private var permissionList: some View {
        PermissionList(
            checklist: model.permissionChecklist,
            requestPermission: model.requestPermission,
            setStartAtLoginEnabled: model.setStartAtLoginEnabled,
            repairAccessibility: model.repairAccessibility,
            showAppInFinder: model.showAppInFinder,
            isBusy: model.isRequestingPermissions || model.isRestarting || model.isRecording || model.isFinishingRecording
        )
    }

    private var audioCheck: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Picker(
                    "Mic input",
                    selection: Binding(
                        get: { model.selectedMicrophoneUID },
                        set: { model.selectMicrophone(uid: $0) }
                    )
                ) {
                    Text("System default").tag(String?.none)
                    ForEach(model.availableMicrophones) { device in
                        Text(device.name).tag(String?.some(device.uid))
                    }
                }
                .controlSize(.small)
                .disabled(model.isRecording)
                .onAppear(perform: model.refreshMicrophones)

                if !model.isRecording {
                    textButton(model.isTestingLevels ? "Stop test" : "Test levels", action: model.toggleLevelTest)
                        .disabled(!model.hasAudioCapturePermissions || model.isFinishingRecording)
                }
            }

            AudioLevelMeterRow(title: "Microphone", level: model.microphoneLevel)
            AudioLevelMeterRow(title: "Mac sound", level: model.systemAudioLevel)

            Text(
                model.isTestingLevels
                    ? "Speak and play any sound. Both bars should move."
                    : "Levels are live while recording or testing."
            )
            .font(TapeType.sans(11.5))
            .foregroundStyle(TapePalette.ash)
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(TapeType.sans(11, .medium))
                .tracking(0.7)
                .textCase(.uppercase)
                .foregroundStyle(TapePalette.ash)
            content()
        }
    }

    private func textButton(_ title: String, isDestructive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(title, role: isDestructive ? .destructive : nil, action: action)
            .buttonStyle(.plain)
            .font(TapeType.sans(12, .medium))
            .foregroundStyle(isDestructive ? TapePalette.coralInk : TapePalette.graphite)
    }
}

struct AudioLevelMeterRow: View {
    var title: String
    var level: Float

    var body: some View {
        HStack(spacing: 10) {
            Text(title)
                .font(TapeType.sans(12))
                .foregroundStyle(TapePalette.graphite)
                .frame(width: 76, alignment: .leading)

            AudioLevelBar(level: level, inkOpacity: 0.7)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title) level")
        .accessibilityValue("\(Int(min(1, max(0, level)) * 100)) percent")
    }
}

/// The outcome of one stopped recording, with the action that recovers it.
struct RecordingReceiptCard: View {
    enum Phase { case working, done, failed }
    var title: String
    var status: String
    var phase: Phase
    var meetingURL: URL?
    /// Offered only when the upload failed.
    var retry: () -> Void
    var showFile: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Last recording")
                .font(TapeType.sans(11, .medium))
                .tracking(0.7)
                .textCase(.uppercase)
                .foregroundStyle(TapePalette.ash)
            Text(title)
                .font(TapeType.sans(13, .medium))
                .foregroundStyle(TapePalette.ink)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                switch phase {
                case .working:
                    ProgressView().controlSize(.mini)
                case .done:
                    Image(systemName: "checkmark")
                        .font(TapeType.sans(11, .semibold))
                        .foregroundStyle(TapePalette.green)
                case .failed:
                    EmptyView()
                }
                Text(status)
                    .font(TapeType.sans(12))
                    .foregroundStyle(phase == .failed ? TapePalette.coralInk : TapePalette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if phase == .failed {
                HStack(spacing: 8) {
                    Button("Retry upload", action: retry)
                        .help("Tape also retries on its own")
                    Button("Show file", action: showFile)
                }
                .buttonStyle(RecorderActionButtonStyle(kind: .quiet, height: 26))
                .padding(.top, 4)
            } else if let meetingURL {
                Link(destination: meetingURL) { Text("Open meeting") }
                    .buttonStyle(RecorderActionButtonStyle(kind: .quiet, height: 26))
                    .padding(.top, 4)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TapePalette.surface, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(TapePalette.border, lineWidth: 1))
    }
}
