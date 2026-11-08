import Foundation
import Testing
@testable import Lodestar

@Suite("Flight results: ranking, filters, badges and the flex hack")
struct FlightResultsTests {
    let cheap = SearchBuild.itinerary(id: "cheap", price: 300, minutes: 600, airlines: ["NK", "UA"])
    let fast = SearchBuild.itinerary(id: "fast", price: 500, minutes: 330, airlines: ["UA"])
    let mid = SearchBuild.itinerary(id: "mid", price: 400, minutes: 330, airlines: ["DL"], from: "OAK", selfTransfer: true)

    var all: [Itinerary] { [fast, mid, cheap] }

    @Test func bestKeepsServerOrderCheapestAndFastestSort() {
        var filters = FlightListFilters()
        #expect(FlightResults.shown(all, checks: [:], filters: filters).map(\.id) == ["fast", "mid", "cheap"])
        filters.sort = .cheapest
        #expect(FlightResults.shown(all, checks: [:], filters: filters).map(\.id) == ["cheap", "mid", "fast"])
        filters.sort = .fastest
        // Same minutes: the lower display price wins.
        #expect(FlightResults.shown(all, checks: [:], filters: filters).map(\.id) == ["mid", "fast", "cheap"])
    }

    @Test func cheapestUsesTrustedPriceWhenTrustedOnly() {
        let checks: [String: FlightSellerState] = ["cheap": .done(SearchBuild.check(lowestTrusted: 650, airlinePrice: 650))]
        var filters = FlightListFilters(sort: .cheapest, trustedOnly: true)
        #expect(FlightResults.shown(all, checks: checks, filters: filters).map(\.id) == ["mid", "fast", "cheap"])
        filters.trustedOnly = false
        #expect(FlightResults.shown(all, checks: checks, filters: filters).first?.id == "cheap")
    }

    @Test func displayPrice() {
        let done = FlightSellerState.done(SearchBuild.check(lowestTrusted: 320))
        #expect(FlightResults.displayPrice(cheap, state: done, trustedOnly: true) == 320)
        #expect(FlightResults.displayPrice(cheap, state: done, trustedOnly: false) == 300)
        #expect(FlightResults.displayPrice(cheap, state: .loading, trustedOnly: true) == 300)
        let none = FlightSellerState.done(SearchBuild.check(lowestTrusted: nil, unvetted: 280))
        #expect(FlightResults.displayPrice(cheap, state: none, trustedOnly: true) == 300)
    }

    @Test func filters() {
        let onlyUnvetted: [String: FlightSellerState] = ["mid": .done(SearchBuild.check(lowestTrusted: nil, unvetted: 380))]
        var filters = FlightListFilters()
        #expect(FlightResults.shown(all, checks: onlyUnvetted, filters: filters).map(\.id) == ["fast", "cheap"])
        filters.trustedOnly = false
        #expect(FlightResults.shown(all, checks: onlyUnvetted, filters: filters).count == 3)
        filters.nonstop = true
        #expect(FlightResults.shown(all, checks: [:], filters: filters).map(\.id) == ["fast", "mid"])
        filters.nonstop = false
        filters.airlines = ["UA"]
        // Every leg must be on a selected carrier: "cheap" has an NK leg.
        #expect(FlightResults.shown(all, checks: [:], filters: filters).map(\.id) == ["fast"])
        filters.airlines = ["UA", "NK"]
        #expect(FlightResults.shown(all, checks: [:], filters: filters).map(\.id) == ["fast", "cheap"])
    }

    @Test func carriersOrderedByCheapestAppearance() {
        let carriers = FlightResults.carriers(all)
        #expect(carriers.map(\.code) == ["UA", "NK", "DL"])
        #expect(carriers.first(where: { $0.code == "UA" })?.minPrice == 300)
        #expect(carriers.first(where: { $0.code == "UA" })?.name == "United")
        let many = (0..<12).map { SearchBuild.itinerary(id: "i\($0)", price: Double(100 + $0), airlines: ["A\($0 % 10)", "B\($0)"]) }
        #expect(FlightResults.carriers(many).count == 10)
    }

