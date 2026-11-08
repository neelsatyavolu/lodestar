import Foundation
@testable import Lodestar

/// Builders for Search and Plan tests: realistic wire JSON (api-search.md 1.1, 2.3) decoded
/// the way the app decodes it.
enum SearchBuild {
    struct LegSpec {
        var from = "SFO"
        var to = "JFK"
        var airline = "UA"
        var depart = "2026-11-26T08:15:00"
        var arrive = "2026-11-26T16:45:00"
        var minutes = 330
    }

    static func leg(_ l: LegSpec) -> String {
        #"{"from":"\#(l.from)","from_name":null,"to":"\#(l.to)","to_name":null,"depart":"\#(l.depart)","arrive":"\#(l.arrive)","minutes":\#(l.minutes),"airline":{"code":"\#(l.airline)","name":"Airline \#(l.airline)"},"operating":null,"flight_number":"100","aircraft":null,"legroom":null,"overnight":false,"amenities":null}"#
    }

    static func slice(_ legs: [LegSpec], selfTransfer: Bool = false) -> String {
        let minutes = legs.map(\.minutes).reduce(0, +)
        let layovers = legs.dropFirst().map { #"{"airport":"\#($0.from)","city":null,"minutes":70,"overnight":false,"change_of_airport":false}"# }
        return #"{"minutes":\#(minutes),"stops":\#(legs.count - 1),"legs":[\#(legs.map(leg).joined(separator: ","))],"layovers":[\#(layovers.joined(separator: ","))],"self_transfer":\#(selfTransfer),"co2_kg":null,"co2_delta_pct":null}"#
    }

    static func itineraryJSON(id: String, price: Double, slices: [String], tfs: String? = "CBwQAhooEgoyMDI2LTExLTI2agcIARIDU0ZP") -> String {
        let tfsValue = tfs.map { "\"\($0)\"" } ?? "null"
        return #"{"id":"\#(id)","price":\#(price),"currency":"USD","booking_url":"https://www.google.com/travel/flights/booking?tfs=\#(id)","tfs":\#(tfsValue),"slices":[\#(slices.joined(separator: ","))]}"#
    }

    static func itinerary(id: String, price: Double, minutes: Int = 330, airlines: [String] = ["UA"],
                          from: String = "SFO", to: String = "JFK", selfTransfer: Bool = false,
                          tfs: String? = "CBwQAhooEgoyMDI2LTExLTI2agcIARIDU0ZP") -> Itinerary {
        let per = minutes / airlines.count
        let legs = airlines.enumerated().map { index, code in
            LegSpec(from: index == 0 ? from : "DEN", to: index == airlines.count - 1 ? to : "DEN", airline: code, minutes: per)
        }
        let json = itineraryJSON(id: id, price: price, slices: [slice(legs, selfTransfer: selfTransfer)], tfs: tfs)
        return try! JSONCoding.decoder.decode(Itinerary.self, from: Data(json.utf8))
    }

    static func result(_ itineraries: [Itinerary], best: String? = nil, cheapest: String? = nil, fastest: String? = nil,
                       baseline: Double? = nil, nearbyFrom: [String] = [], hacks: [Hack] = []) -> SearchResult {
        SearchResult(
            airports: .init(from: ["SFO"], to: ["JFK"], nearbyFrom: nearbyFrom, nearbyTo: []),
            baseline: baseline, itineraries: itineraries,
            labels: .init(best: best, cheapest: cheapest, fastest: fastest),
            hacks: hacks, calendar: [], oneWays: nil, warnings: []
        )
    }

    /// A seller check: `airline` (lowest) and `unvetted` sellers with optional trusted price.
    static func check(lowestTrusted: Double?, airlinePrice: Double? = nil, trustedSeller: String? = "United",
                      unvetted: Double? = nil, gap: Double = 0) -> SellerCheck {
        var sellers: [String] = []
        if let airlinePrice {
            sellers.append(#"{"name":"United","is_airline":true,"lowest":\#(airlinePrice),"tier":"airline","logo":"/api/logo/airline/UA","fares":[{"name":"Basic Economy","price":\#(airlinePrice),"features":[],"policy":{"carry_on":true,"checked_bag_fee":null,"checked_bag_included":false,"changes":"none","refunds":"none","seat_selection":"fee"}}]}"#)
        }
        if let unvetted {
            sellers.append(#"{"name":"CheapFares","is_airline":false,"lowest":\#(unvetted),"tier":"unvetted","logo":"/api/logo/site/_?name=CheapFares","fares":[{"name":null,"price":\#(unvetted),"features":[],"policy":{"carry_on":null,"checked_bag_fee":null,"checked_bag_included":null,"changes":null,"refunds":null,"seat_selection":null}}]}"#)
        }
        let trusted = lowestTrusted.map { "\($0)" } ?? "null"
        let seller = trustedSeller.map { "\"\($0)\"" } ?? "null"
        let json = #"{"sellers":[\#(sellers.joined(separator: ","))],"insight":{"level":null,"typical_low":null,"typical_high":null,"unlikely_to_drop_below":null,"cheaper_than_usual_by":null,"summary":null},"bookingUrl":"https://www.google.com/travel/flights/booking","lowestAny":\#(unvetted ?? lowestTrusted ?? 0),"lowestTrusted":\#(trusted),"trustedSeller":\#(seller),"unvettedGap":\#(gap)}"#
        return try! JSONCoding.decoder.decode(SellerCheck.self, from: Data(json.utf8))
    }

    static func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T {
        try! JSONCoding.decoder.decode(T.self, from: Data(json.utf8))
    }
}
