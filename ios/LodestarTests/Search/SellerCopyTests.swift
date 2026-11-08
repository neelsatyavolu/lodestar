import Foundation
import Testing
@testable import Lodestar

@Suite("Seller check copy and itinerary text")
struct SellerCopyTests {
    @Test func sellerLineStates() {
        #expect(FlightSellerLine.make(state: nil, googlePrice: 400, trustedOnly: true).text == "Sellers not checked")
        let loading = FlightSellerLine.make(state: .loading, googlePrice: 400, trustedOnly: true)
        #expect(loading.text == "Checking sellers" && loading.isLoading)
        #expect(FlightSellerLine.make(state: .failed("x"), googlePrice: 400, trustedOnly: true).text == "Couldn't check sellers")
        let unvetted = FlightSellerLine.make(state: .done(SearchBuild.check(lowestTrusted: nil, unvetted: 300)),
                                             googlePrice: 400, trustedOnly: true)
        #expect(unvetted.text == "Only unvetted agencies" && unvetted.tone == .warn)
    }

    @Test func sellerLineAirlineDirectAndElsewhere() {
        let direct = FlightSellerLine.make(state: .done(SearchBuild.check(lowestTrusted: 400, airlinePrice: 400)),
                                           googlePrice: 400.4, trustedOnly: true)
        #expect(direct == FlightSellerLine(text: "Airline direct", suffix: nil, tone: .ok))
        let agency = SearchBuild.check(lowestTrusted: 430, airlinePrice: 480, trustedSeller: "Expedia")
        let higher = FlightSellerLine.make(state: .done(agency), googlePrice: 400, trustedOnly: true)
        #expect(higher.text == "Expedia")
        #expect(higher.tone == .warn)
        #expect(higher.suffix == " · $400 elsewhere")
        let off = FlightSellerLine.make(state: .done(agency), googlePrice: 400, trustedOnly: false)
        #expect(off.tone == .ok && off.suffix == nil)
    }

    @Test func policyChips() {
        let policy = SearchBuild.decode(FarePolicy.self, #"""
        {"carry_on":true,"checked_bag_fee":35,"checked_bag_included":null,"changes":"free","refunds":"partial","seat_selection":"none"}
        """#)
        #expect(SellerCopy.policyChips(policy) == [
            FarePolicyChip(label: "Carry-on", ok: true),
            FarePolicyChip(label: "Checked bag $35", ok: nil),
            FarePolicyChip(label: "Free changes", ok: true),
            FarePolicyChip(label: "Partly refundable", ok: true),
            FarePolicyChip(label: "Seat choice", ok: false),
        ])
        let basic = SearchBuild.decode(FarePolicy.self, #"""
        {"carry_on":null,"checked_bag_fee":null,"checked_bag_included":false,"changes":"fee","refunds":"none","seat_selection":"fee"}
        """#)
        #expect(SellerCopy.policyChips(basic).map(\.label) == ["Carry-on", "No checked bag", "Changes for a fee", "Refunds", "Seat choice for a fee"])
        #expect(SellerCopy.policyChips(basic).map(\.ok) == [nil, false, nil, false, nil])
        let included = SearchBuild.decode(FarePolicy.self, #"{"checked_bag_fee":0,"changes":"weird"}"#)
        #expect(SellerCopy.bagChip(included) == FarePolicyChip(label: "Checked bag included", ok: true))
        #expect(SellerCopy.policyChips(included)[2] == FarePolicyChip(label: "Changes", ok: nil))
    }

    @Test func insightText() throws {
        let insight = SearchBuild.decode(PriceInsight.self, #"""
        {"level":"low","typical_low":430,"typical_high":610,"unlikely_to_drop_below":390,"cheaper_than_usual_by":30,"summary":null}
        """#)
        let text = try #require(SellerCopy.insight(insight))
        #expect(text.lead == "Price is low, $30 under usual. ")
        #expect(text.rest == "Similar trips usually cost $430–$610. Google expects it won't drop below $390, so waiting is unlikely to help.")
        #expect(text.tone == .ok)
        let empty = SearchBuild.decode(PriceInsight.self, #"{"level":null,"summary":null}"#)
        #expect(SellerCopy.insight(empty) == nil)
        let high = SearchBuild.decode(PriceInsight.self, #"{"level":"high"}"#)
        #expect(SellerCopy.insight(high)?.tone == .danger)
    }

    @Test func unvettedSellers() {
        let check = SearchBuild.check(lowestTrusted: 420, airlinePrice: 420, unvetted: 380, gap: 40)
        #expect(SellerCopy.visibleSellers(check, showUnvetted: false).map(\.name) == ["United"])
        #expect(SellerCopy.visibleSellers(check, showUnvetted: true).count == 2)
        #expect(SellerCopy.unvettedCount(check) == 1)
        let copy = SellerCopy.showUnvetted(count: 1, check: check)
        #expect(copy.label == "Show 1 unvetted agency")
        #expect(copy.detail == " (from $380, $40 less)")
        #expect(SellerCopy.showUnvetted(count: 2, check: SearchBuild.check(lowestTrusted: 1)).label == "Show 2 unvetted agencies")
        #expect(SellerCopy.hasFareTiers(check.sellers[0]))
        #expect(!SellerCopy.hasFareTiers(check.sellers[1]))
    }

    @Test func itineraryText() throws {
        let it = try decodeEnvelope(SearchFixtures.itinerary, as: Itinerary.self)
        let slice = it.slices[0]
        #expect(FlightText.times(slice) == "8:15am – 6:45pm")
        #expect(FlightText.subtitle(slice, label: nil) == "Thu, Nov 26 · United")
        #expect(FlightText.stops(slice) == "1 stop")
        #expect(FlightText.via(slice) == "DEN")
        #expect(FlightText.co2(slice) == "312 kg CO₂ (-8% vs typical)")
        #expect(FlightText.layover(slice.layovers[0]) == "1h 5m layover in Denver")
        #expect(FlightText.legLine(slice.legs[1]) == "3h · United · UA 88 · operated by SkyWest")
        #expect(FlightText.legLine(slice.legs[0]) == "2h 25m · United · UA 1234 · Boeing 737 · 31 in legroom")
        #expect(FlightText.longLabel(index: 0, of: it) == "Flight")
        #expect(FlightText.shortLabel(index: 0, of: it) == nil)
        #expect(FlightText.tripKind(it) == "one way")
        let tight = SearchBuild.decode(Layover.self, #"{"airport":"ORD","city":null,"minutes":45,"overnight":true,"change_of_airport":true}"#)
        #expect(FlightText.layover(tight) == "45m layover in ORD · overnight · change airports · tight connection")
    }
}
