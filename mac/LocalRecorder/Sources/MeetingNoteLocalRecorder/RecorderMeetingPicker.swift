import LocalRecorderCore
import SwiftUI

struct RecorderMeetingPicker: View {
    @ObservedObject var model: RecorderAppModel
    @State private var newTitle = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Search all meetings", text: $model.meetingSearch)
                .textFieldStyle(.roundedBorder)
                .onChange(of: model.meetingSearch) { _, _ in model.loadMeetingChoices() }
            HStack(spacing: 6) {
                TextField("New meeting title (optional)", text: $newTitle)
                    .textFieldStyle(.roundedBorder)
                Button("New") {
                    model.selectRecordingMeeting(meetingId: nil, title: newTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : newTitle)
                }
                .disabled(model.isSwitchingMeeting)
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(model.meetingChoices) { meeting in
                        Button {
                            model.selectRecordingMeeting(meetingId: meeting.meetingId)
                        } label: {
                            HStack(alignment: .top, spacing: 8) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(meeting.title).lineLimit(2).foregroundStyle(TapePalette.ink)
                                    if let date = meeting.startsAt {
                                        Text(date.formatted(date: .abbreviated, time: .shortened))
                                            .font(TapeType.sans(10)).foregroundStyle(TapePalette.muted)
                                    }
                                }
                                Spacer(minLength: 0)
                                if model.activeTarget?.meetingId == meeting.meetingId {
                                    Image(systemName: "checkmark").foregroundStyle(TapePalette.green)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(model.isSwitchingMeeting)
                        Divider().overlay(TapePalette.hairline)
                    }
                    if model.meetingChoicesHaveMore {
                        Button("Load more") { model.loadMeetingChoices(reset: false) }
                            .disabled(model.isLoadingMeetingChoices)
                            .padding(.top, 8)
                    }
                }
            }
            .frame(height: 160)
            if model.isLoadingMeetingChoices || model.isSwitchingMeeting {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text(model.isSwitchingMeeting ? "Confirming destination…" : "Loading meetings…")
                }
                .foregroundStyle(TapePalette.muted)
            }
            if let error = model.meetingPickerError {
                Text(error).foregroundStyle(TapePalette.coralInk).fixedSize(horizontal: false, vertical: true)
                if !model.destinationUnconfirmed {
                    Button("Retry") { model.loadMeetingChoices() }
                }
            } else if model.meetingChoices.isEmpty, !model.isLoadingMeetingChoices {
                Text("No matching meetings").foregroundStyle(TapePalette.muted)
            }
        }
        .font(TapeType.sans(12))
        .padding(12)
        .background(TapePalette.surface, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(TapePalette.border, lineWidth: 1))
    }
}

struct RecorderEndPromptView: View {
    @ObservedObject var model: RecorderAppModel
    let prompt: RecorderEndPrompt
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Meeting ended?").font(TapeType.sans(13, .semibold))
            Text(prompt.detail).font(TapeType.sans(12)).foregroundStyle(TapePalette.muted)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Button("End recording") { respond(stop: true) }
                    .buttonStyle(RecorderActionButtonStyle(kind: .stop))
                Button("Keep recording") { respond(stop: false) }
                    .buttonStyle(.plain)
                    .font(TapeType.sans(12, .medium))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TapePalette.surface, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(TapePalette.border, lineWidth: 1))
    }
    private func respond(stop: Bool) {
        model.respondToEndPrompt(sessionID: prompt.sessionID, promptID: prompt.id, stop: stop)
    }
}
