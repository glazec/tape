import AppKit
import Foundation
import Testing
import Sentry
@testable import LocalRecorderCore

@Test func recorderErrorsExcludePrivateDescriptionsAndMetadata() {
    let error = NSError(domain: "https://private.example/meeting", code: 42, userInfo: [
        NSLocalizedDescriptionKey: "Bearer secret /Users/person/recording.wav person@example.com",
        "uploadToken": "secret"
    ])
    let safe = LocalRecorderTelemetry.sanitizedError(error, operation: .audioMeterStart)
    #expect(safe.domain == String(reflecting: NSError.self))
    #expect(safe.code == 42)
    #expect(safe.localizedDescription == "audio.meter.start")
    #expect(safe.userInfo.count == 1)
}

// Opt in explicitly; ordinary test runs never send events.
@MainActor
@Test func recorderSentryDeliveryVerification() throws {
    let environment = ProcessInfo.processInfo.environment
    guard let dsn = environment["TAPE_SENTRY_VERIFY_DSN"],
          let run = environment["TAPE_SENTRY_VERIFY_ID"] else { return }
    LocalRecorderTelemetry.start(dsn: dsn, environment: "coverage-verification", release: "tape-desktop-verification@\(run)")
    #expect(Thread.isMainThread)
    #expect(SentrySDK.isEnabled)
    let eventId = LocalRecorderTelemetry.capture(
        NSError(domain: "verification", code: 9001, userInfo: [NSLocalizedDescriptionKey: "SECRET_MUST_NOT_BE_SENT"]),
        operation: .audioMeterStart
    )
    LocalRecorderTelemetry.flush(timeout: 10)
    let output = URL(fileURLWithPath: environment["TAPE_SENTRY_VERIFY_OUTPUT"] ?? "/tmp/tape-desktop-sentry-event.json")
    try JSONSerialization.data(withJSONObject: ["eventId": eventId ?? "", "run": run]).write(to: output)
}

@MainActor
@Test func recorderScreenshotRendersAViewAsPNG() throws {
    let view = NSView(frame: NSRect(x: 0, y: 0, width: 120, height: 90))
    view.wantsLayer = true
    view.layer?.backgroundColor = NSColor.systemOrange.cgColor
    let data = try #require(LocalRecorderScreenshot.pngData(of: view))
    #expect(data.starts(with: [0x89, 0x50, 0x4E, 0x47]))
    let image = try #require(NSBitmapImageRep(data: data))
    #expect(image.pixelsWide >= 120)
}

@MainActor
@Test func recorderScreenshotSkipsTinyAndHiddenWindows() {
    let tiny = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 20, height: 20), styleMask: [.borderless], backing: .buffered, defer: true)
    #expect(!LocalRecorderScreenshot.isCapturable(tiny))
    let hidden = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 340, height: 500), styleMask: [.titled], backing: .buffered, defer: true)
    #expect(!LocalRecorderScreenshot.isCapturable(hidden))
}
