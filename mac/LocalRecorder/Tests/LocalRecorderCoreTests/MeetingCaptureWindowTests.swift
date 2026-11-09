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
