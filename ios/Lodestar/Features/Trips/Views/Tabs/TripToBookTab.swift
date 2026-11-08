import SwiftUI

/// To book (`to-book-tab.tsx`): what still needs a reservation, soonest deadline first.
struct TripToBookTab: View {
    let model: TripDetailModel
    let present: (TripsTripSheet) -> Void

    var body: some View {
        let list = model.toBook
        let today = LocalDate.today()
        let pastDue = list.filter { ($0.details.bookBy.map { $0 < today }) ?? false }.count
        VStack(alignment: .leading, spacing: Spacing.lg) {
            SectionHeader(title: "To book", detail: list.isEmpty
                ? "Restaurants, tours, spa slots, cars: anything that needs a reservation."
                : "\(list.count) to reserve, \(pastDue) past due. Soonest deadline first.")
            if list.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    EmptyStateView(title: "Nothing to book yet",
                                   message: "Your AI can go through the itinerary and flag what needs a reservation and by when. You can also mark any planned stop as needing booking from the Itinerary.")
                    aiButton(PlanPart.toBook.draftAction)
                }
            } else {
                ForEach(list) { TripsToBookCard(model: model, item: $0, today: today, present: present) }
                aiButton("Check for more")
            }
        }
    }

    private func aiButton(_ title: String) -> some View {
        Button(title) { Task { await model.draft(.toBook) } }
            .buttonStyle(.lodestar(.ghost, small: true, isLoading: model.drafter.running == .toBook))
            .disabled(model.drafter.isBusy)
    }
}

private struct TripsToBookCard: View {
    let model: TripDetailModel
    let item: TripItem
    let today: LocalDate
    let present: (TripsTripSheet) -> Void

    var body: some View {
        let deadline = TripsText.deadline(item.details.bookBy, today: today)
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.title).textStyle(.bodyMD).foregroundStyle(Color.ink)
                Spacer()
                IconButton(systemName: "xmark", accessibilityLabel: "Doesn't need booking") {
                    Task { await model.patchItem(item.id, TripsRequests.doesNotNeedBooking) }
                }
                .frame(width: 32, height: 32)
            }
            Text(whenLine).textStyle(.caption).foregroundStyle(Color.mute)
            HStack(spacing: Spacing.sm) {
                if let tone = deadline?.tone { StatusDot(tone: tone == .danger ? .danger : .warn) }
                Text(deadline?.text ?? "No deadline").textStyle(.caption).foregroundStyle(Color.bodyText)
                if let estimate = item.details.estimate {
                    Text("· about \(Money.amount(estimate, currency: item.details.currencyCode))").textStyle(.caption).foregroundStyle(Color.mute)
                }
            }
            if let text = item.details.note ?? item.details.why {
                Text(text).textStyle(.bodySM).foregroundStyle(Color.bodyText)
            }
            TripsOptionalDateField(label: "Book by", date: bookByBinding, placeholder: "Set a date", fallback: max(today, item.startDate.adding(days: -7)))
            actions
        }
        .card()
        .disabled(model.busyItems.contains(item.id))
    }

    private var whenLine: String {
        [DateText.short(item.startDate), TripsText.timeRange(item), item.details.address ?? item.place]
            .compactMap { $0 }.joined(separator: " · ")
    }

    private var actions: some View {
        FlowLayout(spacing: Spacing.sm) {
            Button("Mark booked") { present(.markBooked(item.id)) }.buttonStyle(.lodestar(.primary, small: true))
            if let url = item.details.url.flatMap(URL.init(string:)) {
                Button("Reserve") { present(.web(url)) }.buttonStyle(.lodestar(.ghost, small: true))
            }
            if let phone = item.details.phone, let tel = URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })") {
                Link(destination: tel) { Label(phone, systemImage: "phone") }.buttonStyle(.lodestar(.quiet, small: true))
            }
        }
    }

    private var bookByBinding: Binding<LocalDate?> {
        Binding(get: { item.details.bookBy }, set: { day in Task { await model.patchItem(item.id, TripsRequests.bookBy(day)) } })
    }
}

/// Bookings (`bookings-tab.tsx`): confirmed things by kind.
struct TripBookingsTab: View {
    let model: TripDetailModel
    let present: (TripsTripSheet) -> Void

    var body: some View {
        let groups = TripsPlan.bookings(model.trip.items)
        let confirmed = model.trip.items.filter { $0.status == .booked }.count
        let day = model.activeDay ?? model.journey.startDate ?? .today()
        VStack(alignment: .leading, spacing: Spacing.lg) {
            SectionHeader(title: "Bookings", detail: "\(confirmed) confirmed. Forward a confirmation email and it lands here.")
            if groups.isEmpty {
                EmptyStateView(title: "No bookings yet",
                               message: "Forward confirmation emails to your Lodestar address, connect Flint, or add one by hand. Things you mark booked on To book show up here too.",
                               actionTitle: "Add booking") { present(.addItem(.flight, day)) }
            }
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text(group.label).textStyle(.label).foregroundStyle(Color.charcoal)
                    VStack(spacing: 0) {
                        ForEach(group.items) { item in
                            row(item)
                            if item.id != group.items.last?.id { Hairline() }
                        }
                    }
                    .card(padding: 0)
                }
            }
        }
    }

    private func row(_ item: TripItem) -> some View {
        let cancelled = item.status == .cancelled
        let sub = [TripsText.bookingWhen(item), item.details.provider ?? item.details.airline, cancelled ? "Cancelled" : nil]
            .compactMap { $0 }.joined(separator: " · ")
        return HStack(alignment: .top, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(item.title).textStyle(.bodySM).foregroundStyle(cancelled ? Color.ash : Color.ink).strikethrough(cancelled)
                Text(sub).textStyle(.caption).foregroundStyle(Color.mute)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: Spacing.xs) {
                if let price = item.details.price {
                    Text(Money.amount(price, currency: item.details.currencyCode)).textStyle(.bodySM).monospacedDigit().foregroundStyle(Color.ink)
                }
                if let code = item.confirmation {
                    Button { UIPasteboard.general.string = code } label: {
                        Label(code, systemImage: "doc.on.doc").textStyle(.codeSmall)
                    }
                    .buttonStyle(.lodestar(.ghost, small: true))
                    .accessibilityLabel("Copy confirmation \(code)")
                } else {
                    Text("No number").textStyle(.hint).foregroundStyle(Color.ash)
                }
            }
        }
        .padding(Spacing.lg)
        .contentShape(Rectangle())
        .onTapGesture { present(.place(item.id)) }
    }
}
