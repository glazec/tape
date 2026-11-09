import ApplicationServices
import Foundation

/// Reads the displayed document, never the list of background tabs or page text.
enum BrowserMeetingTab {
    static func activeURL(processID: Int32, frame: CGRect) -> URL? {
        guard AXIsProcessTrusted() else { return nil }
        let app = AXUIElementCreateApplication(processID)
        AXUIElementSetMessagingTimeout(app, 0.1)
        let deadline = ProcessInfo.processInfo.systemUptime + 0.4
        guard let windows = value(app, kAXWindowsAttribute) as? [AXUIElement] else { return nil }
        var matches: [AXUIElement] = []
        for window in windows {
            guard ProcessInfo.processInfo.systemUptime < deadline else { return nil }
            if let bounds = bounds(window), abs(bounds.minX - frame.minX) < 2,
               abs(bounds.minY - frame.minY) < 2, abs(bounds.width - frame.width) < 2,
               abs(bounds.height - frame.height) < 2 { matches.append(window) }
        }
        guard matches.count == 1, let window = matches.first else { return nil }
        if let document = url(value(window, kAXDocumentAttribute)) { return document }

        // Breadth first traversal reaches the top-level web area before iframes.
        var queue = [window]
        var index = 0
        while index < queue.count && index < 200 && ProcessInfo.processInfo.systemUptime < deadline {
            let element = queue[index]
            index += 1
            if value(element, kAXRoleAttribute) as? String == "AXWebArea" {
                return url(value(element, kAXURLAttribute))
            }
            if let children = value(element, kAXChildrenAttribute) as? [AXUIElement] {
                queue.append(contentsOf: children.prefix(max(0, 200 - queue.count)))
            }
        }
        return nil
    }

    private static func value(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
        var result: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &result) == .success else { return nil }
        return result
    }

    private static func url(_ value: CFTypeRef?) -> URL? {
        if let string = value as? String { return URL(string: string) }
        return value as? URL
    }

    private static func bounds(_ element: AXUIElement) -> CGRect? {
        guard let position = value(element, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
              let size = value(element, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero
        var dimensions = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
              AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else { return nil }
        return CGRect(origin: point, size: dimensions)
    }
}
