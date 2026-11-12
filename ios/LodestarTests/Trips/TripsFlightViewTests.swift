import Foundation
import Testing
@testable import Lodestar

/// Ports of `lib/journeys/flight-view.test.ts`, plus the card copy.
@Suite("Trips flight view")
struct TripsFlightViewTests {
    typealias M = TripsMake
    typealias F = TripsFlightsTests

    static func at(_ day: String, _ time: String, _ utc: String) -> FlightMoment {
        FlightMoment(date: date(day), time: time, utc: EpochMillis.from(ISO8601DateFormatter().date(from: utc)!))
    }

    static func end(_ code: String, name: String, city: String, zone: String, terminal: String, scheduled: FlightMoment,
                    latest: FlightMoment? = nil, baggage: String? = nil, gate: String? = nil) -> FlightEndpoint {
        FlightEndpoint(code: code, name: name, city: city, zone: zone, terminal: terminal, gate: gate, baggage: baggage,
                       scheduled: scheduled, latest: latest, actual: false)
    }

    static func status(_ phase: FlightPhase = .scheduled, delay: Int? = nil, departureLatest: FlightMoment? = nil,
                       arrivalBaggage: String? = nil) -> FlightStatus {
        FlightStatus(
            phase: phase,
            departure: end("SFO", name: "San Francisco", city: "San Francisco", zone: "PST", terminal: "2",
                           scheduled: at("2026-11-21", "10:20", "2026-11-21T18:20:00Z"), latest: departureLatest),
            arrival: end("PHX", name: "Phoenix Sky Harbor", city: "Phoenix", zone: "MST", terminal: "4",
                         scheduled: at("2026-11-21", "13:25", "2026-11-21T20:25:00Z"), baggage: arrivalBaggage),
            aircraft: "Boeing 737-800", airline: "Southwest Airlines", delay: delay, checkedAt: 0)
    }

    static let folded = TripsFlightGroup(flight: F.flight, departure: F.sfo, arrival: F.phx)
    static let bare = TripsFlightGroup(flight: F.flight, departure: nil, arrival: nil)

    @Test func showsTheBookingAloneWithoutLiveStatus() {
        let v = TripsFlightView(group: Self.folded, status: nil)
        #expect(v.label == "WN 4623")
        #expect(v.airlineName == "Southwest")
        #expect(v.status == "Booked")
        #expect(v.tone == .idle)
        #expect(v.minutes == 125)
        #expect(!v.live)
        #expect(v.from.code == "SFO" && v.from.time == "10:20" && v.from.terminal == "1" && v.from.beThere == "08:50" && v.from.zone == nil)
        #expect(v.from.name == "San Francisco International Airport")
        #expect(v.to.code == "PHX" && v.to.time == "13:25" && v.to.terminal == "4")
        #expect(v.to.note == "Rental Car Center shuttle from the curb, ~15 min")
        #expect(TripsFlightText.liveLine(v) == nil)
    }

    @Test func prefersLiveTerminalsZonesAndTheScheduledDuration() {
        let v = TripsFlightView(group: Self.folded, status: Self.status())
        #expect(v.status == "On time" && v.tone == .ok && v.minutes == 125 && v.aircraft == "Boeing 737-800")
        #expect(v.from.terminal == "2" && v.from.zone == "PST" && v.from.city == "San Francisco" && v.from.name == "San Francisco")
        #expect(v.shift == 60)
        #expect(TripsFlightText.liveLine(v) == "On time · the gate is posted on travel day")
        #expect(TripsFlightText.airLine(v) == "2h 05m in the air · clocks jump 1 hr")
        #expect(TripsFlightText.shiftLine(v) == "Clocks go forward 1 hr on landing.")
    }

    @Test func strikesTheBookedTimeThroughWhenLate() {
        let late = Self.status(.delayed, delay: 45, departureLatest: Self.at("2026-11-21", "11:05", "2026-11-21T19:05:00Z"))
        let v = TripsFlightView(group: Self.bare, status: late)
        #expect(v.status == "Delayed 45 min" && v.tone == .warn)
        #expect(v.from.time == "11:05" && v.from.was == "10:20")
        #expect(TripsFlightText.liveLine(v) == "Delayed 45 min · now leaves 11:05 AM")
    }

    @Test func movesThePlaneAlongInTheAir() {
        let now = EpochMillis.from(ISO8601DateFormatter().date(from: "2026-11-21T19:22:30Z")!)
        let flying = TripsFlightView(group: Self.bare, status: Self.status(.departed), now: now)
        #expect(abs(flying.progress - 0.5) < 0.01)
        #expect(TripsFlightText.trackLabel(flying) == "lands 1:25 PM")
        let landed = TripsFlightView(group: Self.bare, status: Self.status(.landed, arrivalBaggage: "7"))
        #expect(landed.progress == 1)
        #expect(TripsFlightText.liveLine(landed) == "Landed 1:25 PM · bags on carousel 7")
    }

    @Test func saysCancelledWhenTheBookingIs() {
        let cancelled = M.item("flight", kind: .flight, status: .cancelled, title: F.flight.title, day: "2026-11-21", time: "10:20", endTime: "13:25")
        let v = TripsFlightView(group: TripsFlightGroup(flight: cancelled, departure: nil, arrival: nil), status: Self.status())
        #expect(v.status == "Cancelled" && v.tone == .danger && v.isCancelled)
    }

    @Test func readsADurationFromTheTitleOrNote() {
        #expect(TripsFlightView.bookedMinutes(M.item("x", day: "2026-11-21", details: M.details { $0.note = "Nonstop · 2 hr 05 min" })) == 125)
        #expect(TripsFlightView.bookedMinutes(M.item("UA 1", day: "2026-11-21")) == nil)
        #expect(TripsFlightView.duration(125) == "2h 05m")
    }

    @Test func gateLineAndBrandFallback() {
        let v = TripsFlightView(group: Self.folded, status: nil)
        #expect(TripsFlightText.gateLine(v.from) == "Terminal 1")
        #expect(TripsAirlineBrand.of("WN").bg == 0x304CB2)
        #expect(TripsAirlineBrand.of("ZZ") == TripsAirlineBrand.plain)
        #expect(TripsAirlineBrand.of(nil) == TripsAirlineBrand.plain)
    }

    @Test func decodesTheFlightsEndpointWithNulls() throws {
        let json = """
        {"live":true,"flights":{"a":null,"b":{"phase":"boarding","departure":{"code":"SFO","name":null,"city":null,"zone":"PST","terminal":"2","gate":"B12","baggage":null,"scheduled":{"date":"2026-11-21","time":"10:20","utc":1795285200000},"latest":null,"actual":false},"arrival":{"code":"PHX","name":null,"city":null,"zone":null,"terminal":null,"gate":null,"baggage":null,"scheduled":null,"latest":null,"actual":false},"aircraft":null,"airline":null,"delay":null,"checkedAt":1795280000000}}}
        """
        let r = try JSONDecoder().decode(FlightsResponse.self, from: Data(json.utf8))
        #expect(r.live)
        #expect(r.flights["a"] == .some(nil))
        #expect(r.flights["b"]??.phase == .boarding)
        #expect(r.flights["b"]??.departure.gate == "B12")
    }
}
