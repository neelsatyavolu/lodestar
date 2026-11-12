import Foundation
import Testing
@testable import Lodestar

/// The itinerary day's drive rules (`day-section.tsx`), the Hotels tab, stop editing and sharing.
@Suite("Trips day plan, hotels, editing and sharing")
struct TripsDayPlanTests {
    typealias M = TripsMake
    typealias F = TripsFlightsTests

    static let pin = M.details { $0.lat = 37.6; $0.lng = -122.4 }
    static func pinned(_ item: TripItem) -> TripItem {
        var d = item.details
        d.lat = 33.4
        d.lng = -112.0
        return M.item(item.id, kind: item.kind, status: item.status, title: item.title, day: item.startDate.string, time: item.startTime,
                      end: item.endDate?.string, endTime: item.endTime, details: d)
    }

    // Wake up at a hotel in SF, airport stop, the flight, land at PHX, rental car, sleep at a hotel in Phoenix.
    static let sfHotel = M.item("sf-hotel", kind: .stay, status: .booked, title: "Hotel Zephyr", day: "2026-11-19", time: "15:00", end: "2026-11-21", details: pin)
    static let phxHotel = M.item("phx-hotel", kind: .stay, status: .booked, title: "Arizona Biltmore", day: "2026-11-20", time: "15:00", end: "2026-11-23", details: pin)
    static var items: [TripItem] {
        [sfHotel, phxHotel, pinned(F.sfo), pinned(F.flight), pinned(F.phx), pinned(F.alamo)]
    }

    @Test func foldsAirportStopsAndRunsTheRouteHotelToHotel() {
        let plan = TripsDayPlan(items: Self.items, date: date("2026-11-21"))
        #expect(plan.firm.map(\.id) == ["flight", "alamo"])
        #expect(plan.folded == ["sfo", "phx"])
        #expect(plan.stops.map(\.id) == ["sf-hotel", "sfo", "flight", "phx", "alamo", "phx-hotel"])
        #expect(plan.morning.map(\.id) == ["sf-hotel", "phx-hotel"])
    }

    @Test func noDriveIntoOrAcrossAFlight() {
        let plan = TripsDayPlan(items: Self.items, date: date("2026-11-21"))
        #expect(plan.flown == ["sfo", "flight"])
        #expect(plan.legAfterMorning(Self.sfHotel)?.to.id == "sfo")
        let group = plan.groups["flight"]!
        #expect(plan.legAfterFlight(group).map { "\($0.from.id)>\($0.to.id)" } == "phx>alamo")
        #expect(plan.legAfter(plan.firm[1]).map { "\($0.from.id)>\($0.to.id)" } == "alamo>phx-hotel")
        let legs = [StopLeg(from: "sf-hotel", to: "sfo", leg: RouteLeg(seconds: 1200, meters: 20000)),
                    StopLeg(from: "sfo", to: "flight", leg: RouteLeg(seconds: 40000, meters: 1_000_000)),
                    StopLeg(from: "phx", to: "alamo", leg: RouteLeg(seconds: 600, meters: 5000))]
        #expect(plan.driveSeconds(legs) == 1800)
    }

    @Test func endsTheRouteBackAtTheHotelOnADayYouDidntCheckIn() {
        let plan = TripsDayPlan(items: Self.items, date: date("2026-11-21"))
        #expect(plan.night?.id == "phx-hotel")
        #expect(plan.evening.isEmpty)
        let checkIn = TripsDayPlan(items: Self.items, date: date("2026-11-20"))
        #expect(checkIn.night == nil)
    }

    @Test func aNoteBetweenTwoStopsSitsInTheDrive() {
        let a = M.item("a", day: "2026-11-22", time: "09:00", details: Self.pin)
        let note = M.item("note", kind: .note, day: "2026-11-22", time: "10:00")
        let b = M.item("b", day: "2026-11-22", time: "11:00", details: Self.pin)
        let last = M.item("last", kind: .note, day: "2026-11-22", time: "18:00")
        let plan = TripsDayPlan(items: [a, note, b, last], date: date("2026-11-22"))
        #expect(plan.noteInLeg(at: 1))
        #expect(!plan.noteInLeg(at: 3))
    }

    @Test func hotelsTabNightsAndGaps() {
        #expect(TripsHotels.nights(Self.phxHotel) == 3)
        #expect(TripsHotels.nights(M.item("x", kind: .stay, day: "2026-11-21")) == nil)
        let gaps = TripsHotels.gapLine(start: date("2026-11-19"), end: date("2026-11-25"), items: [Self.sfHotel, Self.phxHotel])
        #expect(gaps == "No hotel yet for \(DateText.monthDay(date("2026-11-23"))) to \(DateText.monthDay(date("2026-11-25"))).")
        #expect(TripsHotels.stays([Self.sfHotel, M.item("idea", kind: .stay, status: .suggested, day: "2026-11-19")]).map(\.id) == ["sf-hotel"])
        #expect(TripsHotels.phoneURL("+1 (602) 955-6600")?.absoluteString == "tel:+16029556600")
        #expect(TripsHotels.directionsURL(title: "Biltmore", address: nil) == nil)
    }

    @Test func stopEditSendsOnlyWhatChanged() throws {
        let item = M.item("s", title: "Lunch", day: "2026-11-21", details: M.details { $0.why = "Near the museum" })
        #expect(TripsStopEdit.startingNote(item) == "Near the museum")
        #expect(TripsStopEdit.patch(item, title: " Lunch ", note: "Near the museum") == nil)
        let renamed = try #require(TripsStopEdit.patch(item, title: "Lunch at Pizzeria Bianco", note: "Near the museum"))
        #expect(String(decoding: try JSONEncoder().encode(renamed), as: UTF8.self) == #"{"title":"Lunch at Pizzeria Bianco"}"#)
        let cleared = try #require(TripsStopEdit.patch(item, title: "Lunch", note: "  "))
        #expect(String(decoding: try JSONEncoder().encode(cleared), as: UTF8.self) == #"{"note":null}"#)
    }

    @Test func sharedTripsDecodeWithAccess() throws {
        let row = #"{"id":"j2","title":"Tahoe","destination":null,"startDate":null,"endDate":null,"travelers":null,"tripType":null,"shareToken":null,"source":"manual","createdAt":0,"items":[],"access":{"role":"viewer","owner":"Maya"}}"#
        let shared = try JSONDecoder().decode(JourneyWithItems.self, from: Data(row.utf8)).journey
        #expect(shared.access?.line == "Shared by Maya · view only")
        #expect(!shared.canEdit && !shared.isOwned)
        let editor = JourneyAccess(role: .editor, owner: "")
        #expect(editor.line == "Shared with you · can edit")
        let own = M.journey()
        #expect(own.canEdit && own.isOwned)
    }

    @Test func displayNameFallsBackToTheEmailsNameCapitalized() throws {
        #expect(Preferences.displayName("Neel Satyavolu", email: "neel@example.com") == "Neel Satyavolu")
        #expect(Preferences.displayName("  ", email: "neel.s@example.com") == "Neel.s")
        var p = Preferences()
        p.displayName = "Maya"
        let json = String(decoding: try JSONEncoder().encode(p), as: UTF8.self)
        #expect(json.contains(#""displayName":"Maya""#))
        #expect(try JSONDecoder().decode(Preferences.self, from: Data("{}".utf8)).displayName == "")
    }
}
