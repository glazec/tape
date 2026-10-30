import LocalRecorderCore
import SwiftUI

/// Chooses where a recording is saved. Before recording it sets the destination Record uses;
/// while recording it moves the whole recording. Shown in a popover so the panel never resizes.
struct RecorderMeetingPicker: View {
    @ObservedObject var model: RecorderAppModel
    @State private var newTitle = ""
    @State private var isCreatingMeeting = false
    @State private var chosenID: String?
    @State private var hoveredID: String?
    private enum Field: Hashable { case search, newTitle, meeting(String) }
    @FocusState private var focus: Field?

    static let width: CGFloat = 300
    private static let rowHeight: CGFloat = 34
    private static let headerHeight: CGFloat = 26

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text(model.isRecording ? "Move recording to" : "Save recording to")
                    .font(TapeType.sans(11, .semibold))
                    .foregroundStyle(TapePalette.ash)
                searchField
                if let error = model.meetingPickerError, !model.meetingPickerLoadFailed {
                    Text(error)
                        .font(TapeType.sans(11.5))
                        .foregroundStyle(TapePalette.coralInk)
                        .fixedSize(horizontal: false, vertical: true)
                } else if model.isRecording {
                    Text("The whole recording moves to the meeting you choose.")
                        .font(TapeType.sans(11))
                        .foregroundStyle(TapePalette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding([.horizontal, .top], 12)
            .padding(.bottom, 6)

            ScrollViewReader { scroll in
                ScrollView {
                    list.padding(.horizontal, 6).padding(.bottom, 6)
                }
                .frame(height: listHeight)
                .onChange(of: focus) { _, value in
                    if case .meeting(let id) = value { scroll.scrollTo(id) }
                }
            }

            Divider().overlay(TapePalette.hairline)
            footer.padding(.horizontal, 6).padding(.vertical, 6)
        }
        .frame(width: Self.width)
        .background(TapePalette.paper)
        .foregroundStyle(TapePalette.ink)
        .font(TapeType.sans(12.5))
        .onAppear { focus = .search }
        .onExitCommand {
            if isCreatingMeeting { isCreatingMeeting = false; focus = .search }
            else { model.isMeetingPickerPresented = false }
        }
        .onKeyPress(.downArrow) { moveFocus(by: 1) }
        .onKeyPress(.upArrow) { moveFocus(by: -1) }
        .onChange(of: model.isSwitchingMeeting) { _, switching in
            if !switching { chosenID = nil }
        }
    }

