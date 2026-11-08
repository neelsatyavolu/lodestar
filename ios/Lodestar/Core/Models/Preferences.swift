import Foundation

/// Saved travel preferences (`lib/preferences.ts`). `PUT /api/preferences` replaces the whole
/// object (a missing field resets to its default), so always send a complete value.
/// Decoding is lenient: every missing or invalid field falls back to its default.
struct Preferences: Codable, Hashable, Sendable {
    var homeAirports: [String] = []
    var alliances: [Alliance] = []
    var preferredAirlines: [String] = []
    var avoidedAirlines: [String] = []
    var cabin: Cabin = .economy
    var stops: MaxStops = .any
    var adults: Int = 1
    var bags: Int = 0
    var avoidRedEyes = false
    var avoidSelfTransfer = true
    var noBasicEconomy = false
    var trustedOnly = true
    var nearby = true
    var flexible = true
    var split = true
    var cuisines: [String] = []
    var dietary: [String] = []
    var diningBudget: PriceLevel?
    var interests: [String] = []
    var pace: Pace = .balanced
    /// USD per night, 20...5000.
    var hotelBudget: Int?
    var hotelPriorities: [String] = []

    static let `default` = Preferences()

    init() {}

    enum CodingKeys: String, CodingKey {
        case homeAirports, alliances, preferredAirlines, avoidedAirlines, cabin, stops, adults, bags
        case avoidRedEyes, avoidSelfTransfer, noBasicEconomy, trustedOnly, nearby, flexible, split
        case cuisines, dietary, diningBudget, interests, pace, hotelBudget, hotelPriorities
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = Preferences.default
        func read<T: Decodable>(_ key: CodingKeys, _ fallback: T) -> T {
            (try? c.decodeIfPresent(T.self, forKey: key)) ?? fallback
        }
        homeAirports = read(.homeAirports, d.homeAirports)
        alliances = read(.alliances, d.alliances).filter { $0 != .unknown }
        preferredAirlines = read(.preferredAirlines, d.preferredAirlines)
        avoidedAirlines = read(.avoidedAirlines, d.avoidedAirlines)
        cabin = Self.known(read(.cabin, d.cabin), d.cabin)
        stops = Self.known(read(.stops, d.stops), d.stops)
        adults = read(.adults, d.adults)
        bags = read(.bags, d.bags)
        avoidRedEyes = read(.avoidRedEyes, d.avoidRedEyes)
        avoidSelfTransfer = read(.avoidSelfTransfer, d.avoidSelfTransfer)
        noBasicEconomy = read(.noBasicEconomy, d.noBasicEconomy)
        trustedOnly = read(.trustedOnly, d.trustedOnly)
        nearby = read(.nearby, d.nearby)
        flexible = read(.flexible, d.flexible)
        split = read(.split, d.split)
        cuisines = read(.cuisines, d.cuisines)
        dietary = read(.dietary, d.dietary)
        diningBudget = read(.diningBudget, d.diningBudget).flatMap { $0 == .unknown ? nil : $0 }
        interests = read(.interests, d.interests)
        pace = Self.known(read(.pace, d.pace), d.pace)
        hotelBudget = read(.hotelBudget, d.hotelBudget)
        hotelPriorities = read(.hotelPriorities, d.hotelPriorities)
    }

    /// Every key is always written; `null` for an unset dining or hotel budget.
    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(homeAirports, forKey: .homeAirports)
        try c.encode(alliances, forKey: .alliances)
        try c.encode(preferredAirlines, forKey: .preferredAirlines)
        try c.encode(avoidedAirlines, forKey: .avoidedAirlines)
        try c.encode(cabin, forKey: .cabin)
        try c.encode(stops, forKey: .stops)
        try c.encode(adults, forKey: .adults)
        try c.encode(bags, forKey: .bags)
        try c.encode(avoidRedEyes, forKey: .avoidRedEyes)
        try c.encode(avoidSelfTransfer, forKey: .avoidSelfTransfer)
        try c.encode(noBasicEconomy, forKey: .noBasicEconomy)
        try c.encode(trustedOnly, forKey: .trustedOnly)
        try c.encode(nearby, forKey: .nearby)
        try c.encode(flexible, forKey: .flexible)
        try c.encode(split, forKey: .split)
        try c.encode(cuisines, forKey: .cuisines)
        try c.encode(dietary, forKey: .dietary)
        try c.encode(diningBudget, forKey: .diningBudget)
        try c.encode(interests, forKey: .interests)
        try c.encode(pace, forKey: .pace)
        try c.encode(hotelBudget, forKey: .hotelBudget)
        try c.encode(hotelPriorities, forKey: .hotelPriorities)
    }

    private static func known<E: LenientEnum>(_ value: E, _ fallback: E) -> E {
        value == E.unknownCase ? fallback : value
    }
}

enum PriceLevel: String, LenientEnum {
    case one = "$"
    case two = "$$"
    case three = "$$$"
    case four = "$$$$"
    case unknown
    static let unknownCase = PriceLevel.unknown
}

enum Pace: String, LenientEnum {
    case relaxed, balanced, packed, unknown
    static let unknownCase = Pace.unknown

    var label: String {
        switch self {
        case .relaxed: "Relaxed"
        case .balanced, .unknown: "Balanced"
        case .packed: "See everything"
        }
    }
}

/// Suggested chip choices (UI constants; the server accepts any "Taste" string).
enum TasteChoices {
    static let cuisines = [
        "Local food", "Seafood", "Italian", "Japanese", "Mexican", "Indian", "Thai", "Chinese",
        "Middle Eastern", "French", "Steakhouse", "Street food", "Cafés & bakeries", "Fine dining",
    ]
    static let dietary = [
        "Vegetarian", "Vegan", "Pescatarian", "Gluten-free", "Halal", "Kosher", "Dairy-free", "Nut allergy",
    ]
    static let interests = [
        "Museums", "History", "Food tours", "Nature & hikes", "Beaches", "Nightlife", "Shopping",
        "Architecture", "Art & galleries", "Live music", "Sports", "Markets", "Wellness & spas", "Kid-friendly",
    ]
    static let hotelPriorities = [
        "Walkable location", "Near transit", "Quiet", "Pool", "Gym", "Breakfast included",
        "Free cancellation", "Boutique", "Big chain points", "Views",
    ]

    /// Strips characters outside the server's Taste rule and cuts to 40 chars.
    static func sanitize(_ text: String) -> String {
        let allowed = CharacterSet.letters.union(.decimalDigits).union(.whitespaces)
            .union(CharacterSet(charactersIn: "&'’,.()/-"))
        let kept = String(String.UnicodeScalarView(text.unicodeScalars.filter { allowed.contains($0) }))
        return String(kept.trimmingCharacters(in: .whitespaces).prefix(40))
    }
}
