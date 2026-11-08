import Foundation
import Testing
@testable import Lodestar

@Suite("Stays offers: refundable rate and trusted filter")
struct StaysOffersTests {
    typealias F = StaysFeatureFixtures

    @Test func noOffersOrNoFlexibleRateIsNone() {
        #expect(StaysRefundable(offers: [], nights: 3) == .none)
        #expect(StaysRefundable(offers: [F.offer("A", total: 300), F.offer("B", total: 320)], nights: 3) == .none)
    }

    @Test func cheapestFlexibleIsIncluded() {
        let cheapest = F.offer("A", total: 300, cancel: "2026-11-20")
        #expect(StaysRefundable(offers: [cheapest, F.offer("B", total: 320)], nights: 3) == .included(cheapest))
    }

    @Test func flexibleAtTheSameTotalIsIncluded() {
        let flexible = F.offer("B", total: 300, cancel: "2026-11-20")
        #expect(StaysRefundable(offers: [F.offer("A", total: 300), flexible], nights: 3) == .included(flexible))
    }

    @Test func pricierFlexibleCostsTheDifference() {
        let flexible = F.offer("Hotel", total: 390, tier: .airline, cancel: "2026-11-20")
        let result = StaysRefundable(offers: [F.offer("A", total: 300), flexible], nights: 3)
        #expect(result == .extra(flexible, extra: 90, perNight: 30))
    }

    @Test func zeroNightsDividesByOne() {
        let flexible = F.offer("B", total: 350, cancel: "2026-11-20")
        #expect(StaysRefundable(offers: [F.offer("A", total: 300), flexible], nights: 0) == .extra(flexible, extra: 50, perNight: 50))
    }

    @Test func trustedOnlyHidesUnvettedAndReportsTheSaving() throws {
        let offers = try F.prices().offers
        let list = StaysOfferList(offers: offers, showAll: false)
        #expect(list.shown.map(\.seller) == ["Booking.com", "Memmo Alfama"])
        #expect(list.hidden.map(\.seller) == ["Cheap Rooms Co"])
        #expect(abs(list.hiddenSaving - 26.4) < 0.001)
    }

    @Test func showAllKeepsServerOrder() throws {
        let offers = try F.prices().offers
        let list = StaysOfferList(offers: offers, showAll: true)
        #expect(list.shown.map(\.seller) == ["Cheap Rooms Co", "Booking.com", "Memmo Alfama"])
        #expect(list.hidden.count == 1)
        #expect(list.hiddenSaving == 0)
    }

    @Test func onlyUnvettedLeavesNothingShown() {
        let list = StaysOfferList(offers: [F.offer("X", total: 200, tier: .unvetted)], showAll: false)
        #expect(list.shown.isEmpty)
        #expect(list.hiddenSaving == 0)
    }

    @Test func unknownTierCountsAsUnvetted() {
        let list = StaysOfferList(offers: [F.offer("X", total: 200, tier: .unknown)], showAll: false)
        #expect(list.hidden.count == 1)
    }

    @Test func refundableUsesTheShownOffers() throws {
        let offers = try F.prices().offers
        let shown = StaysOfferList(offers: offers, showAll: false).shown
        guard case .extra(let offer, let extra, let perNight) = StaysRefundable(offers: shown, nights: 3) else {
            Issue.record("Expected a refundable premium")
            return
        }
        #expect(offer.seller == "Memmo Alfama")
        #expect(extra == 30)
        #expect(perNight == 10)
    }
}
