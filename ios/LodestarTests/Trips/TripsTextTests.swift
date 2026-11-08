import Foundation
import Testing
@testable import Lodestar

@Suite("Trips text helpers")
struct TripsTextTests {
    typealias M = TripsMake

    @Test func countdown() {
        let s = date("2026-11-20"), e = date("2026-11-27")
        #expect(TripsText.countdown(start: s, end: e, today: date("2026-11-08")) == "In 12 days")
        #expect(TripsText.countdown(start: s, end: e, today: date("2026-11-19")) == "Tomorrow")
        #expect(TripsText.countdown(start: s, end: e, today: date("2026-11-22")) == "Day 3 of 8")
        #expect(TripsText.countdown(start: s, end: e, today: date("2026-11-28")) == nil)
        #expect(TripsText.countdown(start: nil, end: nil, today: s) == nil)
        #expect(TripsText.isPast(start: s, end: e, today: date("2026-11-28")))
        #expect(!TripsText.isPast(start: nil, end: nil, today: s))
    }

    @Test func tallyCountsLiveItemsByKindInFirstSeenOrder() {
        let items = [
            M.item("f1", kind: .flight, day: "2026-11-20"), M.item("f2", kind: .flight, day: "2026-11-24"),
            M.item("h", kind: .stay, day: "2026-11-20"), M.item("d", kind: .dining, day: "2026-11-21"),
            M.item("x", kind: .dining, status: .cancelled, day: "2026-11-21"), M.item("n", kind: .note, day: "2026-11-21"),
        ]
        #expect(TripsText.tally(items) == "2 flights · 1 stay · 1 reservation")
        #expect(TripsText.tally([]) == "Nothing booked yet")
    }

    @Test func deadlineTones() {
        let today = date("2026-11-15")
        let past = TripsText.deadline(date("2026-11-14"), today: today)
        #expect(past?.text == "Was due Nov 14" && past?.tone == .danger)
        let now = TripsText.deadline(today, today: today)
        #expect(now?.text == "Book today" && now?.tone == .danger)
        let soon = TripsText.deadline(date("2026-11-20"), today: today)
        #expect(soon?.text == "Book by Nov 20" && soon?.tone == .warn)
        let later = TripsText.deadline(date("2026-12-20"), today: today)
        #expect(later?.text == "Book by Dec 20" && later?.tone == nil)
        #expect(TripsText.deadline(nil, today: today) == nil)
    }

    @Test func timeRange() {
        #expect(TripsText.timeRange(M.item("a", day: "2026-11-21")) == nil)
        #expect(TripsText.timeRange(M.item("a", day: "2026-11-21", time: "19:05")) == "7:05 PM")
        #expect(TripsText.timeRange(M.item("a", day: "2026-11-21", time: "19:00", endTime: "21:00")) == "7:00 PM – 9:00 PM")
        #expect(TripsText.timeRange(M.item("a", day: "2026-11-21", time: "22:00", end: "2026-11-22", endTime: "01:00")) == "10:00 PM – 1:00 AM +1")
        #expect(TripsText.timeRange(M.item("a", day: "2026-11-21", time: "19:00", end: "2026-11-24", endTime: "09:00")) == "7:00 PM – Tue, Nov 24, 9:00 AM")
        #expect(TripsText.timeRange(M.item("s", kind: .stay, day: "2026-11-21", time: "15:00", end: "2026-11-24", endTime: "11:00")) == "3:00 PM")
    }

    @Test func bookingWhen() {
        #expect(TripsText.bookingWhen(M.item("s", kind: .stay, day: "2026-11-21", end: "2026-11-24")) == "Nov 21 – Nov 24")
        #expect(TripsText.bookingWhen(M.item("car", kind: .transport, day: "2026-11-21", time: "09:00", end: "2026-11-24", endTime: "17:00"))
            == "Sat, Nov 21 9:00 AM → Tue, Nov 24 5:00 PM")
        #expect(TripsText.bookingWhen(M.item("d", kind: .dining, day: "2026-11-21", time: "19:00")) == "Sat, Nov 21 · 7:00 PM")
    }

    @Test func statusPills() {
        let today = date("2026-11-15")
        #expect(TripsText.statusPill(M.item("a", status: .booked, day: "2026-11-21"), today: today)?.text == "Booked")
        #expect(TripsText.statusPill(M.item("a", status: .suggested, day: "2026-11-21"), today: today)?.dot == .accent)
        #expect(TripsText.statusPill(M.item("a", day: "2026-11-21"), today: today) == nil)
        let due = M.item("a", day: "2026-11-21", details: M.details { $0.reserve = true; $0.bookBy = date("2026-11-15") })
        #expect(TripsText.statusPill(due, today: today) == .init(text: "To book · by Nov 15", dot: .danger))
        #expect(TripsText.statusWord(due) == "To book")
    }

    @Test func driveTotalAndRentalCars() {
        #expect(TripsText.driveTotal(seconds: 20) == "1 min")
        #expect(TripsText.driveTotal(seconds: 36 * 60) == "36 min")
        #expect(TripsText.driveTotal(seconds: 65 * 60) == "1 hr 5 min")
        #expect(TripsText.driveTotal(seconds: 120 * 60) == "2 hr")
        #expect(TripsText.isRentalCar(M.item("Hertz pickup", kind: .transport, day: "2026-11-21")))
        #expect(!TripsText.isRentalCar(M.item("Train to Sintra", kind: .transport, day: "2026-11-21")))
        #expect(!TripsText.isRentalCar(M.item("Car museum", kind: .activity, day: "2026-11-21")))
    }

    @Test func travellersAndRoute() {
        #expect(TripsText.travellers(1) == "1 traveller")
        #expect(TripsText.travellers(3) == "3 travellers")
        #expect(TripsText.travellers(nil) == nil)
        let flight = M.item("f", kind: .flight, day: "2026-11-21", details: M.details { $0.from = "SFO"; $0.to = "NRT" })
        #expect(TripsText.route(flight) == "SFO → NRT")
    }
}
