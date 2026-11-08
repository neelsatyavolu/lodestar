import Foundation
import Testing
@testable import Lodestar

@Suite("Trips forms and request bodies")
struct TripsFormsTests {
    @Test func tripFormValidation() {
        var form = TripsTripForm()
        #expect(form.validate(requireDestination: true) == "Use a place name, like Lisbon.")
        form.destination = "Lisbon; DROP"
        #expect(form.validate(requireDestination: true) == "Use a place name, like Lisbon.")
        form.destination = "São Paulo (Centro)"
        #expect(form.validate(requireDestination: true) == nil)
        form.startDate = date("2026-11-20")
        form.endDate = date("2026-11-19")
        #expect(form.validate(requireDestination: true) == "The trip ends before it starts.")
        form.endDate = nil
        form.travelers = 0
        #expect(form.validate(requireDestination: true) == "At least one traveller.")
        var edit = TripsTripForm()
        #expect(edit.validate(requireDestination: false) == nil)
        edit.wishes = String(repeating: "a", count: 601)
        #expect(edit.validate(requireDestination: false) != nil)
    }

    @Test func createBodyMatchesTheWeb() throws {
        var form = TripsTripForm()
        form.destination = " Lisbon "
        form.startDate = date("2026-11-20")
        let body = try jsonObject(form.newJourney)
        #expect(body["destination"] as? String == "Lisbon")
        #expect(body["startDate"] as? String == "2026-11-20")
        #expect(body["endDate"] as? String == "2026-11-20")
        #expect(body["travelers"] as? Int == 2)
        #expect(body["tripType"] is NSNull)
        #expect(body["title"] == nil)
        #expect(form.wantsDraft)
        form.startDate = nil
        #expect(!form.wantsDraft)
    }

    @Test func editSendsAllSixFields() throws {
        let journey = TripsMake.journey()
        var form = TripsTripForm(editing: journey)
        form.title = ""
        form.destination = ""
        form.endDate = nil
        let body = try jsonObject(form.patch(current: journey))
        #expect(body.keys.sorted() == ["destination", "endDate", "startDate", "title", "travelers", "tripType"])
        #expect(body["title"] as? String == "Lisbon, Nov 2026")
        #expect(body["destination"] is NSNull)
        #expect(body["endDate"] as? String == "2026-11-20")
        #expect(body["tripType"] as? String == "city")
    }

    @Test func addItemForm() throws {
        var form = TripsAddItemForm(choice: .dining, day: date("2026-11-21"))
        #expect(form.validate() == "Give it a name.")
        form.title = "Dinner at Ramiro"
        form.hasTime = true
        form.time = "19:30"
        form.confirmation = " ABC123 "
        let body = try jsonObject(form.newItem)
        #expect(body["kind"] as? String == "dining")
        #expect(body["status"] as? String == "booked")
        #expect(body["startTime"] as? String == "19:30")
        #expect(body["confirmation"] as? String == "ABC123")
        #expect(body["place"] is NSNull)
        #expect((body["details"] as? [String: Any])?.isEmpty == true)

        let stay = TripsAddItemForm(choice: .stay, day: date("2026-11-21"))
        #expect(stay.endDate == date("2026-11-22"))
        #expect(TripsAddItemForm(choice: .rentalCar, day: date("2026-11-21")).newItem.kind == .transport)
        var backwards = TripsAddItemForm(choice: .stay, day: date("2026-11-21"))
        backwards.title = "Hotel"
        backwards.endDate = date("2026-11-20")
        #expect(backwards.validate() == "It ends before it starts.")
    }

    @Test func placeItemFromAPickedSuggestion() throws {
        let s = PlaceSuggestion(id: "osm:n123", name: "Time Out Market", secondary: "Lisbon, Portugal", category: "Food hall",
                                kind: .dining, location: LatLng(lat: 38.7, lng: -9.1), address: "Av. 24 de Julho")
        let item = TripsRequests.placeItem(s, details: nil, day: date("2026-11-21"), now: Date(timeIntervalSince1970: 1_800_000_000))
        let body = try jsonObject(item)
        #expect(body["kind"] as? String == "dining")
        #expect(body["place"] as? String == "Lisbon")
        #expect(body["endDate"] is NSNull)
        let details = try #require(body["details"] as? [String: Any])
        #expect(details.keys.sorted() == ["address", "lat", "lng", "locatedAt", "placeId"])
        #expect(details["locatedAt"] as? Int64 == 1_800_000_000_000)

        let googleStay = PlaceSuggestion(id: "g:ChIJabcdefghij", name: "Memmo", secondary: "", category: nil, kind: .stay, location: nil, address: nil)
        let stay = try jsonObject(TripsRequests.placeItem(googleStay, details: nil, day: date("2026-11-21")))
        #expect(stay["endDate"] as? String == "2026-11-22")
        #expect((stay["details"] as? [String: Any])?.keys.sorted() == ["placeId"])
        #expect(stay["place"] is NSNull)
    }

    @Test func itemPatchBodiesMatchTheContract() throws {
        let keep = try jsonObject(TripsRequests.status(.planned))
        #expect(keep.keys.sorted() == ["status"] && keep["status"] as? String == "planned")
        let needs = try jsonObject(TripsRequests.needsBooking)
        #expect((needs["facts"] as? [String: Any])?["reserve"] as? Bool == true)
        let doesnt = try #require(try jsonObject(TripsRequests.doesNotNeedBooking)["facts"] as? [String: Any])
        #expect(doesnt.keys.sorted() == ["bookBy", "reserve"] && doesnt["reserve"] is NSNull && doesnt["bookBy"] is NSNull)
        #expect(try jsonObject(TripsRequests.time(nil))["startTime"] is NSNull)
        #expect(try jsonObject(TripsRequests.note("  "))["note"] is NSNull)
        #expect(try jsonObject(TripsRequests.move(to: "j2"))["journeyId"] as? String == "j2")
        #expect(try jsonObject(TripsRequests.bookBy(date("2026-11-18"))).keys.sorted() == ["facts"])
    }

    @Test func markBookedDialog() throws {
        let plain = try TripsRequests.markBooked(confirmation: "", paid: "").get()
        let body = try jsonObject(plain)
        #expect(body["status"] as? String == "booked")
        #expect(body["confirmation"] is NSNull)
        #expect((body["facts"] as? [String: Any])?.isEmpty == true)

        let priced = try jsonObject(try TripsRequests.markBooked(confirmation: "X1", paid: "$120").get())
        let facts = try #require(priced["facts"] as? [String: Any])
        #expect(facts["price"] as? Double == 120 && facts["estimate"] is NSNull)
        #expect(throws: TripsProblem.self) { try TripsRequests.markBooked(confirmation: "", paid: "lots").get() }
    }

    @Test func childFormsValidate() throws {
        #expect(throws: TripsProblem(message: "Say what to do.")) { try TripsRequests.task(title: " ", section: "").get() }
        #expect(try TripsRequests.task(title: "Pack", section: "").get().section == "Before you go")
        #expect(throws: TripsProblem(message: "Say what it's for.")) { try TripsRequests.cost(label: "", amount: "4", category: .other, currency: "USD").get() }
        let cost = try TripsRequests.cost(label: "Gas", amount: "40.5", category: .transport, currency: "EUR").get()
        #expect(cost.amount == 40.5 && cost.currency == "EUR" && !cost.paid)
        #expect(throws: TripsProblem(message: "Give the note a title.")) { try TripsRequests.note(title: "", body: "x").get() }
    }
}
