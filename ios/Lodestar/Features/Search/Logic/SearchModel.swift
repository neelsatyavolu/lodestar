import Foundation
import Observation

/// Screen state for the Search tab: the form, the last search, its date strip, seller checks
/// and the list controls. Mirrors the search half of the web's `components/app.tsx`.
@MainActor
@Observable
final class SearchModel {
    var form: SearchForm
    var filters = FlightListFilters()
    var limit = FlightResults.pageSize
    var isSplitOpen = false
    /// The itinerary a hack pointed at.
    var highlight: String?

    private(set) var result: SearchResult?
    /// The form the current `result` came from (hacks apply on top of it).
    private(set) var searched: SearchForm?
    private(set) var isSearching = false
    private(set) var error: String?
    private(set) var calendar: SearchCalendarState = .off
    /// Save states keyed by "" (the whole search) or an itinerary id (saved from its detail).
    private(set) var saves: [String: TripSaveState] = [:]

    let checks: FlightSellerChecks

    @ObservationIgnored private let service: SearchService
    @ObservationIgnored private let handle: @MainActor (any Error) -> String?
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    init(service: SearchService, today: LocalDate = .today(),
         handle: @escaping @MainActor (any Error) -> String? = { $0.isCancellation ? nil : $0.userMessage }) {
        self.service = service
        self.handle = handle
        self.form = .initial(today: today)
        self.checks = FlightSellerChecks(send: service.sellers)
    }

    // MARK: - Derived

    var nearby: Set<String> { result.map(FlightResults.nearbyCodes) ?? [] }

    var flexHack: Hack? {
        guard let result, let searched, !calendar.days.isEmpty else { return nil }
        return FlexHack.make(days: calendar.days, depart: searched.depart,
                             returnDate: searched.roundTrip ? searched.returnDate : nil,
                             baseline: searched.bags > 0 ? nil : result.baseline)
    }

    var hacks: [Hack] { result.map { FlightResults.hacks($0, flex: flexHack) } ?? [] }

    var shown: [Itinerary] {
        guard let result else { return [] }
        return FlightResults.shown(result.itineraries, checks: checks.states, filters: filters)
    }

    var carriers: [FlightCarrier] { result.map { FlightResults.carriers($0.itineraries) } ?? [] }

    func saveState(_ key: String = "") -> TripSaveState { saves[key] ?? .idle }

    // MARK: - Preferences

    /// Saved preferences as form defaults and the "trusted only" default.
    func adopt(_ prefs: Preferences, fillForm: Bool) {
        filters.trustedOnly = prefs.trustedOnly
        if fillForm { form = form.applyingPreferences(prefs) }
    }

    // MARK: - Searching

    /// Runs `form` (or `next`, which becomes the form). A newer search cancels the older one.
    func search(_ next: SearchForm? = nil, preferences: Preferences) {
        if let next { form = next }
        let submitted = form
        guard submitted.isReady() else { return }
        searchTask?.cancel()
        generation += 1
        let token = generation
        isSearching = true
        error = nil
        isSplitOpen = false
        highlight = nil
        let query = submitted.query(applying: preferences)
        searchTask = Task { await self.run(query, form: submitted, token: token) }
    }

    private func run(_ query: SearchQuery, form submitted: SearchForm, token: Int) async {
        defer { if token == generation { isSearching = false } }
        do {
            let found = try await service.search(query)
            guard token == generation else { return }
            result = found
            searched = submitted
            limit = FlightResults.pageSize
            filters.airlines = []
            saves = [:]
            checks.dropQueued()
            for it in found.itineraries.prefix(FlightSellerChecks.autoCheckCount) { checks.check(it, retry: false) }
            if submitted.flexible { loadCalendar(query, token: token) } else { calendar = .off }
        } catch {
            guard token == generation, let message = handle(error) else { return }
            self.error = message
            result = nil
        }
    }

    /// The calendar is slow on Google's side: results show first, the strip lands later.
    private func loadCalendar(_ query: SearchQuery, token: Int) {
        calendar = .loading
        Task {
            let days = (try? await service.calendar(query)) ?? []
            guard token == generation else { return }
            calendar = .loaded(days)
        }
    }

    // MARK: - Hacks and the date strip

    enum HackOutcome: Equatable {
        case searched
        case openSplit
        case focus(Itinerary)
        case none
    }

    /// Runs a hack's action. A `focus` outcome means the view should show that itinerary.
    @discardableResult
    func perform(_ hack: Hack, preferences: Preferences) -> HackOutcome {
        if let apply = hack.apply {
            search((searched ?? form).applying(apply), preferences: preferences)
            return .searched
        }
        if hack.kind == .split {
            isSplitOpen = true
            return .openSplit
        }
        guard let id = hack.itineraryIds.first,
              let it = result?.itineraries.first(where: { $0.id == id }) else { return .none }
        highlight = id
        checks.checkIfNeeded(it)
        return .focus(it)
    }

    func pick(_ day: DayPrice, preferences: Preferences) {
        search(form.picking(day), preferences: preferences)
    }

    func showMore() {
        limit += FlightResults.pageSize
    }

    func toggleAirline(_ code: String) {
        if filters.airlines.contains(code) { filters.airlines.remove(code) } else { filters.airlines.insert(code) }
    }

    // MARK: - Save to Trips

    /// Saves this search's shortlist (or one itinerary first) as a watched trip.
    func saveTrip(focus: Itinerary?, preferences: Preferences) async {
        let key = focus?.id ?? ""
        guard let result, let searched, !(saves[key]?.isSaving ?? false) else { return }
        guard let request = SearchTripSaver.request(form: searched, preferences: preferences,
                                                    result: result, focus: focus) else { return }
        saves[key] = .saving
        do {
            let id = try await service.saveTrip(request)
            saves[key] = .saved(id: id)
        } catch {
            saves[key] = handle(error).map(TripSaveState.failed) ?? .idle
        }
    }
}
