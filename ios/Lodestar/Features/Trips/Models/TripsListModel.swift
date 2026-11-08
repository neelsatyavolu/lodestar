import Foundation
import Observation

/// The Trips home: trips, unfiled items, waiting mail and the saved fare watches.
@MainActor
@Observable
final class TripsListModel {
    let app: AppState

    private(set) var state: LoadState<JourneyList> = .idle
    var notice: String?
    var error: String?
    /// Emails being read by the AI right now (for "Reading 3 emails with your AI…").
    private(set) var readingCount = 0
    private(set) var movingItemIds: Set<String> = []
    private var readProviders: Set<AIProvider> = []

    let fares: FareWatchListModel

    init(app: AppState) {
        self.app = app
        self.fares = FareWatchListModel(app: app)
    }

    var list: JourneyList? { state.value }

    func upcoming(today: LocalDate = .today()) -> [JourneyWithItems] {
        (list?.journeys ?? []).filter { !TripsText.isPast(start: $0.journey.startDate, end: $0.journey.endDate, today: today) }
    }

    /// Most recent first.
    func past(today: LocalDate = .today()) -> [JourneyWithItems] {
        let past = (list?.journeys ?? []).filter { TripsText.isPast(start: $0.journey.startDate, end: $0.journey.endDate, today: today) }
        let last: (JourneyWithItems) -> String = { ($0.journey.endDate ?? $0.journey.startDate)?.string ?? "" }
        return TripsPlan.stableSorted(past) { last($0) > last($1) }
    }

    var waitingMail: [MailSummary] { (list?.mail ?? []).filter { $0.state == .needsAI } }

    /// Loads the list and the fare watches. A reload keeps the current list on screen.
    func load() async {
        if state.value == nil { state = .loading }
        async let faresLoad: Void = self.fares.load()
        do {
            let next = try await app.api.send(API.Journeys.list)
            state = .loaded(next)
        } catch {
            if let message = app.handle(error) {
                if state.value == nil { state = .failed(message) } else { self.error = message }
            }
        }
        await faresLoad
        await readMailIfNeeded()
    }

    /// The web's loop: once per provider per screen, up to 4 rounds, while mail waits for the AI.
    func readMailIfNeeded() async {
        guard let provider = app.aiStatus.defaultProvider, !readProviders.contains(provider), !waitingMail.isEmpty else { return }
        readProviders.insert(provider)
        readingCount = waitingMail.count
        defer { readingCount = 0 }
        var filed = 0
        var failure: String?
        for _ in 0..<4 {
            do {
                let round = try await app.api.send(API.Journeys.readMail(provider))
                filed += round.filed
                if let message = round.error { failure = message; break }
                if round.read == 0 { break }
            } catch {
                failure = app.handle(error)
                break
            }
        }
        if let failure {
            self.error = failure
        } else if filed > 0 {
            notice = "Added \(plural(filed, "booking")) from your email."
        }
        if let next = try? await app.api.send(API.Journeys.list) { state = .loaded(next) }
    }

    func deleteMail(_ id: String) async {
        do {
            _ = try await app.api.send(API.Journeys.deleteMail(id))
            if let l = list {
                state = .loaded(JourneyList(journeys: l.journeys, unfiled: l.unfiled, mail: l.mail.filter { $0.id != id }))
            }
        } catch {
            self.error = app.handle(error)
        }
    }

    /// "Move to…" an unfiled item, then reload.
    func move(itemId: String, to journeyId: String) async {
        movingItemIds.insert(itemId)
        defer { movingItemIds.remove(itemId) }
        do {
            _ = try await app.api.send(API.Journeys.updateItem(itemId, TripsRequests.move(to: journeyId)))
            await load()
        } catch {
            self.error = app.handle(error)
        }
    }

    /// Creates a trip; returns its id (the screen opens it).
    func create(_ form: TripsTripForm) async throws -> String {
        let created = try await app.api.send(API.Journeys.create(form.newJourney))
        await load()
        return created.id
    }

    func journey(id: String) -> JourneyWithItems? {
        list?.journeys.first { $0.id == id }
    }

    /// Replaces or removes a trip locally after the trip page changes it.
    func apply(_ detail: TripDetail?, removing id: String? = nil) {
        guard let l = list else { return }
        var journeys = l.journeys
        if let id { journeys.removeAll { $0.id == id } }
        if let detail, let index = journeys.firstIndex(where: { $0.id == detail.id }) {
            journeys[index] = JourneyWithItems(journey: detail.journey, items: detail.items)
        }
        state = .loaded(JourneyList(journeys: journeys, unfiled: l.unfiled, mail: l.mail))
    }
}
