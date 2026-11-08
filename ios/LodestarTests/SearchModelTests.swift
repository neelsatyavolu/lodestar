import Foundation
import Testing
@testable import Lodestar

enum SearchFixtures {
    static let itinerary = #"""
    {"id":"a1b2c3d4e5f6","price":412.0,"currency":"USD","booking_url":"https://www.google.com/travel/flights/booking?tfs=CBwQ",
     "tfs":"CBwQAhooEgoyMDI2LTExLTI2agcIARIDU0ZPcgcIARIDSkZL",
     "slices":[{"minutes":330,"stops":1,"self_transfer":false,"co2_kg":312,"co2_delta_pct":-8,
       "legs":[
         {"from":"SFO","from_name":"San Francisco International Airport","to":"DEN","to_name":"Denver International Airport",
          "depart":"2026-11-26T08:15:00","arrive":"2026-11-26T11:40:00","minutes":145,
          "airline":{"code":"UA","name":"United Airlines"},"operating":null,"flight_number":"1234",
          "aircraft":"Boeing 737","legroom":"31 in","overnight":false,
          "amenities":{"wifi":true,"usb_power":true,"legroom_inches":31,"brand_new_key":"x"}},
         {"from":"DEN","from_name":null,"to":"JFK","to_name":"John F. Kennedy International Airport",
          "depart":"2026-11-26T12:45:00.123000","arrive":"2026-11-26T18:45:00","minutes":180,
          "airline":{"code":"UA","name":"United Airlines"},"operating":{"code":"OO","name":"SkyWest"},"flight_number":"88",
          "aircraft":null,"legroom":null,"overnight":false,"amenities":null}],
       "layovers":[{"airport":"DEN","city":"Denver","minutes":65,"overnight":false,"change_of_airport":false}]}]}
    """#

    static let searchResult = #"""
    {"airports":{"from":["SFO"],"to":["JFK","EWR","LGA"],"nearbyFrom":["OAK"],"nearbyTo":[]},
     "baseline":440,
     "itineraries":[\#(itinerary)],
     "labels":{"best":"a1b2c3d4e5f6","cheapest":"a1b2c3d4e5f6"},
     "hacks":[
       {"kind":"nearby","title":"Fly from Oakland","detail":"OAK is $28 less.","saving":28,"price":412,"itineraryIds":["a1b2c3d4e5f6"]},
       {"kind":"length","title":"Come back a day later","detail":"Saves $40.","saving":40,"price":400,"itineraryIds":[],"apply":{"return":"2026-12-01"}},
       {"kind":"throwaway","title":"Book the round trip","detail":"Cheaper than one-way.","saving":60,"price":380,"itineraryIds":[],"apply":{"return":null},"caution":"Skip the return leg."},
       {"kind":"teleport","title":"New thing","detail":"","saving":0,"price":1,"itineraryIds":[]}],
     "calendar":[],
     "oneWays":null,
     "warnings":["One-way return: The fare search took too long. Try again."]}
    """#
}

@Suite("Flight search models")
struct SearchModelTests {
    @Test func decodesSearchResult() throws {
        let result = try decodeEnvelope(SearchFixtures.searchResult, as: SearchResult.self)
        #expect(result.airports.to == ["JFK", "EWR", "LGA"])
        #expect(result.baseline == 440)
        #expect(result.labels.fastest == nil)
        #expect(result.oneWays == nil)

        let it = try #require(result.itineraries.first)
        #expect(it.bookingURL.hasPrefix("https://www.google.com/travel/flights"))
        #expect(it.slices[0].legs[1].depart == "2026-11-26T12:45:00.123000")
        #expect(it.slices[0].legs[1].isOperatedByOther)
        #expect(it.slices[0].legs[0].amenities?.hasPower == true)
        #expect(it.slices[0].legs[0].amenities?.legroomInches == 31)
        #expect(it.slices[0].layovers[0].needsCaution == false)
        #expect(it.airlines.map(\.code) == ["UA"])
        #expect(it.airlines[0].displayName == "United")
        #expect(it.slices[0].legs[0].flightCode == "UA 1234")
    }

    @Test func hackKindsAndApplyTriState() throws {
        let hacks = try decodeEnvelope(SearchFixtures.searchResult, as: SearchResult.self).hacks
        #expect(hacks.map(\.kind) == [.nearby, .length, .throwaway, .unknown])
        #expect(hacks[0].apply == nil)

        let base = SearchQuery(from: ["SFO"], to: ["JFK"], depart: date("2026-11-26"), returnDate: date("2026-11-30"))
        let later = try #require(hacks[1].apply)
        #expect(later.returnDate == .some(date("2026-12-01")))
        #expect(later.applied(to: base).returnDate == date("2026-12-01"))

        let oneWayBase = SearchQuery(from: ["SFO"], to: ["JFK"], depart: date("2026-11-26"))
        let roundTrip = try #require(hacks[2].apply)
        #expect(roundTrip.returnDate == .some(nil))
        #expect(roundTrip.applied(to: base).returnDate == nil)
        #expect(roundTrip.applied(to: oneWayBase).depart == date("2026-11-26"))
        #expect(hacks[2].caution == "Skip the return leg.")
    }

    @Test func hackApplyEncodesNullReturnButOmitsAbsent() throws {
        let withNull = try jsonObject(HackApply(returnDate: .some(nil)))
        #expect(withNull.keys.contains("return"))
        #expect(withNull["return"] is NSNull)
        let absent = try jsonObject(HackApply(depart: date("2026-11-25")))
        #expect(!absent.keys.contains("return"))
        #expect(absent["depart"] as? String == "2026-11-25")
    }

    @Test func searchQueryEncodesReturnKeyAndPreferences() throws {
        var prefs = Preferences.default
        prefs.alliances = [.oneworld]
        prefs.avoidedAirlines = ["NK"]
        prefs.preferredAirlines = ["AS"]
        prefs.avoidRedEyes = true
        let query = SearchQuery(from: ["SFO"], to: ["NYC"], depart: date("2026-11-26")).applying(prefs)
        let json = try jsonObject(query)
        #expect(json["return"] is NSNull)
        #expect(json["depart"] as? String == "2026-11-26")
        #expect(json["alliances"] as? [String] == ["ONEWORLD"])
        #expect(json["avoidAirlines"] as? [String] == ["NK"])
        #expect(json["preferAirlines"] as? [String] == ["AS"])
        #expect(json["avoidRedEyes"] as? Bool == true)
        #expect(json["stops"] as? String == "ANY")
        #expect(json["avoidSelfTransfer"] as? Bool == true)
    }

    @Test func calendarBodyAddsWindow() throws {
        let query = SearchQuery(from: ["SFO"], to: ["JFK"], depart: date("2026-11-26"))
        let body = CalendarQuery(query: query, window: .init(start: date("2026-11-01"), end: date("2026-12-31")))
        let json = try jsonObject(body)
        #expect(json["from"] as? [String] == ["SFO"])
        #expect((json["window"] as? [String: String])?["end"] == "2026-12-31")
    }

    @Test func decodesSellerCheck() throws {
        let json = #"""
        {"sellers":[
          {"name":"United","is_airline":true,"lowest":412,"tier":"airline","logo":"/api/logo/airline/UA",
           "fares":[{"name":"Basic Economy","price":412,"features":["Personal item only"],
             "policy":{"carry_on":false,"checked_bag_fee":40,"checked_bag_included":false,"changes":"none","refunds":"none","seat_selection":"fee"}},
            {"name":null,"price":462,"features":[],
             "policy":{"carry_on":true,"checked_bag_fee":null,"checked_bag_included":null,"changes":"free","refunds":"sometimes","seat_selection":null}}]},
          {"name":"FlyCheap","is_airline":false,"lowest":398,"tier":"unvetted","logo":"/api/logo/site/_?name=FlyCheap","fares":[]}],
         "insight":{"level":"low","typical_low":430,"typical_high":610,"unlikely_to_drop_below":null,"cheaper_than_usual_by":30,"summary":null},
         "bookingUrl":"https://www.google.com/travel/flights/booking?tfs=x",
         "lowestAny":398,"lowestTrusted":412,"trustedSeller":"United","unvettedGap":14}
        """#
        let check = try decodeEnvelope(json, as: SellerCheck.self)
        #expect(check.sellers[0].tier == .airline)
        #expect(check.sellers[0].isAirline)
        #expect(check.sellers[0].fares[0].policy.changes == ChangePolicy.none)
        #expect(check.sellers[0].fares[1].displayName == "Standard")
        #expect(check.sellers[0].fares[1].policy.refunds == .unknown)
        #expect(check.sellers[1].tier == .unvetted)
        #expect(check.insight.level == .low)
        #expect(check.unvettedGap == 14)
    }

    @Test func sellerCheckRequestNeedsTfs() throws {
        let it = try decodeEnvelope(SearchFixtures.itinerary, as: Itinerary.self)
        let request = try #require(SellerCheckRequest(itinerary: it))
        #expect(request.airlines == [AirlineRef(code: "UA", name: "United")])
        #expect(request.price == 412)
    }

    @Test func decodesLookups() throws {
        let airports = try decodeEnvelope(#"""
        [{"code":"NYC","label":"New York (all airports)","detail":"JFK · EWR · LGA","metro":true},
         {"code":"SFO","label":"San Francisco (SFO)","detail":"San Francisco International Airport · US","metro":false}]
        """#, as: [AirportSuggestion].self)
        #expect(airports[0].metro)
        let airlines = try decodeEnvelope(#"[{"code":"AZ","name":"ITA Airways"}]"#, as: [AirlineSuggestion].self)
        #expect(airlines[0].id == "AZ")
    }
}

@Suite("Stays models")
struct StaysModelTests {
    @Test func decodesSearchPricesAndFlex() throws {
        let search = try decodeEnvelope(#"""
        {"hotels":[{"key":"ChkIq_abc123XYZ","name":"Memmo Alfama","price":214,"deal_pct":18,"rating":4.6,"reviews":1234,
          "stars":4,"amenities":["Free Wi-Fi","Pool","Bar","Spa","Gym"],"image":"https://lh3.googleusercontent.com/p/x"},
          {"key":"ChkIq_def456XYZ","name":"Hostel","price":40,"deal_pct":null,"rating":null,"reviews":null,"stars":null,"amenities":[],"image":null}],
         "url":"https://www.google.com/travel/hotels/Lisbon"}
        """#, as: StaySearchResult.self)
        #expect(search.hotels[0].dealPct == 18)
        #expect(search.hotels[1].image == nil)

        let prices = try decodeEnvelope(#"""
        {"offers":[{"seller":"Memmo Hotels","official":true,"nightly_base":214,"nightly":245.5,"total":736.5,
          "free_cancel_until":"2026-11-20","url":"https://www.google.com/travel/clk?x","tier":"airline","logo":"/api/logo/site/memmohotels.com?name=Memmo"},
          {"seller":"Booking.com","official":false,"nightly_base":210,"nightly":240,"total":720,"free_cancel_until":null,"url":null,"tier":"trusted","logo":"/api/logo/site/booking.com?name=Booking.com"}],
         "url":"https://www.google.com/travel/hotels/entity/x"}
        """#, as: StayPrices.self)
        #expect(prices.offers[0].freeCancelUntil == date("2026-11-20"))
        #expect(prices.offers[0].tier.stayLabel == "Hotel direct")
        #expect(prices.offers[1].url == nil)

        let flex = try decodeEnvelope(#"{"savings":{"ChkIq_abc123XYZ":{"shift":"earlier","checkin":"2026-11-25","checkout":"2026-11-28","saving":64}}}"#,
                                      as: StayFlexResult.self)
        #expect(flex.savings["ChkIq_abc123XYZ"]?.shift == .earlier)
        #expect(flex.savings["ChkIq_abc123XYZ"]?.saving == 64)
    }

    @Test func stayQueryNights() {
        let q = StaySearchQuery(city: "Lisbon", checkin: date("2026-11-26"), checkout: date("2026-11-29"))
        #expect(q.nights == 3)
        #expect(q.adults == 2)
    }
}
