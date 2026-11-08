import SwiftUI

/// The results list: sort tabs, the two toggles, airline chips, count, cards and "Show N more"
/// (web `components/results.tsx`).
struct FlightResultsView: View {
    @Bindable var model: SearchModel
    let result: SearchResult

    var body: some View {
        let shown = model.shown
        VStack(alignment: .leading, spacing: Spacing.lg) {
            controls(count: shown.count)
            carrierChips
            VStack(spacing: Spacing.md) {
                ForEach(shown.prefix(model.limit)) { it in
                    NavigationLink(value: it) {
                        ItineraryCardView(itinerary: it,
                                          badges: FlightResults.badges(it, labels: result.labels, nearby: model.nearby),
                                          state: model.checks.state(for: it.id),
                                          trustedOnly: model.filters.trustedOnly,
                                          nearby: model.nearby,
                                          highlighted: model.highlight == it.id)
                    }
                    .buttonStyle(.plain)
                    .id(it.id)
                }
                if shown.isEmpty {
                    EmptyStateView(title: "No flights match these filters.")
                }
            }
            if shown.count > model.limit {
                Button("Show \(min(FlightResults.pageSize, shown.count - model.limit)) more") { model.showMore() }
                    .buttonStyle(.lodestar(.ghost))
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func controls(count: Int) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                SearchSegmented(options: FlightSort.allCases.map { ($0, $0.label) }, selection: $model.filters.sort)
                Spacer()
                Text(plural(count, "flight")).textStyle(.caption).foregroundStyle(Color.ash)
            }
            FlowLayout(spacing: Spacing.sm) {
                ToggleChip(title: "Trusted sellers only", isOn: $model.filters.trustedOnly)
                    .accessibilityHint("Show prices from airlines and established agencies only")
                ToggleChip(title: "Nonstop", isOn: $model.filters.nonstop)
            }
        }
    }

    @ViewBuilder private var carrierChips: some View {
        let carriers = model.carriers
        if carriers.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.xs + 2) {
                    ForEach(carriers) { carrier in carrierChip(carrier) }
                }
            }
        }
    }

    private func carrierChip(_ carrier: FlightCarrier) -> some View {
        let isOn = model.filters.airlines.contains(carrier.code)
        return Button { model.toggleAirline(carrier.code) } label: {
            HStack(spacing: Spacing.sm) {
                LogoView(airline: carrier.airline, size: 24)
                Text(carrier.name).foregroundStyle(isOn ? Color.ink : Color.mute)
                Text(Money.usd(carrier.minPrice)).monospacedDigit().foregroundStyle(Color.ash)
            }
            .textStyle(.chip)
            .padding(.leading, Spacing.xs)
            .padding(.trailing, Spacing.md)
            .frame(minHeight: 36)
            .background(isOn ? Color.elevated : Color.clear, in: Capsule())
            .overlay(Capsule().strokeBorder(isOn ? Color.hairlineHover : Color.hairlineStrong, lineWidth: Sizes.hairline))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}
