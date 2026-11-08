import Foundation

// Request bodies for /api/journeys/*. PATCH bodies use `T??` fields:
// nil = omit (leave unchanged), .some(nil) = send null (clear), .some(v) = set.

/// Body of `POST /api/journeys`.
struct NewJourney: Codable, Hashable, Sendable {
    var destination: String
    var startDate: LocalDate?
    var endDate: LocalDate?
    var title: String?
    var travelers: Int? = 2
    var tripType: TripType?

    enum CodingKeys: String, CodingKey { case destination, startDate, endDate, title, travelers, tripType }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(destination, forKey: .destination)
        try c.encode(startDate, forKey: .startDate)
        try c.encode(endDate ?? startDate, forKey: .endDate)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encode(travelers, forKey: .travelers)
        try c.encode(tripType, forKey: .tripType)
    }
}

/// Body of `PATCH /api/journeys/:id`.
struct JourneyPatch: Encodable, Sendable {
    var title: String?
    var destination: String??
    var startDate: LocalDate??
    var endDate: LocalDate??
    var travelers: Int??
    var tripType: TripType??

    enum CodingKeys: String, CodingKey { case title, destination, startDate, endDate, travelers, tripType }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodePatch(destination, forKey: .destination)
        try c.encodePatch(startDate, forKey: .startDate)
        try c.encodePatch(endDate, forKey: .endDate)
        try c.encodePatch(travelers, forKey: .travelers)
        try c.encodePatch(tripType, forKey: .tripType)
    }
}

/// Body of `POST /api/journeys/:id/items`. Only `booked` or `planned` status is accepted.
struct NewItem: Encodable, Sendable {
    var kind: ItemKind
    var status: ItemStatus = .planned
    var title: String
    var startDate: LocalDate
    var startTime: String?
    var endDate: LocalDate?
    var endTime: String?
    var place: String?
    var confirmation: String?
    var details = ItemDetails()

    enum CodingKeys: String, CodingKey {
        case kind, status, title, startDate, startTime, endDate, endTime, place, confirmation, details
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kind, forKey: .kind)
        try c.encode(status, forKey: .status)
        try c.encode(title, forKey: .title)
        try c.encode(startDate, forKey: .startDate)
        try c.encode(startTime, forKey: .startTime)
        try c.encode(endDate, forKey: .endDate)
        try c.encode(endTime, forKey: .endTime)
        try c.encode(place, forKey: .place)
        try c.encode(confirmation, forKey: .confirmation)
        try c.encode(details, forKey: .details)
    }
}

/// Body of `PATCH /api/journeys/items/:id`.
struct ItemPatch: Encodable, Sendable {
    var status: ItemStatus?
    /// .some(nil) unfiles the item.
    var journeyId: String??
    var title: String?
    var startDate: LocalDate?
    var startTime: String??
    var endDate: LocalDate??
    var endTime: String??
    var place: String??
    var confirmation: String??
    /// Sets or clears `details.note`.
    var note: String??
    var location: ItemLocation?
    var facts: ItemFacts?

    enum CodingKeys: String, CodingKey {
        case status, journeyId, title, startDate, startTime, endDate, endTime, place, confirmation, note, location, facts
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(status, forKey: .status)
        try c.encodePatch(journeyId, forKey: .journeyId)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodeIfPresent(startDate, forKey: .startDate)
        try c.encodePatch(startTime, forKey: .startTime)
        try c.encodePatch(endDate, forKey: .endDate)
        try c.encodePatch(endTime, forKey: .endTime)
        try c.encodePatch(place, forKey: .place)
        try c.encodePatch(confirmation, forKey: .confirmation)
        try c.encodePatch(note, forKey: .note)
        try c.encodeIfPresent(location, forKey: .location)
        try c.encodeIfPresent(facts, forKey: .facts)
    }
}

