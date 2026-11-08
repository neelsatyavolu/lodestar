import Foundation

/// Copy and rules for the "Watching fares" cards (`components/trips.tsx`, `lib/trips/booked.ts`).
enum FareWatchText {
    enum Claim: Sendable, Equatable { case yes, maybe, no, unknown }

    /// Whether a lower fare can come back to the traveller, from the fare's change rules.
    static func creditVerdict(_ b: FareBooking) -> (claim: Claim, text: String) {
        let fareWord = b.fare.map { "The \($0)" } ?? "This"
        let base: (Claim, String)
        if b.refunds == .full {
            base = (.yes, "\(fareWord) fare is refundable, so you can cancel for a refund and rebook at the lower price.")
        } else if b.changes == .free {
            base = (.yes, "\(fareWord) fare has no change fee, so you can usually rebook the same flights at the new price and keep the difference as travel credit.")
        } else if b.changes == .fee {
            base = (.maybe, "\(fareWord) fare allows changes for a fee, so rebooking only pays off when the drop is bigger than the fee.")
        } else if b.changes == ChangePolicy.none {
            base = (.no, "\(fareWord) fare doesn't allow changes, so you can't get the difference back.")
        } else {
            let basic = (b.fare ?? "").localizedCaseInsensitiveContains("basic") ? " Basic fares often can't be changed." : ""
            let which = b.fare.map { "the \($0)" } ?? "this"
            base = (.unknown, "Google didn't list the change rules for \(which) fare.\(basic) Check them with \(b.seller) before you rebook.")
        }
        if b.isAirline || base.0 == .no { return base }
        return (base.0, base.1 + " You booked through \(b.seller), so the change goes through them, not the airline.")
    }

    /// "Now $X", "Paid $X" or "Saved at $X".
    static func priceLine(_ trip: SavedTrip) -> String {
        if let last = trip.lastPrice { return "Now \(Money.usd(last))" }
        if let booking = trip.booking { return "Paid \(Money.usd(booking.paid))" }
        return "Saved at \(Money.usd(trip.savedPrice))"
    }

    /// The change against what was paid (booked) or saved; nil when unchecked or unchanged.
    static func change(_ trip: SavedTrip) -> Double? {
        guard let last = trip.lastPrice else { return nil }
        let diff = last - (trip.booking?.paid ?? trip.savedPrice)
        return diff == 0 ? nil : diff
    }

    /// "−$120" or "+$40".
    static func changeText(_ diff: Double) -> String {
        diff < 0 ? "−\(Money.usd(-diff))" : "+\(Money.usd(diff))"
    }

    static func checkedLine(_ trip: SavedTrip) -> String {
        trip.checkedAt.map { "Checked \(DateText.short(LocalDate(localDayOf: $0.asDate, calendar: LocalDate.utc)))" }
            ?? "First check within a day"
    }

    /// The web compares with the UTC day.
    static func isDeparted(_ trip: SavedTrip, todayUTC: LocalDate) -> Bool {
        trip.firstDepart <= todayUTC
    }

    static func bookedLine(_ b: FareBooking) -> String {
        "Booked \(b.fare.map { "\($0) " } ?? "")with \(b.seller) for \(Money.usd(b.paid))."
    }

    /// Reads "$1,500" / "1500" / " 1 500 ". nil for anything that isn't a number.
    static func parseDollars(_ text: String) -> Double? {
        let cleaned = text.filter { !"$, ".contains($0) && !$0.isWhitespace }
        guard !cleaned.isEmpty, let value = Double(cleaned), value.isFinite else { return nil }
        return value
    }

    enum TargetResult: Equatable, Sendable {
        /// Nothing to send (same as saved).
        case unchanged
        case set(Double?)
        case invalid(String)
    }

    static let targetError = "Enter a price in dollars, like 1500."
    static let paidError = "Enter what you paid in dollars, like 1500."

    /// The "Under $ [target]" field: empty clears; otherwise it must be > 0.
    static func target(from text: String, current: Double?) -> TargetResult {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        let value: Double?
        if trimmed.isEmpty {
            value = nil
        } else {
            guard let parsed = parseDollars(trimmed), parsed > 0 else { return .invalid(targetError) }
            value = parsed
        }
        return value == current ? .unchanged : .set(value)
    }

    /// Builds the booking from a seller's fare (the web's `startBooking`).
    static func booking(tfs: String, seller: VerifiedSeller, fare: Fare) -> FareBooking {
        FareBooking(tfs: tfs, seller: seller.name, isAirline: seller.isAirline, fare: fare.name, paid: fare.price,
                    changes: fare.policy.changes, refunds: fare.policy.refunds == .unknown ? nil : fare.policy.refunds)
    }

    /// The booking with the edited "You paid $" value, or the error to show.
    static func booking(_ b: FareBooking, paidText: String) -> Result<FareBooking, TripsProblem> {
        guard let paid = parseDollars(paidText), paid > 0, paid <= 1_000_000 else { return .failure(TripsProblem(message: paidError)) }
        return .success(FareBooking(tfs: b.tfs, seller: b.seller, isAirline: b.isAirline, fare: b.fare, paid: paid,
                                    changes: b.changes, refunds: b.refunds))
    }
}

struct TripsProblem: Error, Equatable, Sendable {
    let message: String
}
