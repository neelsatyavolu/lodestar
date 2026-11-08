import Foundation
import Testing
@testable import Lodestar

@Suite("Stays form")
struct StaysFormTests {
    let today = StaysFeatureFixtures.today

    @Test func defaultsAreThreeNightsThreeWeeksOutForTwo() {
        let form = StaysForm.initial(today: today)
        #expect(form.city == "")
        #expect(form.checkin == date("2026-11-28"))
        #expect(form.checkout == date("2026-12-01"))
        #expect(form.nights == 3)
        #expect(form.adults == 2)
    }

    @Test func movingCheckinKeepsTheLengthOfStay() {
        let form = StaysForm.initial(today: today).with(checkin: date("2026-12-30"))
        #expect(form.checkin == date("2026-12-30"))
        #expect(form.checkout == date("2027-01-02"))
    }

    @Test func movingCheckinWithNoValidLengthKeepsCheckout() {
        let broken = StaysForm(city: "Lisbon", checkin: date("2026-12-05"), checkout: date("2026-12-05"), adults: 2)
        let form = broken.with(checkin: date("2026-12-01"))
        #expect(form.checkout == date("2026-12-05"))
        #expect(form.nights == 4)
    }

    @Test func changesReturnNewFormsAndLeaveTheOriginal() {
        let original = StaysForm.initial(today: today)
        let changed = original.with(city: "Porto").with(adults: 4)
        #expect(original.city == "")
        #expect(original.adults == 2)
        #expect(changed.city == "Porto")
        #expect(changed.adults == 4)
    }

    @Test func cityIsCappedAndAdultsClamped() {
        let form = StaysForm.initial(today: today).with(city: String(repeating: "a", count: 120))
        #expect(form.city.count == 80)
        #expect(form.with(adults: 0).adults == 1)
        #expect(form.with(adults: 12).adults == 8)
    }

    @Test(arguments: [
        ("Lisbon", "2026-11-26", "2026-11-29", true),
        ("L", "2026-11-26", "2026-11-29", false),
        ("  L  ", "2026-11-26", "2026-11-29", false),
        ("Lisbon", "2026-11-06", "2026-11-09", false),
        ("Lisbon", "2026-11-07", "2026-11-08", true),
        ("Lisbon", "2026-11-26", "2026-11-26", false),
        ("Lisbon", "2026-11-26", "2026-12-26", true),
        ("Lisbon", "2026-11-26", "2026-12-27", false),
    ])
    func readiness(city: String, checkin: String, checkout: String, ready: Bool) {
        let form = StaysForm(city: city, checkin: date(checkin), checkout: date(checkout), adults: 2)
        #expect(form.isReady(today: today) == ready)
    }

    @Test func lengthErrorOnlyPastThirtyNights() {
        let thirty = StaysForm(city: "Lisbon", checkin: date("2026-11-26"), checkout: date("2026-12-26"), adults: 2)
        #expect(thirty.lengthError == nil)
        #expect(thirty.with(checkout: date("2026-12-27")).lengthError == "Stays are up to 30 nights.")
    }

    @Test func queryTrimsTheCityAndEncodesTheWireBody() throws {
        let form = StaysForm(city: "  Lisbon ", checkin: date("2026-11-26"), checkout: date("2026-11-29"), adults: 3)
        let body = try jsonObject(form.query)
        #expect(body["city"] as? String == "Lisbon")
        #expect(body["checkin"] as? String == "2026-11-26")
        #expect(body["checkout"] as? String == "2026-11-29")
        #expect(body["adults"] as? Int == 3)
        #expect(body.count == 4)
    }

    @Test func pricesBodyReusesTheSearchDatesAndGuests() throws {
        let body = try jsonObject(StaysFeatureFixtures.query.prices(for: "ChkI0tW3kLqR1qQB"))
        #expect(body["key"] as? String == "ChkI0tW3kLqR1qQB")
        #expect(body["checkin"] as? String == "2026-11-26")
        #expect(body["checkout"] as? String == "2026-11-29")
        #expect(body["adults"] as? Int == 2)
        #expect(body["city"] == nil)
    }

    @Test func flexSavingMovesBothDates() throws {
        let saving = try #require(try StaysFeatureFixtures.flex().savings.values.first)
        let form = StaysForm(query: StaysFeatureFixtures.query).with(dates: saving)
        #expect(form.checkin == date("2026-11-25"))
        #expect(form.checkout == date("2026-11-28"))
        #expect(form.city == "Lisbon")
    }
}
