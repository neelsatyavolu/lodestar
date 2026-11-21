import Foundation
import Testing
@testable import Lodestar

/// Mirrors the `now stop` cases in `lib/journeys/plan.test.ts`.
@Suite("Itinerary opens on what's on now")
struct TripsNowStopTests {
    typealias M = TripsMake
    let day = "2027-05-02"

    var items: [TripItem] {
        [M.item("museum", day: day, time: "09:00", endTime: "11:00"),
         M.item("lunch", kind: .dining, day: day, time: "13:00"),
         M.item("walk", day: day),
         M.item("dinner", kind: .dining, day: day, time: "19:30")]
    }

    @Test func picksTheStopOnNow() {
        #expect(TripsPlan.nowStop(items, date: date(day), clock: "10:15") == "museum")
        // No end time: on for 90 minutes.
        #expect(TripsPlan.nowStop(items, date: date(day), clock: "14:00") == "lunch")
    }

    @Test func picksTheNextStopBetweenStops() {
        #expect(TripsPlan.nowStop(items, date: date(day), clock: "11:30") == "lunch")
        #expect(TripsPlan.nowStop(items, date: date(day), clock: "07:00") == "museum")
    }

    @Test func nilOnceTheDayIsOverOrOnAnotherDay() {
        #expect(TripsPlan.nowStop(items, date: date(day), clock: "23:00") == nil)
        #expect(TripsPlan.nowStop(items, date: date("2027-05-03"), clock: "10:00") == nil)
    }

    @Test func skipsSuggestionsCancellationsStaysAndNotes() {
        let skip = [M.item("idea", status: .suggested, day: day, time: "10:00"),
                    M.item("off", status: .cancelled, day: day, time: "10:00"),
                    M.item("hotel", kind: .stay, day: day, time: "10:00"),
                    M.item("tip", kind: .note, day: day, time: "10:00")]
        #expect(TripsPlan.nowStop(skip, date: date(day), clock: "10:30") == nil)
    }
}
