import Foundation
import Testing
@testable import Lodestar

@Suite("Trips plan derivations")
struct TripsPlanTests {
    typealias M = TripsMake

    @Test func toBookSortsByDeadlineThenWhen() {
        let reserve = M.details { $0.reserve = true }
        let items = [
            M.item("late", day: "2026-11-23", details: reserve),
            M.item("byDeadline", day: "2026-11-24", details: M.details { $0.reserve = true; $0.bookBy = date("2026-11-10") }),
            M.item("notFlagged", day: "2026-11-21"),
            M.item("booked", status: .booked, day: "2026-11-21", details: reserve),
            M.item("eveningSameDay", day: "2026-11-21", time: "19:00", details: reserve),
            M.item("noonSameDay", day: "2026-11-21", time: "12:00", details: reserve),
        ]
        #expect(TripsPlan.toBook(items).map(\.id) == ["byDeadline", "noonSameDay", "eveningSameDay", "late"])
    }

    @Test func bookingsGroupInWebOrderAndDropEmptyGroups() {
        let items = [
            M.item("dinner", kind: .dining, status: .booked, day: "2026-11-21"),
            M.item("idea", kind: .dining, status: .suggested, day: "2026-11-21"),
            M.item("hotel", kind: .stay, status: .cancelled, day: "2026-11-20"),
            M.item("flight", kind: .flight, status: .booked, day: "2026-11-20", time: "08:00"),
        ]
        let groups = TripsPlan.bookings(items)
        #expect(groups.map(\.kind) == [.flight, .stay, .dining])
        #expect(groups.map(\.label) == ["Flights", "Stays", "Restaurants"])
        #expect(groups[2].items.map(\.id) == ["dinner"])
    }

    @Test func itineraryOrderPutsUntimedAfterTimedAndStayLast() {
        let items = [
            M.item("checkIn", kind: .stay, day: "2026-11-21"),
            M.item("untimed", day: "2026-11-21"),
            M.item("late", day: "2026-11-21", time: "21:00"),
            M.item("early", day: "2026-11-21", time: "09:00"),
            M.item("prevDay", day: "2026-11-20"),
        ]
        #expect(TripsPlan.byItinerary(items).map(\.id) == ["prevDay", "early", "late", "untimed", "checkIn"])
    }

    @Test func stableSortKeepsInputOrderForTies() {
        let items = (1...8).map { M.item("i\($0)", day: "2026-11-21") }
        #expect(TripsPlan.byItinerary(items).map(\.id) == items.map(\.id))
    }

    @Test func daysCoverTheTripPlusOutlyingItemsCappedAt60() {
        let days = TripsPlan.days(start: date("2026-11-20"), end: date("2026-11-22"), items: [M.item("a", day: "2026-11-25")])
        #expect(days.map(\.string) == ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-25"])
        #expect(TripsPlan.days(start: date("2026-01-01"), end: date("2026-12-31"), items: []).count == 60)
        #expect(TripsPlan.days(start: nil, end: nil, items: []).isEmpty)
    }

    @Test func defaultDayIsFirstOnOrAfterToday() {
        let days = [date("2026-11-20"), date("2026-11-21"), date("2026-11-22")]
        #expect(TripsPlan.defaultDay(days, today: date("2026-11-21")) == date("2026-11-21"))
        #expect(TripsPlan.defaultDay(days, today: date("2026-12-01")) == date("2026-11-20"))
    }

    @Test func needsLocationFollowsTheWebRules() {
        let now: EpochMillis = 1_800_000_000_000
        let day: EpochMillis = 86_400_000
        #expect(TripsPlan.needsLocation(M.item("a", day: "2026-11-21"), now: now))
        #expect(!TripsPlan.needsLocation(M.item("n", kind: .note, day: "2026-11-21"), now: now))
        #expect(!TripsPlan.needsLocation(M.item("c", status: .cancelled, day: "2026-11-21"), now: now))
        #expect(!TripsPlan.needsLocation(M.item("t", kind: .transport, day: "2026-11-21"), now: now))
        let failedRecently = M.details { $0.locateFailedAt = now - 2 * day }
        #expect(!TripsPlan.needsLocation(M.item("f", day: "2026-11-21", details: failedRecently), now: now))
        let stale = M.details { $0.placeId = "g:abc"; $0.lat = 1; $0.lng = 2; $0.locatedAt = now - 31 * day }
        #expect(TripsPlan.needsLocation(M.item("s", day: "2026-11-21", details: stale), now: now))
        let staleOSM = M.details { $0.placeId = "osm:n1"; $0.lat = 1; $0.lng = 2; $0.locatedAt = now - 31 * day }
        #expect(!TripsPlan.needsLocation(M.item("o", day: "2026-11-21", details: staleOSM), now: now))
    }

