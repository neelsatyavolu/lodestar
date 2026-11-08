import SwiftUI

/// "Watching fares": hidden entirely while there are none.
struct FareWatchSection: View {
    let model: FareWatchListModel

    var body: some View {
        if let error = model.loadError {
            InlineError(message: error)
        } else if !model.trips.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(title: "Watching fares",
                              detail: "Shortlists saved from Plan. Lodestar checks their fares daily and emails you when an alert fires.")
                ForEach(model.trips) { trip in
                    FareWatchCard(model: model, trip: trip).id(trip.id)
                }
            }
        }
    }
}

/// One saved shortlist with its alerts (`TripCard` in `components/trips.tsx`).
struct FareWatchCard: View {
    let model: FareWatchListModel
    let trip: SavedTrip

    @State private var target = ""
    @State private var showShortlist = false
    @State private var confirmDelete = false
    @State private var marking: FareBooking?
    @FocusState private var targetFocused: Bool

    private var departed: Bool { FareWatchText.isDeparted(trip, todayUTC: .todayUTC()) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            header
            if let booking = trip.booking { bookedSummary(booking) }
            Hairline()
            alerts
            if let error = model.error(for: trip.id) { InlineError(message: error) }
            footer
            if showShortlist {
                FareWatchShortlist(model: model, trip: trip, canBook: trip.booking == nil && !departed) { marking = $0 }
            }
        }
        .card()
        .onAppear { target = trip.targetPrice.map { String(Int($0)) } ?? "" }
        .onChange(of: trip.targetPrice) { _, new in target = new.map { String(Int($0)) } ?? "" }
        .onChange(of: targetFocused) { _, focused in if !focused { saveTarget() } }
        .confirmationDialog("Delete \(trip.title)?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await model.delete(trip.id) } }
        } message: {
            Text("Its alerts stop too.")
        }
        .sheet(item: Binding(get: { marking.map { FareWatchMarking(booking: $0) } }, set: { marking = $0?.booking })) { m in
            FareWatchMarkBookedSheet(booking: m.booking) { await model.markBooked(trip.id, $0) }
                .presentationBackground(Color.card)
                .presentationDetents([.medium, .large])
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(trip.title).textStyle(.code).foregroundStyle(Color.ink)
                Text(trip.prompt).textStyle(.caption).foregroundStyle(Color.mute).lineLimit(1)
            }
            Spacer(minLength: Spacing.sm)
            VStack(alignment: .trailing, spacing: Spacing.xxs) {
                HStack(spacing: Spacing.xs) {
                    Text(FareWatchText.priceLine(trip)).foregroundStyle(Color.ink)
                    if let diff = FareWatchText.change(trip) {
                        Text(FareWatchText.changeText(diff)).foregroundStyle(diff < 0 ? Color.ok : Color.mute)
                    }
                }
                .textStyle(.bodySM)
                .monospacedDigit()
                Text(FareWatchText.checkedLine(trip)).textStyle(.hint).foregroundStyle(Color.ash)
            }
            .layoutPriority(1)
        }
    }

    private func bookedSummary(_ booking: FareBooking) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Text(FareWatchText.bookedLine(booking)).textStyle(.bodySM).foregroundStyle(Color.ink)
                Button("Undo") { Task { await model.unmarkBooked(trip.id) } }.buttonStyle(.lodestar(.quiet, small: true))
            }
            if !departed {
                Text(FareWatchText.creditVerdict(booking).text).textStyle(.caption).foregroundStyle(Color.bodyText)
            }
        }
    }

    @ViewBuilder private var alerts: some View {
        if departed {
            Text("This trip has departed, so its alerts are off.").textStyle(.caption).foregroundStyle(Color.ash)
        } else if trip.booking != nil {
            Toggle("Email me if this fare drops below what I paid", isOn: dropBinding)
                .textStyle(.bodySM).tint(Color.accent)
        } else {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Toggle("Email me when it drops", isOn: dropBinding).textStyle(.bodySM).tint(Color.accent)
                HStack(spacing: Spacing.sm) {
                    Text("Under $").textStyle(.bodySM).foregroundStyle(Color.bodyText)
                    TextField("target", text: $target)
                        .keyboardType(.numberPad)
                        .focused($targetFocused)
                        .textStyle(.bodySM)
                        .frame(width: 96, height: 36)
                        .padding(.horizontal, Spacing.sm)
                        .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.md))
                        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
                        .accessibilityLabel("Target price in dollars")
                    if trip.targetHit { Text("sent").textStyle(.hint).foregroundStyle(Color.ash) }
                    if targetFocused { Button("Save") { targetFocused = false }.buttonStyle(.lodestar(.link)) }
                }
                TripsOptionalDateField(label: "Remind me on", date: remindBinding, placeholder: "Pick a day",
                                       range: LocalDate.today().pickerDate...max(LocalDate.today(), trip.firstDepart).pickerDate)
                if trip.reminded { Text("Reminder sent").textStyle(.hint).foregroundStyle(Color.ash) }
            }
        }
    }

    private var footer: some View {
        HStack {
            Button(showShortlist ? "Hide shortlist" : "Show shortlist") {
                showShortlist.toggle()
                if showShortlist { Task { await model.loadSnapshot(trip.id) } }
            }
            .buttonStyle(.lodestar(.ghost, small: true))
            Spacer()
            Button { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
                .buttonStyle(.lodestar(.quiet, small: true))
                .accessibilityLabel("Delete \(trip.title)")
        }
    }

    private var dropBinding: Binding<Bool> {
        Binding(get: { trip.alertDrop }, set: { on in Task { await model.update(trip.id, SavedTripPatch(alertDrop: on)) } })
    }

    private var remindBinding: Binding<LocalDate?> {
        Binding(get: { trip.remindOn }, set: { day in Task { await model.update(trip.id, SavedTripPatch(remindOn: .some(day))) } })
    }

    private func saveTarget() {
        switch FareWatchText.target(from: target, current: trip.targetPrice) {
        case .unchanged: model.setError(nil, for: trip.id)
        case .invalid(let message): model.setError(message, for: trip.id)
        case .set(let value): Task { await model.update(trip.id, SavedTripPatch(targetPrice: .some(value))) }
        }
    }
}

/// Identifiable wrapper for the mark-booked sheet.
struct FareWatchMarking: Identifiable {
    let booking: FareBooking
    var id: String { booking.tfs + booking.seller + (booking.fare ?? "") }
}
