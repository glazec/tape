import AppKit
import LocalRecorderCore
import UserNotifications

struct RecorderEndPrompt: Identifiable {
    enum Reason { case silence, meetingClosed, captureEnded }
    let id: String
    let sessionID: String
    let reason: Reason
    var detail: String {
        switch reason {
        case .silence: "Both audio sources have been quiet. Finish this recording?"
        case .meetingClosed: "The meeting window closed. Finish this recording?"
        case .captureEnded: "Meeting capture ended. Keep recording to continue with this Mac’s audio."
        }
    }
}

enum RecorderNotificationAction {
    static let missingBotCategory = "recorder.missing-bot"
    static let endCategory = "recorder.end"
    static let start = "recorder.start"
    static let stop = "recorder.stop"
    static let keep = "recorder.keep"
}

struct RecorderCaptureRecovery: Codable {
    var pendingStart: RecordingTargetRequest?
    var pendingLegacyIntent: String?
    var targets: [RecordingTarget] = []
    var sdkDrains: [SDKDrain] = []
    struct SDKDrain: Codable {
        var recordingID: String
        var target: RecordingTarget
        var needsFailure: Bool?
    }
}

extension RecorderAppModel {
    private var recoveryURL: URL {
        LocalRecorderFileLocations.uploadQueueDirectoryURL().deletingLastPathComponent().appendingPathComponent("capture-recovery.json")
    }

