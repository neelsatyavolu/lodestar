import Foundation
import Testing
@testable import Lodestar

@Suite("Stays copy and formatting")
struct StaysCopyTests {
    typealias F = StaysFeatureFixtures

    @Test func headerLines() {
        #expect(StaysCopy.title(count: 12, city: "Lisbon") == "12 stays in Lisbon")
        #expect(StaysCopy.title(count: 1, city: "Porto") == "1 stay in Porto")
        #expect(StaysCopy.subtitle(F.query) == "Thu, Nov 26 – Sun, Nov 29 · 3 nights · one room for 2 adults")
        let single = StaySearchQuery(city: "Porto", checkin: date("2026-11-26"), checkout: date("2026-11-27"), adults: 1)
        #expect(StaysCopy.subtitle(single) == "Thu, Nov 26 – Fri, Nov 27 · 1 night · one room for 1 adult")
    }

    @Test func flexStatusLines() throws {
        #expect(StaysCopy.flexStatus(.loading) == "Checking a night earlier and later…")
        #expect(StaysCopy.flexStatus(.failed) == "Couldn't check nearby dates.")
        #expect(StaysCopy.flexStatus(.loaded([:])) == "Moving a night doesn't save much here.")
        #expect(StaysCopy.flexStatus(.loaded(try F.flex().savings)) == "1 stay cost less a night earlier or later.")
    }

    @Test func hotelFacts() throws {
        let hotel = try #require(try F.search().hotels.first)
        #expect(StaysCopy.rating(hotel.rating ?? 0) == "4.6")
        #expect(StaysCopy.rating(4) == "4.0")
        #expect(StaysCopy.reviews(1234) == "(1,234)")
        #expect(StaysCopy.stars(4) == "4-star")
        #expect(StaysCopy.deal(18) == "18% under usual")
        #expect(StaysCopy.amenities(hotel.amenities) == "Free Wi-Fi · Pool · Bar · Air conditioning")
        #expect(StaysCopy.amenities([]) == nil)
        #expect(Money.usd(hotel.price) == "$189")
    }

    @Test func savingLink() throws {
        let saving = try #require(try F.flex().savings.values.first)
        #expect(StaysCopy.saving(saving) == "About $60 less arriving a night earlier (Wed, Nov 25 – Sat, Nov 28). Search those dates")
        let later = FlexSaving(shift: .later, checkin: date("2026-11-27"), checkout: date("2026-11-30"), saving: 1200)
        #expect(StaysCopy.saving(later) == "About $1,200 less arriving a night later (Fri, Nov 27 – Mon, Nov 30). Search those dates")
    }

    @Test func offerRowText() throws {
        let offer = try #require(try F.prices().offers.first)
        #expect(Money.usd(offer.total) == "$514")
        #expect(StaysCopy.nightly(offer, nights: 3) == "$171 × 3 nights")
        #expect(StaysCopy.nightly(offer, nights: 1) == "$171 × 1 night")
        #expect(StaysCopy.freeCancel(date("2026-11-26")) == "Free cancellation until Thu, Nov 26")
        #expect(StaysCopy.bookHint(offer) == "Continue to Cheap Rooms Co through Google Hotels")
        #expect(offer.tier.stayLabel == "Not vetted")
    }

    @Test func refundableNotes() {
        #expect(StaysCopy.refundable(.none) == (nil, "None of these rates can be cancelled for free."))
        let flexible = F.offer("Memmo", total: 390, tier: .airline, cancel: "2026-11-25")
        #expect(StaysCopy.refundable(.included(flexible)).rest == "The cheapest rate here can be cancelled for free until Wed, Nov 25.")
        let extra = StaysCopy.refundable(.extra(flexible, extra: 90, perNight: 30))
        #expect(extra.lead == "Refundable for $90 more")
        #expect(extra.rest == " ($30 a night) with Memmo, free to cancel until Wed, Nov 25.")
    }

    @Test func unvettedToggle() throws {
        let offers = try F.prices().offers
        let hidden = StaysOfferList(offers: offers, showAll: false)
        #expect(StaysCopy.unvettedToggle(hidden, showingAll: false) == "Show 1 unvetted agency (from $514, $26 less)")
        #expect(StaysCopy.unvettedToggle(hidden, showingAll: true) == "Hide unvetted agencies")
        let pricier = StaysOfferList(
            offers: [F.offer("A", total: 300), F.offer("X", total: 320, tier: .unvetted), F.offer("Y", total: 330, tier: .unvetted)],
            showAll: false
        )
        #expect(StaysCopy.unvettedToggle(pricier, showingAll: false) == "Show 2 unvetted agencies")
    }
}
