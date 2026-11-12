import Foundation

/// `data` of `GET /api/journeys/:id/flights` (`lib/flights/types.ts`): live status per flight item,
/// keyed by item id. `live == false` means the server has no AeroDataBox key; a flight more than
/// 30 days out (or one AeroDataBox doesn't know) maps to `nil`.
struct FlightsResponse: Codable, Hashable, Sendable {
    let live: Bool
    let flights: [String: FlightStatus?]

    static let empty = FlightsResponse(live: false, flights: [:])
}

/// A flight's live state. Times are local to each airport, with that airport's zone abbreviation.
struct FlightStatus: Codable, Hashable, Sendable {
    let phase: FlightPhase
    let departure: FlightEndpoint
    let arrival: FlightEndpoint
    let aircraft: String?
    let airline: String?
    /// Minutes late at departure (negative when early).
    let delay: Int?
    /// When Lodestar last asked.
    let checkedAt: EpochMillis
}

enum FlightPhase: String, LenientEnum {
    case scheduled, checkin, boarding, departed, landed, delayed, cancelled, diverted, unknown
    static let unknownCase = FlightPhase.unknown
}

/// A moment at one airport: "2026-11-21" + "10:20" in its own zone, and the instant for maths.
struct FlightMoment: Codable, Hashable, Sendable {
    let date: LocalDate
    let time: String
    let utc: EpochMillis
}

struct FlightEndpoint: Codable, Hashable, Sendable {
    let code: String?
    let name: String?
    let city: String?
    /// "PST", "MST": the zone at that moment.
    let zone: String?
    let terminal: String?
    let gate: String?
    /// Arrival only: the baggage belt.
    let baggage: String?
    let scheduled: FlightMoment?
    /// The best newer time: actual once it happened, else revised or predicted.
    let latest: FlightMoment?
    /// True once `latest` is what happened, not a forecast.
    let actual: Bool
}
