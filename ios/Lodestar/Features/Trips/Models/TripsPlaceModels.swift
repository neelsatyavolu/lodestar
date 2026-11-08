import Foundation
import Observation

/// Google place details per placeId for the session (the web's `place-cache.ts`).
@MainActor
@Observable
final class TripsPlaceCache {
    let app: AppState
    private(set) var details: [String: LoadState<PlaceDetails>] = [:]

    init(app: AppState) {
        self.app = app
    }

    func state(for placeId: String?) -> LoadState<PlaceDetails> {
        placeId.flatMap { details[$0] } ?? .idle
    }

    /// Only `g:` ids have details. Loads once; a failure can be retried.
    func load(_ placeId: String?, session: String? = nil) async {
        guard let placeId, placeId.hasPrefix("g:") else { return }
        switch details[placeId] {
        case .loaded, .loading: return
        default: break
        }
        details[placeId] = .loading
        do {
            details[placeId] = .loaded(try await app.api.send(API.Places.details(id: placeId, session: session)).place)
        } catch {
            details[placeId] = app.handle(error).map { .failed($0) } ?? .idle
        }
    }

    /// The destination's cover photo: first Google suggestion for the name, then its first photo.
    func coverPhoto(for destination: String) async -> String? {
        guard destination.count >= 2,
              let result = try? await app.api.send(API.Places.search(query: destination)),
              let first = result.suggestions.first(where: \.isGoogle)
        else { return nil }
        await load(first.id)
        return details[first.id]?.value?.photos.first
    }
}

/// The place search box ("Add a place", "Pick the place to pin it"): debounced, one Google
/// session id per box, reused for the details call of the picked row.
@MainActor
@Observable
final class TripsPlaceSearchModel {
    let app: AppState
    let near: LatLng?
    let session = UUID().uuidString.lowercased()

    var query = "" {
        didSet { if query != oldValue { schedule() } }
    }
    private(set) var suggestions: [PlaceSuggestion] = []
    private(set) var isSearching = false
    private(set) var error: String?
    private var task: Task<Void, Never>?

    static let debounce: Duration = .milliseconds(250)

    init(app: AppState, near: LatLng?) {
        self.app = app
        self.near = near
    }

    var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    private func schedule() {
        task?.cancel()
        let q = trimmed
        guard q.count >= 2 else {
            suggestions = []
            isSearching = false
            return
        }
        task = Task { [weak self] in
            try? await Task.sleep(for: Self.debounce)
            guard !Task.isCancelled else { return }
            await self?.search(q)
        }
    }

    private func search(_ q: String) async {
        isSearching = true
        defer { isSearching = false }
        do {
            let result = try await app.api.send(API.Places.search(query: q, near: near, session: session))
            guard q == trimmed else { return }
            suggestions = result.suggestions
            error = nil
        } catch {
            if let message = app.handle(error) { self.error = message }
        }
    }

    /// Details for a picked Google row (nil for OSM rows or when the call fails).
    func details(for s: PlaceSuggestion) async -> PlaceDetails? {
        guard s.isGoogle else { return nil }
        return try? await app.api.send(API.Places.details(id: s.id, session: session)).place
    }
}
