import Foundation
import Testing
@testable import Lodestar

private func event(_ json: String) -> CanvasEvent {
    SearchBuild.decode(CanvasEvent.self, json)
}

private let connectedStatus = AIStatus(
    connected: .init(codex: true, grok: true),
    models: .init(codex: [AIModel(id: "gpt-6-astra", label: "GPT-6 Astra")], grok: [])
)

@Suite("Plan: stream reducer, history, saving and the conversation model")
@MainActor
struct PlanTests {
    private var planEvent: CanvasEvent { event(#"{"type":"plan","plan":\#(PlanFixtures.plan)}"#) }

    private func finishedTurn() -> PlanTurn {
        [planEvent,
         event(#"{"type":"search","index":0,"state":"running"}"#),
         event(#"{"type":"search","index":0,"state":"done","count":42,"cheapest":389}"#),
         event(PlanFixtures.canvas),
         event(#"{"type":"done"}"#)]
            .reduce(PlanTurn(prompt: "Bay Area to New York")) { $0.applying($1) }
    }

    @Test func reducerFollowsTheStream() {
        var turn = PlanTurn(prompt: "Trip")
        #expect(turn.status == "Starting" && turn.isRunning)
        turn = turn.applying(event(#"{"type":"status","text":"Reading your request"}"#))
        #expect(turn.status == "Reading your request")
        turn = turn.applying(planEvent)
        #expect(turn.status == "Running 1 searches")
        #expect(turn.searches.map(\.state) == [.waiting])
        turn = turn.applying(event(#"{"type":"search","index":0,"state":"error","error":"The fare search took too long. Try again."}"#))
        #expect(turn.searches[0].state == .error)
        #expect(PlanLogic.outcome(turn.searches[0]) == "failed")
        // An index outside the plan is ignored.
        #expect(turn.applying(event(#"{"type":"search","index":4,"state":"done"}"#)) == turn)
        turn = turn.applying(event(#"{"type":"error","error":"Your AI connection expired. Reconnect it."}"#))
        #expect(turn.error == "Your AI connection expired. Reconnect it." && turn.status == nil)
        turn = turn.applying(event(#"{"type":"done"}"#))
        #expect(!turn.isRunning)
        #expect(turn.applying(event(#"{"type":"future"}"#)) == turn)
    }

    @Test func canvasPicksCiteRealOptions() {
        let turn = finishedTurn()
        #expect(turn.hasPicks)
        // "S1-2" has no option, so only one pick is shown.
        #expect(turn.citedPicks.map(\.pick.ref) == ["S1-1"])
        #expect(turn.searchLabel(for: turn.citedPicks[0].option) == "SFO/OAK to NYC")
        #expect(turn.citedPicks[0].pick.tag.planLabel == "Best")
        #expect(PlanLogic.outcome(turn.searches[0]) == "from $389")
        #expect(PlanLogic.outcome(SearchProgress(state: .done, count: 0, cheapest: nil)) == "none")
    }

    @Test func historyKeepsLastFourCanvasTurns() {
        let done = finishedTurn()
        var noCanvas = PlanTurn(prompt: "no answer")
        noCanvas = noCanvas.finished(error: "x")
        let turns = (0..<6).map { _ in done } + [noCanvas]
        let history = PlanLogic.history(turns)
        #expect(history.count == 4)
        #expect(history[0].reply == "Fly Saturday, back Sunday United nonstop is the pick.")
        #expect(history[0].prompt == "Bay Area to New York")
    }

    @Test func saveRequestUsesCheapestDoneSearch() throws {
        let turn = finishedTurn()
        #expect(PlanLogic.savePrice(turn) == 389)
        var noFare = turn
        noFare.searches = [SearchProgress(state: .error, error: "x")]
        #expect(PlanLogic.savePrice(noFare) == 412)
        let request = try #require(PlanLogic.saveRequest(turn, filters: SearchFilters(preferences: .default)))
        #expect(request.searches.count == 1)
        #expect(request.price == 389)
        let body = try jsonObject(request)
        let snapshot = try #require(body["snapshot"] as? [String: Any])
        #expect(snapshot["prompt"] as? String == "Bay Area to New York")
        let searches = try #require(snapshot["searches"] as? [[String: Any]])
        #expect(searches[0]["state"] as? String == "done")
        #expect(searches[0]["index"] == nil)
        #expect(PlanLogic.saveRequest(PlanTurn(prompt: "x"), filters: SearchFilters(preferences: .default)) == nil)
    }

    @Test func routeContextProviderAndErrors() {
        let search = SearchBuild.decode(TripPlan.self, PlanFixtures.plan).searches[0]
        #expect(PlanLogic.route(search) == "SFO/OAK→JFK/EWR Sat, Nov 21–Sun, Nov 29")
        #expect(PlanLogic.context(SearchQuery(from: [], to: ["JFK"], depart: date("2026-11-26"))) == nil)
        #expect(PlanLogic.context(SearchQuery(from: ["SFO"], to: ["JFK"], depart: date("2026-11-26"))) != nil)
        #expect(PlanLogic.provider(picked: .grok, status: connectedStatus) == .grok)
        #expect(PlanLogic.provider(picked: nil, status: connectedStatus) == .codex)
        #expect(PlanLogic.provider(picked: .grok, status: .disconnected) == nil)
        #expect(PlanLogic.streamError(APIError.server(status: 401, message: "Connect your Grok account first.")) == "Connect your Grok account first.")
        #expect(PlanLogic.streamError(APIError.offline) == PlanLogic.lostConnection)
        #expect(PlanLogic.streamError(CancellationError()) == nil)
    }

    // MARK: - Model

    private func stubService(events: [CanvasEvent], captured: CanvasBox) -> PlanService {
        PlanService(
            canvas: { request in
                captured.set(request)
                return AsyncThrowingStream { continuation in
                    events.forEach { continuation.yield($0) }
                    continuation.finish()
                }
            },
            saveTrip: { _ in "trip-9" },
            sellers: { _ in SearchBuild.check(lowestTrusted: 1) }
        )
    }

    @Test func runSendsRequestAndFoldsEvents() async throws {
        let box = CanvasBox()
        let model = PlanModel(service: stubService(events: [planEvent, event(PlanFixtures.canvas), event(#"{"type":"done"}"#)], captured: box))
        var prefs = Preferences.default
        prefs.homeAirports = ["SFO"]
        let inputs = PlanInputs(status: connectedStatus, preferences: prefs,
                                flightForm: SearchQuery(from: ["SFO"], to: ["JFK"], depart: date("2026-11-26")))
        model.prompt = "  Thanksgiving in New York  "
        model.modelID = "gpt-6-astra"
        #expect(model.canSend(inputs))
        model.run(model.prompt, inputs: inputs)
        #expect(model.prompt.isEmpty)
        #expect(model.isRunning)
        for _ in 0..<20 { await Task.yield() }
        #expect(!model.isRunning)
        let turn = try #require(model.turns.last)
        #expect(turn.prompt == "Thanksgiving in New York")
        #expect(turn.hasPicks)
        let request = try #require(box.value)
        #expect(request.provider == .codex)
        #expect(request.model == "gpt-6-astra")
        #expect(request.defaults?.homeAirports == ["SFO"])
        #expect(request.context != nil)
        #expect(request.history.isEmpty)

        await model.saveTrip(turn.id, preferences: prefs)
        #expect(model.turns.last?.save == .saved(id: "trip-9"))

        model.newTrip()
        #expect(model.turns.isEmpty)
    }

    @Test func lostStreamShowsTheLostConnectionLine() async {
        let service = PlanService(
            canvas: { _ in AsyncThrowingStream { $0.finish(throwing: APIError.offline) } },
            saveTrip: { _ in "" }, sellers: { _ in SearchBuild.check(lowestTrusted: 1) })
        let model = PlanModel(service: service)
        model.run("Somewhere warm", inputs: PlanInputs(status: connectedStatus, preferences: .default, flightForm: nil))
        for _ in 0..<20 { await Task.yield() }
        #expect(model.turns.last?.error == PlanLogic.lostConnection)
        #expect(model.turns.last?.isRunning == false)
    }

    @Test func noProviderMeansNoRun() {
        let model = PlanModel(service: stubService(events: [], captured: CanvasBox()))
        let inputs = PlanInputs(status: .disconnected, preferences: .default, flightForm: nil)
        model.prompt = "Lisbon"
        #expect(!model.canSend(inputs))
        model.run("Lisbon", inputs: inputs)
        #expect(model.turns.isEmpty)
    }

    @Test func originAskAndReplanReplacesTheTurn() async throws {
        let needs = SearchBuild.decode(TripPlan.self, #"{"understanding":"","assumptions":[],"searches":[],"question":"Where from?","needsOrigin":true}"#)
        let box = CanvasBox()
        let model = PlanModel(service: stubService(events: [.plan(needs), .done], captured: box))
        let inputs = PlanInputs(status: connectedStatus, preferences: .default, flightForm: nil)
        model.run("Tokyo in March", inputs: inputs)
        for _ in 0..<20 { await Task.yield() }
        #expect(model.needsOrigin(homeAirports: []))
        #expect(!model.needsOrigin(homeAirports: ["SEA"]))
        model.replanWithHome(["SEA"], inputs: inputs)
        for _ in 0..<20 { await Task.yield() }
        #expect(model.turns.count == 1)
        #expect(try #require(box.value).defaults?.homeAirports == ["SEA"])
    }
}

final class CanvasBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: CanvasRequest?
    var value: CanvasRequest? { lock.withLock { stored } }
    func set(_ request: CanvasRequest) { lock.withLock { stored = request } }
}