    func persistCaptureRecovery() throws {
        try FileManager.default.createDirectory(at: recoveryURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(recoveryState).write(to: recoveryURL, options: .atomic)
    }

    func configureRecordingWorkflow() {
        if let data = try? Data(contentsOf: recoveryURL),
           let saved = try? JSONDecoder().decode(RecorderCaptureRecovery.self, from: data) {
            recoveryState = saved
        }
        refreshPendingUploadCount()
        notificationCenter.setNotificationCategories([
            UNNotificationCategory(identifier: RecorderNotificationAction.missingBotCategory, actions: [
                UNNotificationAction(identifier: RecorderNotificationAction.start, title: "Start recording", options: [])
            ], intentIdentifiers: [], options: [.customDismissAction]),
            UNNotificationCategory(identifier: RecorderNotificationAction.endCategory, actions: [
                UNNotificationAction(identifier: RecorderNotificationAction.stop, title: "End recording", options: []),
                UNNotificationAction(identifier: RecorderNotificationAction.keep, title: "Keep recording", options: [])
            ], intentIdentifiers: [], options: [.customDismissAction])
        ])
        if let client = makeClient() {
            for drain in recoveryState.sdkDrains {
                startSDKDrain(client: client, target: drain.target, recordingID: drain.recordingID)
            }
            Task { try? await sealRecoveredCaptures(client: client) }
        }
        recallSDKController.onCaptureFailure = { [weak self] id in
            guard let self, self.captureSessionID == id, self.isRecording, !self.isFinishingRecording else { return }
            self.isFinishingRecording = true
            self.statusText = "Continuing with local audio"
            Task { await self.finishCapture(continueNatively: true) }
        }
        refreshPendingUploadCount()
        recallSDKController.onLifecycleEvent = { [weak self] id, event in
            guard let self, self.captureSessionID == id, self.isRecording, !self.isFinishingRecording else { return }
            if event == .recordingEnded {
                self.captureNaturallyEnded = true
                self.statusText = "Meeting capture ended"
                Task { await self.stopRecallSDKLevelMetering() }
                if self.endPrompt == nil { self.presentEndPrompt(reason: .captureEnded) }
            } else if self.endPromptPolicy.meetingClosed() {
                self.presentEndPrompt(reason: .meetingClosed)
            }
        }
    }

    func beginRecording(meetingId: String? = nil, title: String? = nil, legacyIntent: String? = nil, nativeOnly: Bool = false) {
        guard !isStartingRecording, !isRecording, !isFinishingRecording else { return }
        guard canMonitor, let client = makeClient() else { statusText = "Login and permissions are needed first"; return }
        isStartingRecording = true
        isAdvancedExpanded = false
        isMeetingPickerPresented = false
        statusText = "Starting recording"
        Task {
            defer { isStartingRecording = false }
            do {
                // A prior process may have stopped before sealing. Preserve that
                // binding until the server acknowledges its final destination.
                try await sealRecoveredCaptures(client: client)
                let target: RecordingTarget
                if let legacy = recoveryState.pendingLegacyIntent ?? legacyIntent {
                    recoveryState.pendingLegacyIntent = legacy
                    try persistCaptureRecovery()
                    let claim = try await client.claimIntent(fallbackIntentId: legacy, explicit: true)
                    guard claim.claimed, let id = claim.meetingId else {
                        recoveryState.pendingLegacyIntent = nil
                        try persistCaptureRecovery()
                        statusText = claimFailureStatus(reason: claim.reason)
                        return
                    }
                    target = RecordingTarget(fallbackIntentId: legacy, meetingId: id, meetingTitle: claim.meetingTitle ?? "Untitled meeting", startsAt: claim.startsAt, endsAt: claim.endsAt)
                } else {
                    let request = recoveryState.pendingStart ?? RecordingTargetRequest(clientRequestId: UUID().uuidString, meetingId: meetingId, title: title)
                    recoveryState.pendingStart = request
                    try persistCaptureRecovery()
                    target = try await client.setRecordingTarget(request)
                }
                recoveryState.targets.append(target)
                recoveryState.pendingStart = nil
                recoveryState.pendingLegacyIntent = nil
                try persistCaptureRecovery()
                activeTarget = target
                captureSessionID = UUID().uuidString
                captureNaturallyEnded = false
                endPrompt = nil
                endPromptPolicy = RecorderEndPromptPolicy(scheduledEnd: target.endsAt)
                await startCapture(client: client, fallbackIntentId: target.fallbackIntentId, title: target.meetingTitle, nativeOnly: nativeOnly)
                if !isRecording {
                    activeTarget = nil
                    captureSessionID = nil
                    // A known failed binding can be sealed, then the next click
                    // receives a new request ID. Unknown network outcomes retain it.
                    try await sealRecoveredCaptures(client: client)
                    activeTarget = nil
                    captureSessionID = nil
                }
            } catch {
                if !isRecording { activeTarget = nil; captureSessionID = nil }
                if case LocalRecorderAPIError.httpStatus(let status, _, _) = error, (400..<500).contains(status), status != 408, status != 429 {
                    recoveryState.pendingStart = nil
                    try? persistCaptureRecovery()
                }
                statusText = "Could not start recording. Retry to recover the same meeting."
            }
            refreshPendingUploadCount()
        }
    }

    func sealRecoveredCaptures(client: LocalRecorderAPIClient) async throws {
        for target in recoveryState.targets {
            guard RecorderRecoveryPolicy.shouldRecover(intentID: target.fallbackIntentId, activeTargetID: activeTarget?.fallbackIntentId, isStarting: isStartingRecording, isRecording: isRecording) else { continue }
            let status = try await client.recordingTargetStatus(fallbackIntentId: target.fallbackIntentId)
            if !status.isTerminal {
                _ = try await client.finishRecordingTarget(fallbackIntentId: target.fallbackIntentId)
            }
            recoveryState.targets.removeAll { $0.fallbackIntentId == target.fallbackIntentId }
            try persistCaptureRecovery()
        }
    }

    func replaceSDKAttemptForNative(client: LocalRecorderAPIClient, target: RecordingTarget, recordingID: String) async throws -> RecordingTarget {
        // SDK startup has either stopped or exited before this function runs.
        // If there was capture, preserve its webhook; never suppress that segment.
        if !recallSDKController.didCaptureStart(recordingID) {
            let status = try await client.recordingTargetStatus(fallbackIntentId: target.fallbackIntentId)
            if !status.isTerminal {
                try await client.failIntent(fallbackIntentId: target.fallbackIntentId, errorMessage: "Desktop SDK could not start capture")
            }
        }
        if recoveryState.sdkDrains.contains(where: { $0.recordingID == recordingID }) {
            startSDKDrain(client: client, target: target, recordingID: recordingID)
        }
        activeTarget = nil
        try await sealRecoveredCaptures(client: client)
        let request = RecordingTargetRequest(clientRequestId: UUID().uuidString, meetingId: target.meetingId)
        recoveryState.pendingStart = request
        try persistCaptureRecovery()
        let replacement = try await client.setRecordingTarget(request)
        recoveryState.targets.append(replacement)
        recoveryState.pendingStart = nil
        try persistCaptureRecovery()
        activeTarget = replacement
        captureSessionID = UUID().uuidString
        return replacement
    }

    func loadMeetingChoices(reset: Bool = true) {
        guard let client = makeClient() else { return }
        if !reset && isLoadingMeetingChoices { return }
        meetingSearchGeneration += 1
        let generation = meetingSearchGeneration
        let query = meetingSearch
        let offset = reset ? 0 : meetingChoices.count
        if reset { meetingChoices = []; meetingChoicesHaveMore = false }
        isLoadingMeetingChoices = true
        meetingPickerError = nil
        Task {
            do {
                let response = try await client.fetchRecordingMeetings(query: query, offset: offset)
                guard generation == meetingSearchGeneration else { return }
                meetingChoices.append(contentsOf: response.meetings)
                meetingChoicesHaveMore = response.hasMore
            } catch {
                guard generation == meetingSearchGeneration else { return }
                meetingPickerError = "Could not load meetings. Try again."
            }
            if generation == meetingSearchGeneration { isLoadingMeetingChoices = false }
        }
    }

    func selectRecordingMeeting(meetingId: String?, title: String? = nil) {
        guard isRecording, !isFinishingRecording, !isSwitchingMeeting,
              let client = activeClient, let target = activeTarget, let sessionID = captureSessionID else { return }
        isSwitchingMeeting = true
        meetingPickerError = nil
        Task {
            defer { if captureSessionID == sessionID { isSwitchingMeeting = false } }
            do {
                let updated = try await client.setRecordingTarget(RecordingTargetRequest(fallbackIntentId: target.fallbackIntentId, meetingId: meetingId, title: title))
                guard captureSessionID == sessionID, isRecording else { return }
                destinationUnconfirmed = false
                activeTarget = updated
                activeRecordingTitle = updated.meetingTitle
                recoveryState.targets.removeAll { $0.fallbackIntentId == updated.fallbackIntentId }
                recoveryState.targets.append(updated)
                try persistCaptureRecovery()
                endPromptPolicy = RecorderEndPromptPolicy(scheduledEnd: updated.endsAt)
                endPrompt = nil
                statusText = "Recording \(updated.meetingTitle)"
                isMeetingPickerPresented = false
            } catch {
                guard captureSessionID == sessionID, !isFinishingRecording else { return }
                // The response may have been lost after a committed move. Keep
                // the selector open and do not claim a destination was confirmed.
                destinationUnconfirmed = true
                meetingPickerError = "Could not confirm the destination. Choose it again to retry."
            }
        }
    }

    func presentEndPrompt(reason: RecorderEndPrompt.Reason) {
        guard isRecording, !isFinishingRecording, endPrompt == nil, let sessionID = captureSessionID else { return }
        let prompt = RecorderEndPrompt(id: UUID().uuidString, sessionID: sessionID, reason: reason)
        endPrompt = prompt
        let content = UNMutableNotificationContent()
        content.title = "Meeting ended?"
        content.body = prompt.detail
        content.categoryIdentifier = RecorderNotificationAction.endCategory
        content.userInfo = ["captureSessionID": sessionID, "promptID": prompt.id]
        Task { try? await notificationCenter.add(UNNotificationRequest(identifier: prompt.id, content: content, trigger: nil)) }
    }

    func respondToEndPrompt(sessionID: String?, promptID: String?, stop: Bool) {
        guard let prompt = endPrompt, prompt.sessionID == sessionID, prompt.id == promptID,
              captureSessionID == sessionID, isRecording, !isFinishingRecording else { return }
        notificationCenter.removeDeliveredNotifications(withIdentifiers: [prompt.id])
        endPrompt = nil
        if stop { stopRecording(); return }
        endPromptPolicy.snooze()
        if captureNaturallyEnded {
            isFinishingRecording = true
            Task { await finishCapture(continueNatively: true) }
        }
    }

    func finishCapture(continueNatively: Bool = false) async {
        guard let client = activeClient, let target = activeTarget, let sessionID = captureSessionID else {
            isFinishingRecording = false
            return
        }
        let backend = activeRecordingBackend
        var sdkRecordingID: String?
        var sdkHadCapture = true
        var stoppedLocally = false
        do {
            await stopRecallSDKLevelMetering()
            switch backend {
            case .recallDesktopSDK:
                let result = try await recallSDKController.stop()
                sdkRecordingID = result.clientRecordingId
                sdkHadCapture = result.didCaptureStart
            case .localUpload, nil:
                let payload: LocalRecordingUploadPayload
                if let retainedStoppedPayload { payload = retainedStoppedPayload }
                else {
                    let result = try await captureController.stop()
                    payload = result.payload
                    retainedStoppedPayload = payload
                }
                stoppedLocally = true
                // Save media and queue metadata before any network operation.
                try uploadQueue.save(payload)
                retainedStoppedPayload = nil
            }
        } catch {
            isFinishingRecording = false
            if stoppedLocally { captureNaturallyEnded = true }
            statusText = stoppedLocally ? "Capture stopped, but its upload queue could not be saved. Keep Tape open." : "Capture has not confirmed it stopped. Try Stop again."
            return
        }
        guard captureSessionID == sessionID else { return }
        isRecording = false
        captureSessionID = nil
        activeClient = nil
        activeFallbackIntentId = nil
        activeRecordingBackend = nil
        activeTarget = nil
        activeRecordingTitle = nil
        captureNaturallyEnded = false
        isSwitchingMeeting = false
        destinationUnconfirmed = false
        isMeetingPickerPresented = false
        endPrompt = nil
        resetAudioLevels()
        isFinishingRecording = false
        statusText = "Capture stopped"
        if let sdkRecordingID {
            if !sdkHadCapture {
                if let index = recoveryState.sdkDrains.firstIndex(where: { $0.recordingID == sdkRecordingID }) {
                    recoveryState.sdkDrains[index].needsFailure = true
                    try? persistCaptureRecovery()
                }
            }
            startSDKDrain(client: client, target: target, recordingID: sdkRecordingID)
        }
        refreshPendingUploadCount()

        var finalTarget = target
        do {
            finalTarget = try await client.finishRecordingTarget(fallbackIntentId: target.fallbackIntentId)
            recoveryState.targets.removeAll { $0.fallbackIntentId == target.fallbackIntentId }
            try persistCaptureRecovery()
        } catch {
            uploadStatusText = "Capture stopped. Waiting to confirm its destination."
        }
        if stoppedLocally { Task { await uploadQueuedRecordings(client: client) } }
        if continueNatively, !isRecording, !isStartingRecording {
            beginRecording(meetingId: finalTarget.meetingId, nativeOnly: true)
        }
    }

    func refreshPendingUploadCount() {
        pendingUploadCount = (try? uploadQueue.load().count) ?? 0
        pendingUploadCount += sdkDrainTasks.count
    }

    func startSDKDrain(client: LocalRecorderAPIClient, target: RecordingTarget, recordingID: String) {
        guard sdkDrainTasks[recordingID] == nil else { return }
        sdkDrainTasks[recordingID] = Task {
            while !Task.isCancelled {
                do {
                    let currentClient = makeClient() ?? client
                    var status = try await currentClient.recordingTargetStatus(fallbackIntentId: target.fallbackIntentId)
                    if !status.isTerminal, recoveryState.sdkDrains.first(where: { $0.recordingID == recordingID })?.needsFailure == true {
                        try await currentClient.failIntent(fallbackIntentId: target.fallbackIntentId, errorMessage: "Desktop capture was cancelled before it started")
                        status = try await currentClient.recordingTargetStatus(fallbackIntentId: target.fallbackIntentId)
                    }
                    if status.isTerminal {
                        try await recallSDKController.shutdown(clientRecordingId: recordingID)
                        recoveryState.sdkDrains.removeAll { $0.recordingID == recordingID }
                        try persistCaptureRecovery()
                        sdkDrainTasks.removeValue(forKey: recordingID)
                        refreshPendingUploadCount()
                        uploadStatusText = status.state == "completed" ? "Recording received. Transcript processing continues." : "Recording upload failed. Keep your saved recording files."
                        return
                    }
                    uploadStatusText = "Uploading recording. Keep Tape open."
                } catch {
                    uploadStatusText = "Waiting for upload confirmation. Keep Tape open and reconnect."
                }
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }
}
