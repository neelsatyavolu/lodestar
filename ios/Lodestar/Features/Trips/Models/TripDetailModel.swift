import Foundation
import Observation

/// Tabs of the trip page, in the web's order.
enum TripsTab: String, CaseIterable, Identifiable, Sendable {
    case overview, itinerary, book, bookings, budget, checklist

    var id: String { rawValue }

    var label: String {
        switch self {
        case .overview: "Overview"
        case .itinerary: "Itinerary"
        case .book: "To book"
        case .bookings: "Bookings"
        case .budget: "Budget"
        case .checklist: "Checklist"
        }
    }
}

/// One trip page: the full trip, its tabs, and every change made from them.
/// Each write replaces the local trip with what the server answers (no in-place mutation).
@MainActor
@Observable
final class TripDetailModel {
    let app: AppState
    let id: String

    private(set) var trip: TripDetail
    private(set) var hasFullTrip = false
    private(set) var loadError: String?
    private(set) var isDeleted = false
    var tab: TripsTab = .overview
    var activeDay: LocalDate?
    var error: String?
    var notice: String?
    private(set) var busyItems: Set<String> = []
    private(set) var isSharing = false

    /// Drive times per day, keyed by the stops they were fetched for.
    private(set) var legs: [LocalDate: (stops: [String], legs: [StopLeg])] = [:]
    let places: TripsPlaceCache
    let drafter: TripsDraftRunner

    /// Called after every change so the list stays in step (nil = deleted).
    var onChange: ((TripDetail?) -> Void)?

    private var located = false

    init(app: AppState, journey: JourneyWithItems, openTab: TripsTab = .overview) {
        self.app = app
        self.id = journey.id
        self.trip = TripDetail(journey: journey.journey, items: journey.items, tasks: [], notes: [], costs: [])
        self.tab = openTab
        self.places = TripsPlaceCache(app: app)
        self.drafter = TripsDraftRunner(app: app)
        self.activeDay = TripsPlan.defaultDay(days, today: .today())
    }

    var journey: Journey { trip.journey }
    var days: [LocalDate] { TripsPlan.days(start: journey.startDate, end: journey.endDate, items: trip.items) }
    var toBook: [TripItem] { TripsPlan.toBook(trip.items) }
    var budget: TripsBudget { TripsBudget(trip: trip) }
    var shareURL: URL? { journey.shareToken.map { app.api.config.shareURL(token: $0) } }

    func issues(today: LocalDate = .today()) -> [TripsIssue] {
        TripsPlan.issues(start: journey.startDate, end: journey.endDate, items: trip.items, today: today)
    }

    func item(_ id: String) -> TripItem? { trip.items.first { $0.id == id } }

    // MARK: - Loading

    /// `GET /api/journeys/:id`, then the locate loop once.
    func load() async {
        do {
            adopt(try await app.api.send(API.Journeys.get(id)).journey)
            hasFullTrip = true
            loadError = nil
        } catch {
            guard let message = app.handle(error) else { return }
            if (error as? APIError)?.isNotFound == true { isDeleted = true }
            loadError = message
            return
        }
        if activeDay == nil || !(days.contains { $0 == activeDay }) {
            activeDay = TripsPlan.defaultDay(days, today: .today())
        }
        await locateIfNeeded()
    }

    /// Pins items from email and imports: up to 6 rounds, errors ignored (as the web does).
    func locateIfNeeded(now: Date = .now) async {
        guard !located else { return }
        located = true
        let ms = EpochMillis.from(now)
        guard trip.items.contains(where: { TripsPlan.needsLocation($0, now: ms) }) else { return }
        for _ in 0..<6 {
            guard let round = try? await app.api.send(API.Journeys.locate(id)) else { return }
            if let journey = round.journey { adopt(trip.with(items: journey.items)) }
            if round.remaining == 0 || round.settled == 0 { return }
        }
    }

    /// Drive times for a day with 2+ stops; refetched when the stops or their pins change.
    func loadLegs(for day: LocalDate) async {
        let stops = TripsPlan.dayStops(trip.items, date: day)
        let signature = stops.map { "\($0.id)@\($0.details.lat ?? 0),\($0.details.lng ?? 0)" }
        guard stops.count >= 2 else { legs[day] = nil; return }
        if legs[day]?.stops == signature { return }
        do {
            let answer = try await app.api.send(API.Journeys.legs(id, date: day))
            legs[day] = (signature, answer.legs)
        } catch {
            app.handle(error)
        }
    }

    func leg(from: String, to: String, on day: LocalDate) -> StopLeg? {
        legs[day]?.legs.first { $0.from == from && $0.to == to }
    }

    // MARK: - The trip itself

    /// Edit. Returns the error to show in the sheet.
    func update(_ form: TripsTripForm) async -> String? {
        if let problem = form.validate(requireDestination: false) { return problem }
        do {
            adopt(try await app.api.send(API.Journeys.update(id, form.patch(current: journey))).journey)
            return nil
        } catch {
            return app.handle(error)
        }
    }

    func delete() async -> Bool {
        do {
            _ = try await app.api.send(API.Journeys.delete(id))
            isDeleted = true
            onChange?(nil)
            return true
        } catch {
            self.error = app.handle(error)
            return false
        }
    }

    /// Turns the share link on or off.
    func setSharing(_ on: Bool) async {
        isSharing = true
        defer { isSharing = false }
        do {
            let answer = try await app.api.send(API.Journeys.share(id, on: on))
            let j = journey
            let next = Journey(id: j.id, title: j.title, destination: j.destination, startDate: j.startDate, endDate: j.endDate,
                               travelers: j.travelers, tripType: j.tripType, shareToken: answer.token, source: j.source, createdAt: j.createdAt)
            adopt(TripDetail(journey: next, items: trip.items, tasks: trip.tasks, notes: trip.notes, costs: trip.costs))
        } catch {
            self.error = app.handle(error)
        }
    }

    // MARK: - Internal

    func adopt(_ next: TripDetail) {
        trip = next
        onChange?(next)
    }

    func markBusy(_ itemId: String, _ busy: Bool) {
        if busy { busyItems.insert(itemId) } else { busyItems.remove(itemId) }
    }

    /// Reloads after a create (items answer only an id).
    func reload() async {
        if let next = try? await app.api.send(API.Journeys.get(id)).journey { adopt(next) }
    }
}