    // MARK: Search

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(TapeType.sans(11))
                .foregroundStyle(TapePalette.ash)
            TextField("Search meetings", text: $model.meetingSearch)
                .textFieldStyle(.plain)
                .focused($focus, equals: .search)
                .onChange(of: model.meetingSearch) { _, _ in model.loadMeetingChoices() }
                // Return moves to the results; choosing a row always takes a second, visible step.
                .onSubmit { if let first = selectableChoices.first { focus = .meeting(first.id) } }
                .onKeyPress(.downArrow) { moveFocus(by: 1) }
        }
        .padding(.horizontal, 8)
        .frame(height: 28)
        .background(TapePalette.mist, in: RoundedRectangle(cornerRadius: 6))
    }

    // MARK: List

    @ViewBuilder
    private var list: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            if model.meetingPickerLoadFailed && model.meetingChoices.isEmpty {
                loadErrorRow
            } else if model.meetingChoices.isEmpty && model.isLoadingMeetingChoices {
                ForEach([0.6, 0.45, 0.7], id: \.self) { SkeletonRow(fraction: $0) }
            } else if model.meetingChoices.isEmpty {
                Text(trimmedSearch.isEmpty ? "No meetings yet" : "No meetings match \u{201C}\(trimmedSearch)\u{201D}")
                    .font(TapeType.sans(12))
                    .foregroundStyle(TapePalette.muted)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, minHeight: 96)
            } else {
                ForEach(sections, id: \.title) { section in
                    Text(section.title)
                        .font(TapeType.sans(10.5, .semibold))
                        .tracking(0.6)
                        .textCase(.uppercase)
                        .foregroundStyle(TapePalette.ash)
                        .padding(.horizontal, 8)
                        .frame(height: Self.headerHeight, alignment: .bottomLeading)
                        .padding(.bottom, 2)
                    ForEach(section.meetings) { meeting in
                        meetingRow(meeting, section: section.kind).id(meeting.id)
                    }
                }
                if model.meetingPickerLoadFailed {
                    // A failed page keeps the meetings already shown.
                    loadErrorRow
                } else if model.meetingChoicesHaveMore {
                    SkeletonRow(fraction: 0.5)
                        .onAppear { model.loadMeetingChoices(reset: false) }
                }
            }
        }
    }

    private var loadErrorRow: some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.circle")
            Text(model.meetingPickerError ?? "Couldn't load meetings")
            Spacer(minLength: 0)
            Button("Retry") { model.loadMeetingChoices(reset: model.meetingChoices.isEmpty) }
                .buttonStyle(.plain)
                .font(TapeType.sans(12, .medium))
                .foregroundStyle(TapePalette.graphite)
        }
        .font(TapeType.sans(12))
        .foregroundStyle(TapePalette.coralInk)
        .padding(.horizontal, 8)
        .frame(height: Self.rowHeight)
    }

    private func meetingRow(_ meeting: RecordingMeeting, section: Section.Kind) -> some View {
        let current = isCurrent(meeting)
        let unavailable = !current && unavailableReason(meeting) != nil
        let isChosen = chosenID == meeting.id && model.isSwitchingMeeting
        let isFocused = focus == .meeting(meeting.id)
        return Button { choose(meeting) } label: {
            HStack(spacing: 8) {
                Text(meeting.title)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .foregroundStyle(unavailable ? TapePalette.ash : TapePalette.ink)
                Spacer(minLength: 8)
                Group {
                    if isChosen {
                        ProgressView().controlSize(.mini)
                    } else if current {
                        Image(systemName: "checkmark")
                            .font(TapeType.sans(11, .semibold))
                            .foregroundStyle(TapePalette.green)
                    } else if let reason = unavailableReason(meeting) {
                        Text(reason.short)
                    } else {
                        Text(timeLabel(meeting, section: section))
                    }
                }
                .font(TapeType.sans(11.5))
                .monospacedDigit()
                .foregroundStyle(TapePalette.muted)
            }
            .padding(.horizontal, 8)
            .frame(height: Self.rowHeight)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(current || isFocused || hoveredID == meeting.id ? TapePalette.mist : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(unavailable ? 0.6 : (model.isSwitchingMeeting && !isChosen ? 0.6 : 1))
        .onHover { hoveredID = $0 ? meeting.id : (hoveredID == meeting.id ? nil : hoveredID) }
        .help(unavailableReason(meeting).map { current ? meeting.title : $0.full } ?? meeting.title)
        .focused($focus, equals: .meeting(meeting.id))
        .focusEffectDisabled()
        .disabled(model.isSwitchingMeeting || unavailable)
        .accessibilityLabel("\(meeting.title), \(timeLabel(meeting, section: section))")
        .accessibilityAddTraits(current ? .isSelected : [])
        .accessibilityHint(current ? "Current destination" : (unavailable ? unavailableReason(meeting)?.full ?? "" : (model.isRecording ? "Move the whole recording to this meeting" : "Save the recording to this meeting")))
        .onKeyPress(.return) {
            guard !unavailable, !model.isSwitchingMeeting else { return .ignored }
            choose(meeting)
            return .handled
        }
    }

    // MARK: Footer

    @ViewBuilder
    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if isCreatingMeeting {
                HStack(spacing: 8) {
                    TextField("Name this meeting", text: $newTitle)
                        .textFieldStyle(.plain)
                        .focused($focus, equals: .newTitle)
                        .onSubmit(createMeeting)
                        .padding(.horizontal, 8)
                        .frame(height: 26)
                        .background(TapePalette.mist, in: RoundedRectangle(cornerRadius: 6))
                    Button("Create", action: createMeeting)
                        .buttonStyle(RecorderActionButtonStyle(kind: .quiet, height: 26))
                        .disabled(model.isSwitchingMeeting || newTitle.utf16.count > 500)
                }
                .padding(.horizontal, 2)
                if newTitle.utf16.count > 500 {
                    Text("Shorten the title (500 characters max)")
                        .font(TapeType.sans(11))
                        .foregroundStyle(TapePalette.coralInk)
                        .padding(.horizontal, 8)
                }
            } else {
                Button {
                    newTitle = trimmedSearch
                    isCreatingMeeting = true
                    focus = .newTitle
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "plus")
                            .font(TapeType.sans(11, .medium))
                            .foregroundStyle(TapePalette.ash)
                        Text(isNewMeetingCurrent ? "New meeting" : "New meeting\u{2026}")
                        Spacer(minLength: 0)
                        if isNewMeetingCurrent {
                            Image(systemName: "checkmark")
                                .font(TapeType.sans(11, .semibold))
                                .foregroundStyle(TapePalette.green)
                        }
                    }
                    .padding(.horizontal, 8)
                    .frame(height: Self.rowHeight)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(hoveredID == "new" ? TapePalette.mist : Color.clear)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .onHover { hoveredID = $0 ? "new" : (hoveredID == "new" ? nil : hoveredID) }
                .disabled(model.isSwitchingMeeting)
                .help(model.isRecording ? "Move this recording into a new meeting" : "Save this recording as a new meeting")
            }
        }
    }

    // MARK: Data

    fileprivate struct Section {
        enum Kind { case today, upcoming, earlier }
        var kind: Kind
        var title: String
        var meetings: [RecordingMeeting]
    }

    private var sections: [Section] {
        let calendar = Calendar.current
        let now = Date()
        var today: [RecordingMeeting] = [], upcoming: [RecordingMeeting] = [], earlier: [RecordingMeeting] = []
        for meeting in model.meetingChoices {
            guard let date = meeting.displayDate else { earlier.append(meeting); continue }
            if calendar.isDateInToday(date) { today.append(meeting) }
            else if date > now { upcoming.append(meeting) }
            else { earlier.append(meeting) }
        }
        return [
            Section(kind: .today, title: "Today", meetings: today),
            Section(kind: .upcoming, title: "Upcoming", meetings: upcoming),
            Section(kind: .earlier, title: "Earlier", meetings: earlier),
        ].filter { !$0.meetings.isEmpty }
    }

    private var listHeight: CGFloat {
        if model.meetingChoices.isEmpty { return model.meetingPickerLoadFailed ? Self.rowHeight + 12 : 108 }
        let rows = CGFloat(model.meetingChoices.count + (model.meetingChoicesHaveMore || model.meetingPickerLoadFailed ? 1 : 0))
        let content = rows * Self.rowHeight + CGFloat(sections.count) * (Self.headerHeight + 2) + 6
        return min(max(content, 120), 248)
    }

    private var trimmedSearch: String {
        model.meetingSearch.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Display order, so arrow keys follow what the eye sees.
    private var selectableChoices: [RecordingMeeting] {
        sections.flatMap(\.meetings).filter { meeting in
            isCurrent(meeting) ? model.destinationUnconfirmed : unavailableReason(meeting) == nil
        }
    }

    private var currentMeetingID: String? {
        if model.isRecording {
            return model.destinationUnconfirmed ? nil : model.activeTarget?.meetingId
        }
        if case .meeting(let id, _) = model.recordingDestination { return id }
        return nil
    }

    private var isNewMeetingCurrent: Bool {
        !model.isRecording && model.recordingDestination == .newMeeting(title: nil)
    }

    /// A short trailing label plus the full reason for the tooltip.
    private func unavailableReason(_ meeting: RecordingMeeting) -> (short: String, full: String)? {
        if model.rejectedMeetingIDs.contains(meeting.meetingId) {
            return ("Unavailable", "That meeting can't take this recording")
        }
        guard let reason = meeting.unavailableReason else { return nil }
        return (reason.localizedCaseInsensitiveContains("bot") ? "Bot recording" : "Unavailable", reason)
    }

    private func isCurrent(_ meeting: RecordingMeeting) -> Bool {
        meeting.meetingId == currentMeetingID
    }

    private func timeLabel(_ meeting: RecordingMeeting, section: Section.Kind) -> String {
        guard let date = meeting.displayDate else { return "" }
        switch section {
        case .today:
            return date.formatted(TapeFormat.time)
        case .upcoming:
            return date.formatted(.dateTime.weekday(.abbreviated).hour().minute().locale(TapeFormat.locale))
        case .earlier:
            return date.formatted(.dateTime.month(.abbreviated).day().locale(TapeFormat.locale))
        }
    }

    // MARK: Actions

    private func choose(_ meeting: RecordingMeeting) {
        guard !model.isSwitchingMeeting else { return }
        if isCurrent(meeting) {
            model.isMeetingPickerPresented = false
        } else if model.isRecording {
            chosenID = meeting.id
            model.selectRecordingMeeting(meetingId: meeting.meetingId)
        } else {
            model.pendingDestination = meeting.meetingId == model.suggestedMeeting?.meetingId
                ? nil
                : .meeting(id: meeting.meetingId, title: meeting.title)
            model.isMeetingPickerPresented = false
        }
    }

    private func createMeeting() {
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard title.utf16.count <= 500, !model.isSwitchingMeeting else { return }
        if model.isRecording {
            chosenID = nil
            model.selectRecordingMeeting(meetingId: nil, title: title.isEmpty ? nil : title)
        } else {
            model.pendingDestination = .newMeeting(title: title.isEmpty ? nil : title)
            model.isMeetingPickerPresented = false
        }
    }

    private func moveFocus(by direction: Int) -> KeyPress.Result {
        guard focus != .newTitle, !model.isSwitchingMeeting else { return .ignored }
        let choices = selectableChoices
        let index: Int
        if case .meeting(let id) = focus { index = choices.firstIndex(where: { $0.id == id }) ?? -1 }
        else { index = -1 }
        let next = index + direction
        if choices.indices.contains(next) { focus = .meeting(choices[next].id) }
        else if next < 0 { focus = .search }
        return .handled
    }
}

private struct SkeletonRow: View {
    var fraction: CGFloat

    var body: some View {
        GeometryReader { proxy in
            RoundedRectangle(cornerRadius: 3)
                .fill(TapePalette.mist)
                .frame(width: (proxy.size.width - 16) * fraction, height: 10)
                .padding(.horizontal, 8)
                .frame(maxHeight: .infinity)
        }
        .frame(height: 34)
        .accessibilityLabel("Loading meetings")
    }
}

/// Anchors the meeting picker to a destination control.
struct MeetingPickerPopover: ViewModifier {
    @ObservedObject var model: RecorderAppModel

    func body(content: Content) -> some View {
        content.popover(isPresented: $model.isMeetingPickerPresented, arrowEdge: .bottom) {
            RecorderMeetingPicker(model: model)
        }
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
