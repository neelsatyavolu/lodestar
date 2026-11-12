import SwiftUI

/// Toggle chips for one taste list plus a dashed "Other…" box (web `Chips` in tastes.tsx).
struct TasteChipsField: View {
    let draft: PreferencesDraft
    let field: TasteField
    @State private var other = ""
    @FocusState private var otherFocused: Bool

    var body: some View {
        let selected = draft.value[keyPath: field.keyPath]
        VStack(alignment: .leading, spacing: Spacing.sm) {
            AccountFieldLabel(text: field.label)
            FlowLayout {
                ForEach(field.displayed(selected: selected), id: \.self) { choice in
                    Chip(title: choice, isOn: selected.contains(choice)) { draft.toggle(choice, in: field) }
                }
                otherBox
            }
        }
    }

    private var otherBox: some View {
        TextField("Add to \(field.label.lowercased())", text: $other,
                  prompt: Text("Other…").foregroundStyle(Color.stone))
            .textStyle(.chip)
            .foregroundStyle(Color.ink)
            .submitLabel(.done)
            .focused($otherFocused)
            .padding(.horizontal, 14)
            .frame(width: 112, height: Sizes.chip)
            .overlay(Capsule().strokeBorder(otherFocused ? Color.accent : Color.hairlineStrong,
                                            style: StrokeStyle(lineWidth: Sizes.hairline, dash: [3, 3])))
            .onSubmit(commit)
            .onChange(of: otherFocused) { _, isFocused in if !isFocused { commit() } }
    }

    private func commit() {
        draft.addOther(other, to: field)
        other = ""
    }
}

/// Food you love, Dietary needs, Usual dinner budget (web `DiningFields`).
struct DiningFields: View {
    let draft: PreferencesDraft

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            TasteChipsField(draft: draft, field: .cuisines)
            TasteChipsField(draft: draft, field: .dietary)
            VStack(alignment: .leading, spacing: Spacing.sm) {
                AccountFieldLabel(text: "Usual dinner budget")
                FlowLayout {
                    ForEach(PriceLevel.knownCases, id: \.self) { level in
                        Chip(title: level.rawValue, isOn: draft.value.diningBudget == level, mono: true) {
                            draft.toggle(level)
                        }
                        .accessibilityLabel(Self.spokenLevel(level))
                    }
                }
            }
        }
    }

    private static func spokenLevel(_ level: PriceLevel) -> String {
        switch level {
        case .one: "Inexpensive"
        case .two: "Moderate"
        case .three: "Expensive"
        case .four, .unknown: "Very expensive"
        }
    }
}

/// What you like doing, Pace, hotel priorities and the hotel budget (web `DoingFields`).
struct DoingFields: View {
    let draft: PreferencesDraft
    @FocusState private var budgetFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            TasteChipsField(draft: draft, field: .interests)
            VStack(alignment: .leading, spacing: Spacing.sm) {
                AccountFieldLabel(text: "Pace")
                FlowLayout {
                    ForEach(Pace.knownCases, id: \.self) { pace in
                        Chip(title: pace.label, isOn: draft.value.pace == pace) { draft.update { $0.pace = pace } }
                    }
                }
            }
            TasteChipsField(draft: draft, field: .hotelPriorities)
            budgetField
        }
    }

    private var budgetField: some View {
        VStack(alignment: .leading, spacing: Spacing.xs + 2) {
            AccountFieldLabel(text: "Hotel budget per night (USD, optional)")
            TextField("Hotel budget per night", text: Binding(get: { draft.hotelBudgetText },
                                                              set: { draft.setHotelBudgetText($0) }),
                      prompt: Text("250").foregroundStyle(Color.stone))
                .textStyle(.bodySM)
                .monospacedDigit()
                .foregroundStyle(Color.ink)
                .keyboardType(.numberPad)
                .focused($budgetFocused)
                .padding(.horizontal, 14)
                .frame(width: 160, height: Sizes.input)
                .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(budgetFocused ? Color.accent : Color.hairlineHover, lineWidth: Sizes.hairline))
                .onChange(of: budgetFocused) { _, isFocused in if !isFocused { draft.commitHotelBudget() } }
        }
    }
}

/// Alliance chips: "only show these" (web preferences and onboarding page 2).
struct AllianceChips: View {
    let draft: PreferencesDraft

    var body: some View {
        FlowLayout {
            ForEach(Alliance.knownCases, id: \.self) { alliance in
                Chip(title: alliance.label, isOn: draft.value.alliances.contains(alliance)) { draft.toggle(alliance) }
            }
        }
    }
}

/// A row of toggle chips bound to boolean preferences.
struct PreferenceToggles: View {
    let draft: PreferencesDraft
    let items: [(title: String, keyPath: WritableKeyPath<Preferences, Bool>)]

    var body: some View {
        FlowLayout {
            ForEach(items.indices, id: \.self) { index in
                let item = items[index]
                ToggleChip(title: item.title, isOn: Binding(
                    get: { draft.value[keyPath: item.keyPath] },
                    set: { newValue in draft.update { $0[keyPath: item.keyPath] = newValue } }
                ))
            }
        }
    }
}
