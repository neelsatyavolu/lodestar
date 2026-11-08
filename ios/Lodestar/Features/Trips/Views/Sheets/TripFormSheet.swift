import SwiftUI

/// "Plan a trip" and "Edit" (`forms.tsx`).
struct TripFormSheet: View {
    enum Mode {
        /// The connected AI's name, when one is connected.
        case create(String?)
        case edit(Journey)
    }

    let mode: Mode
    /// Throws an `APIError` to show; the sheet closes on success.
    let submit: (TripsTripForm) async throws -> Void

    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var form = TripsTripForm()
    @State private var hasDates = false
    @State private var hasEnd = false
    @State private var busy = false
    @State private var error: String?

    private var isCreate: Bool { if case .create = mode { true } else { false } }
    private var aiName: String? { if case .create(let name) = mode { name } else { nil } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    if !isCreate {
                        LodestarField(label: "Name", text: $form.title, placeholder: "Lisbon, Nov 2026")
                    }
                    LodestarField(label: "Where", text: $form.destination, placeholder: "Lisbon", contentType: .addressCity, submitLabel: .next)
                    dates
                    Stepper(value: $form.travelers, in: 1...30) {
                        Text(TripsText.travellers(form.travelers) ?? "").textStyle(.bodySM).foregroundStyle(Color.bodyText)
                    }
                    typePicker
                    if let aiName, isCreate { aiSection(aiName) }
                    if let error { InlineError(message: error) }
                }
                .padding(Sizes.sheetPadding)
            }
            .canvasBackground()
            .navigationTitle(isCreate ? "Plan a trip" : "Edit trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(submitTitle, action: save).disabled(busy)
                }
            }
        }
        .onAppear(perform: prefill)
    }

    private var submitTitle: String {
        guard isCreate else { return "Save" }
        return form.wantsDraft && aiName != nil && hasDates ? "Create and draft" : "Create"
    }

    private var dates: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Toggle("Dates", isOn: $hasDates.animation(Motion.fast)).textStyle(.bodySM).tint(Color.accent)
            if hasDates {
                DatePicker("Starts", selection: startBinding, displayedComponents: .date).textStyle(.bodySM)
                Toggle("Ends on another day", isOn: $hasEnd).textStyle(.bodySM).tint(Color.accent)
                if hasEnd {
                    DatePicker("Ends", selection: endBinding, in: startBinding.wrappedValue..., displayedComponents: .date)
                        .textStyle(.bodySM)
                }
            }
        }
        .onChange(of: hasDates) { _, on in
            form.startDate = on ? (form.startDate ?? .today().adding(days: 30)) : nil
            if !on { hasEnd = false; form.endDate = nil }
        }
        .onChange(of: hasEnd) { _, on in
            form.endDate = on ? (form.endDate ?? form.startDate?.adding(days: 4)) : nil
        }
    }

    private var typePicker: some View {
        Picker("Kind of trip", selection: $form.tripType) {
            Text("Not set").tag(TripType?.none)
            ForEach(TripType.knownCases, id: \.self) { type in
                Text(type.label).tag(TripType?.some(type))
            }
        }
        .textStyle(.bodySM)
        .tint(Color.ink)
    }

    private func aiSection(_ name: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Toggle("Draft it with \(name)", isOn: $form.draftWithAI).textStyle(.bodySM).tint(Color.accent)
            if form.draftWithAI {
                LodestarField(label: "Anything it should know?", text: $form.wishes,
                              placeholder: "Slow mornings, one big dinner, no museums",
                              hint: hasDates ? nil : "Add dates so it can plan each day.")
            }
        }
    }

    private var startBinding: Binding<Date> {
        Binding(get: { (form.startDate ?? .today()).pickerDate }, set: { form.startDate = LocalDate(localDayOf: $0) })
    }

    private var endBinding: Binding<Date> {
        Binding(get: { (form.endDate ?? form.startDate ?? .today()).pickerDate }, set: { form.endDate = LocalDate(localDayOf: $0) })
    }

    private func prefill() {
        guard case .edit(let journey) = mode, form.destination.isEmpty, form.title.isEmpty else { return }
        form = TripsTripForm(editing: journey)
        hasDates = journey.startDate != nil
        hasEnd = journey.endDate != nil && journey.endDate != journey.startDate
    }

    private func save() {
        if let problem = form.validate(requireDestination: isCreate) {
            error = problem
            return
        }
        busy = true
        error = nil
        Task {
            do {
                try await submit(form)
                dismiss()
            } catch let problem as TripsProblem {
                self.error = problem.message
            } catch {
                self.error = app.handle(error)
            }
            busy = false
        }
    }
}
