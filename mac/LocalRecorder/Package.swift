// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MeetingNoteLocalRecorder",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "MeetingNoteLocalRecorder", targets: ["MeetingNoteLocalRecorder"]),
        .library(name: "LocalRecorderCore", targets: ["LocalRecorderCore"]),
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.9.2"),
        .package(url: "https://github.com/getsentry/sentry-cocoa", exact: "9.31.0"),
    ],
    targets: [
        .target(name: "LocalRecorderCore", dependencies: [.product(name: "Sentry", package: "sentry-cocoa")]),
        .executableTarget(
            name: "MeetingNoteLocalRecorder",
            dependencies: [
                "LocalRecorderCore",
                .product(name: "Sparkle", package: "Sparkle"),
            ]
        ),
        .testTarget(
            name: "LocalRecorderCoreTests",
            dependencies: [
                "LocalRecorderCore",
                .product(name: "Sparkle", package: "Sparkle"),
            ]
        ),
    ]
)
