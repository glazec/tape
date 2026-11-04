import Foundation
import Testing
@testable import LocalRecorderCore

private final class UploadProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@Test func uploadResumesSavedSessionWithoutResendingCompletedPart() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let fileURL = directory.appendingPathComponent("computer.wav")
    try Data(repeating: 1, count: 12).write(to: fileURL)
    try JSONEncoder().encode(RecordingUploadCheckpoint(uploadId: "saved-session", fileSize: 12))
        .write(to: fileURL.appendingPathExtension("upload.json"), options: .atomic)
    let date = Date()
    let track = TrackMetadata(captureStartedAt: date, captureStoppedAt: date.addingTimeInterval(1), sampleRate: 48_000, channelCount: 2, codec: "pcm_s16le", container: "wav", firstSampleTime: 0)
    let payload = LocalRecordingUploadPayload(fallbackIntentId: "intent", clientRecordingId: "recording", recordingStartedAt: date, recordingStoppedAt: date.addingTimeInterval(1), computerAudioURL: fileURL, microphoneAudioURL: fileURL, synthesizedAudioURL: fileURL, manifest: RecordingManifest(appVersion: "test", computerAudio: track, microphoneAudio: track))
    var actions: [String] = []
    var uploadedParts: [Int] = []
    UploadProtocol.handler = { request in
        if request.httpMethod == "PUT" {
            uploadedParts.append(Int(request.url!.lastPathComponent)!)
            return (200, Data())
        }
        var bytes = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                bytes.append(contentsOf: buffer.prefix(count))
            }
        }
        let body = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
        let action = body["action"] as! String
        actions.append(action)
        #expect(body["uploadId"] as? String == "saved-session")
        var result: [String: Any] = ["assetId": "asset", "partSize": 8, "uploadId": "saved-session", "completedParts": [1], "complete": action == "complete"]
        if action == "part" {
            #expect(body["partNumber"] as? Int == 2)
            result["uploadUrl"] = "https://storage.example.com/2"
        }
        return (200, try JSONSerialization.data(withJSONObject: result))
    }
    defer { UploadProtocol.handler = nil }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [UploadProtocol.self]
    let session = URLSession(configuration: configuration)
    defer { session.invalidateAndCancel() }
    let client = LocalRecorderAPIClient(serverURL: URL(string: "https://app.example.com")!, bearerToken: "token", deviceId: "device")
    let asset = try await client.uploadResumableAsset(payload: payload, role: "computerAudio", fileURL: fileURL, session: session)
    #expect(asset == "asset")
    #expect(actions == ["status", "part", "complete"])
    #expect(uploadedParts == [2])
}
