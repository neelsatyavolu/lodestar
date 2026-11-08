import Foundation
import Testing
@testable import Lodestar

/// View-model flows against a stubbed server (no network).
@MainActor
@Suite("Trips view models")
struct TripsModelFlowTests {
    private func journeyRow(_ items: [String] = []) -> JourneyWithItems {
        let json = tripsDetailJSON(items: items)
        return try! JSONDecoder().decode(JourneyWithItems.self, from: Data(json.utf8))
    }

    @Test func listLoadsTripsAndFareWatches() async {
        let (client, host) = TripsStubProtocol.client { request, _ in
            switch request.url?.path() {
            case "/api/journeys":
                return TripsStubProtocol.ok(#"{"journeys":[\#(tripsDetailJSON(items: []))],"unfiled":[],"mail":[]}"#)
            case "/api/trips":
                return TripsStubProtocol.ok(#"{"trips":[]}"#)
            default:
                return TripsStubProtocol.fail(404, "Not found.")
            }
        }
        let model = TripsListModel(app: AppState(api: client))
        await model.load()
        #expect(model.list?.journeys.count == 1)
        #expect(model.upcoming(today: date("2026-11-01")).count == 1)
        #expect(model.past(today: date("2026-12-01")).count == 1)
        #expect(model.fares.trips.isEmpty && model.fares.loadError == nil)
        #expect(Set(TripsStubProtocol.log(host)) == ["GET /api/journeys", "GET /api/trips"])
    }

    @Test func listFailureShowsTheServerSentence() async {
        let (client, _) = TripsStubProtocol.client { _, _ in TripsStubProtocol.fail(429, "Too many requests. Wait a minute and try again.") }
        let model = TripsListModel(app: AppState(api: client))
        await model.load()
        #expect(model.state.errorMessage == "Too many requests. Wait a minute and try again.")
    }

    @Test func locateLoopStopsWhenNothingIsSettled() async {
        let calls = Counter()
        let (client, host) = TripsStubProtocol.client { request, _ in
            if request.url?.path() == "/api/journeys/j1/locate" {
                let n = calls.next()
                let pinned = tripsItemJSON("a", details: #"{"lat":1,"lng":2,"locatedAt":1}"#)
                return TripsStubProtocol.ok(#"{"journey":\#(tripsDetailJSON(items: [pinned])),"located":1,"settled":\#(n == 1 ? 1 : 0),"remaining":1}"#)
            }
            return TripsStubProtocol.ok(#"{"journey":\#(tripsDetailJSON(items: [tripsItemJSON("a")]))}"#)
        }
        let model = TripDetailModel(app: AppState(api: client), journey: journeyRow([tripsItemJSON("a")]))
        await model.load()
        #expect(model.hasFullTrip)
        #expect(model.trip.items.first?.details.isPinned == true)
        #expect(TripsStubProtocol.log(host).filter { $0.hasSuffix("/locate") }.count == 2)
        // Once per page.
        await model.locateIfNeeded()
        #expect(TripsStubProtocol.log(host).filter { $0.hasSuffix("/locate") }.count == 2)
    }

    @Test func checklistToggleRollsBackOnFailure() async {
        let task = #"{"id":"t1","journeyId":"j1","title":"Pack","done":false,"due":null,"section":"Packing","position":0,"source":"manual"}"#
        let (client, _) = TripsStubProtocol.client { request, _ in
            if request.httpMethod == "PATCH" { return TripsStubProtocol.fail(500, "Couldn't save that.") }
            return TripsStubProtocol.ok(#"{"journey":\#(tripsDetailJSON(items: [], tasks: "[\(task)]"))}"#)
        }
        let model = TripDetailModel(app: AppState(api: client), journey: journeyRow())
        await model.load()
        let first = try! #require(model.trip.tasks.first)
        await model.setDone(first, true)
        #expect(model.trip.tasks.first?.done == false)
        #expect(model.error == "Couldn't save that.")
    }

    @Test func shareUpdatesTheTokenFromTheURL() async {
        let token = String(repeating: "a", count: 32)
        let (client, _) = TripsStubProtocol.client { _, body in
            let on = body.flatMap { String(data: $0, encoding: .utf8) }?.contains("true") == true
            return TripsStubProtocol.ok(on ? #"{"url":"https://lodestar.xanom.co/t/\#(token)"}"# : #"{"url":null}"#)
        }
        let changes = Counter()
        let model = TripDetailModel(app: AppState(api: client), journey: journeyRow())
        model.onChange = { _ in _ = changes.next() }
        await model.setSharing(true)
        #expect(model.journey.shareToken == token)
        #expect(model.shareURL?.lastPathComponent == token)
        await model.setSharing(false)
        #expect(model.journey.shareToken == nil)
        #expect(changes.value == 2)
    }

    @Test func removingAnItemDropsItLocally() async {
        let (client, host) = TripsStubProtocol.client { _, _ in TripsStubProtocol.ok("{}") }
        let model = TripDetailModel(app: AppState(api: client), journey: journeyRow([tripsItemJSON("a"), tripsItemJSON("b")]))
        await model.removeItem("a")
        #expect(model.trip.items.map(\.id) == ["b"])
        #expect(TripsStubProtocol.log(host) == ["DELETE /api/journeys/items/a"])
    }

    @Test func draftWithoutAIAsksToConnect() async {
        let (client, host) = TripsStubProtocol.client { _, _ in TripsStubProtocol.ok("{}") }
        let app = AppState(api: client)
        let model = TripDetailModel(app: app, journey: journeyRow())
        await model.draft(.itinerary)
        #expect(app.sheet == .connectAI)
        #expect(TripsStubProtocol.log(host).isEmpty)
    }

    @Test func wanderlogPicksEveryTripThenImports() async {
        let (client, _) = TripsStubProtocol.client { _, body in
            let text = body.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            if text.contains("keys") { return TripsStubProtocol.ok(#"{"imported":2}"#) }
            return TripsStubProtocol.ok(#"{"trips":[{"key":"abcd1","title":"Japan","startDate":"2026-04-01","endDate":null,"places":12},{"key":"abcd2","title":"Peru","startDate":null,"endDate":null,"places":3}]}"#)
        }
        let model = TripsWanderlogModel(app: AppState(api: client))
        #expect(!model.canList)
        model.session = "s%3Aabcdefghijkl"
        #expect(model.canList)
        await model.list()
        #expect(model.picked == ["abcd1", "abcd2"])
        #expect(model.importTitle == "Import 2 trips")
        model.toggle("abcd2")
        #expect(model.importTitle == "Import 1 trip")
        #expect(await model.importPicked() == 2)
        #expect(model.session.isEmpty)
    }

    @Test func fareWatchTargetUpdateReplacesTheCard() async {
        let summary = #"{"id":"s1","title":"SFO → MAA","prompt":"p","savedPrice":1200,"lastPrice":null,"checkedAt":null,"alertDrop":true,"targetPrice":TARGET,"targetHit":false,"remindOn":null,"reminded":false,"firstDepart":"2026-12-07","createdAt":0,"booking":null}"#
        let (client, _) = TripsStubProtocol.client { request, _ in
            if request.httpMethod == "PATCH" { return TripsStubProtocol.ok(#"{"trip":\#(summary.replacingOccurrences(of: "TARGET", with: "900"))}"#) }
            return TripsStubProtocol.ok(#"{"trips":[\#(summary.replacingOccurrences(of: "TARGET", with: "null"))]}"#)
        }
        let model = FareWatchListModel(app: AppState(api: client))
        await model.load()
        #expect(model.trips.first?.targetPrice == nil)
        await model.update("s1", SavedTripPatch(targetPrice: .some(900)))
        #expect(model.trips.first?.targetPrice == 900)
    }
}

/// A thread-safe call counter for stub handlers.
final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func next() -> Int { lock.withLock { count += 1; return count } }
    var value: Int { lock.withLock { count } }
}
