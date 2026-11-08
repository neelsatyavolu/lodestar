import SwiftUI

/// "Ways to save": one card per hack with its action link (web `HackCards`).
struct HackCardsView: View {
    let hacks: [Hack]
    let onAction: (Hack) -> Void

    var body: some View {
        if !hacks.isEmpty {
            VStack(spacing: Spacing.md) {
                ForEach(Array(hacks.enumerated()), id: \.offset) { _, hack in card(hack) }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Ways to save")
        }
    }

    private func card(_ hack: Hack) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Image(systemName: hack.kind.symbol)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(hack.kind == .ulcc ? Color.warn : Color.charcoal)
                .frame(width: 18)
                .padding(.top, 2)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                    Text(hack.title).textStyle(.bodySM).fontWeight(.medium).foregroundStyle(Color.ink)
                    Spacer(minLength: 0)
                    if hack.saving > 0 {
                        Text(Money.saving(hack.saving)).textStyle(.bodySM).monospacedDigit().foregroundStyle(Color.ink)
                            .fixedSize()
                    }
                }
                if !hack.detail.isEmpty {
                    Text(hack.detail).textStyle(.chip).foregroundStyle(Color.mute)
                }
                if let caution = hack.caution {
                    Text(caution).textStyle(.caption).foregroundStyle(Color.ash)
                }
                Button("\(hack.kind.actionLabel) →") { onAction(hack) }
                    .buttonStyle(.lodestar(.link))
                    .textStyle(.chip)
                    .padding(.top, Spacing.xs)
            }
        }
        .card()
    }
}

/// "Nearby dates": lowest fare per departure day, from `/api/calendar` (web `DateStrip`).
struct DateStripView: View {
    let days: [DayPrice]
    let selected: LocalDate
    let onPick: (DayPrice) -> Void

    var body: some View {
        if days.count >= 2 {
            let prices = days.map(\.price)
            let low = prices.min() ?? 0
            let high = prices.max() ?? 0
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Nearby dates").textStyle(.bodySM).foregroundStyle(Color.ink)
                        .fixedSize()
                    Spacer()
                    Text("Lowest fare per departure day\(days.first?.returnDate != nil ? ", same trip length" : "")")
                        .textStyle(.caption).foregroundStyle(Color.ash)
                        .multilineTextAlignment(.trailing)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .bottom, spacing: Spacing.xs + 2) {
                        ForEach(days, id: \.depart) { day in bar(day, low: low, high: high) }
                    }
                }
            }
            .card()
        }
    }

    private func bar(_ day: DayPrice, low: Double, high: Double) -> some View {
        let isSelected = day.depart == selected
        let isMin = day.price == low
        let fraction = high == low ? 0.6 : 0.25 + (day.price - low) / (high - low) * 0.75
        return Button { onPick(day) } label: {
            VStack(spacing: Spacing.xs + 2) {
                Text(Money.usd(day.price)).textStyle(.caption).monospacedDigit()
                    .foregroundStyle(isMin ? Color.accent : isSelected ? Color.ink : Color.mute)
                ZStack(alignment: .bottom) {
                    Color.clear.frame(height: 56)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(isMin ? Color.accent : isSelected ? Color.ink : Color.stone)
                        .frame(height: 56 * fraction)
                }
                Text(DateText.short(day.depart).replacingOccurrences(of: ",", with: ""))
                    .textStyle(.hint).foregroundStyle(isSelected ? Color.ink : Color.ash)
            }
            .padding(Spacing.xs + 2)
            .frame(minWidth: 64)
            .background(isSelected ? Color.elevated : Color.clear, in: RoundedRectangle(cornerRadius: Radius.md))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(DateText.short(day.depart)), \(Money.usd(day.price))")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// "Two one-way tickets · $X total" with both cards (the split hack's panel).
struct SplitPanelView: View {
    let caution: String?
    let out: Itinerary
    let back: Itinerary
    let checks: FlightSellerChecks
    let trustedOnly: Bool
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .firstTextBaseline) {
                Text("Two one-way tickets · \(Money.usd(out.price + back.price)) total")
                    .textStyle(.bodySM).foregroundStyle(Color.ink)
                Spacer()
                Button("Close", action: onClose).buttonStyle(.lodestar(.quiet)).textStyle(.caption)
            }
            if let caution { Text(caution).textStyle(.caption).foregroundStyle(Color.ash) }
            ForEach([out, back]) { it in
                NavigationLink(value: it) {
                    ItineraryCardView(itinerary: it, badges: [], state: checks.state(for: it.id),
                                      trustedOnly: trustedOnly, nearby: [])
                }
                .buttonStyle(.plain)
            }
        }
        .padding(Spacing.lg)
        .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
    }
}
