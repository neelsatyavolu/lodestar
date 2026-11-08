import SwiftUI

/// The trip part of the place panel: status line, day, time, note and status buttons.
struct TripsPlaceTripPart: View {
    let model: TripDetailModel
    let item: TripItem
    let present: (TripsTripSheet) -> Void
    let close: () -> Void

    @State private var note = ""
    @State private var confirmRemove = false
    @FocusState private var noteFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(statusLine).textStyle(.code).foregroundStyle(Color.bodyText)
            if model.busyItems.contains(item.id) { Spinner() }
            dayPicker
            if item.kind != .stay { timeRow }
            noteField
            buttons
        }
        .onAppear { note = item.details.note ?? "" }
        .onChange(of: noteFocused) { _, focused in if !focused { saveNote() } }
        .confirmationDialog("Remove \(item.title)?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                Task {
                    await model.removeItem(item.id)
                    close()
                }
            }
        }
    }

    /// "Booked · 7:00 PM · ABC123".
    private var statusLine: String {
        [TripsText.statusWord(item), TripsText.timeRange(item), item.confirmation].compactMap { $0 }.joined(separator: " · ")
    }

    private var dayPicker: some View {
        HStack {
            Text("Day").textStyle(.bodySM).foregroundStyle(Color.bodyText)
            Spacer()
            Menu {
                ForEach(model.days, id: \.self) { day in
                    Button(DateText.short(day)) { Task { await model.patchItem(item.id, TripsRequests.day(day)) } }
                }
            } label: {
                Text(DateText.short(item.startDate))
            }
            .buttonStyle(.lodestar(.ghost, small: true))
        }
    }

    private var timeRow: some View {
        HStack {
            Text("Time").textStyle(.bodySM).foregroundStyle(Color.bodyText)
            Spacer()
            if let time = item.startTime {
                DatePicker("Time", selection: Binding(
                    get: { TripsClock.date(from: time) },
                    set: { new in Task { await model.patchItem(item.id, TripsRequests.time(TripsClock.hhmm(from: new))) } }
                ), displayedComponents: .hourAndMinute)
                .labelsHidden()
                Button("Clear") { Task { await model.patchItem(item.id, TripsRequests.time(nil)) } }
                    .buttonStyle(.lodestar(.quiet, small: true))
                    .accessibilityLabel("Clear time")
            } else {
                Button("Set a time") { Task { await model.patchItem(item.id, TripsRequests.time("12:00")) } }
                    .buttonStyle(.lodestar(.ghost, small: true))
            }
        }
    }

    private var noteField: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("Note").textStyle(.label).foregroundStyle(Color.charcoal)
            TextField("What to order, how to get there…", text: $note, axis: .vertical)
                .lineLimit(2...6)
                .focused($noteFocused)
                .textStyle(.bodySM)
                .padding(Spacing.md)
                .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(noteFocused ? Color.accent : Color.hairlineStrong, lineWidth: Sizes.hairline))
            if noteFocused {
                Button("Save note") { noteFocused = false }.buttonStyle(.lodestar(.link))
            }
        }
    }

    @ViewBuilder private var buttons: some View {
        let flow = FlowLayout(spacing: Spacing.sm) {
            switch item.status {
            case .suggested:
                Button("Keep") { patch(TripsRequests.status(.planned)) }.buttonStyle(.lodestar(.primary, small: true))
            case .planned:
                Button("Mark booked") { present(.markBooked(item.id)) }.buttonStyle(.lodestar(.primary, small: true))
                Button(item.details.reserve == true ? "Doesn't need booking" : "Needs booking") {
                    patch(item.details.reserve == true ? TripsRequests.doesNotNeedBooking : TripsRequests.needsBooking)
                }
                .buttonStyle(.lodestar(.ghost, small: true))
            case .booked:
                Button("Mark cancelled") { patch(TripsRequests.status(.cancelled)) }.buttonStyle(.lodestar(.ghost, small: true))
            case .cancelled, .unknown:
                EmptyView()
            }
        }
        flow
        Button(item.status == .suggested ? "Dismiss" : "Remove", role: .destructive) {
            if item.status == .suggested {
                Task { await model.removeItem(item.id); close() }
            } else {
                confirmRemove = true
            }
        }
        .buttonStyle(.lodestar(.destructive, small: true))
    }

    private func patch(_ p: ItemPatch) {
        Task { await model.patchItem(item.id, p) }
    }

    private func saveNote() {
        guard note.trimmingCharacters(in: .whitespacesAndNewlines) != (item.details.note ?? "") else { return }
        patch(TripsRequests.note(note))
    }
}
