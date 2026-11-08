import Foundation

/// Every Stays sentence, built from values so tests can check them against the web's copy.
enum StaysCopy {
    static let heroLine1 = "Hotels too."
    static let heroLine2 = "Same sellers you can trust."
    static let heroBody = "Live prices from Google Hotels, checked seller by seller with taxes included. Every search also tries arriving a night earlier or later, and shows what a refundable rate costs."
    static let priceNote = "Prices are Google's lowest per night before taxes. Open a stay for every seller's price with taxes and fees."
    static let sellersTitle = "Who sells this stay, with taxes and fees"
    static let pricesLoading = "Reading every seller's price for these dates…"
    static let onlyUnvetted = "Only agencies we haven't vetted list this hotel for these dates."
    static let noRefundable = "None of these rates can be cancelled for free."
    static let openOnGoogle = "Open on Google Hotels"
    static let seeMoreOnGoogle = "See more on Google Hotels"
    static let searchFailed = "The hotel search failed. Try again."
    static let pricesFailed = "Couldn't read this hotel's prices."
    static let emptyTitle = "No stays for these dates"
    static let emptyMessage = "Try another place or move the dates."

    // MARK: Results header

    /// "12 stays in Lisbon"
    static func title(count: Int, city: String) -> String {
        "\(plural(count, "stay")) in \(city)"
    }

    /// "Thu, Nov 26 – Sun, Nov 29 · 3 nights · one room for 2 adults"
    static func subtitle(_ query: StaySearchQuery) -> String {
        "\(DateText.short(query.checkin)) – \(DateText.short(query.checkout)) · "
            + "\(plural(query.nights, "night")) · one room for \(plural(query.adults, "adult"))"
    }

    /// The flex line beside the header.
    static func flexStatus(_ state: StaysFlexState) -> String {
        switch state {
        case .loading: "Checking a night earlier and later…"
        case .failed: "Couldn't check nearby dates."
        case .loaded(let savings):
            savings.isEmpty
                ? "Moving a night doesn't save much here."
                : "\(plural(savings.count, "stay")) cost less a night earlier or later."
        }
    }

    // MARK: Hotel card

    /// "4.5" (one decimal, as the web's `toFixed(1)`).
    static func rating(_ rating: Double) -> String { String(format: "%.1f", rating) }

    /// "(1,234)"
    static func reviews(_ count: Int) -> String {
        "(\(count.formatted(.number.locale(Locale(identifier: "en_US")))))"
    }

    /// "4-star"
    static func stars(_ stars: Int) -> String { "\(stars)-star" }

    /// "18% under usual"
    static func deal(_ pct: Int) -> String { "\(pct)% under usual" }

    /// The first 4 amenities joined by " · ", or nil when there are none.
    static func amenities(_ list: [String]) -> String? {
        list.isEmpty ? nil : list.prefix(4).joined(separator: " · ")
    }

    /// "About $60 less arriving a night earlier (Wed, Nov 25 – Sat, Nov 28). Search those dates"
    static func saving(_ saving: FlexSaving) -> String {
        let when = saving.shift == .earlier ? "a night earlier" : "a night later"
        return "About \(Money.usd(Double(saving.saving))) less arriving \(when) "
            + "(\(DateText.short(saving.checkin)) – \(DateText.short(saving.checkout))). Search those dates"
    }

    // MARK: Offers

    /// "Free cancellation until Thu, Nov 26"
    static func freeCancel(_ date: LocalDate) -> String {
        "Free cancellation until \(DateText.short(date))"
    }

    /// "$212 × 3 nights"
    static func nightly(_ offer: StayOffer, nights: Int) -> String {
        "\(Money.usd(offer.nightly)) × \(plural(nights, "night"))"
    }

    /// The refundable note as a bold lead (may be nil) and the rest of the sentence.
    static func refundable(_ value: StaysRefundable) -> (lead: String?, rest: String) {
        switch value {
        case .none:
            return (nil, noRefundable)
        case .included(let offer):
            return (nil, "The cheapest rate here can be cancelled for free until \(cancelDay(offer)).")
        case .extra(let offer, let extra, let perNight):
            return (
                "Refundable for \(Money.usd(extra)) more",
                " (\(Money.usd(perNight)) a night) with \(offer.seller), free to cancel until \(cancelDay(offer))."
            )
        }
    }

    /// "Show 2 unvetted agencies (from $380, $25 less)" or "Hide unvetted agencies".
    static func unvettedToggle(_ list: StaysOfferList, showingAll: Bool) -> String {
        if showingAll { return "Hide unvetted agencies" }
        let count = list.hidden.count
        let base = "Show \(count) unvetted agenc\(count == 1 ? "y" : "ies")"
        guard list.hiddenSaving > 0, let first = list.hidden.first else { return base }
        return base + " (from \(Money.usd(first.total)), \(Money.usd(list.hiddenSaving)) less)"
    }

    /// Accessibility hint for Book, as the web's tooltip.
    static func bookHint(_ offer: StayOffer) -> String {
        "Continue to \(offer.seller) through Google Hotels"
    }

    private static func cancelDay(_ offer: StayOffer) -> String {
        offer.freeCancelUntil.map(DateText.short) ?? ""
    }
}