    @Test func searchCenterPrefersTheDayThenPlacesThenArrivalFlight() {
        let pin: (Double, Double) -> ItemDetails = { lat, lng in M.details { $0.lat = lat; $0.lng = lng } }
        let items = [
            M.item("museum", day: "2026-11-21", details: pin(10, 20)),
            M.item("cafe", day: "2026-11-21", details: pin(12, 22)),
            M.item("hotel", kind: .stay, day: "2026-11-20", end: "2026-11-23", details: pin(30, 40)),
            M.item("beach", day: "2026-11-22", details: pin(50, 60)),
        ]
        let onDay = TripsPlan.searchCenter(items, date: date("2026-11-21"))
        #expect(onDay == LatLng(lat: (10 + 12 + 30) / 3, lng: (20 + 22 + 40) / 3))
        let flightsOnly = [
            M.item("home", kind: .flight, day: "2026-11-24", details: pin(1, 1)),
            M.item("arrive", kind: .flight, day: "2026-11-20", details: pin(5, 5)),
        ]
        #expect(TripsPlan.searchCenter(flightsOnly, date: date("2026-11-21")) == LatLng(lat: 5, lng: 5))
        #expect(TripsPlan.searchCenter([], date: nil) == nil)
    }

    @Test func pinNumbersCountPerDayInItineraryOrder() {
        let pin = M.details { $0.lat = 1; $0.lng = 1 }
        let items = [
            M.item("b", day: "2026-11-21", time: "12:00", details: pin),
            M.item("a", day: "2026-11-21", time: "09:00", details: pin),
            M.item("unpinned", day: "2026-11-21", time: "10:00"),
            M.item("c", day: "2026-11-22", details: pin),
            M.item("x", status: .cancelled, day: "2026-11-22", details: pin),
        ]
        #expect(TripsPlan.pinNumbers(items) == ["a": 1, "b": 2, "c": 1])
        #expect(TripsPlan.dayColorIndex(items) == [date("2026-11-21"): 0, date("2026-11-22"): 1])
    }

    @Test func dayStopsKeepFlightsAndSkipNotesIdeasAndUnpinned() {
        let pin = M.details { $0.lat = 1; $0.lng = 1 }
        let items = [
            M.item("stop", day: "2026-11-21", time: "09:00", details: pin),
            M.item("flight", kind: .flight, day: "2026-11-21", time: "10:20", details: pin),
            M.item("idea", status: .suggested, day: "2026-11-21", details: pin),
            M.item("note", kind: .note, day: "2026-11-21", details: pin),
            M.item("loose", day: "2026-11-21"),
        ]
        #expect(TripsPlan.dayStops(items, date: date("2026-11-21")).map(\.id) == ["stop", "flight"])
    }

    @Test func dayStopsRunFromTheMorningHotelToTheNightHotel() {
        let pin = M.details { $0.lat = 1; $0.lng = 1 }
        let items = [
            M.item("night", kind: .stay, day: "2026-11-21", end: "2026-11-23", details: pin),
            M.item("morning", kind: .stay, day: "2026-11-19", end: "2026-11-21", details: pin),
            M.item("idea-hotel", kind: .stay, status: .suggested, day: "2026-11-20", end: "2026-11-22", details: pin),
            M.item("stop", day: "2026-11-21", time: "11:00", details: pin),
        ]
        #expect(TripsPlan.dayStops(items, date: date("2026-11-21")).map(\.id) == ["morning", "stop", "night"])
        #expect(TripsPlan.dayStops(items, date: date("2026-11-22")).isEmpty)
    }

    @Test func notesFollowAStopAtTheSameTime() {
        let items = [M.item("note", kind: .note, day: "2026-11-21", time: "17:15"), M.item("stop", day: "2026-11-21", time: "17:15")]
        #expect(TripsPlan.byItinerary(items).map(\.id) == ["stop", "note"])
    }

    @Test func placesToVisitAreUntimedOrSuggestedActivitiesAndDining() {
        let items = [
            M.item("idea", kind: .dining, status: .suggested, day: "2026-11-21", time: "19:00"),
            M.item("untimed", day: "2026-11-21"),
            M.item("timed", day: "2026-11-21", time: "10:00"),
            M.item("hotel", kind: .stay, status: .suggested, day: "2026-11-21"),
        ]
        #expect(Set(TripsPlan.placesToVisit(items).map(\.id)) == ["idea", "untimed"])
    }
}
