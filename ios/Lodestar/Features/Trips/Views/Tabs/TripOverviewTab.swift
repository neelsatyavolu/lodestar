import SwiftUI

/// Overview (`overview-tab.tsx`).
struct TripOverviewTab: View {
    let model: TripDetailModel
    let present: (TripsTripSheet) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            if model.trip.items.contains(where: { $0.details.isPinned && $0.status != .cancelled }) {
                TripsMapCard(model: model, day: nil) { present(.map) }
            }
            reservations
            budgetCard
            TripsIssuesCard(model: model, present: present)
            TripsNotesCard(model: model, present: present)
            TripsLodgingCard(model: model, present: present)
            placesToVisit
        }
    }

    private var firstDay: LocalDate { model.activeDay ?? model.journey.startDate ?? .today() }

    private var reservations: some View {
        let items = model.trip.items
        let booked = items.filter { $0.status == .booked }.count
        let count: (TripsAddItemForm.Choice) -> Int = { choice in
            items.filter { item in
                guard item.status == .booked else { return false }
                switch choice {
                case .rentalCar: return TripsText.isRentalCar(item)
                case .transport: return item.kind == .transport && !TripsText.isRentalCar(item)
                default: return item.kind == choice.kind
                }
            }.count
        }
        let choices: [(TripsAddItemForm.Choice, String, String)] = [
            (.flight, "Flight", "airplane"), (.stay, "Stay", "bed.double"), (.rentalCar, "Rental car", "car"),
            (.transport, "Transport", "tram"), (.activity, "Activity", "ticket"), (.dining, "Dining", "fork.knife"),
        ]
        return Card(title: "Reservations") {
            Button("\(booked) booked · \(model.toBook.count) to book") { model.tab = .bookings }
                .buttonStyle(.lodestar(.link))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: Spacing.sm)], spacing: Spacing.sm) {
                ForEach(choices, id: \.0) { choice, label, icon in
                    Button { present(.addItem(choice, firstDay)) } label: {
                        HStack(spacing: Spacing.sm) {
                            Image(systemName: icon).frame(width: 18)
                            Text(label)
                            Spacer(minLength: 0)
                            let n = count(choice)
                            if n > 0 { Text("\(n)").monospacedDigit().foregroundStyle(Color.mute) }
                        }
                    }
                    .buttonStyle(.lodestar(.ghost, small: true, fullWidth: true))
                    .accessibilityLabel("Add \(label.lowercased())")
                }
            }
        }
    }

    private var budgetCard: some View {
        let b = model.budget
        return Card(title: "Budget") {
            Text(Money.amount(b.total, currency: b.currency)).textStyle(.headingMD).monospacedDigit().foregroundStyle(Color.ink)
            Text(b.total == 0 ? "Nothing priced yet" : budgetLine(b)).textStyle(.caption).foregroundStyle(Color.mute)
            Button("View details") { model.tab = .budget }.buttonStyle(.lodestar(.link))
        }
    }

    private func budgetLine(_ b: TripsBudget) -> String {
        ["\(Money.amount(b.paid, currency: b.currency)) paid", b.perPerson.map { "\(Money.amount($0, currency: b.currency)) each" }]
            .compactMap { $0 }.joined(separator: " · ")
    }

    @ViewBuilder private var placesToVisit: some View {
        let places = TripsPlan.placesToVisit(model.trip.items)
        VStack(alignment: .leading, spacing: Spacing.md) {
            TripsSectionHead(title: "Places to visit") {
                Button("Suggest places") { Task { await model.suggest(.dining) } }
                    .buttonStyle(.lodestar(.ghost, small: true, isLoading: model.drafter.suggesting == .dining))
                    .disabled(model.drafter.isBusy || !model.canPlanMeals)
            }
            if places.isEmpty {
                Text("Ideas without a time land here: places to eat and things to do you might fit in.")
                    .textStyle(.bodySM).foregroundStyle(Color.mute)
            } else {
                ForEach(places) { item in
                    TripsStopCard(model: model, item: item, pin: nil, present: present)
                }
            }
        }
    }
}

/// "To sort out": issues worked out from the plan.
struct TripsIssuesCard: View {
    let model: TripDetailModel
    let present: (TripsTripSheet) -> Void

    var body: some View {
        let issues = model.issues()
        if !issues.isEmpty {
            let warns = issues.filter { $0.level == .warn }.count
            Card(title: warns > 0 ? "To sort out · \(warns)" : "To sort out") {
                ForEach(issues) { issue in
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                        StatusDot(tone: issue.level == .warn ? .warn : .neutral)
                        Text(issue.text).textStyle(.bodySM).foregroundStyle(Color.bodyText)
                        Spacer(minLength: 0)
                        if let id = issue.itemId {
                            Button("Open") { present(.place(id)) }.buttonStyle(.lodestar(.link))
                        }
                    }
                }
            }
        }
    }
}

/// Notes with "Add a note" and "Write notes with AI".
struct TripsNotesCard: View {
    let model: TripDetailModel
    let present: (TripsTripSheet) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            TripsSectionHead(title: "Notes") {
                Menu {
                    Button("Add a note") { present(.note(nil)) }
                    Button("Write notes with AI") { Task { await model.draft(.notes) } }
                } label: {
                    Image(systemName: "ellipsis").frame(width: Sizes.button, height: Sizes.buttonSmall)
                }
                .disabled(model.drafter.isBusy)
                .accessibilityLabel("Notes actions")
            }
            if model.trip.notes.isEmpty {
                Text("Nothing written yet.").textStyle(.bodySM).foregroundStyle(Color.mute)
            }
            ForEach(model.trip.notes) { note in
                Button { present(.note(note.id)) } label: {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(note.title).textStyle(.bodyMD).foregroundStyle(Color.ink)
                        Text(note.body).textStyle(.bodySM).foregroundStyle(Color.bodyText).multilineTextAlignment(.leading)
                    }
                    .card()
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// "Hotels and lodging": each run of nights, gaps dashed.
struct TripsLodgingCard: View {
    let model: TripDetailModel
    let present: (TripsTripSheet) -> Void

    var body: some View {
        let j = model.journey
        let runs = TripsPlan.nights(start: j.startDate, end: j.endDate, items: model.trip.items)
        if !runs.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.md) {
                TripsSectionHead(title: "Hotels and lodging") {
                    Text(plural(runs.map(\.nights).reduce(0, +), "night")).textStyle(.caption).foregroundStyle(Color.ash)
                }
                ForEach(runs) { run in row(run) }
            }
        }
    }

    @ViewBuilder private func row(_ run: TripsNightRun) -> some View {
        let dates = "\(DateText.monthDay(run.from)) – \(DateText.monthDay(run.to)) · \(plural(run.nights, "night"))"
        if let stay = run.stay {
            Button { present(.place(stay.id)) } label: {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(stay.title).textStyle(.bodyMD).foregroundStyle(Color.ink)
                    Text(stay.status == .booked ? [stay.place, "Booked"].compactMap { $0 }.joined(separator: " · ") : "Planned, not booked")
                        .textStyle(.caption).foregroundStyle(Color.mute)
                    Text(dates).textStyle(.caption).foregroundStyle(Color.ash)
                }
                .card()
            }
            .buttonStyle(.plain)
        } else {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("No stay yet").textStyle(.bodyMD).foregroundStyle(Color.ink)
                Text(dates).textStyle(.caption).foregroundStyle(Color.ash)
                Button("Add a place to stay") { present(.addItem(.stay, run.from)) }.buttonStyle(.lodestar(.ghost, small: true))
            }
            .padding(Sizes.cardPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairlineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
        }
    }
}
