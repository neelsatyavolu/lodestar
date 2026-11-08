import SwiftUI

/// The flight search form card (web `components/search-form.tsx`).
struct SearchFormView: View {
    @Binding var form: SearchForm
    let isSearching: Bool
    let onSubmit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            selectsRow
            Hairline()
            VStack(alignment: .leading, spacing: Spacing.md) {
                airports
                dates
            }
            .padding(Spacing.md)
            Hairline()
            hacksRow
        }
        .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
    }

    private var selectsRow: some View {
        FlowLayout(spacing: Spacing.sm) {
            SearchSegmented(options: [(true, "Round trip"), (false, "One way")], selection: Binding(
                get: { form.roundTrip }, set: { form = form.settingRoundTrip($0) }))
            SearchMenuPicker(title: "Travellers",
                             options: SearchForm.adultChoices.map { ($0, plural($0, "adult")) },
                             selection: $form.adults)
            SearchMenuPicker(title: "Cabin", options: Cabin.knownCases.map { ($0, $0.label) },
                             selection: $form.cabin)
            SearchMenuPicker(title: "Stops",
                             options: MaxStops.knownCases.map { ($0, $0 == .any ? "Any stops" : $0.label) },
                             selection: $form.stops)
            SearchMenuPicker(title: "Checked bags",
                             options: SearchForm.bagChoices.map { ($0, $0 == 0 ? "No checked bag" : plural($0, "checked bag")) },
                             selection: $form.bags)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm + 2)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var airports: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            AirportFieldView(label: "From", codes: $form.from)
            HStack {
                Spacer()
                Button { form = form.swapped() } label: {
                    Image(systemName: "arrow.up.arrow.down")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.charcoal)
                        .frame(width: 32, height: 32)
                        .background(Color.elevated, in: Circle())
                        .overlay(Circle().strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Swap from and to")
                Spacer()
            }
            .padding(.vertical, -Spacing.xs)
            AirportFieldView(label: "To", codes: $form.to)
        }
    }

    private var dates: some View {
        let today = LocalDate.today()
        return HStack(alignment: .top, spacing: Spacing.md) {
            dateField("Depart", date: form.depart, from: today) { form = form.settingDepart($0) }
            if form.roundTrip {
                dateField("Return", date: form.returnDate ?? form.depart, from: form.depart) { form = form.settingReturn($0) }
            }
        }
    }

    private func dateField(_ title: String, date: LocalDate, from minimum: LocalDate,
                           set: @escaping (LocalDate) -> Void) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs + 2) {
            Text(title).textStyle(.label).foregroundStyle(Color.charcoal)
            DatePicker(title, selection: Binding(
                get: { date.pickerDate },
                set: { set(LocalDate(localDayOf: $0)) }
            ), in: minimum.pickerDate..., displayedComponents: .date)
            .labelsHidden()
            .datePickerStyle(.compact)
            .tint(Color.accent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var hacksRow: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Hacks").textStyle(.caption).foregroundStyle(Color.ash)
            FlowLayout(spacing: Spacing.sm) {
                ToggleChip(title: "Nearby airports", isOn: $form.nearby)
                    .accessibilityHint("Also search airports within 150 km of yours")
                ToggleChip(title: "±3 days", isOn: $form.flexible)
                    .accessibilityHint("Check prices three days either side")
                ToggleChip(title: "Two one-ways", isOn: $form.split)
                    .accessibilityHint("Compare round trips with two separate one-way tickets")
            }
            if let message = form.issue()?.message { InlineError(message: message) }
            Button(action: onSubmit) {
            Label(isSearching ? "Searching…" : "Search flights", systemImage: "magnifyingglass")
            }
            .buttonStyle(.lodestar(.primary, fullWidth: true))
            .disabled(!form.isReady() || isSearching)
        }
        .padding(Spacing.md)
    }
}
