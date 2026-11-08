import Foundation
import Observation

/// Seller checks (`POST /api/sellers`) in a FIFO queue, at most 2 at a time, as on the web.
/// Search checks the first 4 results of every search; cards the user opens queue their own.
@MainActor
@Observable
final class FlightSellerChecks {
    typealias Sender = @Sendable (SellerCheckRequest) async throws -> SellerCheck

    static let concurrency = 2
    static let autoCheckCount = 4

    private(set) var states: [String: FlightSellerState] = [:]

    @ObservationIgnored private var queue: [Itinerary] = []
    @ObservationIgnored private var running = 0
    @ObservationIgnored private var started = Set<String>()
    @ObservationIgnored private let send: Sender

    init(send: @escaping Sender) {
        self.send = send
    }

    convenience init(api: APIClient) {
        self.init { request in try await api.send(API.Flights.sellers(request)) }
    }

    func state(for id: String) -> FlightSellerState? { states[id] }

    /// Queues a check. `retry: false` skips an itinerary already checked or queued (auto-checks);
    /// `retry: true` is "Try again" or a card the user opened. No `tfs` means no check.
    func check(_ itinerary: Itinerary, retry: Bool = true) {
        guard itinerary.tfs != nil else { return }
        if started.contains(itinerary.id) {
            if !retry { return }
            if case .loading = states[itinerary.id] { return }
        }
        started.insert(itinerary.id)
        states[itinerary.id] = .loading
        queue.append(itinerary)
        pump()
    }

    /// Opening a card checks it once (web: only when no check exists yet).
    func checkIfNeeded(_ itinerary: Itinerary) {
        if states[itinerary.id] == nil { check(itinerary) }
    }

    /// A new search drops queued checks that haven't started, so they can be retried later.
    func dropQueued() {
        for it in queue {
            started.remove(it.id)
            states[it.id] = nil
        }
        queue.removeAll()
    }

    private func pump() {
        while running < Self.concurrency, !queue.isEmpty {
            let next = queue.removeFirst()
            running += 1
            Task { await self.run(next) }
        }
    }

    private func run(_ itinerary: Itinerary) async {
        defer {
            running -= 1
            pump()
        }
        guard let request = SellerCheckRequest(itinerary: itinerary) else {
            states[itinerary.id] = nil
            return
        }
        do {
            states[itinerary.id] = .done(try await send(request))
        } catch {
            states[itinerary.id] = error.isCancellation ? nil : .failed(error.userMessage)
            if error.isCancellation { started.remove(itinerary.id) }
        }
    }
}
