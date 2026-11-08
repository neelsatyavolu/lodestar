import Foundation

/// Body of `POST /api/sellers`.
struct SellerCheckRequest: Encodable, Sendable {
    let tfs: String
    /// Unique marketing airlines across all legs, with display names.
    let airlines: [AirlineRef]
    let price: Double?

    /// nil when the itinerary has no `tfs` (the check is impossible).
    init?(itinerary: Itinerary) {
        guard let tfs = itinerary.tfs else { return nil }
        self.tfs = tfs
        self.airlines = Array(itinerary.airlines.prefix(12)).map { AirlineRef(code: $0.code, name: $0.displayName) }
        self.price = itinerary.price
    }
}

/// `data` of `POST /api/sellers`: who sells this exact itinerary.
struct SellerCheck: Codable, Hashable, Sendable {
    /// Lowest first, then airline < trusted < unvetted.
    let sellers: [VerifiedSeller]
    let insight: PriceInsight
    let bookingURL: String
    let lowestAny: Double?
    /// Cheapest airline-or-trusted seller.
    let lowestTrusted: Double?
    let trustedSeller: String?
    /// How much cheaper the cheapest unvetted seller is than `lowestTrusted` (>= 0).
    let unvettedGap: Double

    enum CodingKeys: String, CodingKey {
        case sellers, insight, lowestAny, lowestTrusted, trustedSeller, unvettedGap
        case bookingURL = "bookingUrl"
    }
}

struct PriceInsight: Codable, Hashable, Sendable {
    let level: Level?
    let typicalLow: Double?
    let typicalHigh: Double?
    let unlikelyToDropBelow: Double?
    let cheaperThanUsualBy: Double?
    let summary: String?

    enum Level: String, LenientEnum {
        case low, typical, high, unknown
        static let unknownCase = Level.unknown
    }

    enum CodingKeys: String, CodingKey {
        case level, summary
        case typicalLow = "typical_low"
        case typicalHigh = "typical_high"
        case unlikelyToDropBelow = "unlikely_to_drop_below"
        case cheaperThanUsualBy = "cheaper_than_usual_by"
    }
}

struct VerifiedSeller: Codable, Hashable, Sendable {
    let name: String
    let isAirline: Bool
    let lowest: Double
    let fares: [Fare]
    let tier: SellerTier
    /// Relative path, e.g. /api/logo/site/expedia.com?name=Expedia. Load with `LogoView`.
    let logo: String

    enum CodingKeys: String, CodingKey {
        case name, lowest, fares, tier, logo
        case isAirline = "is_airline"
    }
}

struct Fare: Codable, Hashable, Sendable {
    /// Fare tier ("Basic Economy"). nil shows as "Standard".
    let name: String?
    let price: Double
    let features: [String]
    let policy: FarePolicy

    var displayName: String { name ?? "Standard" }
}

struct FarePolicy: Codable, Hashable, Sendable {
    let carryOn: Bool?
    /// 0 = included.
    let checkedBagFee: Double?
    let checkedBagIncluded: Bool?
    let changes: ChangePolicy?
    let refunds: RefundPolicy?
    let seatSelection: SeatPolicy?

    enum CodingKeys: String, CodingKey {
        case changes, refunds
        case carryOn = "carry_on"
        case checkedBagFee = "checked_bag_fee"
        case checkedBagIncluded = "checked_bag_included"
        case seatSelection = "seat_selection"
    }
}

enum ChangePolicy: String, LenientEnum {
    case free, fee, none, unknown
    static let unknownCase = ChangePolicy.unknown
}

enum RefundPolicy: String, LenientEnum {
    case full, partial, none, unknown
    static let unknownCase = RefundPolicy.unknown
}

enum SeatPolicy: String, LenientEnum {
    case free, fee, none, unknown
    static let unknownCase = SeatPolicy.unknown
}
