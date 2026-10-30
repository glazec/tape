#if DEBUG
import AppKit
import LocalRecorderCore
import SwiftUI

/// Renders the recorder window in representative states for design review.
@MainActor
enum LocalRecorderSnapshot {
    static func render(to directory: URL) {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        app.finishLaunching()
        app.activate(ignoringOtherApps: true)
        let iconURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("../../Resources/AppIcon.icns")
        if let icon = NSImage(contentsOf: iconURL) {
            app.applicationIconImage = icon
        }

        StatusDot.pulsesWhileLive = false
        TapeType.register()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let appearance = ProcessInfo.processInfo.environment["TAPE_DESKTOP_SNAPSHOT_APPEARANCE"] == "dark"
            ? NSAppearance(named: .darkAqua)
            : NSAppearance(named: .aqua)

        let captures = states().map { name, model in
            (name, capture(model: model, appearance: appearance))
        }
        for (name, image) in captures {
            write(image, to: directory.appendingPathComponent("\(name).png"))
        }
        // The review composite keeps the three primary states; the rest are written for checking.
        write(composite(captures.prefix(3).map(\.1)), to: directory.appendingPathComponent("composite.png"))
    }

    private static func states() -> [(String, RecorderAppModel)] {
        let granted = PermissionChecklist(
            microphone: .granted,
            screenCapture: .granted,
            accessibility: .granted,
            notifications: .granted,
            startAtLogin: .granted
        )

        let signedOut = RecorderAppModel(snapshotBearerToken: "")
        signedOut.statusText = "Sign in to start monitoring"

        let upcoming = RecorderAppModel(snapshotBearerToken: "token")
        upcoming.permissionChecklist = granted
        upcoming.statusText = "Monitoring"
        let start = Calendar.current.date(bySettingHour: 14, minute: 30, second: 0, of: Date().addingTimeInterval(86_400))!
        let iso = ISO8601DateFormatter()
        let json = """
        {"botStatus":"scheduled","botStatusDetail":"Bot will join at start","botStatusLabel":"Bot scheduled",\
        "endsAt":"\(iso.string(from: start.addingTimeInterval(45 * 60)))","meetingId":"snapshot",\
        "startsAt":"\(iso.string(from: start))","title":"Weekly product review with the Northwind design team"}
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        upcoming.nextScheduleMeeting = try? decoder.decode(LocalRecorderMonitoringMeeting.self, from: Data(json.utf8))

        let recording = RecorderAppModel(snapshotBearerToken: "token")
        recording.permissionChecklist = granted
        recording.isRecording = true
        recording.recordingStartedAt = Date().addingTimeInterval(-724)
        recording.activeRecordingTitle = "Design sync with Northwind"
        recording.statusText = "Recording"
        recording.audioLevels = (0..<36).map { index in
            let wave = abs(sin(Double(index) * 0.55)) * 0.55 + abs(sin(Double(index) * 1.7)) * 0.3
            return Float(min(1, 0.08 + wave))
        }
        recording.microphoneLevel = 0.55
        recording.systemAudioLevel = 0.32

        let picker = RecorderAppModel(snapshotBearerToken: "token")
        picker.permissionChecklist = granted
        picker.isRecording = true
        picker.recordingStartedAt = recording.recordingStartedAt
        picker.activeRecordingTitle = "Design sync with Northwind"
        picker.statusText = "Recording"
        picker.audioLevels = recording.audioLevels
        picker.isMeetingPickerPresented = true
        picker.activeTarget = RecordingTarget(fallbackIntentId: "snapshot", meetingId: "current", meetingTitle: "Design sync with Northwind")
        let choices = """
        [{"meetingId":"current","title":"Design sync with Northwind","status":"recording","startsAt":"\(iso.string(from: Date()))"},
        {"meetingId":"previous","title":"Design sync with Northwind","status":"completed","startsAt":"\(iso.string(from: Date().addingTimeInterval(-86_400)))"},
        {"meetingId":"research","title":"Manual recording","status":"processing","createdAt":"\(iso.string(from: Date().addingTimeInterval(-100_000)))"},
        {"meetingId":"busy","title":"Customer research","status":"recording","startsAt":"\(iso.string(from: Date()))","unavailableReason":"Meeting bot is recording"}]
        """
        picker.meetingChoices = (try? decoder.decode([RecordingMeeting].self, from: Data(choices.utf8))) ?? []
        picker.meetingChoicesHaveMore = true

        let prompt = RecorderAppModel(snapshotBearerToken: "token")
        prompt.permissionChecklist = granted
        prompt.isRecording = true
        prompt.recordingStartedAt = recording.recordingStartedAt
        prompt.activeRecordingTitle = "Design sync with Northwind"
        prompt.statusText = "Recording"
        prompt.captureSessionID = "snapshot-prompt"
        prompt.endPrompt = RecorderEndPrompt(id: "snapshot", sessionID: "snapshot-prompt", reason: .silence)

        let uploadIssue = RecorderAppModel(snapshotBearerToken: "token")
        uploadIssue.permissionChecklist = granted
        uploadIssue.nextScheduleMeeting = upcoming.nextScheduleMeeting
        uploadIssue.statusText = "Could not upload recording. Files kept locally."

        let receipt = RecorderAppModel(snapshotBearerToken: "token")
        receipt.permissionChecklist = granted
        receipt.nextScheduleMeeting = upcoming.nextScheduleMeeting
        receipt.statusText = "Capture stopped"
        receipt.pendingUploadCount = 1
        receipt.updateUploadReceipt(intentID: "stopped", target: RecordingTarget(fallbackIntentId: "stopped", meetingId: "previous", meetingTitle: "Design sync with Northwind"), message: "Saved on this Mac. Uploading…", serverURL: URL(string: "https://tape.example"))

        let conflict = RecorderAppModel(snapshotBearerToken: "token")
        conflict.permissionChecklist = granted
        conflict.nextScheduleMeeting = upcoming.nextScheduleMeeting
        conflict.nextScheduleMeeting?.botStatus = "recording"
        conflict.nextScheduleMeeting?.startsAt = Date().addingTimeInterval(-300)
        conflict.statusText = "Watching your calendar"

        let serverUnavailable = RecorderAppModel(snapshotBearerToken: "token")
        serverUnavailable.permissionChecklist = granted
        serverUnavailable.nextScheduleMeeting = upcoming.nextScheduleMeeting
        serverUnavailable.recordingStartFailure = .serviceUnavailable
        // A successful background refresh must not hide the failed Record action.
        serverUnavailable.statusText = "Watching your calendar"

        let settings = RecorderAppModel(snapshotBearerToken: "token")
        settings.permissionChecklist = granted
        settings.statusText = "Watching your calendar"
        settings.isAdvancedExpanded = true
        settings.account = LocalRecorderAccount(email: "alex@example.com", workspaceName: "Northwind Design")

        let permissions = RecorderAppModel(snapshotBearerToken: "token")
        permissions.isAdvancedExpanded = true
        permissions.statusText = "Finish access setup"

        return [
            ("signed-out", signedOut), ("upcoming", upcoming), ("recording", recording),
            ("upload-issue", uploadIssue), ("settings", settings), ("permissions", permissions),
            ("meeting-picker", picker), ("end-prompt", prompt),
            ("upload-receipt", receipt), ("recording-conflict", conflict),
            ("recording-unavailable", serverUnavailable),
        ]
    }

    private static func capture(model: RecorderAppModel, appearance: NSAppearance?) -> NSImage {
        let controller = NSHostingController(rootView: RecorderMenuView(model: model, showsWindowChrome: true))
        controller.safeAreaRegions = []
        let window = SnapshotWindow(contentViewController: controller)
        window.title = "Tape Desktop"
        window.styleMask = [.titled, .closable, .miniaturizable]
        RecorderWindowChrome.apply(to: window)
        window.appearance = appearance
        window.setFrameOrigin(NSPoint(x: -10_000, y: -10_000))
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        let deadline = Date().addingTimeInterval(0.8)
        while Date() < deadline {
            if let event = NSApp.nextEvent(matching: .any, until: Date().addingTimeInterval(0.05), inMode: .default, dequeue: true) {
                NSApp.sendEvent(event)
            }
        }

        let frameView = window.contentView?.superview ?? controller.view
        frameView.layoutSubtreeIfNeeded()
        let bounds = frameView.bounds
        let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: Int(bounds.width * 2),
            pixelsHigh: Int(bounds.height * 2),
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        )!
        rep.size = bounds.size
        frameView.cacheDisplay(in: bounds, to: rep)
        if model.isAdvancedExpanded {
            let expandedHeight = window.frame.height
            model.isAdvancedExpanded = false
            let resizeDeadline = Date().addingTimeInterval(0.4)
            while Date() < resizeDeadline {
                if let event = NSApp.nextEvent(matching: .any, until: Date().addingTimeInterval(0.05), inMode: .default, dequeue: true) {
                    NSApp.sendEvent(event)
                }
            }
            print("Settings window height: \(expandedHeight) expanded, \(window.frame.height) collapsed")
        }
        window.orderOut(nil)
        let image = NSImage(size: bounds.size)
        image.addRepresentation(rep)
        return image
    }

    private static func composite(_ images: [NSImage]) -> NSImage {
        let gutter: CGFloat = 48
        let width = images.reduce(gutter) { $0 + $1.size.width + gutter }
        let height = (images.map(\.size.height).max() ?? 0) + gutter * 2
        let canvasRep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: Int(width * 2),
            pixelsHigh: Int(height * 2),
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        )!
        canvasRep.size = NSSize(width: width, height: height)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: canvasRep)
        NSColor(calibratedWhite: 0.86, alpha: 1).setFill()
        NSRect(x: 0, y: 0, width: width, height: height).fill()
        var x = gutter
        for image in images {
            let y = height - gutter - image.size.height
            let shadow = NSShadow()
            shadow.shadowBlurRadius = 10
            shadow.shadowOffset = NSSize(width: 0, height: -3)
            shadow.shadowColor = NSColor.black.withAlphaComponent(0.09)
            NSGraphicsContext.saveGraphicsState()
            shadow.set()
            NSBezierPath(roundedRect: NSRect(x: x, y: y, width: image.size.width, height: image.size.height), xRadius: 10, yRadius: 10).fill()
            NSGraphicsContext.restoreGraphicsState()
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(roundedRect: NSRect(x: x, y: y, width: image.size.width, height: image.size.height), xRadius: 10, yRadius: 10).addClip()
            image.draw(at: NSPoint(x: x, y: y), from: .zero, operation: .sourceOver, fraction: 1)
            NSGraphicsContext.restoreGraphicsState()
            // macOS draws a hairline window border that offscreen caching omits.
            let border = NSBezierPath(roundedRect: NSRect(x: x + 0.25, y: y + 0.25, width: image.size.width - 0.5, height: image.size.height - 0.5), xRadius: 10, yRadius: 10)
            border.lineWidth = 0.5
            NSColor.black.withAlphaComponent(0.2).setStroke()
            border.stroke()
            x += image.size.width + gutter
        }
        NSGraphicsContext.restoreGraphicsState()
        let canvas = NSImage(size: canvasRep.size)
        canvas.addRepresentation(canvasRep)
        return canvas
    }

    /// Reports itself as key so the traffic lights render in their focused colors offscreen.
    private final class SnapshotWindow: NSWindow {
        override var isKeyWindow: Bool { true }
        override var isMainWindow: Bool { true }
    }

    private static func write(_ image: NSImage, to url: URL) {
        guard
            let rep = image.representations.compactMap({ $0 as? NSBitmapImageRep }).first,
            let data = rep.representation(using: .png, properties: [:])
        else {
            return
        }
        try? data.write(to: url)
    }
}
#endif
