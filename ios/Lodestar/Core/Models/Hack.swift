import Foundation

enum HackKind: String, LenientEnum {
    case nearby, flex, split, nonstop, ulcc, cabin, position, length, group, throwaway, timing, stopover
    case unknown

    static let unknownCase = HackKind.unknown

    /// SF Symbol for the hack card.
    var symbol: String {
        switch self {
        case .nearby: "mappin"
        case .flex, .length: "calendar"
        case .split: "arrow.triangle.branch"
        case .nonstop: "airplane"
        case .ulcc: "exclamationmark.triangle"
        case .cabin: "chair"
        case .position: "car"
        case .group: "person.2"
        case .throwaway: "repeat"
        case .timing: "moon"
        case .stopover: "bed.double"
        case .unknown: "sparkle"
        }
    }

    /// Action link text on the hack card.
    var actionLabel: String {
        switch self {
        case .flex, .length: "Search these dates"
        case .split: "Show both tickets"
        case .cabin: "Search that cabin"
        case .position: "Search from there"
        case .group: "Search one seat"
        case .throwaway: "Search the round trip"
        case .nearby, .nonstop, .ulcc, .timing, .stopover, .unknown: "Show flight"
        }
    }
}

/// A saving the server (or the client-side flex port) found (`lib/hacks.ts`).
struct Hack: Codable, Hashable, Sendable {
    let kind: HackKind
    let title: String
    let detail: String
    /// Whole dollars saved. Negative = costs more (nonstop, cabin); 0 = informational.
    let saving: Int
    let price: Double
    /// Ids in `SearchResult.itineraries`; for split `[outId, backId]` in `oneWays`; `[]` for flex.
    let itineraryIds: [String]
    /// Present when re-running a search reproduces the hack.
    let apply: HackApply?
    let caution: String?

    init(kind: HackKind, title: String, detail: String, saving: Int, price: Double,
         itineraryIds: [String], apply: HackApply?, caution: String?) {
        self.kind = kind
        self.title = title
        self.detail = detail
        self.saving = saving
        self.price = price
        self.itineraryIds = itineraryIds
        self.apply = apply
        self.caution = caution
    }

    enum CodingKeys: String, CodingKey {
        case kind, title, detail, saving, price, itineraryIds, apply, caution
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(HackKind.self, forKey: .kind)
        title = try c.decode(String.self, forKey: .title)
        detail = try c.decodeIfPresent(String.self, forKey: .detail) ?? ""
        // Integer on the wire; tolerate a stored decimal.
        saving = Int((try c.decode(Double.self, forKey: .saving)).rounded())
        price = try c.decode(Double.self, forKey: .price)
        itineraryIds = try c.decodeIfPresent([String].self, forKey: .itineraryIds) ?? []
        apply = try c.decodeIfPresent(HackApply.self, forKey: .apply)
        caution = try c.decodeIfPresent(String.self, forKey: .caution)
    }
}

/// The search overrides that reproduce a hack. Only these keys ever appear.
/// `returnDate` is tri-state: nil = absent (keep the current return), `.some(nil)` = one-way,
/// `.some(date)` = round trip with that return.
struct HackApply: Codable, Hashable, Sendable {
    var from: [String]?
    var depart: LocalDate?
    var returnDate: LocalDate??
    var cabin: Cabin?
    var adults: Int?

    enum CodingKeys: String, CodingKey {
        case from, depart, cabin, adults
        case returnDate = "return"
    }

    init(from: [String]? = nil, depart: LocalDate? = nil, returnDate: LocalDate?? = nil,
         cabin: Cabin? = nil, adults: Int? = nil) {
        self.from = from
        self.depart = depart
        self.returnDate = returnDate
        self.cabin = cabin
        self.adults = adults
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = try c.decodeIfPresent([String].self, forKey: .from)
        depart = try c.decodeIfPresent(LocalDate.self, forKey: .depart)
        returnDate = try c.decodePresence(LocalDate.self, forKey: .returnDate)
        cabin = try c.decodeIfPresent(Cabin.self, forKey: .cabin)
        adults = try c.decodeIfPresent(Int.self, forKey: .adults)
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(from, forKey: .from)
        try c.encodeIfPresent(depart, forKey: .depart)
        try c.encodePatch(returnDate, forKey: .returnDate)
        try c.encodeIfPresent(cabin, forKey: .cabin)
        try c.encodeIfPresent(adults, forKey: .adults)
    }

    /// Applies the overrides to the last searched query (web rule: override from, depart,
    /// cabin and adults when present; a present `return` sets it, null makes it one-way).
    func applied(to query: SearchQuery) -> SearchQuery {
        var copy = query
        if let from { copy.from = from }
        if let depart { copy.depart = depart }
        if let cabin { copy.cabin = cabin }
        if let adults { copy.adults = adults }
        if let returnDate { copy.returnDate = returnDate }
        return copy
    }
}

/// A hack inside a Plan canvas: a `Hack` plus the label of the planned search it came from.
struct CanvasHack: Codable, Hashable, Sendable {
    let hack: Hack
    let search: String

    enum CodingKeys: String, CodingKey { case search }

    init(hack: Hack, search: String) {
        self.hack = hack
        self.search = search
    }

    init(from decoder: any Decoder) throws {
        hack = try Hack(from: decoder)
        search = try decoder.container(keyedBy: CodingKeys.self).decodeIfPresent(String.self, forKey: .search) ?? ""
    }

    func encode(to encoder: any Encoder) throws {
        try hack.encode(to: encoder)
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(search, forKey: .search)
    }
}
