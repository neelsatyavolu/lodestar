import Foundation
import Observation

/// "Watching fares": saved Plan shortlists with their alerts and the bought fare (`/api/trips`).
@MainActor
@Observable
final class FareWatchListModel {
    let app: AppState

    private(set) var trips: [SavedTrip] = []
    /// The section is hidden while loading and when empty; a load error shows in place.
    private(set) var loadError: String?
    /// Per-card error lines.
    private(set) var errors: [String: String] = [:]
    private(set) var snapshots: [String: LoadState<Snapshot>] = [:]
    /// Seller checks for shortlist itineraries, keyed by `tfs`.
    private(set) var sellerChecks: [String: LoadState<SellerCheck>] = [:]

    init(app: AppState) {
        self.app = app
    }

    func load() async {
        do {
            trips = try await app.api.send(API.SavedTrips.list).trips
            loadError = nil
        } catch {
            if let message = app.handle(error) { loadError = message }
        }
    }

    func error(for id: String) -> String? { errors[id] }

    func setError(_ message: String?, for id: String) {
        errors[id] = message
    }

    /// Alert changes: drop toggle, target price, reminder day.
    func update(_ id: String, _ patch: SavedTripPatch) async {
        guard !patch.isEmpty else { return }
        errors[id] = nil
        do {
            replace(try await app.api.send(API.SavedTrips.update(id, patch)).trip)
        } catch {
            errors[id] = app.handle(error)
        }
    }

    func delete(_ id: String) async {
        do {
            _ = try await app.api.send(API.SavedTrips.delete(id))
            trips.removeAll { $0.id == id }
        } catch {
            errors[id] = app.handle(error)
        }
    }

    /// Saves the bought fare. Returns the error to show in the dialog, nil on success.
    func markBooked(_ id: String, _ booking: FareBooking) async -> String? {
        do {
            replace(try await app.api.send(API.SavedTrips.markBooked(id, booking)).trip)
            return nil
        } catch {
            return app.handle(error)
        }
    }

    /// "Undo": back to watching the shortlist.
    func unmarkBooked(_ id: String) async {
        errors[id] = nil
        do {
            replace(try await app.api.send(API.SavedTrips.unmarkBooked(id)).trip)
        } catch {
            errors[id] = app.handle(error)
        }
    }

    /// Loads the saved shortlist once, when the card opens it.
    func loadSnapshot(_ id: String) async {
        if case .loaded = snapshots[id] { return }
        snapshots[id] = .loading
        do {
            snapshots[id] = .loaded(try await app.api.send(API.SavedTrips.snapshot(id)).snapshot)
        } catch {
            snapshots[id] = app.handle(error).map { .failed($0) } ?? .idle
        }
    }

    /// Who sells this itinerary now (`/api/sellers`), so the traveller can say which fare they bought.
    func checkSellers(_ itinerary: Itinerary) async {
        guard let request = SellerCheckRequest(itinerary: itinerary), let tfs = itinerary.tfs else { return }
        if case .loaded = sellerChecks[tfs] { return }
        sellerChecks[tfs] = .loading
        do {
            sellerChecks[tfs] = .loaded(try await app.api.send(API.Flights.sellers(request)))
        } catch {
            sellerChecks[tfs] = app.handle(error).map { .failed($0) } ?? .idle
        }
    }

    private func replace(_ trip: SavedTrip) {
        trips = trips.map { $0.id == trip.id ? trip : $0 }
    }
}
