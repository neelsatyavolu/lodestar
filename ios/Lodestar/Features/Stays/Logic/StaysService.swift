import Foundation

/// The three Stays calls, behind a protocol so the screen model can be tested without the network.
protocol StaysService: Sendable {
    func search(_ query: StaySearchQuery) async throws -> StaySearchResult
    func prices(_ query: StayPricesQuery) async throws -> StayPrices
    func flex(_ query: StaySearchQuery) async throws -> StayFlexResult
}

/// The live service over the shared `APIClient`.
struct StaysAPIService: StaysService {
    let api: APIClient

    func search(_ query: StaySearchQuery) async throws -> StaySearchResult {
        try await api.send(API.Stays.search(query))
    }

    func prices(_ query: StayPricesQuery) async throws -> StayPrices {
        try await api.send(API.Stays.prices(query))
    }

    func flex(_ query: StaySearchQuery) async throws -> StayFlexResult {
        try await api.send(API.Stays.flex(query))
    }
}
