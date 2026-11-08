import Foundation

/// A trip in the organizer ("journey" in the API, "Trips" in the UI).
struct Journey: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let title: String
    let destination: String?
    let startDate: LocalDate?
    let endDate: LocalDate?
    let travelers: Int?
    let tripType: TripType?
    /// Non-nil = the share link is on. Build the link with `APIConfig.shareURL(token:)`.
    let shareToken: String?
    let source: RecordSource
    let createdAt: EpochMillis
}

/// A trip with its items (`GET /api/journeys` list rows).
struct JourneyWithItems: Codable, Hashable, Sendable, Identifiable {
    let journey: Journey
    let items: [TripItem]

    var id: String { journey.id }

    enum CodingKeys: String, CodingKey { case items }

    init(journey: Journey, items: [TripItem]) {
        self.journey = journey
        self.items = items
    }

    init(from decoder: any Decoder) throws {
        journey = try Journey(from: decoder)
        items = try decoder.container(keyedBy: CodingKeys.self).decode([TripItem].self, forKey: .items)
    }

    func encode(to encoder: any Encoder) throws {
        try journey.encode(to: encoder)
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(items, forKey: .items)
    }
}

/// A full trip (`GET /api/journeys/:id`): journey + items + checklist, notes and budget lines.
struct TripDetail: Codable, Hashable, Sendable, Identifiable {
    let journey: Journey
    let items: [TripItem]
    let tasks: [TripTask]
    let notes: [TripNote]
    let costs: [TripCost]

    var id: String { journey.id }

    enum CodingKeys: String, CodingKey { case items, tasks, notes, costs }

    init(journey: Journey, items: [TripItem], tasks: [TripTask], notes: [TripNote], costs: [TripCost]) {
        self.journey = journey
        self.items = items
        self.tasks = tasks
        self.notes = notes
        self.costs = costs
    }

    init(from decoder: any Decoder) throws {
        journey = try Journey(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decode([TripItem].self, forKey: .items)
        tasks = try c.decodeIfPresent([TripTask].self, forKey: .tasks) ?? []
        notes = try c.decodeIfPresent([TripNote].self, forKey: .notes) ?? []
        costs = try c.decodeIfPresent([TripCost].self, forKey: .costs) ?? []
    }

    func encode(to encoder: any Encoder) throws {
        try journey.encode(to: encoder)
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(items, forKey: .items)
        try c.encode(tasks, forKey: .tasks)
        try c.encode(notes, forKey: .notes)
        try c.encode(costs, forKey: .costs)
    }

    /// A copy with new items (after `locate`, `suggest`).
    func with(items: [TripItem]) -> TripDetail {
        TripDetail(journey: journey, items: items, tasks: tasks, notes: notes, costs: costs)
    }
}

/// One dated thing on a trip: a flight, stay, reservation, plan or note.
struct TripItem: Codable, Hashable, Sendable, Identifiable {
    let id: String
    /// nil = "Needs a trip" (unfiled).
    let journeyId: String?
    let kind: ItemKind
    let status: ItemStatus
    let title: String
    let startDate: LocalDate
    /// "HH:MM", 24-hour.
    let startTime: String?
    let endDate: LocalDate?
    let endTime: String?
    /// City or area.
    let place: String?
    /// Show in Geist Mono.
    let confirmation: String?
    let details: ItemDetails
    let source: RecordSource
    /// Server bookkeeping; ignore in UI.
    let dedupeKey: String?
    let updatedAt: EpochMillis

    /// Not cancelled and not suggested.
    var isLive: Bool { status.isLive }
}

/// Kind-specific facts. Every key optional; absent keys are omitted when encoding
/// (the server's `details` schema is strict, so never add keys here that it doesn't list).
struct ItemDetails: Codable, Hashable, Sendable {
    var airline: String?
    var flightNumber: String?
    var from: String?
    var to: String?
    var address: String?
    var phone: String?
    var price: Double?
    var currency: String?
    var url: String?
    var cuisine: String?
    var priceLevel: String?
    var why: String?
    var reserve: Bool?
    var bookBy: LocalDate?
    var estimate: Double?
    var meal: Meal?
    var rating: Double?
    var note: String?
    var guests: Int?
    var provider: String?
    var placeId: String?
    var lat: Double?
    var lng: Double?
    var locatedAt: EpochMillis?
    var locateFailedAt: EpochMillis?

    init() {}

    /// "USD" when absent.
    var currencyCode: String { (currency ?? "USD").uppercased() }
    var isPinned: Bool { lat != nil && lng != nil }
    /// Google place ids open place details; OSM ids don't.
    var isGooglePlace: Bool { placeId?.hasPrefix("g:") == true }
}

struct TripTask: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let journeyId: String
    let title: String
    let done: Bool
    let due: LocalDate?
    let section: String
    let position: Int
    let source: RecordSource
}

struct TripNote: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let journeyId: String
    let title: String
    let body: String
    let position: Int
    let source: RecordSource
}

struct TripCost: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let journeyId: String
    let label: String
    let amount: Double
    let currency: String
    let category: CostCategory
    let paid: Bool
    let source: RecordSource
}

/// Forwarded mail waiting for AI or that failed. Newest first, at most 50.
struct MailSummary: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let sender: String
    let subject: String
    let state: MailState
    let error: String?
    let receivedAt: EpochMillis
}
