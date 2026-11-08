import Foundation
import Testing
@testable import Lodestar

enum TripFixtures {
    static let item = #"""
    {"id":"6f1c9a52-1d1b-4a0e-9a57-2f5f6b1e9c01","journeyId":"0b8e5f7c-3c1f-4a39-8f3a-9d6b2b7e4a10","kind":"dining","status":"planned",
     "title":"Dinner at Cervejaria Ramiro","startDate":"2026-11-21","startTime":"19:30","endDate":null,"endTime":null,
     "place":"Lisbon","confirmation":null,
     "details":{"cuisine":"Seafood","priceLevel":"$$","reserve":true,"bookBy":"2026-11-14","estimate":80,"meal":"dinner",
       "placeId":"g:ChIJabc123def456","lat":38.72,"lng":-9.13,"locatedAt":1762500000000},
     "source":"ai","dedupeKey":null,"updatedAt":1762500000000}
    """#

    static let journey = #"""
    "id":"0b8e5f7c-3c1f-4a39-8f3a-9d6b2b7e4a10","title":"Lisbon, Nov 2026","destination":"Lisbon",
    "startDate":"2026-11-20","endDate":"2026-11-24","travelers":2,"tripType":"city","shareToken":null,"source":"manual","createdAt":1762400000000
    """#

    static let detail = #"""
    {\#(journey),"items":[\#(item)],
     "tasks":[{"id":"t1","journeyId":"0b8e5f7c-3c1f-4a39-8f3a-9d6b2b7e4a10","title":"Check passports","done":false,"due":null,"section":"Before you go","position":0,"source":"manual"}],
     "notes":[{"id":"n1","journeyId":"0b8e5f7c-3c1f-4a39-8f3a-9d6b2b7e4a10","title":"Getting around","body":"Viva Viagem card.","position":0,"source":"ai"}],
     "costs":[{"id":"c1","journeyId":"0b8e5f7c-3c1f-4a39-8f3a-9d6b2b7e4a10","label":"Tram rides","amount":24.5,"currency":"EUR","category":"transport","paid":false,"source":"ai"}]}
    """#
}

@Suite("Trips organizer models")
struct JourneyModelTests {
    @Test func decodesList() throws {
        let list = try decodeEnvelope(#"""
        {"journeys":[{\#(TripFixtures.journey),"items":[\#(TripFixtures.item)]}],
         "unfiled":[],
         "mail":[{"id":"m1","sender":"tap@flytap.com","subject":"Your booking","state":"needs_ai","error":null,"receivedAt":1762500000000}]}
        """#, as: JourneyList.self)
        let first = try #require(list.journeys.first)
        #expect(first.journey.tripType == .city)
        #expect(first.journey.startDate == date("2026-11-20"))
        #expect(first.items.count == 1)
        #expect(list.mail[0].state == .needsAI)
    }

    @Test func decodesTripDetailAndItemDetails() throws {
        let detail = try decodeEnvelope(#"{"journey":\#(TripFixtures.detail)}"#, as: JourneyResponse.self).journey
        #expect(detail.id == "0b8e5f7c-3c1f-4a39-8f3a-9d6b2b7e4a10")
        #expect(detail.tasks[0].section == "Before you go")
        #expect(detail.notes[0].source == .ai)
        #expect(detail.costs[0].category == .transport)
        let item = try #require(detail.items.first)
        #expect(item.kind == .dining && item.status == .planned && item.isLive)
        #expect(item.startTime == "19:30")
        #expect(item.details.reserve == true)
        #expect(item.details.bookBy == date("2026-11-14"))
        #expect(item.details.meal == .dinner)
        #expect(item.details.isGooglePlace && item.details.isPinned)
        #expect(item.details.currencyCode == "USD")
    }

    @Test func unknownEnumsDoNotBreakDecoding() throws {
        let json = TripFixtures.item.replacingOccurrences(of: #""kind":"dining""#, with: #""kind":"cruise""#)
            .replacingOccurrences(of: #""source":"ai""#, with: #""source":"robot""#)
        let item = try JSONCoding.decoder.decode(TripItem.self, from: Data(json.utf8))
        #expect(item.kind == .unknown)
        #expect(item.source == .unknown)
    }

    @Test func childResponses() throws {
        let created = try decodeEnvelope(#"{"id":"abc"}"#, as: CreatedID.self)
        #expect(created.id == "abc")
        let generate = try decodeEnvelope(#"{"journey":\#(TripFixtures.detail),"added":7}"#, as: GenerateResponse.self)
        #expect(generate.added == 7)
        let share = try decodeEnvelope(#"{"url":"https://lodestar.xanom.co/t/AbCdEfGhIjKlMnOpQrStUvWxYz012345"}"#, as: ShareResponse.self)
        #expect(share.token == "AbCdEfGhIjKlMnOpQrStUvWxYz012345")
        #expect(try decodeEnvelope(#"{"url":null}"#, as: ShareResponse.self).token == nil)
        let legs = try decodeEnvelope(#"{"legs":[{"from":"a","to":"b","leg":{"seconds":2160,"meters":38141}},{"from":"b","to":"c","leg":null}]}"#, as: LegsResponse.self)
        #expect(legs.legs[1].leg == nil)
        let locate = try decodeEnvelope(#"{"journey":null,"located":0,"settled":0,"remaining":3}"#, as: LocateResponse.self)
        #expect(locate.remaining == 3)
        let read = try decodeEnvelope(#"{"read":3,"filed":2,"error":null}"#, as: ReadMailResponse.self)
        #expect(read.filed == 2)
        let wander = try decodeEnvelope(#"{"trips":[{"key":"abcd1234","title":"Japan","startDate":"2027-03-01","endDate":null,"places":12}]}"#, as: WanderlogTripList.self)
        #expect(wander.trips[0].places == 12)
    }

    @Test func patchesOmitOrNullFields() throws {
        let unfile = try jsonObject(ItemPatch(journeyId: .some(nil)))
        #expect(unfile.count == 1 && unfile["journeyId"] is NSNull)

        let noBooking = try jsonObject(ItemPatch(facts: ItemFacts(reserve: .some(nil), bookBy: .some(nil))))
        let facts = try #require(noBooking["facts"] as? [String: Any])
        #expect(facts.count == 2 && facts["reserve"] is NSNull && facts["bookBy"] is NSNull)

        let booked = try jsonObject(ItemPatch(status: .booked, confirmation: .some("ABC123"),
                                              facts: ItemFacts(estimate: .some(nil), price: .some(120))))
        #expect(booked["status"] as? String == "booked")
        #expect(booked["confirmation"] as? String == "ABC123")
        #expect((booked["facts"] as? [String: Any])?["price"] as? Double == 120)

        let journey = try jsonObject(JourneyPatch(title: "Lisbon", travelers: .some(nil)))
        #expect(journey.count == 2 && journey["travelers"] is NSNull)

        let task = try jsonObject(TaskPatch(done: true))
        #expect(task.count == 1)
    }

    @Test func createBodies() throws {
        let journey = try jsonObject(NewJourney(destination: "Lisbon", startDate: date("2026-11-20")))
        #expect(journey["endDate"] as? String == "2026-11-20")
        #expect(journey["travelers"] as? Int == 2)
        #expect(journey["title"] == nil)

        var details = ItemDetails()
        details.placeId = "osm:N123"
        details.lat = 38.7
        let item = try jsonObject(NewItem(kind: .activity, title: "Castle", startDate: date("2026-11-21"), details: details))
        let sent = try #require(item["details"] as? [String: Any])
        #expect(sent.count == 2)
        #expect(item["status"] as? String == "planned")
        #expect(item["startTime"] is NSNull)

        #expect(try jsonObject(GenerateRequest(provider: .grok, part: .toBook))["part"] as? String == "to_book")
        #expect(try jsonObject(NewTask(title: "Pack"))["section"] as? String == "Before you go")
        #expect(try jsonObject(NewCost(label: "Gas", amount: 40))["category"] as? String == "other")
    }
}

@Suite("Saved trips, places, connectors and agents")
struct SavedTripModelTests {
    @Test func decodesSavedTrips() throws {
        let list = try decodeEnvelope(#"""
        {"trips":[{"id":"9a7e","title":"SFO → MAA · Dec 7 – Dec 20","prompt":"Chennai over the holidays","savedPrice":1240,
          "lastPrice":1180,"checkedAt":1762500000000,"alertDrop":true,"targetPrice":null,"targetHit":false,"remindOn":"2026-11-30",
          "reminded":false,"firstDepart":"2026-12-07","createdAt":1762400000000,
          "booking":{"tfs":"CBwQAhooEgoyMDI2LTEy","seller":"Air India","isAirline":true,"fare":"Economy Comfort","paid":1195,"changes":"fee","refunds":null}}]}
        """#, as: SavedTripList.self)
        let trip = try #require(list.trips.first)
        #expect(trip.remindOn == date("2026-11-30"))
        #expect(trip.booking?.changes == .fee)
        #expect(trip.booking?.refunds == nil)
    }

    @Test func snapshotSkipsBrokenOptions() throws {
        let json = #"""
        {"snapshot":{"prompt":"Bay Area to NYC","plan":\#(PlanFixtures.plan),
          "canvas":{"headline":"Fly Saturday","summary":"","picks":[],"tips":[],"followups":[]},
          "options":{"S1-1":{"itinerary":\#(SearchFixtures.itinerary),"search":0},"S1-2":{"itinerary":{"id":"x"},"search":0}},
          "hacks":[],"searches":[{"state":"done","count":40,"cheapest":389},{"state":"error","error":"Timed out."}]}}
        """#
        let snapshot = try decodeEnvelope(json, as: SnapshotResponse.self).snapshot
        #expect(snapshot.options.keys.sorted() == ["S1-1"])
        #expect(snapshot.searches[1].state == .error)
        #expect(snapshot.plan.searches.count == 1)
    }

    @Test func savedTripPatchAndBooking() throws {
        let patch = SavedTripPatch(targetPrice: .some(nil))
        #expect(!patch.isEmpty)
        #expect(try jsonObject(patch)["targetPrice"] is NSNull)
        #expect(SavedTripPatch().isEmpty)
        let booking = try jsonObject(FareBooking(tfs: "CBwQAhooEgoyMDI2LTEy", seller: "Expedia", isAirline: false, fare: nil,
                                                 paid: 1200, changes: .unknown, refunds: .full))
        #expect(booking["changes"] is NSNull)
        #expect(booking["refunds"] as? String == "full")
        #expect(booking["fare"] is NSNull)
    }

    @Test func decodesPlaces() throws {
        let search = try decodeEnvelope(#"""
        {"suggestions":[{"id":"g:ChIJabc123def456","name":"Time Out Market","secondary":"Lisbon, Portugal","category":"Food court","kind":"dining","location":null,"address":null},
          {"id":"osm:N12345","name":"Belém Tower","secondary":"Lisbon","category":null,"kind":"activity","location":{"lat":38.69,"lng":-9.21},"address":"Av. Brasília"}],
         "provider":"google"}
        """#, as: PlaceSearchResult.self)
        #expect(search.suggestions[0].isGoogle)
        #expect(search.suggestions[1].location?.lng == -9.21)
        let details = try decodeEnvelope(#"""
        {"place":{"id":"g:ChIJabc123def456","name":"Time Out Market","address":"Av. 24 de Julho 49","location":{"lat":38.70,"lng":-9.14},
          "category":"Food court","kind":"dining","rating":4.5,"ratingCount":51234,"priceLevel":"$$","phone":"+351 21 060 7403",
          "website":"https://www.timeoutmarket.com","mapsUrl":"https://maps.google.com/?cid=1","openNow":true,
          "hours":["Monday: 10:00 AM – 12:00 AM"],"summary":null,"photos":["places/ChIJabc/photos/AbC"]}}
        """#, as: PlaceDetailsResponse.self)
        #expect(details.place.ratingCount == 51234)
        #expect(details.place.photos.count == 1)
    }

    @Test func decodesConnectorsAndAgents() throws {
        let connectors = try decodeEnvelope(#"""
        {"address":"k2j3h4g5f6d7s8a9q0w1e2r3@in.lodestar.xanom.co",
         "flint":[{"id":"f1","deviceName":"Neel's MacBook","createdAt":1762400000000,"lastDeliveryAt":null}]}
        """#, as: ConnectorsState.self)
        #expect(connectors.flint[0].lastDeliveryAt == nil)
        let code = try decodeEnvelope(#"{"code":"ABCD-EFGH","expiresAt":1762500600000}"#, as: FlintPairingCode.self)
        #expect(code.code == "ABCD-EFGH")
        let agents = try decodeEnvelope(#"""
        {"mcpUrl":"https://lodestar.xanom.co/api/mcp","grants":[{"id":"g1","kind":"personal","clientId":null,"name":"Codex on my laptop","createdAt":1762400000000,"lastUsedAt":null}]}
        """#, as: AgentsState.self)
        #expect(agents.grants[0].kind == .personal)
        let token = try decodeEnvelope(#"{"grant":{"id":"g2","kind":"oauth","clientId":"c","name":"Claude","createdAt":1,"lastUsedAt":2},"token":"lsp_abc"}"#,
                                       as: AgentTokenCreated.self)
        #expect(token.token.hasPrefix("lsp_"))
    }
}
