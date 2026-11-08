import Foundation

/// The network calls Search and Plan make, as closures so the models can be tested offline.
struct SearchService: Sendable {
    var search: @Sendable (SearchQuery) async throws -> SearchResult
    var calendar: @Sendable (SearchQuery) async throws -> [DayPrice]
    var sellers: FlightSellerChecks.Sender
    /// `POST /api/trips`; returns the new trip's id.
    var saveTrip: @Sendable (SaveTripRequest) async throws -> String

    static func live(_ api: APIClient) -> SearchService {
        SearchService(
            search: { try await api.send(API.Flights.search($0)) },
            calendar: { try await api.send(API.Flights.calendar($0)) },
            sellers: { try await api.send(API.Flights.sellers($0)) },
            saveTrip: { try await api.send(API.SavedTrips.save($0)).id }
        )
    }
}

/// Where a "Save trip and get alerts" control stands.
enum TripSaveState: Hashable, Sendable {
    case idle
    case saving
    case saved(id: String)
    case failed(String)

    var isSaving: Bool { self == .saving }

    var savedID: String? {
        if case .saved(let id) = self { return id }
        return nil
    }

    var error: String? {
        if case .failed(let message) = self { return message }
        return nil
    }
}

/// The date strip's data (`/api/calendar`), fetched only when the search was flexible.
enum SearchCalendarState: Hashable, Sendable {
    case off
    case loading
    case loaded([DayPrice])

    var days: [DayPrice] {
        if case .loaded(let days) = self { return days }
        return []
    }
}
