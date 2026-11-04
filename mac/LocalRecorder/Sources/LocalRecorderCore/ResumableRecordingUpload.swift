import Foundation

struct RecordingUploadCheckpoint: Codable {
    var uploadId: String
    var fileSize: Int
}

struct RecordingMultipartResponse: Decodable {
    var assetId: String
    var partSize: Int
    var uploadId: String?
    var completedParts: [Int]
    var complete: Bool
    var expired: Bool?
    var uploadUrl: URL?
}

extension LocalRecorderAPIClient {
    public func uploadResumableRecordingAssets(
        payload: LocalRecordingUploadPayload
    ) async throws -> LocalRecordingUploadAssetIds {
        let computer = try await uploadResumableAsset(payload: payload, role: "computerAudio", fileURL: payload.computerAudioURL)
        let microphone = try await uploadResumableAsset(payload: payload, role: "microphoneAudio", fileURL: payload.microphoneAudioURL)
        let synthesized = try await uploadResumableAsset(payload: payload, role: "synthesizedAudio", fileURL: payload.synthesizedAudioURL)
        var assets = LocalRecordingUploadAssetIds(computerAudioAssetId: computer, microphoneAudioAssetId: microphone, synthesizedAudioAssetId: synthesized, audioFormat: payload.computerAudioURL.pathExtension)
        if let screenshots = payload.screenshots {
            assets.screenshots = []
            for (index, screenshot) in screenshots.enumerated() {
                let assetId = try await uploadResumableAsset(payload: payload, role: "screenshot:\(index)", fileURL: screenshot.fileURL)
                assets.screenshots?.append(.init(assetId: assetId, timestampMs: screenshot.timestampMs))
            }
        }
        return assets
    }

    func uploadResumableAsset(
        payload: LocalRecordingUploadPayload, role: String, fileURL: URL, session: URLSession = .shared
    ) async throws -> String {
        let size = try fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0 else { throw LocalRecorderAPIError.invalidResponse }
        let checkpointURL = fileURL.appendingPathExtension("upload.json")
        let checkpoint = try? JSONDecoder().decode(RecordingUploadCheckpoint.self, from: Data(contentsOf: checkpointURL))
        // Recordings are sealed before enqueueing. Never reuse a session for a changed file.
        if let checkpoint, checkpoint.fileSize != size { throw LocalRecorderAPIError.invalidResponse }
        var state = try await multipartRequest(payload: payload, role: role, size: size,
            action: checkpoint == nil ? "start" : "status", uploadId: checkpoint?.uploadId, session: session)
        if state.expired == true {
            state = try await multipartRequest(payload: payload, role: role, size: size, action: "start", session: session)
        }
        if state.complete { return state.assetId }
        guard let uploadId = state.uploadId, state.partSize > 0, state.partSize <= 16 * 1024 * 1024 else {
            throw LocalRecorderAPIError.invalidResponse
        }
        // Atomic persistence precedes sending bytes, so app restart can recover the session.
        try JSONEncoder().encode(RecordingUploadCheckpoint(uploadId: uploadId, fileSize: size))
            .write(to: checkpointURL, options: .atomic)
        let file = try FileHandle(forReadingFrom: fileURL)
        defer { try? file.close() }
        let completed = Set(state.completedParts)
        for number in 1...((size + state.partSize - 1) / state.partSize) where !completed.contains(number) {
            try Task.checkCancellation()
            let signed = try await multipartRequest(payload: payload, role: role, size: size,
                action: "part", uploadId: uploadId, partNumber: number, session: session)
            if signed.complete { return signed.assetId }
            guard let url = signed.uploadUrl else { throw LocalRecorderAPIError.invalidResponse }
            let offset = (number - 1) * state.partSize
            let count = min(state.partSize, size - offset)
            try file.seek(toOffset: UInt64(offset))
            guard let bytes = try file.read(upToCount: count), bytes.count == count else {
                throw LocalRecorderAPIError.invalidResponse
            }
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            let (data, response) = try await session.upload(for: request, from: bytes)
            try validateHTTPResponse(data: data, response: response)
        }
        let finished = try await multipartRequest(payload: payload, role: role, size: size,
            action: "complete", uploadId: uploadId, session: session)
        guard finished.complete else { throw LocalRecorderAPIError.invalidResponse }
        return finished.assetId
    }

    func multipartRequest(
        payload: LocalRecordingUploadPayload, role: String, size: Int,
        action: String, uploadId: String? = nil, partNumber: Int? = nil, session: URLSession = .shared
    ) async throws -> RecordingMultipartResponse {
        var request = URLRequest(url: serverURL.appending(path: "/api/local-recorder/recordings/multipart"))
        request.httpMethod = "POST"
        applyRecorderHeaders(to: &request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "action": action, "role": role, "fileSize": size,
            "format": role.hasPrefix("screenshot:") ? "jpg" : payload.computerAudioURL.pathExtension,
            "clientRecordingId": payload.clientRecordingId,
            "fallbackIntentId": payload.fallbackIntentId,
            "recordingStartedAt": ISO8601DateFormatter().string(from: payload.recordingStartedAt),
        ]
        if let uploadId { body["uploadId"] = uploadId }
        if let partNumber { body["partNumber"] = partNumber }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        try validateHTTPResponse(data: data, response: response)
        return try JSONDecoder().decode(RecordingMultipartResponse.self, from: data)
    }
}
