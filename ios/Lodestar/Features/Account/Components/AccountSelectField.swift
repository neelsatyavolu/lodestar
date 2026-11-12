import SwiftUI

/// The web's `<select>`: a labelled menu on the deep inset fill with a strong hairline.
struct AccountSelectField<Value: Hashable>: View {
    let label: String
    @Binding var selection: Value
    let options: [Value]
    let title: (Value) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs + 2) {
            AccountFieldLabel(text: label)
            Menu {
                Picker(label, selection: $selection) {
                    ForEach(options, id: \.self) { option in
                        Text(title(option)).tag(option)
                    }
                }
            } label: {
                HStack {
                    Text(title(selection)).textStyle(.bodySM).foregroundStyle(Color.ink)
                    Spacer(minLength: Spacing.sm)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.ash)
                }
                .padding(.horizontal, Spacing.md)
                .frame(minHeight: Sizes.input)
                .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairlineHover, lineWidth: Sizes.hairline))
                .contentShape(RoundedRectangle(cornerRadius: Radius.md))
            }
            .accessibilityLabel(label)
            .accessibilityValue(title(selection))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Cabin, Stops, Travellers and Checked bags, bound to a draft.
struct TripDefaultFields: View {
    enum Field { case cabin, stops, adults, bags }

    let draft: PreferencesDraft
    let fields: [Field]

    var body: some View {
        Grid(horizontalSpacing: Spacing.md, verticalSpacing: Spacing.lg) {
            ForEach(Array(stride(from: 0, to: fields.count, by: 2)), id: \.self) { start in
                GridRow {
                    field(fields[start])
                    if start + 1 < fields.count { field(fields[start + 1]) }
                }
            }
        }
    }

    @ViewBuilder private func field(_ field: Field) -> some View {
        switch field {
        case .cabin:
            AccountSelectField(label: "Cabin", selection: binding(\.cabin), options: Cabin.knownCases, title: \.label)
        case .stops:
            AccountSelectField(label: "Stops", selection: binding(\.stops), options: MaxStops.knownCases, title: \.label)
        case .adults:
            AccountSelectField(label: "Travellers", selection: binding(\.adults),
                               options: PreferenceRules.adultChoices, title: PreferenceRules.adultsLabel)
        case .bags:
            AccountSelectField(label: "Checked bags", selection: binding(\.bags),
                               options: PreferenceRules.bagChoices, title: PreferenceRules.bagsLabel)
        }
    }

    private func binding<T>(_ keyPath: WritableKeyPath<Preferences, T>) -> Binding<T> {
        let draft = draft
        return Binding(get: { draft.value[keyPath: keyPath] }, set: { newValue in draft.update { $0[keyPath: keyPath] = newValue } })
    }
}
