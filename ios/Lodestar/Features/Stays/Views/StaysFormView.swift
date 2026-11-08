import SwiftUI

/// Where, check in, check out, guests, Search. Matches the web form's limits and defaults.
struct StaysFormView: View {
    let model: StaysSearchModel

    var body: some View {
        let form = model.form
        VStack(alignment: .leading, spacing: Spacing.md) {
            LodestarField(
                label: "Where",
                text: Binding(get: { model.form.city }, set: { value in model.update { $0.with(city: value) } }),
                placeholder: "City or neighborhood",
                contentType: .addressCity,
                autocapitalization: .words,
                submitLabel: .search,
                onSubmit: { model.submit() }
            )
            HStack(spacing: Spacing.md) {
                StaysDateField(
                    label: "Check in",
                    date: form.checkin,
                    minimum: model.todayDate,
                    set: { day in model.update { $0.with(checkin: day) } }
                )
                StaysDateField(
                    label: "Check out",
                    date: form.checkout,
                    minimum: form.checkin.adding(days: 1),
                    set: { day in model.update { $0.with(checkout: day) } }
                )
            }
            HStack(alignment: .bottom, spacing: Spacing.md) {
                guestsPicker(form.adults)
                Button {
                    model.submit()
                } label: {
                    if model.isSearching {
                        Text("Searching…")
                    } else {
                        Label("Search", systemImage: "magnifyingglass")
                    }
                }
                .buttonStyle(.lodestar(.primary, fullWidth: true, isLoading: model.isSearching))
                .disabled(!model.canSearch)
                .padding(.bottom, (Sizes.input - Sizes.button) / 2)
            }
            if let error = form.lengthError {
                InlineError(message: error)
            }
        }
        .card(padding: Spacing.md)
    }

    private func guestsPicker(_ adults: Int) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs + 2) {
            Text("Guests").textStyle(.label).foregroundStyle(Color.charcoal)
            Menu {
                Picker("Guests", selection: Binding(get: { model.form.adults }, set: { n in model.update { $0.with(adults: n) } })) {
                    ForEach(1...StaysForm.maxAdults, id: \.self) { n in
                        Text(plural(n, "adult")).tag(n)
                    }
                }
            } label: {
                HStack {
                    Text(plural(adults, "adult")).textStyle(.bodySM).foregroundStyle(Color.ink)
                    Spacer(minLength: Spacing.xs)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)).foregroundStyle(Color.ash)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: Sizes.input)
                .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
            }
            .accessibilityLabel("Guests, \(plural(adults, "adult"))")
        }
        .frame(maxWidth: .infinity)
    }
}

/// A compact date picker on a `LocalDate`, in UTC so the picked day never shifts.
private struct StaysDateField: View {
    let label: String
    let date: LocalDate
    let minimum: LocalDate
    let set: (LocalDate) -> Void

    /// Gregorian in UTC with the device's locale, so the picker shows the wire day as written.
    private static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = LocalDate.utc.timeZone
        return calendar
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs + 2) {
            Text(label).textStyle(.label).foregroundStyle(Color.charcoal)
            DatePicker(
                label,
                selection: Binding(
                    get: { date.date },
                    set: { set(LocalDate(localDayOf: $0, calendar: Self.utcCalendar)) }
                ),
                in: minimum.date...,
                displayedComponents: .date
            )
            .labelsHidden()
            .datePickerStyle(.compact)
            .tint(Color.accent)
            .environment(\.timeZone, Self.utcCalendar.timeZone)
            .environment(\.calendar, Self.utcCalendar)
            .frame(maxWidth: .infinity, minHeight: Sizes.input, alignment: .leading)
            .padding(.horizontal, Spacing.sm)
            .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
        }
        .frame(maxWidth: .infinity)
    }
}
