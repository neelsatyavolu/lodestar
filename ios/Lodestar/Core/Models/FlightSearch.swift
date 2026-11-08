import Foundation

/// Body of `POST /api/search` and `POST /api/calendar`. The server applies no saved
/// preferences: fill the filter fields with `applying(_:)`.
struct SearchQuery: Codable, Hashable, Sendable {
    var from: [String]
    var to: [String]
    var depart: LocalDate
    /// nil = one-way.
    var returnDate: LocalDate?
    var cabin: Cabin = .economy
    var stops: MaxStops = .any
    var adults: Int = 1
    var children: Int = 0
    var bags: Int = 0
    var nearby: Bool = true
    var flexible: Bool = true
    var split: Bool = true
    var alliances: [Alliance] = []
    var avoidAirlines: [String] = []
    var preferAirlines: [String] = []
    var noBasicEconomy: Bool = false
    var avoidRedEyes: Bool = false
    var avoidSelfTransfer: Bool = true

    enum CodingKeys: String, CodingKey {
        case from, to, depart, cabin, stops, adults, children, bags, nearby, flexible, split
        case alliances, avoidAirlines, preferAirlines, noBasicEconomy, avoidRedEyes, avoidSelfTransfer
        case returnDate = "return"
    }

    init(from: [String], to: [String], depart: LocalDate, returnDate: LocalDate? = nil) {
        self.from = from
        self.to = to
        self.depart = depart
        self.returnDate = returnDate
    }

    // `return` is always sent (null for one-way), matching the web.
    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(from, forKey: .from)
        try c.encode(to, forKey: .to)
        try c.encode(depart, forKey: .depart)
        try c.encode(returnDate, forKey: .returnDate)
        try c.encode(cabin, forKey: .cabin)
        try c.encode(stops, forKey: .stops)
        try c.encode(adults, forKey: .adults)
        try c.encode(children, forKey: .children)
        try c.encode(bags, forKey: .bags)
        try c.encode(nearby, forKey: .nearby)
        try c.encode(flexible, forKey: .flexible)
        try c.encode(split, forKey: .split)
        try c.encode(alliances, forKey: .alliances)
        try c.encode(avoidAirlines, forKey: .avoidAirlines)
        try c.encode(preferAirlines, forKey: .preferAirlines)
        try c.encode(noBasicEconomy, forKey: .noBasicEconomy)
        try c.encode(avoidRedEyes, forKey: .avoidRedEyes)
        try c.encode(avoidSelfTransfer, forKey: .avoidSelfTransfer)
    }

    var isRoundTrip: Bool { returnDate != nil }

    /// Copies the saved filters into the query (note the renamed airline keys).
    func applying(_ prefs: Preferences) -> SearchQuery {
        var copy = self
        copy.alliances = prefs.alliances
        copy.avoidAirlines = prefs.avoidedAirlines
        copy.preferAirlines = prefs.preferredAirlines
        copy.noBasicEconomy = prefs.noBasicEconomy
        copy.avoidRedEyes = prefs.avoidRedEyes
        copy.avoidSelfTransfer = prefs.avoidSelfTransfer
        return copy
    }
}

/// Body of `POST /api/calendar`: a search plus an optional visible window.
struct CalendarQuery: Encodable, Sendable {
    let query: SearchQuery
    let window: DateWindow?

    struct DateWindow: Codable, Hashable, Sendable {
        let start: LocalDate
        let end: LocalDate
    }

    enum CodingKeys: String, CodingKey { case window }

    func encode(to encoder: any Encoder) throws {
        try query.encode(to: encoder)
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(window, forKey: .window)
    }
}

/// `data` of `POST /api/search`.
struct SearchResult: Codable, Hashable, Sendable {
    let airports: SearchAirports
    /// Cheapest fare between exactly the requested airports.
    let baseline: Double?
    /// Already in "best" order. May be empty.
    let itineraries: [Itinerary]
    let labels: SearchLabels
    /// Sorted by saving, descending.
    let hacks: [Hack]
    /// Always empty from this route; fetch `/api/calendar`.
    let calendar: [DayPrice]
    let oneWays: OneWays?
    let warnings: [String]

    struct SearchAirports: Codable, Hashable, Sendable {
        let from: [String]
        let to: [String]
        let nearbyFrom: [String]
        let nearbyTo: [String]
    }

    struct SearchLabels: Codable, Hashable, Sendable {
        let best: String?
        let cheapest: String?
        let fastest: String?
    }

    struct OneWays: Codable, Hashable, Sendable {
        let out: [Itinerary]
        let back: [Itinerary]
    }
}

/// Lowest fare for one departure day (`/api/calendar` returns a bare array of these).
struct DayPrice: Codable, Hashable, Sendable {
    let depart: LocalDate
    let returnDate: LocalDate?
    let price: Double

    enum CodingKeys: String, CodingKey {
        case depart, price
        case returnDate = "return"
    }
}

/// `GET /api/airports?q=` suggestion.
struct AirportSuggestion: Codable, Hashable, Sendable, Identifiable {
    let code: String
    let label: String
    let detail: String
    let metro: Bool

    var id: String { code }
}

/// `GET /api/airlines?q=` suggestion. `name` is already the display name.
struct AirlineSuggestion: Codable, Hashable, Sendable, Identifiable {
    let code: String
    let name: String

    var id: String { code }
}
