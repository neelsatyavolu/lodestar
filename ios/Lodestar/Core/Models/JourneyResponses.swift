import Foundation

/// `data` of `GET /api/journeys`.
struct JourneyList: Codable, Hashable, Sendable {
    /// Without tasks, notes or costs.
    let journeys: [JourneyWithItems]
    /// "Needs a trip".
    let unfiled: [TripItem]
    let mail: [MailSummary]
}

/// `{id}` answered by creates (`POST /api/journeys`, items, `POST /api/trips`).
struct CreatedID: Codable, Hashable, Sendable {
    let id: String
}

/// `{journey: TripDetail}` answered by get, patch, generate and suggest.
struct JourneyResponse: Codable, Hashable, Sendable {
    let journey: TripDetail
}

/// `data` of `POST /api/journeys/:id/generate`: replace the local trip with `journey`.
struct GenerateResponse: Codable, Hashable, Sendable {
    let journey: TripDetail
    let added: Int
}

struct ItemResponse: Codable, Hashable, Sendable {
    let item: TripItem
}

struct TaskResponse: Codable, Hashable, Sendable {
    let task: TripTask
}

struct NoteResponse: Codable, Hashable, Sendable {
    let note: TripNote
}

struct CostResponse: Codable, Hashable, Sendable {
    let cost: TripCost
}

/// `data` of `POST /api/journeys/:id/share`: the link when on, nil when off.
struct ShareResponse: Codable, Hashable, Sendable {
    let url: String?

    /// The token is the URL's last path segment.
    var token: String? { url.flatMap { URL(string: $0)?.lastPathComponent } }
}

/// `data` of `GET /api/journeys/:id/legs`.
struct LegsResponse: Codable, Hashable, Sendable {
    let legs: [StopLeg]
}

struct StopLeg: Codable, Hashable, Sendable {
    let from: String
    let to: String
    /// nil = no route found.
    let leg: RouteLeg?
}

struct RouteLeg: Codable, Hashable, Sendable {
    let seconds: Double
    let meters: Double
}

/// `data` of `POST /api/journeys/:id/locate`.
struct LocateResponse: Codable, Hashable, Sendable {
    let journey: TripDetail?
    let located: Int
    let settled: Int
    let remaining: Int
}

/// `data` of `POST /api/journeys/read`.
struct ReadMailResponse: Codable, Hashable, Sendable {
    let read: Int
    let filed: Int
    let error: String?
}

/// `data` of the Wanderlog import without keys.
struct WanderlogTripList: Codable, Hashable, Sendable {
    let trips: [WanderlogTrip]
}

struct WanderlogTrip: Codable, Hashable, Sendable, Identifiable {
    let key: String
    let title: String
    let startDate: LocalDate?
    let endDate: LocalDate?
    let places: Int

    var id: String { key }
}

/// `data` of the Wanderlog import with keys.
struct WanderlogImported: Codable, Hashable, Sendable {
    let imported: Int
}
