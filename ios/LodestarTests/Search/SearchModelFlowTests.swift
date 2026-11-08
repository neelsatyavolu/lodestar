import Foundation
import Testing
@testable import Lodestar

/// Records requests and lets a test release seller checks one by one.
actor SellerGate {
    private(set) var requested: [String] = []
    private var waiting: [CheckedContinuation<Void, Never>] = []

    func enter(_ tfs: String) async {
        requested.append(tfs)
        await withCheckedContinuation { waiting.append($0) }
    }

    func releaseAll() {
        waiting.forEach { $0.resume() }
        waiting.removeAll()
    }
}

@MainActor
private func settle() async {
    for _ in 0..<20 { await Task.yield() }
}

@Suite("Search screen model, seller queue and Save to Trips")
@MainActor
struct SearchModelFlowTests {
    let today = date("2026-11-07")

    private func its(_ count: Int) -> [Itinerary] {
        (0..<count).map { SearchBuild.itinerary(id: "it\($0)", price: Double(300 + $0 * 10), tfs: "TFS-abcdefghijklmnop-\($0)") }
    }

    @Test func sellerQueueRunsTwoAtATimeAndDropsQueued() async {
        let gate = SellerGate()
        let checks = FlightSellerChecks { request in
            await gate.enter(request.tfs)
            return SearchBuild.check(lowestTrusted: request.price)
        }
        let list = its(4)
        list.forEach { checks.check($0, retry: false) }
        await settle()
        #expect(await gate.requested.count == 2)
        #expect(list.allSatisfy { checks.state(for: $0.id) == .loading })
        checks.dropQueued()
        #expect(checks.state(for: "it2") == nil && checks.state(for: "it3") == nil)
        await gate.releaseAll()
        await settle()
        #expect(checks.state(for: "it0")?.check?.lowestTrusted == 300)
        #expect(await gate.requested.count == 2)
        // A dropped one can be checked again; one already done isn't re-run without retry.
        checks.check(list[0], retry: false)
        checks.check(list[2], retry: false)
        await settle()
        #expect(await gate.requested.count == 3)
        await gate.releaseAll()
    }

    @Test func sellerFailureShowsMessageAndNoTfsIsSkipped() async {
        let checks = FlightSellerChecks { _ in throw APIError.server(status: 502, message: "The seller check failed. Try again.") }
        checks.check(SearchBuild.itinerary(id: "a", price: 1))
        checks.check(SearchBuild.itinerary(id: "b", price: 1, tfs: nil))
        await settle()
        #expect(checks.state(for: "a") == .failed("The seller check failed. Try again."))
        #expect(checks.state(for: "b") == nil)
    }

    private func service(result: SearchResult, days: [DayPrice] = [], saved: @escaping @Sendable (SaveTripRequest) -> Void = { _ in }) -> SearchService {
        SearchService(
            search: { _ in result },
            calendar: { _ in days },
            sellers: { _ in SearchBuild.check(lowestTrusted: 100) },
            saveTrip: { saved($0); return "trip-1" }
        )
    }

    private func readyModel(_ service: SearchService) -> SearchModel {
        let model = SearchModel(service: service, today: today)
        model.form.from = ["SFO"]
        model.form.to = ["JFK"]
        model.form.depart = date("2026-11-26")
        model.form.returnDate = date("2026-12-01")
        return model
    }

    @Test func searchLoadsResultsCalendarAndFlexHack() async {
        let result = SearchBuild.result(its(6), best: "it0", baseline: 450)
        let days = [DayPrice(depart: date("2026-11-26"), returnDate: date("2026-12-01"), price: 450),
                    DayPrice(depart: date("2026-11-24"), returnDate: date("2026-11-29"), price: 380)]
        let model = readyModel(service(result: result, days: days))
        model.search(preferences: .default)
        #expect(model.isSearching)
        await settle()
        #expect(!model.isSearching)
        #expect(model.result?.itineraries.count == 6)
        #expect(model.searched?.from == ["SFO"])
        #expect(model.calendar.days.count == 2)
        #expect(model.hacks.first?.kind == .flex)
        #expect(model.hacks.first?.saving == 70)
        // The first 4 are checked automatically.
        #expect(model.checks.states.count == 4)
    }

    @Test func searchErrorIsShownAndClearsResult() async {
        let failing = SearchService(
            search: { _ in throw APIError.server(status: 400, message: "We don't know the airport XYZ.") },
            calendar: { _ in [] }, sellers: { _ in SearchBuild.check(lowestTrusted: 1) }, saveTrip: { _ in "" })
        let model = readyModel(failing)
        model.search(preferences: .default)
        await settle()
        #expect(model.error == "We don't know the airport XYZ.")
        #expect(model.result == nil)
        #expect(!model.isSearching)
    }

    @Test func notReadyFormDoesNotSearch() {
        let model = SearchModel(service: service(result: SearchBuild.result([])), today: today)
        model.search(preferences: .default)
        #expect(!model.isSearching)
    }

    @Test func hackActions() async {
        let list = its(2)
        let split = Hack(kind: .split, title: "Two one-ways", detail: "", saving: 30, price: 1, itineraryIds: ["o", "b"], apply: nil, caution: nil)
        let nearby = Hack(kind: .nearby, title: "Oakland", detail: "", saving: 20, price: 1, itineraryIds: ["it1"], apply: nil, caution: nil)
        let length = Hack(kind: .length, title: "Stay longer", detail: "", saving: 40, price: 1, itineraryIds: [],
                          apply: HackApply(returnDate: .some(date("2026-12-03"))), caution: nil)
        let model = readyModel(service(result: SearchBuild.result(list, hacks: [split, nearby, length])))
        model.form.flexible = false
        model.search(preferences: .default)
        await settle()
        #expect(model.perform(split, preferences: .default) == .openSplit)
        #expect(model.isSplitOpen)
        #expect(model.perform(nearby, preferences: .default) == .focus(list[1]))
        #expect(model.highlight == "it1")
        #expect(model.perform(length, preferences: .default) == .searched)
        #expect(model.form.returnDate == date("2026-12-03"))
        await settle()
        #expect(model.searched?.returnDate == date("2026-12-03"))
        #expect(!model.isSplitOpen)
    }

    @Test func saveTripPostsShortlistAndRecordsID() async throws {
        let box = RequestBox()
        let list = its(3)
        let result = SearchBuild.result(list, best: "it1", cheapest: "it0", fastest: "it1")
        let model = readyModel(service(result: result, saved: { request in box.set(request) }))
        var prefs = Preferences.default
        prefs.avoidedAirlines = ["NK"]
        model.search(preferences: prefs)
        await settle()
        await model.saveTrip(focus: list[2], preferences: prefs)
        #expect(model.saveState("it2") == .saved(id: "trip-1"))
        #expect(model.saveState() == .idle)
        let request = try #require(box.value)
        #expect(request.price == 300)
        #expect(request.searches.count == 1)
        #expect(request.filters?.avoidAirlines == ["NK"])
        #expect(request.snapshot.canvas.picks.map(\.ref) == ["S1-1", "S1-2", "S1-3"])
        #expect(request.snapshot.canvas.picks.map(\.tag) == [.alternative, .best, .cheapest])
        #expect(request.snapshot.options["S1-1"]?.itinerary.id == "it2")
    }
}

/// Thread-safe holder for the request a stub received.
final class RequestBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: SaveTripRequest?
    var value: SaveTripRequest? { lock.withLock { stored } }
    func set(_ request: SaveTripRequest) { lock.withLock { stored = request } }
}
