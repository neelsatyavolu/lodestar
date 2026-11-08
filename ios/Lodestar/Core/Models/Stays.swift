import Foundation

/// Body of `POST /api/stays/search` and `POST /api/stays/flex`.
/// Note: both share one 20/min rate-limit bucket, so a search plus its flex check spends 2.
struct StaySearchQuery: Codable, Hashable, Sendable {
    var city: String
    var checkin: LocalDate
    var checkout: LocalDate
    var adults: Int = 2

    var nights: Int { checkin.days(to: checkout) }
}

/// Body of `POST /api/stays/prices`. Use the dates and guests of the search the hotel came from.
struct StayPricesQuery: Codable, Hashable, Sendable {
    let key: String
    let checkin: LocalDate
    let checkout: LocalDate
    let adults: Int
}

/// `data` of `POST /api/stays/search`.
struct StaySearchResult: Codable, Hashable, Sendable {
    let hotels: [Hotel]
    /// Google Hotels results page.
    let url: String
}

struct Hotel: Codable, Hashable, Sendable, Identifiable {
    /// Opaque id for `/api/stays/prices` and the flex savings map.
    let key: String
    let name: String
    /// Google's "from" price per night, before taxes.
    let price: Double
    let dealPct: Int?
    let rating: Double?
    let reviews: Int?
    let stars: Int?
    let amenities: [String]
    /// Absolute thumbnail URL.
    let image: String?

    var id: String { key }

    enum CodingKeys: String, CodingKey {
        case key, name, price, rating, reviews, stars, amenities, image
        case dealPct = "deal_pct"
    }
}

/// `data` of `POST /api/stays/prices`.
struct StayPrices: Codable, Hashable, Sendable {
    /// Sorted by total, then tier.
    let offers: [StayOffer]
    /// Google Hotels page for this hotel.
    let url: String
}

struct StayOffer: Codable, Hashable, Sendable {
    let seller: String
    /// The hotel's own site.
    let official: Bool
    let nightlyBase: Double
    let nightly: Double
    let total: Double
    let freeCancelUntil: LocalDate?
    /// nil = no Book button.
    let url: String?
    /// `.airline` here means Hotel direct.
    let tier: SellerTier
    let logo: String

    enum CodingKeys: String, CodingKey {
        case seller, official, nightly, total, url, tier, logo
        case nightlyBase = "nightly_base"
        case freeCancelUntil = "free_cancel_until"
    }
}

/// `data` of `POST /api/stays/flex`, keyed by `Hotel.key`.
struct StayFlexResult: Codable, Hashable, Sendable {
    let savings: [String: FlexSaving]
}

struct FlexSaving: Codable, Hashable, Sendable {
    let shift: Shift
    let checkin: LocalDate
    let checkout: LocalDate
    /// Whole dollars, whole stay.
    let saving: Int

    enum Shift: String, LenientEnum {
        case earlier, later, unknown
        static let unknownCase = Shift.unknown
    }
}
