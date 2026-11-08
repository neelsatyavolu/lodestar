import SwiftUI

/// Header, flex status, price note, hotel cards and the Google Hotels link.
struct StaysResultsView: View {
    let model: StaysSearchModel
    let results: StaysResults
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            header
            if results.hotels.isEmpty {
                EmptyStateView(title: StaysCopy.emptyTitle, message: StaysCopy.emptyMessage)
            } else {
                Text(StaysCopy.priceNote).textStyle(.caption).foregroundStyle(Color.ash)
                LazyVStack(spacing: Spacing.md) {
                    ForEach(Array(results.hotels.enumerated()), id: \.element.key) { index, hotel in
                        StayCardView(
                            hotel: hotel,
                            route: StaysDetailRoute(resultsID: results.id, hotelKey: hotel.key),
                            saving: model.flexSavings[hotel.key],
                            onShift: { model.shift(to: $0) }
                        )
                        .rise(delay: Double(min(index, 8)) * Motion.stagger)
                    }
                }
                .id(results.id)
            }
            if let url = URL(string: results.url) {
                Button(StaysCopy.seeMoreOnGoogle) { openURL(url) }
                    .buttonStyle(.lodestar(.quiet, small: true))
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(StaysCopy.title(count: results.hotels.count, city: results.query.city))
                .textStyle(.headingSM)
                .foregroundStyle(Color.ink)
                .accessibilityAddTraits(.isHeader)
            Text(StaysCopy.subtitle(results.query))
                .textStyle(.bodySM)
                .foregroundStyle(Color.mute)
            if let flex = model.flex, !results.hotels.isEmpty {
                HStack(spacing: Spacing.sm) {
                    if flex == .loading { Spinner(color: .ash, size: 11) }
                    Text(StaysCopy.flexStatus(flex)).textStyle(.caption).foregroundStyle(Color.ash)
                }
                .padding(.top, Spacing.xxs)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// One hotel: thumbnail, name, rating, class, deal, amenities and Google's "from" price.
/// Tapping opens the hotel's sellers; a flex saving adds a link that re-runs the search.
struct StayCardView: View {
    let hotel: Hotel
    let route: StaysDetailRoute
    let saving: FlexSaving?
    let onShift: (FlexSaving) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            NavigationLink(value: route) {
                HStack(alignment: .top, spacing: Spacing.md) {
                    RemoteImage(source: hotel.image)
                        .frame(width: 80, height: 64)
                    StayFacts(hotel: hotel, amenityLines: 1)
                    Spacer(minLength: 0)
                    StayFromPrice(price: hotel.price)
                }
                .padding(Spacing.md)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Shows every seller's price with taxes and fees")
            if let saving {
                Button(StaysCopy.saving(saving)) { onShift(saving) }
                    .buttonStyle(.lodestar(.link, small: true))
                    .multilineTextAlignment(.leading)
                    .padding(.horizontal, Spacing.md)
                    .padding(.bottom, Spacing.md)
            }
        }
        .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
    }
}

/// Name, "★ 4.5 (1,234)", "4-star", the deal, amenities.
struct StayFacts: View {
    let hotel: Hotel
    /// nil shows every amenity line (detail); the card shows one truncated line.
    var amenityLines: Int? = 1

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs + 2) {
            Text(hotel.name).textStyle(.bodyMD).fontWeight(.medium).foregroundStyle(Color.ink)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.md) { facts }
                VStack(alignment: .leading, spacing: Spacing.xxs) { facts }
            }
            .textStyle(.chip)
            if let amenities = StaysCopy.amenities(hotel.amenities) {
                Text(amenities)
                    .textStyle(.caption)
                    .foregroundStyle(Color.ash)
                    .lineLimit(amenityLines)
            }
        }
    }

    @ViewBuilder private var facts: some View {
        if let rating = hotel.rating {
            HStack(spacing: Spacing.xs) {
                Image(systemName: "star.fill").font(.system(size: 10)).foregroundStyle(Color.ink)
                Text(StaysCopy.rating(rating)).foregroundStyle(Color.bodyText).monospacedDigit()
                if let reviews = hotel.reviews {
                    Text(StaysCopy.reviews(reviews)).foregroundStyle(Color.ash).monospacedDigit()
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(ratingLabel(rating))
        }
        if let stars = hotel.stars {
            Text(StaysCopy.stars(stars)).foregroundStyle(Color.mute)
        }
        if let deal = hotel.dealPct {
            HStack(spacing: Spacing.xs + 2) {
                StatusDot(tone: .ok, size: Sizes.statusDotInPill)
                Text(StaysCopy.deal(deal)).foregroundStyle(Color.bodyText)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func ratingLabel(_ rating: Double) -> String {
        let base = "Rated \(StaysCopy.rating(rating)) out of 5"
        guard let reviews = hotel.reviews else { return base }
        return base + ", \(plural(reviews, "review"))"
    }
}

/// "from / $189 / a night, before taxes", right aligned.
struct StayFromPrice: View {
    let price: Double

    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text("from").textStyle(.hint).foregroundStyle(Color.ash)
            Text(Money.usd(price)).textStyle(.headingSM).foregroundStyle(Color.ink).monospacedDigit()
                .fixedSize()
            Text("a night, before taxes").textStyle(.hint).foregroundStyle(Color.ash)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 76, alignment: .trailing)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("From \(Money.usd(price)) a night, before taxes")
    }
}
