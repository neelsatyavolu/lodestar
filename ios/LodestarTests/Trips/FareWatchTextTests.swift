import Foundation
import Testing
@testable import Lodestar

@Suite("Fare watch copy and rules")
struct FareWatchTextTests {
    private func booking(fare: String? = "Main Cabin", airline: Bool = true, changes: ChangePolicy? = nil, refunds: RefundPolicy? = nil) -> FareBooking {
        FareBooking(tfs: "CjRIabcdefghijklmnop", seller: airline ? "United" : "Expedia", isAirline: airline, fare: fare, paid: 1500,
                    changes: changes, refunds: refunds)
    }

    @Test func creditVerdictBranches() {
        #expect(FareWatchText.creditVerdict(booking(refunds: .full)).text
            == "The Main Cabin fare is refundable, so you can cancel for a refund and rebook at the lower price.")
        #expect(FareWatchText.creditVerdict(booking(changes: .free)).claim == .yes)
        #expect(FareWatchText.creditVerdict(booking(fare: nil, changes: .fee)).text
            == "This fare allows changes for a fee, so rebooking only pays off when the drop is bigger than the fee.")
        #expect(FareWatchText.creditVerdict(booking(changes: ChangePolicy.none)).claim == .no)
        #expect(FareWatchText.creditVerdict(booking(fare: "Basic Economy")).text
            == "Google didn't list the change rules for the Basic Economy fare. Basic fares often can't be changed. Check them with United before you rebook.")
    }

    @Test func agencyBookingsAddTheGoesThroughThemLineUnlessNo() {
        let maybe = FareWatchText.creditVerdict(booking(airline: false, changes: .fee))
        #expect(maybe.text.hasSuffix(" You booked through Expedia, so the change goes through them, not the airline."))
        let no = FareWatchText.creditVerdict(booking(airline: false, changes: ChangePolicy.none))
        #expect(!no.text.contains("booked through"))
    }

    @Test func priceLineAndChange() {
        #expect(FareWatchText.priceLine(TripsMake.savedTrip()) == "Saved at $1,200")
        #expect(FareWatchText.priceLine(TripsMake.savedTrip(booking: booking())) == "Paid $1,500")
        let dropped = TripsMake.savedTrip(lastPrice: 1080)
        #expect(FareWatchText.priceLine(dropped) == "Now $1,080")
        #expect(FareWatchText.change(dropped) == -120)
        #expect(FareWatchText.changeText(-120) == "−$120")
        #expect(FareWatchText.changeText(40) == "+$40")
        #expect(FareWatchText.change(TripsMake.savedTrip(lastPrice: 1200)) == nil)
        #expect(FareWatchText.change(TripsMake.savedTrip(lastPrice: 1600, booking: booking())) == 100)
        #expect(FareWatchText.checkedLine(TripsMake.savedTrip()) == "First check within a day")
        #expect(FareWatchText.checkedLine(TripsMake.savedTrip(checkedAt: 1_795_000_000_000)).hasPrefix("Checked "))
    }

    @Test func departedComparesTheUTCDay() {
        let trip = TripsMake.savedTrip()
        #expect(FareWatchText.isDeparted(trip, todayUTC: date("2026-12-07")))
        #expect(!FareWatchText.isDeparted(trip, todayUTC: date("2026-12-06")))
    }

    @Test func targetField() {
        #expect(FareWatchText.target(from: "", current: nil) == .unchanged)
        #expect(FareWatchText.target(from: " ", current: 900) == .set(nil))
        #expect(FareWatchText.target(from: "$1,100", current: 900) == .set(1100))
        #expect(FareWatchText.target(from: "900", current: 900) == .unchanged)
        #expect(FareWatchText.target(from: "0", current: nil) == .invalid("Enter a price in dollars, like 1500."))
        #expect(FareWatchText.target(from: "cheap", current: nil) == .invalid("Enter a price in dollars, like 1500."))
    }

    @Test func bookingFromSellerFareAndPaidEdit() throws {
        let json = #"""
        {"name":"Expedia","is_airline":false,"lowest":1400,"tier":"trusted","logo":"/api/logo/site/expedia.com",
         "fares":[{"name":"Main Cabin","price":1400,"features":[],"policy":{"changes":"free","refunds":"partial"}}]}
        """#
        let seller = try JSONDecoder().decode(VerifiedSeller.self, from: Data(json.utf8))
        let b = FareWatchText.booking(tfs: "CjRIabcdefghijklmnop", seller: seller, fare: seller.fares[0])
        #expect(b.seller == "Expedia" && !b.isAirline && b.paid == 1400 && b.changes == .free && b.refunds == .partial)

        let edited = try FareWatchText.booking(b, paidText: "$1,350").get()
        #expect(edited.paid == 1350 && edited.tfs == b.tfs)
        #expect(throws: TripsProblem(message: "Enter what you paid in dollars, like 1500.")) {
            try FareWatchText.booking(b, paidText: "0").get()
        }
        let body = try jsonObject(edited)
        #expect(body["paid"] as? Double == 1350)
        #expect(body["fare"] as? String == "Main Cabin")
    }

    @Test func savedTripPatchBodies() throws {
        #expect(try jsonObject(SavedTripPatch(targetPrice: .some(nil))).keys.sorted() == ["targetPrice"])
        #expect(try jsonObject(SavedTripPatch(targetPrice: .some(nil)))["targetPrice"] is NSNull)
        #expect(try jsonObject(SavedTripPatch(remindOn: .some(date("2026-12-01"))))["remindOn"] as? String == "2026-12-01")
        #expect(try jsonObject(SavedTripPatch(alertDrop: false))["alertDrop"] as? Bool == false)
    }
}
