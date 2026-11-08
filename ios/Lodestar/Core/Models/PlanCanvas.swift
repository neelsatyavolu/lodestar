import Foundation

/// Filters applied to every planned search (Plan) and stored with a saved trip.
/// Mapped from preferences like `SearchQuery.applying(_:)`.
struct SearchFilters: Codable, Hashable, Sendable {
    var alliances: [Alliance]?
    var avoidAirlines: [String]?
    var preferAirlines: [String]?
    var noBasicEconomy: Bool?
    var avoidRedEyes: Bool?
    var avoidSelfTransfer: Bool?

    init(preferences p: Preferences) {
        alliances = p.alliances
        avoidAirlines = p.avoidedAirlines
        preferAirlines = p.preferredAirlines
        noBasicEconomy = p.noBasicEconomy
        avoidRedEyes = p.avoidRedEyes
        avoidSelfTransfer = p.avoidSelfTransfer
    }
}

/// Body of `POST /api/ai/canvas`.
struct CanvasRequest: Encodable, Sendable {
    let provider: AIProvider
    /// A `AIModel.id`; nil = "Default model".
    var model: String?
    /// 3...1200 chars.
    let prompt: String
    /// The current search form, only when it has both from and to.
    var context: CanvasContext?
    /// Up to 4 earlier turns, oldest first.
    var history: [CanvasTurn] = []
    var defaults: CanvasDefaults?
    var filters: SearchFilters?

    enum CodingKeys: String, CodingKey { case provider, model, prompt, context, history, defaults, filters }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(provider, forKey: .provider)
        try c.encodeIfPresent(model, forKey: .model)
        try c.encode(prompt, forKey: .prompt)
        try c.encode(context, forKey: .context)
        try c.encode(history, forKey: .history)
        try c.encode(defaults, forKey: .defaults)
        try c.encode(filters, forKey: .filters)
    }
}

/// The search form subset Plan uses as defaults.
struct CanvasContext: Encodable, Hashable, Sendable {
    let query: SearchQuery

    enum CodingKeys: String, CodingKey {
        case from, to, depart, cabin, stops, adults, bags, nearby, flexible, split
        case returnDate = "return"
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(query.from, forKey: .from)
        try c.encode(query.to, forKey: .to)
        try c.encode(query.depart, forKey: .depart)
        try c.encode(query.returnDate, forKey: .returnDate)
        try c.encode(query.cabin, forKey: .cabin)
        try c.encode(query.stops, forKey: .stops)
        try c.encode(query.adults, forKey: .adults)
        try c.encode(query.bags, forKey: .bags)
        try c.encode(query.nearby, forKey: .nearby)
        try c.encode(query.flexible, forKey: .flexible)
        try c.encode(query.split, forKey: .split)
    }
}

struct CanvasTurn: Codable, Hashable, Sendable {
    /// <= 1200 chars.
    let prompt: String
    /// "\(headline) \(summary)", trimmed and cut to 600.
    let reply: String
}

struct CanvasDefaults: Codable, Hashable, Sendable {
    var homeAirports: [String]
    var cabin: Cabin
    var stops: MaxStops
    var adults: Int
    var bags: Int

    init(preferences p: Preferences) {
        homeAirports = p.homeAirports
        cabin = p.cabin
        stops = p.stops
        adults = p.adults
        bags = p.bags
    }
}

/// One NDJSON line of the canvas stream. Unknown types decode as `.ignored`.
enum CanvasEvent: Decodable, Sendable, Equatable {
    case status(String)
    case plan(TripPlan)
    case search(SearchProgress)
    case canvas(CanvasResult)
    case error(String)
    case done
    case ignored(type: String)

    private enum CodingKeys: String, CodingKey { case type, text, plan, error }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "status": self = .status(try c.decode(String.self, forKey: .text))
        case "plan": self = .plan(try c.decode(TripPlan.self, forKey: .plan))
        case "search": self = .search(try SearchProgress(from: decoder))
        case "canvas": self = .canvas(try CanvasResult(from: decoder))
        case "error": self = .error(try c.decode(String.self, forKey: .error))
        case "done": self = .done
        default: self = .ignored(type: type)
        }
    }
}

