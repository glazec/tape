import AppKit
import CoreText
import LocalRecorderCore
import SwiftUI

/// Warm paper and ink palette shared with the web workspace (see DESIGN.md).
enum TapePalette {
    static let paper = dynamic(light: 0xF9F8F6, dark: 0x1C1918)
    static let surface = dynamic(light: 0xFEFEFD, dark: 0x262220)
    static let mist = dynamic(light: 0xF6F3F1, dark: 0x262220)
    static let ink = dynamic(light: 0x1D1918, dark: 0xF3EFEC)
    static let charcoal = dynamic(light: 0x2B2826, dark: 0xEDE8E5)
    static let graphite = dynamic(light: 0x5A4F4A, dark: 0xB3A8A3)
    static let ash = dynamic(light: 0x746963, dark: 0xA69B95)
    static let muted = dynamic(light: 0x786D68, dark: 0x9C918C)
    static let hairline = dynamic(light: 0xE9E4E1, dark: 0x34302E)
    static let border = dynamic(light: 0xE4E0DC, dark: 0x403B39)
    static let coral = dynamic(light: 0xEC4F44, dark: 0xEF6157)
    static let coralInk = dynamic(light: 0xC23A30, dark: 0xF38A80)
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

            summary
                .padding(.horizontal, 20)
                .padding(.top, showsWindowChrome ? 8 : 18)
                .padding(.bottom, model.isAdvancedExpanded ? 14 : 18)

