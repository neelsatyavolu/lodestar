import Foundation
import Observation

/// The background "a night earlier or later" check for the results on screen.
enum StaysFlexState: Hashable, Sendable {
    case loading
    case loaded([String: FlexSaving])
    case failed

    var savings: [String: FlexSaving] {
        if case .loaded(let savings) = self { return savings }
        return [:]
    }
}

/// One set of results. `id` changes with every search so late answers from an older one are dropped.
struct StaysResults: Hashable, Sendable {
    let id: Int
    let query: StaySearchQuery
    let hotels: [Hotel]
    /// Google Hotels results page.
    let url: String
}

/// Turns a caught error into the sentence to show (nil for cancellation).
typealias StaysErrorText = @MainActor (_ error: any Error, _ fallback: String) -> String?

/// State for the Stays tab: the form, the results, the flex check and every hotel's seller prices.
/// Mirrors `components/stays.tsx`: a newer search cancels the running one, and a new result set
/// cancels pending price checks and the flex check.
@MainActor @Observable
final class StaysSearchModel {
    private(set) var form: StaysForm
    private(set) var results: StaysResults?
    private(set) var isSearching = false
    private(set) var searchError: String?
    private(set) var flex: StaysFlexState?
    /// Seller prices per `Hotel.key`, for the results on screen.
    private(set) var prices: [String: LoadState<StayPrices>] = [:]

    @ObservationIgnored private let service: any StaysService
    @ObservationIgnored private let errorText: StaysErrorText
    @ObservationIgnored private let today: () -> LocalDate
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var searchToken = 0
    @ObservationIgnored private(set) var flexTask: Task<Void, Never>?
    @ObservationIgnored private var priceTasks: [String: Task<Void, Never>] = [:]

    init(
        service: any StaysService,
        errorText: @escaping StaysErrorText = StaysSearchModel.defaultErrorText,
        today: @escaping () -> LocalDate = { LocalDate.todayUTC() }
    ) {
        self.service = service
        self.errorText = errorText
        self.today = today
        self.form = StaysForm.initial(today: today())
    }

    /// Cancellation shows nothing; API errors show their sentence; anything else the fallback.
    static func defaultErrorText(_ error: any Error, _ fallback: String) -> String? {
        if error.isCancellation { return nil }
        return (error as? APIError)?.message ?? fallback
    }

    // MARK: Form

    var todayDate: LocalDate { today() }
    var canSearch: Bool { form.isReady(today: today()) && !isSearching }
    var flexSavings: [String: FlexSaving] { flex?.savings ?? [:] }

    func update(_ change: (StaysForm) -> StaysForm) {
        form = change(form)
    }

    // MARK: Search

    /// Runs the form's search when it is ready. Returns the running task (tests await it).
    @discardableResult
    func submit() -> Task<Void, Never>? {
        guard canSearch else { return nil }
        return start(form.query)
    }

    /// Re-runs the search with the dates a flex saving found.
    @discardableResult
    func shift(to saving: FlexSaving) -> Task<Void, Never>? {
        guard let results else { return nil }
        let next = StaysForm(query: results.query).with(dates: saving)
        form = next
        return start(next.query)
    }

    private func start(_ query: StaySearchQuery) -> Task<Void, Never> {
        searchTask?.cancel()
        searchToken += 1
        let token = searchToken
        isSearching = true
        searchError = nil
        let task = Task { [weak self] in
            guard let self else { return }
            await self.run(query, token: token)
        }
        searchTask = task
        return task
    }

    private func run(_ query: StaySearchQuery, token: Int) async {
        defer { if token == searchToken { isSearching = false } }
        do {
            let found = try await service.search(query)
            guard token == searchToken, !Task.isCancelled else { return }
            show(StaysResults(id: token, query: query, hotels: found.hotels, url: found.url))
        } catch {
            guard token == searchToken else { return }
            searchError = errorText(error, StaysCopy.searchFailed)
        }
    }

    private func show(_ newResults: StaysResults) {
        cancelResultWork()
        prices = [:]
        results = newResults
        flex = .loading
        flexTask = Task { [weak self] () -> Void in
            await self?.runFlex(newResults)
        }
    }

    private func runFlex(_ owner: StaysResults) async {
        do {
            let found = try await service.flex(owner.query)
            guard results?.id == owner.id, !Task.isCancelled else { return }
            flex = .loaded(found.savings)
        } catch {
            guard results?.id == owner.id, !error.isCancellation, !Task.isCancelled else { return }
            flex = .failed
        }
    }

    private func cancelResultWork() {
        flexTask?.cancel()
        flexTask = nil
        priceTasks.values.forEach { $0.cancel() }
        priceTasks = [:]
    }

    // MARK: Seller prices

    /// Fetches a hotel's seller prices once per result set; `force` retries after an error.
    @discardableResult
    func loadPrices(for hotel: Hotel, force: Bool = false) -> Task<Void, Never>? {
        guard let owner = results else { return nil }
        switch prices[hotel.key] {
        case .loading, .loaded: if !force { return nil }
        case .failed, .idle, nil: break
        }
        priceTasks[hotel.key]?.cancel()
        prices[hotel.key] = .loading
        let task = Task { [weak self] () -> Void in
            await self?.runPrices(owner, key: hotel.key)
        }
        priceTasks[hotel.key] = task
        return task
    }

    private func runPrices(_ owner: StaysResults, key: String) async {
        do {
            let found = try await service.prices(owner.query.prices(for: key))
            guard results?.id == owner.id, !Task.isCancelled else { return }
            prices[key] = .loaded(found)
        } catch {
            guard results?.id == owner.id, !Task.isCancelled,
                  let message = errorText(error, StaysCopy.pricesFailed) else { return }
            prices[key] = .failed(message)
        }
    }

    func priceState(for hotel: Hotel) -> LoadState<StayPrices> {
        prices[hotel.key] ?? .idle
    }
}