/// A `search` event, also the stored per-search state in a snapshot.
struct SearchProgress: Codable, Hashable, Sendable {
    /// 0-based index into `plan.searches`. Absent in snapshots (position is the index).
    var index: Int?
    let state: State
    var count: Int?
    var cheapest: Double?
    var error: String?

    enum State: String, LenientEnum {
        case waiting, running, done, error, unknown
        static let unknownCase = State.unknown
    }
}

/// `{type:"canvas", canvas, options, hacks}`.
struct CanvasResult: Codable, Hashable, Sendable {
    let canvas: Canvas
    /// Keyed by pick ref ("S2-1").
    let options: [String: CanvasOption]
    let hacks: [CanvasHack]
}

struct CanvasOption: Codable, Hashable, Sendable {
    let itinerary: Itinerary
    /// 0-based index into `plan.searches`.
    let search: Int
}

/// What the model understood and which searches it ran. ("Plan" in the API.)
struct TripPlan: Codable, Hashable, Sendable {
    let understanding: String
    let assumptions: [String]
    let searches: [PlannedSearch]
    let question: String?
    /// True when only the origin is missing.
    let needsOrigin: Bool

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        understanding = try c.decodeIfPresent(String.self, forKey: .understanding) ?? ""
        assumptions = try c.decodeIfPresent([String].self, forKey: .assumptions) ?? []
        searches = try c.decodeIfPresent([PlannedSearch].self, forKey: .searches) ?? []
        question = try c.decodeIfPresent(String.self, forKey: .question)
        needsOrigin = try c.decodeIfPresent(Bool.self, forKey: .needsOrigin) ?? false
    }
}

struct PlannedSearch: Codable, Hashable, Sendable {
    let label: String
    let why: String
    let from: [String]
    let to: [String]
    let depart: LocalDate
    let returnDate: LocalDate?
    let cabin: Cabin
    let stops: MaxStops
    let adults: Int
    let bags: Int
    let nearby: Bool
    let flexible: Bool

    enum CodingKeys: String, CodingKey {
        case label, why, from, to, depart, cabin, stops, adults, bags, nearby, flexible
        case returnDate = "return"
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(label, forKey: .label)
        try c.encode(why, forKey: .why)
        try c.encode(from, forKey: .from)
        try c.encode(to, forKey: .to)
        try c.encode(depart, forKey: .depart)
        try c.encode(returnDate, forKey: .returnDate)
        try c.encode(cabin, forKey: .cabin)
        try c.encode(stops, forKey: .stops)
        try c.encode(adults, forKey: .adults)
        try c.encode(bags, forKey: .bags)
        try c.encode(nearby, forKey: .nearby)
        try c.encode(flexible, forKey: .flexible)
    }
}

struct Canvas: Codable, Hashable, Sendable {
    let headline: String
    let summary: String
    let picks: [Pick]
    let tips: [String]
    let followups: [String]

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        headline = try c.decode(String.self, forKey: .headline)
        summary = try c.decodeIfPresent(String.self, forKey: .summary) ?? ""
        picks = try c.decodeIfPresent([Pick].self, forKey: .picks) ?? []
        tips = try c.decodeIfPresent([String].self, forKey: .tips) ?? []
        followups = try c.decodeIfPresent([String].self, forKey: .followups) ?? []
    }
}

struct Pick: Codable, Hashable, Sendable {
    /// "S<search#>-<option#>", 1-based; a key of `CanvasResult.options`.
    let ref: String
    let title: String
    let why: String
    let tradeoff: String?
    let tag: Tag

    enum Tag: String, LenientEnum {
        case best, cheapest, fastest, comfort, hack, alternative, unknown
        static let unknownCase = Tag.unknown
    }
}

// Memberwise initialisers (the custom decoders above suppress the synthesized ones).
extension TripPlan {
    init(understanding: String, assumptions: [String], searches: [PlannedSearch], question: String?, needsOrigin: Bool) {
        self.understanding = understanding
        self.assumptions = assumptions
        self.searches = searches
        self.question = question
        self.needsOrigin = needsOrigin
    }
}

extension Canvas {
    init(headline: String, summary: String, picks: [Pick], tips: [String], followups: [String]) {
        self.headline = headline
        self.summary = summary
        self.picks = picks
        self.tips = tips
        self.followups = followups
    }
}