            if model.isAdvancedExpanded {
                RecorderSettingsView(model: model, isSignedIn: isSignedIn)
            }
        }
        .frame(width: 340)
        .background(TapePalette.paper)
        .foregroundStyle(TapePalette.ink)
        .animation(.easeOut(duration: 0.18), value: model.isAdvancedExpanded)
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

            Text(state.title)
                .font(TapeType.serif(22))
                .tracking(-0.3)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .truncationMode(.tail)
                .padding(.top, 6)
                .padding(.trailing, showsWindowChrome ? 0 : 24)

            if model.isRecording {
                RecordingLevelsView(
                    samples: model.audioLevels,
                    microphoneLevel: model.microphoneLevel,
                    systemAudioLevel: model.systemAudioLevel
                )
                .padding(.top, 10)
            } else {
                Text(state.detail)
                    .font(TapeType.sans(12.5))
                    .foregroundStyle(TapePalette.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .help(state.detailHelp ?? "")
                    .padding(.top, 3)
            }

            if let notice = statusNotice {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    if notice.isProblem {
                        Image(systemName: "exclamationmark.circle")
                            .font(TapeType.sans(11, .medium))
                    }
                    Text(notice.text)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .font(TapeType.sans(12, .medium))
                .foregroundStyle(notice.isProblem ? TapePalette.coralInk : TapePalette.muted)
                .padding(.top, 8)
            }

            Button(action: performPrimaryAction) {
                Text(state.actionTitle)
            }
            .buttonStyle(RecorderActionButtonStyle(kind: state.actionKind))
            .disabled(state.isActionDisabled)
            .fixedSize()
            .padding(.top, 16)
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

    /// Surfaces the model's status line when it says something the summary does not,
    /// such as a failed upload, an expired session, or a fallback to local recording.
    private var statusNotice: (text: String, isProblem: Bool)? {
        let text = model.statusText.trimmingCharacters(in: .whitespacesAndNewlines)
        let routine: Set<String> = [
            "", "Sign in to start monitoring", "Finish access setup", "Permissions ready",
            "Screen and audio ready", "Checking your calendar", "Watching your calendar",
            "No upcoming meetings", "Monitoring", "Recording \(model.activeRecordingTitle ?? "")",
            "Signed out", "Testing audio levels", "Recording",
        ]
        guard !routine.contains(text), !model.isFinishingRecording, !model.isRequestingPermissions else {
            return nil
        }
        if model.nextPermissionStep != nil, text.hasPrefix("Enable") {
            return nil
        }
        let problemMarkers = ["could not", "stopped", "expired", "paused", "enter a valid", "enable", "allow", "failed"]
        let isProblem = problemMarkers.contains { text.localizedCaseInsensitiveContains($0) }
        return (text, isProblem)
    }

    private var settingsToggle: some View {
        Button(action: { model.isAdvancedExpanded.toggle() }) {
            Image(systemName: model.isAdvancedExpanded ? "xmark" : "gearshape")
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

    private var state: RecorderSummaryState {
        let title = model.activeRecordingTitle ?? "Untitled recording"

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
                eyebrow: "Recording",
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
                detail: "Sign in with Google to see your calendar here.",
                actionTitle: "Sign in",
                actionKind: .primary,
                isActionDisabled: false
            )
        }
        if let step = model.nextPermissionStep {
            let opensSettings = step == .alerts && model.permissionChecklist.notifications == .denied
            return RecorderSummaryState(
                eyebrow: "Setup",
                tone: TapePalette.amber,
                title: step.statusTitle,
                detail: step.statusDetail,
                actionTitle: opensSettings ? "Open Alerts Settings" : step.actionTitle,
                actionKind: .primary,
                isActionDisabled: false
            )
        }
        if let missed = model.pendingMeetings.first {
            return RecorderSummaryState(
                eyebrow: "Not being recorded",
                tone: TapePalette.coral,
                title: missed.title,
                detail: "Started \(timeText(missed.displayTimeWindow.startsAt))",
                actionTitle: "Record on this Mac",
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
                    ? "Until \(meeting.endsAt.map(timeText) ?? "the end") · \(notetakerText(meeting))"
                    : "\(rangeText(meeting)) · \(notetakerText(meeting))",
                detailHelp: meeting.botStatusDetail,
                actionTitle: "Record on this Mac",
                actionKind: .primary,
                isActionDisabled: false
            )
        }
        return RecorderSummaryState(
            eyebrow: "Watching your calendar",
            tone: nil,
            title: "Nothing scheduled",
            detail: "Tape will pick up your next meeting",
            actionTitle: "Record on this Mac",
            actionKind: .primary,
            isActionDisabled: false
        )
    }

    private func performPrimaryAction() {
        if model.isFinishingRecording {
            return
        } else if model.isRecording {
            model.stopRecording()
        } else if !isSignedIn {
            model.signIn()
        } else if model.nextPermissionStep != nil {
            model.requestNextPermission()
        } else {
            model.startRecording()
        }
    }

    // MARK: Formatting

    private func timeText(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    private func rangeText(_ meeting: LocalRecorderMonitoringMeeting) -> String {
        guard let endsAt = meeting.endsAt else {
            return timeText(meeting.startsAt)
        }
        return (meeting.startsAt..<max(endsAt, meeting.startsAt)).formatted(
            .interval.hour().minute()
        )
    }

    private func dayText(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return "Today"
        }
        if calendar.isDateInTomorrow(date) {
            return "Tomorrow"
        }
        return date.formatted(.dateTime.weekday(.wide))
    }

    private func notetakerText(_ meeting: LocalRecorderMonitoringMeeting) -> String {
        switch meeting.botStatus {
        case "scheduled":
            return "Tape will join automatically"
        case "joined", "recording":
            return "Tape is in the call"
        case "in_meeting_room":
            return "Tape is waiting to be let in"
        default:
            return meeting.botStatusLabel
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

struct RecorderActionButtonStyle: ButtonStyle {
    enum Kind {
        case primary
        case stop
        case quiet
    }

    var kind: Kind
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 7) {
            if kind == .stop {
                RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                    .fill(TapePalette.coral)
                    .frame(width: 8, height: 8)
            }
            configuration.label
        }
        .font(TapeType.sans(13, .medium))
        .foregroundStyle(kind == .quiet ? TapePalette.ink : TapePalette.paper)
        .padding(.horizontal, 14)
        .frame(height: 30)
        .background(
            Capsule().fill(kind == .quiet ? TapePalette.surface : TapePalette.charcoal)
        )
        .overlay(
            Capsule().strokeBorder(kind == .quiet ? TapePalette.border : Color.clear)
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

/// Live proof that capture is working: a rolling waveform plus one meter per source,
/// so a silent microphone or missing system audio is visible at a glance.
struct RecordingLevelsView: View {
    var samples: [Float]
    var microphoneLevel: Float
    var systemAudioLevel: Float

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            RollingWaveform(samples: samples)
                .frame(height: 26)
            HStack(spacing: 16) {
                SourceLevel(title: "Mic", level: microphoneLevel)
                SourceLevel(title: "Mac sound", level: systemAudioLevel)
            }
        }
    }
}

struct RollingWaveform: View {
    var samples: [Float]

    var body: some View {
        GeometryReader { proxy in
            let count = max(samples.count, 1)
            let spacing: CGFloat = 2
            let barWidth = max(1.5, (proxy.size.width - spacing * CGFloat(count - 1)) / CGFloat(count))
            HStack(alignment: .center, spacing: spacing) {
                ForEach(Array(samples.enumerated()), id: \.offset) { _, sample in
                    Capsule()
                        .fill(TapePalette.coral.opacity(0.8))
                        .frame(width: barWidth, height: max(2, proxy.size.height * CGFloat(min(1, sample))))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .leading)
        }
        .animation(.linear(duration: 0.1), value: samples)
        .accessibilityHidden(true)
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
            AudioLevelBar(level: level, inkOpacity: 0.65)
                .frame(width: 54)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title) level")
        .accessibilityValue("\(Int(min(1, max(0, level)) * 100)) percent")
    }
}

struct AudioLevelBar: View {
    var level: Float
    var inkOpacity: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(TapePalette.hairline)
                Capsule()
                    .fill(level > 0.9 ? TapePalette.amber : TapePalette.ink.opacity(inkOpacity))
                    .frame(width: proxy.size.width * CGFloat(min(1, max(0, level))))
            }
        }
        .frame(height: 4)
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
#if DEBUG
    @State private var showsDevelopmentServer = false
#endif

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            section("Permissions") {
                PermissionList(
                    checklist: model.permissionChecklist,
                    requestPermission: model.requestPermission,
                    setStartAtLoginEnabled: model.setStartAtLoginEnabled,
                    repairAccessibility: model.repairAccessibility,
                    showAppInFinder: model.showAppInFinder,
                    isBusy: model.isRequestingPermissions || model.isRestarting || model.isRecording || model.isFinishingRecording
                )
            }

            if model.hasAudioCapturePermissions {
                DisclosureGroup("Audio check", isExpanded: $showsAudioCheck) {
                    audioCheck.padding(.top, 8)
                }
            }

            if isSignedIn {
                section("Account") {
                    if let account = model.account {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(account.email)
                            Text(account.workspaceName)
                                .foregroundStyle(TapePalette.muted)
                        }
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text("Account details unavailable. Check your connection.")
                            .foregroundStyle(TapePalette.muted)
                    }
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
                textButton("Updates", action: model.checkForUpdates)
                textButton(model.isRestarting ? "Restarting…" : "Restart", action: model.restartApp)
                    .disabled(model.isRestarting || model.isRequestingPermissions)
                Spacer()
                textButton("Quit", isDestructive: true, action: model.exitApp)
            }
        }
        .font(TapeType.sans(12))
        .tint(TapePalette.graphite)
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .transition(.opacity)
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
                .font(TapeType.sans(11, .semibold))
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
