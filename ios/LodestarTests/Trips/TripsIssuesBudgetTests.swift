import Foundation
import Testing
@testable import Lodestar

@Suite("Trips nights, issues and budget")
struct TripsIssuesBudgetTests {
    typealias M = TripsMake

    @Test func nightsMergeRunsAtTheSameStayAndGaps() {
        let items = [M.item("hotel", kind: .stay, status: .booked, day: "2026-11-20", end: "2026-11-22")]
        let runs = TripsPlan.nights(start: date("2026-11-20"), end: date("2026-11-24"), items: items)
        #expect(runs.count == 2)
        #expect(runs[0].stay?.id == "hotel" && runs[0].nights == 2 && runs[0].to == date("2026-11-22"))
        #expect(runs[1].stay == nil && runs[1].nights == 2 && runs[1].from == date("2026-11-22"))
        #expect(TripsPlan.nights(start: date("2026-11-20"), end: date("2026-11-20"), items: items).isEmpty)
    }

    @Test func issuesUseTheWebsSentences() {
        let today = date("2026-11-15")
        let items = [
            M.item("hotel", kind: .stay, status: .booked, day: "2026-11-20", end: "2026-11-23"),
            M.item("Dinner", kind: .dining, day: "2026-11-21", time: "19:00",
                   details: M.details { $0.reserve = true; $0.bookBy = date("2026-11-14") }),
            M.item("Tour", day: "2026-11-21", time: "19:00", details: M.details { $0.reserve = true; $0.bookBy = date("2026-11-18") }),
            M.item("Spa", day: "2026-11-22", details: M.details { $0.reserve = true }),
        ]
        let texts = TripsPlan.issues(start: date("2026-11-20"), end: date("2026-11-24"), items: items, today: today).map(\.text)
        #expect(texts == [
            "No place to stay for the night of Nov 23.",
            "Dinner was to be booked by Nov 14.",
            "Book Tour by Nov 18.",
            "Spa on Nov 22 isn't booked yet.",
            "Dinner and Tour are both at 19:00 on Nov 21.",
            "Nothing planned yet on Nov 20, Nov 23, Nov 24.",
        ])
    }

    @Test func noIssuesOnceTheTripEnded() {
        #expect(TripsPlan.issues(start: date("2026-11-01"), end: date("2026-11-05"), items: [], today: date("2026-11-06")).isEmpty)
    }

    @Test func multiNightGapIsOneIssue() {
        let texts = TripsPlan.issues(start: date("2026-11-20"), end: date("2026-11-23"), items: [], today: date("2026-11-01")).map(\.text)
        #expect(texts.first == "No place to stay for 3 nights, Nov 20 to Nov 23.")
    }

    @Test func daySummaryNamesFlightsAndDedupes() {
        let items = [
            M.item("TP 202", kind: .flight, day: "2026-11-20", time: "08:00"),
            M.item("Lunch", kind: .dining, day: "2026-11-20", time: "13:00"),
            M.item("Lunch", kind: .dining, day: "2026-11-20", time: "14:00"),
            M.item("hotel", kind: .stay, day: "2026-11-20"),
            M.item("idea", status: .suggested, day: "2026-11-20"),
            M.item("Hop", kind: .flight, day: "2026-11-22", details: M.details { $0.to = "OPO" }),
        ]
        #expect(TripsPlan.daySummary(start: date("2026-11-20"), end: date("2026-11-24"), items: items, date: date("2026-11-20")) == "Fly in, Lunch")
        #expect(TripsPlan.daySummary(start: date("2026-11-20"), end: date("2026-11-24"), items: items, date: date("2026-11-22")) == "Fly to OPO")
    }

    @Test func budgetSumsTheMainCurrencyByCategory() {
        let items = [
            M.item("flight", kind: .flight, status: .booked, day: "2026-11-20", details: M.details { $0.price = 900 }),
            M.item("dinner", kind: .dining, day: "2026-11-21", details: M.details { $0.estimate = 80 }),
            M.item("tour", day: "2026-11-21", details: M.details { $0.price = 40 }),
            M.item("idea", status: .suggested, day: "2026-11-21", details: M.details { $0.price = 999 }),
            M.item("tram", kind: .transport, day: "2026-11-21", details: M.details { $0.price = 30; $0.currency = "eur" }),
        ]
        let costs = [M.cost("tips", 50, paid: true), M.cost("pass", 20, currency: "EUR", category: .transport)]
        let b = TripsBudget(items: items, costs: costs, travelers: 2)
        #expect(b.currency == "USD")
        #expect(b.lines.map(\.category) == [.flights, .dining, .activities, .other])
        #expect(b.paid == 950)
        #expect(b.estimated == 120)
        #expect(b.total == 1070)
        #expect(b.perPerson == 535)
        #expect(b.otherCurrencies == ["EUR"])
    }

    @Test func budgetTieGoesToFirstSeenCurrencyAndNoPerPersonForOne() {
        let costs = [M.cost("a", 10, currency: "EUR"), M.cost("b", 20, currency: "USD")]
        let b = TripsBudget(items: [], costs: costs, travelers: 1)
        #expect(b.currency == "EUR")
        #expect(b.perPerson == nil)
        #expect(TripsBudget(items: [], costs: [], travelers: 3).currency == "USD")
    }
}
