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
