import Foundation
import Testing
@testable import Lodestar

/// Ports of `lib/journeys/flights.test.ts`.
@Suite("Trips flights: codes, airports and folding")
struct TripsFlightsTests {
    typealias M = TripsMake

    // The day from the web's screenshot: an airport stop, the flight, a landing stop and the rental car.
    static let flight = M.item("flight", kind: .flight, status: .booked, title: "Southwest WN 4623 · SFO → PHX · nonstop 2h05 · 4 travelers",
                               day: "2026-11-21", time: "10:20", endTime: "13:25", details: M.details { $0.airline = "Southwest" })
    static let sfo = M.item("sfo", title: "SFO Terminal 1", day: "2026-11-21", time: "08:50",
                            details: M.details { $0.address = "San Francisco International Airport, Terminal 1" })
    static let phx = M.item("phx", title: "Land at PHX Terminal 4", day: "2026-11-21", time: "13:25",
                            details: M.details { $0.note = "Rental Car Center shuttle from the curb, ~15 min" })
    static let alamo = M.item("alamo", kind: .transport, title: "Alamo rental", day: "2026-11-21", time: "14:00",
                              details: M.details { $0.address = "1805 E Sky Harbor Cir S, Phoenix, AZ" })

    @Test func codeReadsDetailsFirstThenTheTitle() {
        let numbered = M.item("a", title: "Flight home", day: "2026-11-21", details: M.details { $0.flightNumber = "UA 837" })
        #expect(TripsFlights.code(numbered) == .init(airline: "UA", number: "837"))
        #expect(TripsFlights.code(Self.flight) == .init(airline: "WN", number: "4623"))
        #expect(TripsFlights.code(M.item("b", title: "B6123 to Boston", day: "2026-11-21")) == .init(airline: "B6", number: "123"))
        #expect(TripsFlights.code(M.item("c", title: "Fly to Phoenix", day: "2026-11-21")) == nil)
    }

    @Test func airportsPreferDetailsThenTheTitlesArrow() {
        let detailed = M.item("a", title: "x", day: "2026-11-21", details: M.details { $0.from = "SFO"; $0.to = "PHX" })
        #expect(TripsFlights.airports(detailed) == ("SFO", "PHX"))
        #expect(TripsFlights.airports(Self.flight) == ("SFO", "PHX"))
        let partial = M.item("b", title: "San Francisco (SFO) to Tokyo", day: "2026-11-21", details: M.details { $0.from = "San Francisco (SFO)" })
        #expect(TripsFlights.airports(partial) == ("SFO", nil))
        let lower = M.item("c", title: "x", day: "2026-11-21", details: M.details { $0.from = "sfo" })
        #expect(TripsFlights.airports(lower).from == "SFO")
    }

    @Test func foldsTheAirportStopsOnEitherSide() {
        let groups = TripsFlights.groups([Self.sfo, Self.flight, Self.phx, Self.alamo])
        #expect(groups == [TripsFlightGroup(flight: Self.flight, departure: Self.sfo, arrival: Self.phx)])
        #expect(TripsFlights.foldedIds(groups) == ["sfo", "phx"])
    }

    @Test func leavesStopsOutsideTheWindowOrAtOtherAirportsAlone() {
        let early = M.item("early", title: "SFO Terminal 1", day: "2026-11-21", time: "05:00")
        let other = M.item("other", title: "OAK Terminal 2", day: "2026-11-21", time: "09:00")
        let late = M.item("late", title: "Land at PHX Terminal 4", day: "2026-11-21", time: "17:00")
        #expect(TripsFlights.groups([early, other, Self.flight, late]) == [TripsFlightGroup(flight: Self.flight, departure: nil, arrival: nil)])
    }

    @Test func needsTheAirportInTheTitleOrAnAirportWordPlusTheCodeInTheAddress() {
        let parking = M.item("parking", title: "Terminal 4 parking", day: "2026-11-21", time: "13:40", details: M.details { $0.address = "Sky Harbor, PHX" })
        #expect(TripsFlights.groups([Self.flight, parking]).first?.arrival == parking)
        #expect(TripsFlights.groups([Self.flight, Self.alamo]).first?.arrival == nil)
    }

    @Test func ignoresCancelledAndSuggestedFlightsAndStops() {
        let cancelled = M.item("flight", kind: .flight, status: .cancelled, title: Self.flight.title, day: "2026-11-21", time: "10:20", endTime: "13:25")
        #expect(TripsFlights.groups([cancelled, Self.sfo]).isEmpty)
        let idea = M.item("sfo", status: .suggested, title: "SFO Terminal 1", day: "2026-11-21", time: "08:50")
        #expect(TripsFlights.groups([Self.flight, idea]).first?.departure == nil)
    }

    @Test func putsAnOvernightArrivalOnTheLandingDay() {
        let redeye = M.item("redeye", kind: .flight, title: "UA 1 SFO → JFK", day: "2026-11-21", time: "22:00", end: "2026-11-22", endTime: "06:30")
        let jfk = M.item("jfk", title: "JFK Terminal 7", day: "2026-11-22", time: "07:00")
        #expect(TripsFlights.groups([redeye, jfk]).first?.arrival == jfk)
    }

    @Test func flightBetweenIsTrueWhenAFlightLeavesBetweenTwoStops() {
        let day = date("2026-11-21")
        #expect(TripsFlights.flightBetween([Self.sfo, Self.flight, Self.phx], date: day, Self.sfo, Self.phx))
        #expect(!TripsFlights.flightBetween([Self.sfo, Self.flight, Self.phx, Self.alamo], date: day, Self.phx, Self.alamo))
    }

    @Test func leavesSoonOnlyWithinADayAheadOrHalfADayAfter() {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let at = { (s: String) in ISO8601DateFormatter().date(from: s)! }
        #expect(TripsFlights.leavesSoon([Self.flight], now: at("2026-11-20T12:00:00Z"), calendar: utc))
        #expect(TripsFlights.leavesSoon([Self.flight], now: at("2026-11-21T20:00:00Z"), calendar: utc))
        #expect(!TripsFlights.leavesSoon([Self.flight], now: at("2026-11-19T12:00:00Z"), calendar: utc))
        #expect(!TripsFlights.leavesSoon([Self.flight], now: at("2026-11-22T00:00:00Z"), calendar: utc))
    }
}
