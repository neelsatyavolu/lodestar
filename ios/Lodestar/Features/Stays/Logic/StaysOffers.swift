import Foundation

/// How much more a refundable rate costs, among the offers the traveller sees
/// (web `lib/stays/offers.ts refundable`).
enum StaysRefundable: Hashable, Sendable {
    /// The cheapest rate shown can already be cancelled for free.
    case included(StayOffer)
    /// A refundable rate costs `extra` more for the whole stay.
    case extra(StayOffer, extra: Double, perNight: Double)
    case none

    init(offers: [StayOffer], nights: Int) {
        guard let cheapest = offers.first,
              let flexible = offers.first(where: { $0.freeCancelUntil != nil })
        else {
            self = .none
            return
        }
        if flexible == cheapest || flexible.total <= cheapest.total {
            self = .included(flexible)
            return
        }
        let extra = flexible.total - cheapest.total
        self = .extra(flexible, extra: extra, perNight: extra / Double(max(1, nights)))
    }
}

/// Which offers show under "trusted only", and what the hidden unvetted ones would save.
struct StaysOfferList: Hashable, Sendable {
    let shown: [StayOffer]
    let hidden: [StayOffer]
    /// `shown[0].total - hidden[0].total` when both exist, else 0.
    let hiddenSaving: Double

    /// `offers` arrive sorted by total, then tier. With `showAll` nothing is filtered,
    /// but `hidden` still lists the unvetted offers so the toggle stays visible.
    init(offers: [StayOffer], showAll: Bool) {
        let unvetted = offers.filter { !$0.tier.isTrusted }
        let visible = showAll ? offers : offers.filter { $0.tier.isTrusted }
        shown = visible
        hidden = unvetted
        if let firstShown = visible.first, let firstHidden = unvetted.first {
            hiddenSaving = firstShown.total - firstHidden.total
        } else {
            hiddenSaving = 0
        }
    }
}

extension StayOffer {
    /// Stable enough for `ForEach`: the web keys rows by seller, total and cancel date.
    var rowID: String {
        "\(seller)-\(total)-\(freeCancelUntil?.string ?? "none")"
    }
}
