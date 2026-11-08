import SwiftUI

/// A collapsed itinerary: badges, one row per slice, price and the seller line.
/// Tapping it (wrapped in a NavigationLink) opens `ItineraryDetailView`.
struct ItineraryCardView: View {
    let itinerary: Itinerary
    let badges: [FlightBadge]
    let state: FlightSellerState?
    let trustedOnly: Bool
    let nearby: Set<String>
    var highlighted = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if !badges.isEmpty { badgeRow }
            HStack(alignment: .top, spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(Array(itinerary.slices.enumerated()), id: \.offset) { index, slice in
                        FlightSliceRow(slice: slice, label: FlightText.shortLabel(index: index, of: itinerary), nearby: nearby)
                    }
                }
                Spacer(minLength: 0)
                priceColumn
            }
        }
        .padding(Sizes.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.lg)
                .strokeBorder(highlighted ? Color.hairlineHover : Color.hairlineStrong, lineWidth: Sizes.hairline)
        )
        .contentShape(RoundedRectangle(cornerRadius: Radius.lg))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows the flights and who sells them")
    }

    private var badgeRow: some View {
        FlowLayout(spacing: Spacing.xs + 2, lineSpacing: Spacing.xs + 2) {
            ForEach(badges, id: \.self) { badge in
                Pill(text: badge.rawValue, style: badge == .best ? .accent : .neutral,
                     dot: badge == .selfTransfer ? .warn : nil)
            }
        }
    }

    private var priceColumn: some View {
        let line = FlightSellerLine.make(state: state, googlePrice: itinerary.price, trustedOnly: trustedOnly)
        return VStack(alignment: .trailing, spacing: 2) {
            Text(Money.usd(FlightResults.displayPrice(itinerary, state: state, trustedOnly: trustedOnly)))
                .textStyle(.headingMD).monospacedDigit().foregroundStyle(Color.ink)
                .fixedSize()
            Text(FlightText.tripKind(itinerary)).textStyle(.hint).foregroundStyle(Color.ash)
            FlightSellerLineView(line: line).padding(.top, Spacing.xs)
        }
        .frame(minWidth: 96, alignment: .trailing)
    }
}

/// One slice: logos, times with "+1", label · date · airlines, duration, route and stops.
struct FlightSliceRow: View {
    let slice: FlightSlice
    let label: String?
    let nearby: Set<String>

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            logos
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(FlightText.times(slice)).textStyle(.bodyMD).monospacedDigit().foregroundStyle(Color.ink)
                    let shift = FlightText.dayShift(slice)
                    if shift > 0 {
                        Text("+\(shift)").textStyle(.hint).foregroundStyle(Color.mute).baselineOffset(6)
                    }
                }
                Text(FlightText.subtitle(slice, label: label))
                    .textStyle(.caption).foregroundStyle(Color.ash).lineLimit(1)
                HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
                    Text("\(FlightText.stops(slice)) · \(DurationText.minutes(slice.minutes)) ·")
                        .textStyle(.caption).foregroundStyle(Color.bodyText)
                    route
                }
                let via = FlightText.via(slice)
                if !via.isEmpty {
                    Text(via).textStyle(.codeSmall).foregroundStyle(Color.ash).lineLimit(1)
                }
            }
        }
    }

    private var logos: some View {
        let airlines = Array(FlightText.airlines(slice).prefix(2))
        let size: CGFloat = airlines.count > 1 ? 22 : 28
        return ZStack(alignment: .topLeading) {
            ForEach(Array(airlines.enumerated()), id: \.offset) { index, airline in
                LogoView(airline: airline, size: size).offset(x: CGFloat(index) * 10, y: CGFloat(index) * 8)
            }
        }
        .frame(width: 32, height: 32, alignment: .topLeading)
    }

    private var route: some View {
        let from = slice.origin ?? ""
        let to = slice.destination ?? ""
        let fromText = Text(from).foregroundStyle(nearby.contains(from) ? Color.accent : Color.ash)
        let toText = Text(to).foregroundStyle(nearby.contains(to) ? Color.accent : Color.ash)
        return Text("\(fromText)\(Text("–").foregroundStyle(Color.ash))\(toText)")
            .textStyle(.codeSmall)
            .fixedSize()
    }
}

/// The seller line: spinner while checking, then a dot and who sells it.
struct FlightSellerLineView: View {
    let line: FlightSellerLine

    var body: some View {
        HStack(spacing: Spacing.xs + 2) {
            if line.isLoading { Spinner(size: 10) }
            switch line.tone {
            case .ok: StatusDot(tone: .ok, size: 6)
            case .warn: StatusDot(tone: .warn, size: 6)
            case .none: EmptyView()
            }
            Text("\(Text(line.text).foregroundStyle(line.tone == .none ? Color.ash : Color.charcoal))\(Text(line.suffix ?? "").foregroundStyle(Color.ash))")
                .textStyle(.hint)
                .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
}
