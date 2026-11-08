import SwiftUI

/// "Add": a flight, stay, reservation, plan or transfer by hand.
struct TripsAddItemSheet: View {
    let model: TripDetailModel
    @Environment(\.dismiss) private var dismiss
    @State private var form: TripsAddItemForm
    @State private var busy = false
    @State private var error: String?

    init(model: TripDetailModel, choice: TripsAddItemForm.Choice, day: LocalDate) {
        self.model = model
        _form = State(initialValue: TripsAddItemForm(choice: choice, day: day))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    Picker("What", selection: $form.choice) {
                        ForEach(TripsAddItemForm.Choice.allCases) { Text($0.label).tag($0) }
                    }
                    .tint(Color.ink)
                    .onChange(of: form.choice) { _, choice in
                        if choice == .stay, form.endDate == nil { form.endDate = form.startDate.adding(days: 1) }
                        if choice == .rentalCar, form.title.isEmpty { form.title = "Rental car" }
                    }
                    LodestarField(label: "Name", text: $form.title, placeholder: placeholder)
                    DatePicker(form.choice == .stay ? "Check in" : "Day", selection: $form.startDate.asDate, displayedComponents: .date)
                        .textStyle(.bodySM)
                    if form.choice == .stay {
                        TripsOptionalDateField(label: "Check out", date: $form.endDate, placeholder: "Set", fallback: form.startDate.adding(days: 1))
                    } else {
                        Toggle("Time", isOn: $form.hasTime).textStyle(.bodySM).tint(Color.accent)
                        if form.hasTime {
                            DatePicker("Starts at", selection: timeBinding, displayedComponents: .hourAndMinute).textStyle(.bodySM)
                        }
                    }
                    LodestarField(label: "City or area (optional)", text: $form.place, placeholder: "Lisbon")
                    LodestarField(label: "Confirmation number (optional)", text: $form.confirmation, mono: true, autocapitalization: .characters)
                    Toggle("Already booked", isOn: $form.booked).textStyle(.bodySM).tint(Color.accent)
                    if let error { InlineError(message: error) }
                }
                .padding(Sizes.sheetPadding)
            }
            .canvasBackground()
            .navigationTitle("Add to the trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Add", action: save).disabled(busy) }
            }
        }
    }

    private var placeholder: String {
        switch form.choice {
        case .activity: "Tile museum"
        case .dining: "Dinner at Cervejaria Ramiro"
        case .stay: "Memmo Alfama"
        case .flight: "TAP 202 to Lisbon"
        case .transport: "Train to Sintra"
        case .rentalCar: "Rental car"
        }
    }

    private var timeBinding: Binding<Date> {
        Binding(get: { TripsClock.date(from: form.time) }, set: { form.time = TripsClock.hhmm(from: $0) })
    }

    private func save() {
        if let problem = form.validate() {
            error = problem
            return
        }
        busy = true
        Task {
            error = await model.addItem(form.newItem)
            busy = false
            if error == nil { dismiss() }
        }
    }
}

/// "Add a place" on a day: search Google/OSM near the trip, or keep free text as a note.
struct TripsAddPlaceSheet: View {
    let model: TripDetailModel
    let day: LocalDate
    @Environment(\.dismiss) private var dismiss
    @State private var search: TripsPlaceSearchModel
    @State private var busy = false
    @State private var error: String?

    init(model: TripDetailModel, day: LocalDate) {
        self.model = model
        self.day = day
        _search = State(initialValue: TripsPlaceSearchModel(app: model.app, near: TripsPlan.searchCenter(model.trip.items, date: day)))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text(DateText.long(day)).textStyle(.bodySM).foregroundStyle(Color.mute)
                    TripsPlaceSearchList(search: search, busy: busy) { picked in add(picked) }
                    if search.trimmed.count >= 2 {
                        Button("Add \u{201C}\(search.trimmed)\u{201D} as a note") { addNote() }
                            .buttonStyle(.lodestar(.ghost, small: true))
                            .disabled(busy)
                    }
                    if let error { InlineError(message: error) }
                }
                .padding(Sizes.sheetPadding)
            }
            .canvasBackground()
            .navigationTitle("Add a place")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func add(_ s: PlaceSuggestion) {
        busy = true
        Task {
            let details = await search.details(for: s)
            error = await model.addItem(TripsRequests.placeItem(s, details: details, day: day))
            busy = false
            if error == nil { dismiss() }
        }
    }

    private func addNote() {
        busy = true
        Task {
            error = await model.addItem(TripsRequests.noteItem(search.trimmed, day: day))
            busy = false
            if error == nil { dismiss() }
        }
    }
}

/// The search field and its suggestion rows.
struct TripsPlaceSearchList: View {
    @Bindable var search: TripsPlaceSearchModel
    let busy: Bool
    let pick: (PlaceSuggestion) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            LodestarField(label: "Search places", text: $search.query, placeholder: "A restaurant, museum, beach…",
                          autocapitalization: .words, submitLabel: .search)
            if search.isSearching || busy { Spinner() }
            if let error = search.error { InlineError(message: error) }
            ForEach(search.suggestions) { s in
                Button { pick(s) } label: {
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        Text(s.name).textStyle(.bodySM).foregroundStyle(Color.ink)
                        Text([s.category, s.secondary].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                            .textStyle(.caption).foregroundStyle(Color.mute).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, minHeight: Sizes.button, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(busy)
                Hairline()
            }
        }
    }
}
