import SwiftUI

/// The refundable note, the seller rows, the unvetted toggle and "Open on Google Hotels".
struct StayOffersPanel: View {
    let prices: StayPrices
    let nights: Int
    @State private var showAll: Bool
    @Environment(\.openURL) private var openURL

    init(prices: StayPrices, nights: Int, trustedOnly: Bool) {
        self.prices = prices
        self.nights = nights
        _showAll = State(initialValue: !trustedOnly)
    }

    var body: some View {
        let list = StaysOfferList(offers: prices.offers, showAll: showAll)
        VStack(alignment: .leading, spacing: Spacing.md) {
            refundableNote(StaysRefundable(offers: list.shown, nights: nights))
            VStack(spacing: 0) {
                ForEach(Array(list.shown.enumerated()), id: \.element.rowID) { index, offer in
                    if index > 0 { Hairline() }
                    StayOfferRow(offer: offer, nights: nights)
                }
                if list.shown.isEmpty {
                    Text(StaysCopy.onlyUnvetted)
                        .textStyle(.bodySM)
                        .foregroundStyle(Color.mute)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, Spacing.md)
                }
            }
            footer(list)
        }
    }

    @ViewBuilder private func refundableNote(_ value: StaysRefundable) -> some View {
        let text = StaysCopy.refundable(value)
        Group {
            if let lead = text.lead {
                Text("\(Text(lead).foregroundStyle(Color.ink))\(Text(text.rest).foregroundStyle(Color.bodyText))")
            } else {
                Text(text.rest).foregroundStyle(value == .none ? Color.mute : Color.bodyText)
            }
        }
        .textStyle(.chip)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func footer(_ list: StaysOfferList) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack { footerItems(list) }
            VStack(alignment: .leading, spacing: Spacing.sm) { footerItems(list) }
        }
    }

    @ViewBuilder private func footerItems(_ list: StaysOfferList) -> some View {
        if !list.hidden.isEmpty {
            Button(StaysCopy.unvettedToggle(list, showingAll: showAll)) {
                withAnimation(Motion.fast) { showAll.toggle() }
            }
            .buttonStyle(.lodestar(.link, small: true))
            .multilineTextAlignment(.leading)
        }
        Spacer(minLength: 0)
        if let url = URL(string: prices.url) {
            Button {
                openURL(url)
            } label: {
                Label(StaysCopy.openOnGoogle, systemImage: "arrow.up.right").labelStyle(StaysTrailingIconLabelStyle())
            }
            .buttonStyle(.lodestar(.quiet, small: true))
        }
    }
}

/// Logo, seller, tier, free cancellation; total and nightly; Book.
struct StayOfferRow: View {
    let offer: StayOffer
    let nights: Int
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(spacing: Spacing.md) {
            LogoView(path: offer.logo, name: offer.seller, size: 28)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(offer.seller).textStyle(.bodySM).foregroundStyle(Color.ink).lineLimit(1)
                StatusLabel(text: offer.tier.stayLabel, tone: StatusDot.Tone(tier: offer.tier))
                if let until = offer.freeCancelUntil {
                    Text(StaysCopy.freeCancel(until)).textStyle(.hint).foregroundStyle(Color.bodyText)
                }
            }
            Spacer(minLength: Spacing.xs)
            VStack(alignment: .trailing, spacing: 0) {
                Text(Money.usd(offer.total)).textStyle(.bodyMD).foregroundStyle(Color.ink).monospacedDigit()
                Text(StaysCopy.nightly(offer, nights: nights)).textStyle(.hint).foregroundStyle(Color.ash).monospacedDigit()
            }
            .fixedSize()
            .accessibilityElement(children: .combine)
            if let link = offer.url.flatMap(URL.init(string:)) {
                Button {
                    openURL(link)
                } label: {
                    Label("Book", systemImage: "arrow.up.right").labelStyle(StaysTrailingIconLabelStyle())
                }
                .buttonStyle(.lodestar(.ghost, small: true))
                .accessibilityHint(StaysCopy.bookHint(offer))
            }
        }
        .padding(.vertical, Spacing.md)
    }
}

/// Title then icon ("Book ↗").
struct StaysTrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: Spacing.xs) {
            configuration.title
            configuration.icon.font(.system(size: 11, weight: .medium))
        }
    }
}
