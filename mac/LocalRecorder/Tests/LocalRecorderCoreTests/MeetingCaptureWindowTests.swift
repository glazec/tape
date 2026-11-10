import Foundation
import Testing
@testable import LocalRecorderCore

@Test func changedBrowserDocumentDoesNotMatchCaptureTarget() {
    let selected = MeetingCaptureWindow(id: 1, processID: 123, bundleID: "com.google.Chrome", title: "Slides",
                                       activeTabURL: URL(string: "https://example.com/slides"))
    let switched = MeetingCaptureWindow(id: 1, processID: 123, bundleID: selected.bundleID, title: selected.title,
                                       activeTabURL: URL(string: "https://example.com/other"))
    #expect(selected != switched)
}

@Test func unidentifiedBrowserTabStillRecordsButNeverScreenshots() {
    // Chrome often hides its tab URL from accessibility. Refusing the window used to
    // block audio entirely; now audio records and no tab is ever screenshotted.
    let unknownTab = MeetingCaptureWindow(id: 1, processID: 123, bundleID: "com.google.Chrome", title: "Meet")
    #expect(unknownTab.screenshotIdentity == nil)

    let knownTab = MeetingCaptureWindow(id: 1, processID: 123, bundleID: "com.google.Chrome", title: "Meet",
                                        activeTabURL: URL(string: "https://meet.google.com/abc-defg-hij"))
    #expect(knownTab.screenshotIdentity == knownTab)

    let app = MeetingCaptureWindow(id: 2, processID: 456, bundleID: "us.zoom.xos", title: "Zoom Meeting")
    #expect(app.screenshotIdentity == app)
}

@Test func windowChooserListsOnlyNormalWindowsOfOtherApps() {
    let windows = [
        CaptureWindowChoice(id: 1, bundleID: "com.google.Chrome", appName: "Google Chrome", title: "Meet", width: 1200, height: 800, stackOrder: 3),
        // Tape's own panel and setup window are never a meeting.
        CaptureWindowChoice(id: 2, bundleID: "tech.inevitable.meeting-note.local-recorder", appName: "Tape Desktop", title: "Tape Desktop", width: 340, height: 400, stackOrder: 0),
        // Menu bar extras, widgets and overlays sit above the normal layer.
        CaptureWindowChoice(id: 3, bundleID: "com.example.menu", appName: "Menu Extra", title: "Item", width: 400, height: 300, layer: 25, stackOrder: 1),
        CaptureWindowChoice(id: 4, bundleID: "com.apple.dock", appName: "Dock", title: "Dock", width: 1440, height: 900, stackOrder: 2),
        CaptureWindowChoice(id: 5, bundleID: "", appName: "Window Server", title: "Menubar", width: 1440, height: 900, stackOrder: 2),
        CaptureWindowChoice(id: 6, bundleID: "com.apple.controlcenter", appName: "Control Center", title: "Control Center", width: 400, height: 400),
        // Untitled and tiny windows are toolbars, tooltips and helpers.
        CaptureWindowChoice(id: 7, bundleID: "us.zoom.xos", appName: "zoom.us", title: "  ", width: 1200, height: 800),
        CaptureWindowChoice(id: 8, bundleID: "us.zoom.xos", appName: "zoom.us", title: "Zoom", width: 199, height: 400),
        CaptureWindowChoice(id: 9, bundleID: "us.zoom.xos", appName: "zoom.us", title: "Zoom", width: 400, height: 119),
        CaptureWindowChoice(id: 10, bundleID: "us.zoom.xos", appName: "zoom.us", title: "Hidden", width: 1200, height: 800, isOnScreen: false),
        CaptureWindowChoice(id: 11, bundleID: "us.zoom.xos", appName: "zoom.us", title: "Zoom Meeting", width: 200, height: 120, stackOrder: 5),
    ]
    let choices = CaptureWindowChoices.choices(from: windows, excludingBundleID: "tech.inevitable.meeting-note.local-recorder")
    #expect(choices.map(\.id) == [1, 11])
}

@Test func windowChooserPutsTheFrontmostAppFirstAndKeepsItsWindowsTogether() {
    let windows = [
        CaptureWindowChoice(id: 1, bundleID: "com.google.Chrome", appName: "Google Chrome", title: "Docs", width: 1200, height: 800, stackOrder: 6),
        CaptureWindowChoice(id: 2, bundleID: "us.zoom.xos", appName: "zoom.us", title: "Zoom Meeting", width: 1200, height: 800, stackOrder: 4),
        CaptureWindowChoice(id: 3, bundleID: "com.google.Chrome", appName: "Google Chrome", title: "Meet", width: 1200, height: 800, stackOrder: 2),
        // Without a reported position, apps fall to the end in name order.
        CaptureWindowChoice(id: 4, bundleID: "com.tinyspeck.slackmacgap", appName: "Slack", title: "Huddle", width: 1200, height: 800),
        CaptureWindowChoice(id: 5, bundleID: "com.apple.Safari", appName: "Safari", title: "Notes", width: 1200, height: 800),
    ]
    let choices = CaptureWindowChoices.choices(from: windows, excludingBundleID: nil)
    #expect(choices.map(\.id) == [3, 1, 2, 5, 4])
}
