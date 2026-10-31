import LocalRecorderCore
import SwiftUI

struct PermissionList: View {
    var checklist: PermissionChecklist
    var requestPermission: (OperationalPermission) -> Void
    var setStartAtLoginEnabled: @MainActor @Sendable (Bool) -> Void
    var repairAccessibility: () -> Void
    var showAppInFinder: () -> Void
    var isBusy: Bool
    @State private var showsRecovery = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            PermissionRow(title: "Microphone", grant: checklist.microphone) {
                requestPermission(.microphone)
            }
            PermissionRow(title: "Screen and system audio", grant: checklist.screenCapture) {
                requestPermission(.screenCapture)
            }
            PermissionRow(title: "Accessibility", grant: checklist.accessibility) {
                requestPermission(.accessibility)
            }
            PermissionRow(title: "Alerts", grant: checklist.notifications) {
                requestPermission(.notifications)
            }
            HStack {
                Text("Open at login")
                    .font(TapeType.sans(12))
                Spacer()
                Toggle(
                    "",
                    isOn: Binding(
                        get: { checklist.startAtLogin == .granted },
                        set: { isEnabled in
                            Task { @MainActor in
                                setStartAtLoginEnabled(isEnabled)
                            }
                        }
                    )
                )
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.mini)
                .accessibilityLabel("Start Tape Desktop at login")
            }
            if checklist.accessibility != .granted {
                DisclosureGroup("Accessibility still blocked?", isExpanded: $showsRecovery) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("An older copy may have the saved permission. Reset its entry, then enable this copy in System Settings.")
                            .font(TapeType.sans(11.5))
                            .foregroundStyle(TapePalette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 16) {
                            Button("Reset access…", action: repairAccessibility)
                            Button("Show this app", action: showAppInFinder)
                        }
                        .buttonStyle(.plain)
                        .font(TapeType.sans(12, .medium))
                        .foregroundStyle(TapePalette.coralInk)
                    }
                    .padding(.top, 6)
                }
                .font(TapeType.sans(11.5))
                .padding(.top, 6)
            }
        }
        .disabled(isBusy)
    }
}

struct PermissionRow: View {
    var title: String
    var grant: PermissionGrant
    var action: () -> Void

    var body: some View {
        HStack {
            Text(title)
                .font(TapeType.sans(12))
            Spacer()
            if grant == .granted {
                Image(systemName: "checkmark")
                    .font(TapeType.sans(10, .semibold))
                    .foregroundStyle(TapePalette.green)
                    .accessibilityLabel("Allowed")
            } else {
                Button("Allow", action: action)
                    .buttonStyle(.plain)
                    .font(TapeType.sans(12, .semibold))
                    .foregroundStyle(TapePalette.coralInk)
            }
        }
        .frame(height: 18)
    }
}

extension PermissionChecklist {
    /// Steps of first-run setup already done, out of the four macOS permissions.
    var grantedSetupCount: Int {
        [microphone, screenCapture, accessibility, notifications].filter { $0 == .granted }.count
    }

    var allSetupGranted: Bool { grantedSetupCount == 4 }
}

/// First-run progress: what is done, what the button above asks for now, and what is left.
struct SetupChecklist: View {
    var checklist: PermissionChecklist

    var body: some View {
        // Same order as `nextRequiredPermission`, so the highlighted row is the one the button asks for.
        let rows: [(String, PermissionGrant)] = [
            ("Microphone", checklist.microphone),
            ("Meeting detection (Accessibility)", checklist.accessibility),
            ("Notifications", checklist.notifications),
            ("Screen and system audio", checklist.screenCapture),
        ]
        let current = rows.firstIndex { $0.1 != .granted }
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack(spacing: 8) {
                    Group {
                        if row.1 == .granted {
                            Image(systemName: "checkmark")
                                .font(TapeType.sans(11, .semibold))
                                .foregroundStyle(TapePalette.green)
                        } else {
                            Circle()
                                .strokeBorder(index == current ? TapePalette.ink : TapePalette.ash, lineWidth: 1)
                                .frame(width: 9, height: 9)
                        }
                    }
                    .frame(width: 14)
                    Text(row.0)
                        .font(TapeType.sans(12, index == current ? .medium : .regular))
                        .foregroundStyle(index == current ? TapePalette.ink : (row.1 == .granted ? TapePalette.muted : TapePalette.graphite))
                }
                .frame(height: 22)
                .accessibilityElement(children: .combine)
                .accessibilityValue(row.1 == .granted ? "Allowed" : (index == current ? "Next" : "Not allowed yet"))
            }
        }
    }
}