/// Pins an item to a place. `placeId` must match `^(g|osm):[\w:.-]+$`.
struct ItemLocation: Codable, Hashable, Sendable {
    let placeId: String
    let lat: Double
    let lng: Double
    let address: String?

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(placeId, forKey: .placeId)
        try c.encode(lat, forKey: .lat)
        try c.encode(lng, forKey: .lng)
        try c.encode(address, forKey: .address)
    }
}

/// `facts` in an item PATCH (strict on the server: only these keys). nil omits, .some(nil) removes.
struct ItemFacts: Encodable, Sendable {
    var reserve: Bool??
    var bookBy: LocalDate??
    var estimate: Double??
    var price: Double??
    var currency: String??
    var url: String??
    var phone: String??
    var address: String??

    enum CodingKeys: String, CodingKey { case reserve, bookBy, estimate, price, currency, url, phone, address }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodePatch(reserve, forKey: .reserve)
        try c.encodePatch(bookBy, forKey: .bookBy)
        try c.encodePatch(estimate, forKey: .estimate)
        try c.encodePatch(price, forKey: .price)
        try c.encodePatch(currency, forKey: .currency)
        try c.encodePatch(url, forKey: .url)
        try c.encodePatch(phone, forKey: .phone)
        try c.encodePatch(address, forKey: .address)
    }
}

/// Body of `POST /api/journeys/:id/tasks`.
struct NewTask: Encodable, Sendable {
    var title: String
    var due: LocalDate?
    var section = "Before you go"

    enum CodingKeys: String, CodingKey { case title, due, section }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(due, forKey: .due)
        try c.encode(section, forKey: .section)
    }
}

/// Body of `PATCH /api/journeys/tasks/:taskId`.
struct TaskPatch: Encodable, Sendable {
    var title: String?
    var done: Bool?
    var due: LocalDate??
    var section: String?

    enum CodingKeys: String, CodingKey { case title, done, due, section }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodeIfPresent(done, forKey: .done)
        try c.encodePatch(due, forKey: .due)
        try c.encodeIfPresent(section, forKey: .section)
    }
}

/// Body of `POST /api/journeys/:id/notes`. A note with the same title (any case) is replaced.
struct NewNote: Codable, Hashable, Sendable {
    var title: String
    var body: String
}

/// Body of `PATCH /api/journeys/notes/:noteId`.
struct NotePatch: Codable, Hashable, Sendable {
    var title: String?
    var body: String?
}

/// Body of `POST /api/journeys/:id/costs`.
struct NewCost: Codable, Hashable, Sendable {
    var label: String
    var amount: Double
    var currency = "USD"
    var category: CostCategory = .other
    var paid = false
}

/// Body of `PATCH /api/journeys/costs/:costId`.
struct CostPatch: Codable, Hashable, Sendable {
    var label: String?
    var amount: Double?
    var currency: String?
    var category: CostCategory?
    var paid: Bool?
}

struct ShareRequest: Codable, Hashable, Sendable {
    let on: Bool
}

/// Body of `POST /api/journeys/:id/generate`.
struct GenerateRequest: Codable, Hashable, Sendable {
    let provider: AIProvider
    let part: PlanPart
    /// <= 600 chars.
    var wishes: String?
}

/// Body of `POST /api/journeys/:id/suggest`.
struct SuggestRequest: Codable, Hashable, Sendable {
    let provider: AIProvider
    let kind: Kind

    enum Kind: String, Codable, Sendable {
        case dining, hotels
    }
}

/// Body of `POST /api/journeys/read`.
struct ReadMailRequest: Codable, Hashable, Sendable {
    let provider: AIProvider
}

/// Body of `POST /api/journeys/import/wanderlog`. Without `keys` it lists trips; with them it imports.
struct WanderlogImportRequest: Codable, Hashable, Sendable {
    /// The wanderlog.com `connect.sid` cookie value. Never stored.
    let session: String
    var keys: [String]?
}
