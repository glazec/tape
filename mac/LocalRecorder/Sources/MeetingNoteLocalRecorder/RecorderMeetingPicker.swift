import LocalRecorderCore
import SwiftUI

struct RecorderMeetingPicker: View {
    @ObservedObject var model: RecorderAppModel
    @State private var newTitle = ""
    @State private var isCreatingMeeting = false
    private enum Field: Hashable { case search, newTitle, meeting(String) }
    @FocusState private var focus: Field?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Your entire current recording will be added here. Earlier recordings stay unchanged.")
                .foregroundStyle(TapePalette.muted)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Search all meetings", text: $model.meetingSearch)
                .textFieldStyle(.roundedBorder)
                .focused($focus, equals: .search)
                .onChange(of: model.meetingSearch) { _, _ in model.loadMeetingChoices() }
            Text("Recent and upcoming meetings")
                .font(TapeType.sans(11, .medium))
                .foregroundStyle(TapePalette.muted)
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(model.meetingChoices) { meeting in
                            meetingRow(meeting).id(meeting.id)
                            Divider().overlay(TapePalette.hairline)
                        }
                        if model.meetingChoicesHaveMore {
                            Button("Load more") { model.loadMeetingChoices(reset: false) }
                                .disabled(model.isLoadingMeetingChoices)
                                .padding(.top, 8)
                        }
                    }
                }
                .frame(height: 180)
                .onChange(of: focus) { _, value in
                    if case .meeting(let id) = value { scroll.scrollTo(id) }
                }
            }
            DisclosureGroup("Create a new meeting", isExpanded: $isCreatingMeeting) {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("Meeting title (optional)", text: $newTitle)
                        .textFieldStyle(.roundedBorder)
                        .focused($focus, equals: .newTitle)
                        .onSubmit { createMeeting() }
                    Button("Create meeting", action: createMeeting)
                        .disabled(model.isSwitchingMeeting || newTitle.utf16.count > 500)
                    if newTitle.utf16.count > 500 {
                        Text("Use a shorter title, up to 500 characters.").foregroundStyle(TapePalette.coralInk)
                    }
                }.padding(.top, 6)
            }
            .onChange(of: isCreatingMeeting) { _, expanded in
                if expanded { focus = .newTitle }
            }
            if model.isLoadingMeetingChoices || model.isSwitchingMeeting {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text(model.isSwitchingMeeting ? "Confirming meeting…" : "Loading meetings…")
                }.foregroundStyle(TapePalette.muted)
            }
            if let error = model.meetingPickerError {
                Text(error).foregroundStyle(TapePalette.coralInk).fixedSize(horizontal: false, vertical: true)
                if model.meetingPickerLoadFailed {
                    Button("Retry search") { model.loadMeetingChoices() }
                }
            } else if model.meetingChoices.isEmpty, !model.isLoadingMeetingChoices {
                Text("No matching meetings. Try another title or create a meeting.")
                    .foregroundStyle(TapePalette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .font(TapeType.sans(12))
        .padding(12)
        .background(TapePalette.surface, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(TapePalette.border, lineWidth: 1))
        .onAppear { focus = .search }
        .onExitCommand { model.isMeetingPickerPresented = false }
        .onKeyPress(.downArrow) { moveFocus(by: 1) }
        .onKeyPress(.upArrow) { moveFocus(by: -1) }
    }

    private func meetingRow(_ meeting: RecordingMeeting) -> some View {
        let current = model.activeTarget?.meetingId == meeting.meetingId
        let unavailable = !current && meeting.unavailableReason != nil
        return Button {
            if current && !model.destinationUnconfirmed { model.isMeetingPickerPresented = false }
            else { model.selectRecordingMeeting(meetingId: meeting.meetingId) }
        } label: {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(meeting.title).lineLimit(2).foregroundStyle(TapePalette.ink)
                    Text(meetingContext(meeting))
                        .font(TapeType.sans(11)).foregroundStyle(TapePalette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                if current && !model.destinationUnconfirmed {
                    Image(systemName: "checkmark").foregroundStyle(TapePalette.green).accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focused($focus, equals: .meeting(meeting.id))
        .disabled(model.isSwitchingMeeting || unavailable)
        .accessibilityAddTraits(current && !model.destinationUnconfirmed ? .isSelected : [])
        .accessibilityHint(current ? "Current recording meeting" : "Add the entire current recording to this meeting")
        .onKeyPress(.return) {
            guard !unavailable, !model.isSwitchingMeeting else { return .ignored }
            if current && !model.destinationUnconfirmed { model.isMeetingPickerPresented = false }
            else { model.selectRecordingMeeting(meetingId: meeting.meetingId) }
            return .handled
        }
    }

    private func meetingContext(_ meeting: RecordingMeeting) -> String {
        let date = meeting.displayDate.map { value in
            let time = value.formatted(date: .omitted, time: .shortened)
            if Calendar.current.isDateInToday(value) { return "Today, \(time)" }
            if Calendar.current.isDateInYesterday(value) { return "Yesterday, \(time)" }
            return value.formatted(date: .abbreviated, time: .shortened)
        } ?? "Date unavailable"
        let current = meeting.meetingId == model.activeTarget?.meetingId && !model.destinationUnconfirmed
        let state = current ? "Current recording" : meeting.unavailableReason ?? meeting.statusLabel
        return "\(meeting.dateIsCreationDate && meeting.displayDate != nil ? "Created " : "")\(date) · \(state)"
    }

    private func createMeeting() {
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard title.utf16.count <= 500 else { return }
        model.selectRecordingMeeting(meetingId: nil, title: title.isEmpty ? nil : title)
    }

    private func moveFocus(by direction: Int) -> KeyPress.Result {
        guard focus != .newTitle, !model.isSwitchingMeeting else { return .ignored }
        let choices = model.meetingChoices.filter {
            let current = $0.meetingId == model.activeTarget?.meetingId
            return current ? model.destinationUnconfirmed : $0.unavailableReason == nil
        }
        let index: Int
        if case .meeting(let id) = focus { index = choices.firstIndex(where: { $0.id == id }) ?? -1 }
        else { index = -1 }
        let next = index + direction
        if choices.indices.contains(next) { focus = .meeting(choices[next].id) }
        else if next < 0 { focus = .search }
        return .handled
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