    @Test func badges() {
        let labels = SearchResult.SearchLabels(best: "fast", cheapest: "cheap", fastest: "fast")
        #expect(FlightResults.badges(fast, labels: labels, nearby: ["OAK"]) == [.best, .fastest])
        #expect(FlightResults.badges(mid, labels: labels, nearby: ["OAK"]) == [.nearby, .selfTransfer])
        #expect(FlightResults.badges(cheap, labels: labels, nearby: []) == [.cheapest])
    }

    @Test func hacksMergeFlexAndSortBySaving() {
        let server = SearchBuild.decode([Hack].self, #"""
        [{"kind":"nearby","title":"Fly from Oakland","detail":"","saving":28,"price":412,"itineraryIds":["mid"]},
         {"kind":"nonstop","title":"Nonstop","detail":"","saving":-40,"price":500,"itineraryIds":["fast"]}]
        """#)
        let result = SearchBuild.result(all, hacks: server)
        let flex = Hack(kind: .flex, title: "Go 2 days later", detail: "", saving: 60, price: 1,
                        itineraryIds: [], apply: nil, caution: nil)
        #expect(FlightResults.hacks(result, flex: flex).map(\.kind) == [.flex, .nearby, .nonstop])
        #expect(FlightResults.hacks(result, flex: nil).map(\.kind) == [.nearby, .nonstop])
    }

    // MARK: - Flex hack (api-search.md 2.2)

    let days = [
        DayPrice(depart: date("2026-11-23"), returnDate: date("2026-11-28"), price: 380),
        DayPrice(depart: date("2026-11-26"), returnDate: date("2026-12-01"), price: 450),
        DayPrice(depart: date("2026-11-28"), returnDate: date("2026-12-03"), price: 420),
    ]

    @Test func flexHackRoundTripEarlier() throws {
        let hack = try #require(FlexHack.make(days: days, depart: date("2026-11-26"), returnDate: date("2026-12-01"), baseline: 999))
        #expect(hack.kind == .flex)
        #expect(hack.title == "Leave 3 days earlier")
        #expect(hack.detail == "Mon, Nov 23 – Sat, Nov 28 is $70 less than your dates.")
        #expect(hack.saving == 70)
        #expect(hack.price == 380)
        #expect(hack.itineraryIds.isEmpty)
        #expect(hack.apply?.depart == date("2026-11-23"))
        #expect(hack.apply?.returnDate == .some(date("2026-11-28")))
    }

    @Test func flexHackOneWayLaterUsesBaselineWhenDayMissing() throws {
        let oneWay = [DayPrice(depart: date("2026-11-27"), returnDate: nil, price: 200),
                      DayPrice(depart: date("2026-11-28"), returnDate: nil, price: 260)]
        let hack = try #require(FlexHack.make(days: oneWay, depart: date("2026-11-26"), returnDate: nil, baseline: 240))
        #expect(hack.title == "Go 1 day later")
        #expect(hack.detail == "Fri, Nov 27 is $40 less than your dates.")
        #expect(hack.apply?.returnDate == .some(nil))
    }

    @Test func flexHackNone() {
        #expect(FlexHack.make(days: [], depart: date("2026-11-26"), returnDate: nil, baseline: 400) == nil)
        // No chosen price (bags > 0 passes nil baseline) and the searched day is missing.
        #expect(FlexHack.make(days: [days[0]], depart: date("2026-11-26"), returnDate: nil, baseline: nil) == nil)
        // Saving under $15.
        let close = [DayPrice(depart: date("2026-11-26"), returnDate: nil, price: 400),
                     DayPrice(depart: date("2026-11-27"), returnDate: nil, price: 390)]
        #expect(FlexHack.make(days: close, depart: date("2026-11-26"), returnDate: nil, baseline: nil) == nil)
        // The searched day is already the cheapest.
        let best = [DayPrice(depart: date("2026-11-26"), returnDate: nil, price: 100),
                    DayPrice(depart: date("2026-11-27"), returnDate: nil, price: 390)]
        #expect(FlexHack.make(days: best, depart: date("2026-11-26"), returnDate: nil, baseline: nil) == nil)
    }

    @Test func flexReturnShiftsWhenDayHasNone() throws {
        let noReturn = [DayPrice(depart: date("2026-11-28"), returnDate: nil, price: 300)]
        let hack = try #require(FlexHack.make(days: noReturn, depart: date("2026-11-26"), returnDate: date("2026-12-01"), baseline: 400))
        #expect(hack.apply?.returnDate == .some(date("2026-12-03")))
    }
}
