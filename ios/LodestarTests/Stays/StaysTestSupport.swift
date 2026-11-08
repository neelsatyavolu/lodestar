import Foundation
@testable import Lodestar

enum StaysFeatureFixtures {
    static let today = date("2026-11-07")

    static let searchJSON = #"""
    {"hotels":[
      {"key":"ChkI0tW3kLqR1qQBGg0vZy8xMWJ3Y3FfbXA5EAE","name":"Memmo Alfama","price":189.4,"deal_pct":18,
       "rating":4.6,"reviews":1234,"stars":4,"amenities":["Free Wi-Fi","Pool","Bar","Air conditioning","Spa"],
       "image":"https://lh3.googleusercontent.com/p/abc=w200"},
      {"key":"ChgIq4yS8pX_9tYBGgwvbS8wZ3k2cjJfMRAB","name":"Lisboa Pessoa","price":142,"deal_pct":null,
       "rating":null,"reviews":null,"stars":null,"amenities":[],"image":null}
    ],"url":"https://www.google.com/travel/search?q=Lisbon"}
    """#

    static let pricesJSON = #"""
    {"offers":[
      {"seller":"Cheap Rooms Co","official":false,"nightly_base":150,"nightly":171.2,"total":513.6,
       "free_cancel_until":null,"url":"https://www.google.com/travel/clk?a=1","tier":"unvetted","logo":"/api/logo/site/_?name=Cheap%20Rooms%20Co"},
      {"seller":"Booking.com","official":false,"nightly_base":160,"nightly":180,"total":540,
       "free_cancel_until":null,"url":"https://www.google.com/travel/clk?a=2","tier":"trusted","logo":"/api/logo/site/booking.com?name=Booking.com"},
      {"seller":"Memmo Alfama","official":true,"nightly_base":168,"nightly":190,"total":570,
       "free_cancel_until":"2026-11-25","url":null,"tier":"airline","logo":"/api/logo/site/_?name=Memmo%20Alfama"}
    ],"url":"https://www.google.com/travel/hotels/entity/abc"}
    """#

    static let flexJSON = #"""
    {"savings":{"ChkI0tW3kLqR1qQBGg0vZy8xMWJ3Y3FfbXA5EAE":
      {"shift":"earlier","checkin":"2026-11-25","checkout":"2026-11-28","saving":60}}}
    """#

    static func search() throws -> StaySearchResult { try decodeEnvelope(searchJSON, as: StaySearchResult.self) }
    static func prices() throws -> StayPrices { try decodeEnvelope(pricesJSON, as: StayPrices.self) }
    static func flex() throws -> StayFlexResult { try decodeEnvelope(flexJSON, as: StayFlexResult.self) }

    static func offer(_ seller: String, total: Double, tier: SellerTier = .trusted, cancel: String? = nil) -> StayOffer {
        StayOffer(seller: seller, official: tier == .airline, nightlyBase: total / 3, nightly: total / 3, total: total,
                  freeCancelUntil: cancel.map(date), url: nil, tier: tier, logo: "/api/logo/site/_?name=x")
    }

    static let query = StaySearchQuery(city: "Lisbon", checkin: date("2026-11-26"), checkout: date("2026-11-29"), adults: 2)
}

/// Records every request and answers from closures.
final class StubStaysService: StaysService, @unchecked Sendable {
    private let lock = NSLock()
    private var _searches: [StaySearchQuery] = []
    private var _prices: [StayPricesQuery] = []
    private var _flexes: [StaySearchQuery] = []

    var onSearch: @Sendable (StaySearchQuery) async throws -> StaySearchResult = { _ in try StaysFeatureFixtures.search() }
    var onPrices: @Sendable (StayPricesQuery) async throws -> StayPrices = { _ in try StaysFeatureFixtures.prices() }
    var onFlex: @Sendable (StaySearchQuery) async throws -> StayFlexResult = { _ in try StaysFeatureFixtures.flex() }

    var searches: [StaySearchQuery] { lock.withLock { _searches } }
    var priceRequests: [StayPricesQuery] { lock.withLock { _prices } }
    var flexes: [StaySearchQuery] { lock.withLock { _flexes } }

    func search(_ query: StaySearchQuery) async throws -> StaySearchResult {
        lock.withLock { _searches.append(query) }
        return try await onSearch(query)
    }

    func prices(_ query: StayPricesQuery) async throws -> StayPrices {
        lock.withLock { _prices.append(query) }
        return try await onPrices(query)
    }

    func flex(_ query: StaySearchQuery) async throws -> StayFlexResult {
        lock.withLock { _flexes.append(query) }
        return try await onFlex(query)
    }
}

struct StaysTestError: Error {}
