import Foundation

/// The seller line under a collapsed card's price (web `SellerLine`).
struct FlightSellerLine: Hashable, Sendable {
    enum Tone: Hashable, Sendable { case none, ok, warn }

    let text: String
    /// " · $412 elsewhere", in a dimmer color.
    var suffix: String?
    var tone: Tone = .none
    var isLoading = false

    static func make(state: FlightSellerState?, googlePrice: Double, trustedOnly: Bool) -> FlightSellerLine {
        switch state {
        case nil: return FlightSellerLine(text: "Sellers not checked")
        case .loading: return FlightSellerLine(text: "Checking sellers", isLoading: true)
        case .failed: return FlightSellerLine(text: "Couldn't check sellers")
        case .done(let check):
            guard let trusted = check.lowestTrusted else {
                return FlightSellerLine(text: "Only unvetted agencies", tone: .warn)
            }
            let airline = check.sellers.contains { $0.tier == .airline && $0.lowest == trusted }
            let label = airline ? "Airline direct" : (check.trustedSeller ?? SellerTier.trusted.flightLabel)
            let differs = trustedOnly && trusted.rounded() != googlePrice.rounded()
            let suffix = differs && trusted > googlePrice ? " · \(Money.usd(googlePrice)) elsewhere" : nil
            return FlightSellerLine(text: label, suffix: suffix, tone: differs ? .warn : .ok)
        }
    }
}

/// A fare's policy chip: ✓ (true), ✗ (false, struck through) or neutral (nil).
struct FarePolicyChip: Hashable, Sendable {
    let label: String
    let ok: Bool?
}

enum SellerCopy {
    static let loading = "Reading the live booking page for this exact itinerary…"
    static let noTrusted = "No airline or trusted agency sells this itinerary. Only unvetted agencies list it."
    static let hideUnvetted = "Hide unvetted agencies"
    static let selfTransfer = "Self-transfer: separate tickets. You collect and re-check bags, and a missed connection is on you."

    /// The five chips the web shows per fare tile.
    static func policyChips(_ p: FarePolicy) -> [FarePolicyChip] {
        [
            FarePolicyChip(label: "Carry-on", ok: p.carryOn),
            bagChip(p),
            changesChip(p.changes),
            refundsChip(p.refunds),
            seatChip(p.seatSelection),
        ]
    }

    static func bagChip(_ p: FarePolicy) -> FarePolicyChip {
        if p.checkedBagFee == 0 { return FarePolicyChip(label: "Checked bag included", ok: true) }
        if let fee = p.checkedBagFee { return FarePolicyChip(label: "Checked bag \(Money.amount(fee))", ok: nil) }
        if p.checkedBagIncluded == false { return FarePolicyChip(label: "No checked bag", ok: false) }
        return FarePolicyChip(label: "Checked bag", ok: nil)
    }

    private static func changesChip(_ c: ChangePolicy?) -> FarePolicyChip {
        switch c {
        case .free: FarePolicyChip(label: "Free changes", ok: true)
        case .fee: FarePolicyChip(label: "Changes for a fee", ok: nil)
        case .none?: FarePolicyChip(label: "Changes", ok: false)
        case .unknown, nil: FarePolicyChip(label: "Changes", ok: nil)
        }
    }

    private static func refundsChip(_ r: RefundPolicy?) -> FarePolicyChip {
        switch r {
        case .full: FarePolicyChip(label: "Refundable", ok: true)
        case .partial: FarePolicyChip(label: "Partly refundable", ok: true)
        case .none?: FarePolicyChip(label: "Refunds", ok: false)
        case .unknown, nil: FarePolicyChip(label: "Refunds", ok: nil)
        }
    }

    private static func seatChip(_ s: SeatPolicy?) -> FarePolicyChip {
        switch s {
        case .free: FarePolicyChip(label: "Seat choice", ok: true)
        case .fee: FarePolicyChip(label: "Seat choice for a fee", ok: nil)
        case .none?: FarePolicyChip(label: "Seat choice", ok: false)
        case .unknown, nil: FarePolicyChip(label: "Seat choice", ok: nil)
        }
    }

    /// "Price is low, $40 under usual. Similar trips usually cost $300–$450. Google expects…".
    /// nil when there's neither a level nor a summary.
    static func insight(_ i: PriceInsight) -> (lead: String?, rest: String, tone: InsightTone)? {
        let level = i.level.flatMap { $0 == .unknown ? nil : $0 }
        guard level != nil || i.summary != nil else { return nil }
        var lead: String?
        if let level {
            let under = i.cheaperThanUsualBy.map { $0 > 0 ? ", $\(Int($0.rounded())) under usual" : "" } ?? ""
            lead = "Price is \(level.rawValue)\(under). "
        }
        var rest = ""
        if let low = i.typicalLow, let high = i.typicalHigh, low > 0, high > 0 {
            rest += "Similar trips usually cost \(Money.usd(low))–\(Money.usd(high)). "
        }
        if let floor = i.unlikelyToDropBelow, floor > 0 {
            rest += "Google expects it won't drop below \(Money.usd(floor)), so waiting is unlikely to help."
        }
        let tone: InsightTone = level == .low ? .ok : level == .high ? .danger : .warn
        return (lead, rest.trimmingCharacters(in: .whitespaces), tone)
    }

    enum InsightTone: Sendable { case ok, warn, danger }

    /// "Show 2 unvetted agencies (from $380, $32 less)".
    static func showUnvetted(count: Int, check: SellerCheck) -> (label: String, detail: String?) {
        let label = "Show \(count) unvetted agenc\(count == 1 ? "y" : "ies")"
        guard check.unvettedGap > 0 else { return (label, nil) }
        return (label, " (from \(Money.usd(check.lowestAny)), $\(Int(check.unvettedGap.rounded())) less)")
    }

    /// The web shows "from" under a seller's price when it lists several fares or a named one.
    static func hasFareTiers(_ seller: VerifiedSeller) -> Bool {
        seller.fares.count > 1 || seller.fares.first?.name != nil
    }

    static func visibleSellers(_ check: SellerCheck, showUnvetted: Bool) -> [VerifiedSeller] {
        showUnvetted ? check.sellers : check.sellers.filter { $0.tier.isTrusted }
    }

    static func unvettedCount(_ check: SellerCheck) -> Int {
        check.sellers.filter { !$0.tier.isTrusted }.count
    }
}
