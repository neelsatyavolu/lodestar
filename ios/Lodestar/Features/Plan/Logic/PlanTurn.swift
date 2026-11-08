import Foundation

/// One message and what the AI did with it (web `Board`). Every change makes a new value.
struct PlanTurn: Hashable, Sendable, Identifiable {
    let id: UUID
    let prompt: String
    var status: String?
    var plan: TripPlan?
    /// Per planned search, in order.
    var searches: [SearchProgress] = []
    var result: CanvasResult?
    var error: String?
    var isRunning = true
    var save: TripSaveState = .idle

    init(prompt: String, id: UUID = UUID()) {
        self.id = id
        self.prompt = prompt
        self.status = "Starting"
    }

    var canvas: Canvas? { result?.canvas }
    var hasPicks: Bool { !(canvas?.picks.isEmpty ?? true) }

    /// Folds one stream event into the turn (web `readNdjson` switch).
    func applying(_ event: CanvasEvent) -> PlanTurn {
        var next = self
        switch event {
        case .status(let text):
            next.status = text
        case .plan(let plan):
            next.plan = plan
            if !plan.searches.isEmpty { next.status = "Running \(plan.searches.count) searches" }
            next.searches = plan.searches.map { _ in SearchProgress(state: .waiting) }
        case .search(let progress):
            guard let index = progress.index, next.searches.indices.contains(index) else { return self }
            next.searches[index] = SearchProgress(state: progress.state, count: progress.count,
                                                  cheapest: progress.cheapest, error: progress.error)
        case .canvas(let result):
            next.result = result
            next.status = nil
        case .error(let message):
            next.error = message
            next.status = nil
        case .done:
            next.isRunning = false
            next.status = nil
        case .ignored:
            return self
        }
        return next
    }

    /// The stream ended or failed: stop the spinner, keep whatever arrived.
    func finished(error message: String? = nil) -> PlanTurn {
        var next = self
        next.isRunning = false
        next.status = nil
        if let message { next.error = message }
        return next
    }

    func withSave(_ state: TripSaveState) -> PlanTurn {
        var next = self
        next.save = state
        return next
    }

    /// The picks whose option arrived, with that option (a pick always cites a real result).
    var citedPicks: [(pick: Pick, option: CanvasOption)] {
        guard let result else { return [] }
        return result.canvas.picks.compactMap { pick in result.options[pick.ref].map { (pick, $0) } }
    }

    /// "from SFO/OAK to NYC": the label of the planned search an option came from.
    func searchLabel(for option: CanvasOption) -> String? {
        guard let searches = plan?.searches, searches.indices.contains(option.search) else { return nil }
        return searches[option.search].label
    }
}

enum PlanLogic {
    static let maxHistory = 4
    static let maxPrompt = 1200
    static let maxReply = 600

    /// Earlier turns sent with each message: the last 4 that produced a canvas, oldest first.
    static func history(_ turns: [PlanTurn]) -> [CanvasTurn] {
        turns.compactMap { turn in
            turn.canvas.map { canvas in
                let reply = "\(canvas.headline) \(canvas.summary)".trimmingCharacters(in: .whitespacesAndNewlines)
                return CanvasTurn(prompt: String(turn.prompt.prefix(maxPrompt)), reply: String(reply.prefix(maxReply)))
            }
        }
        .suffix(maxHistory)
        .map { $0 }
    }

    /// Min of the done searches' cheapest fares, else the cheapest cited option.
    static func savePrice(_ turn: PlanTurn) -> Double? {
        let fares = turn.searches.compactMap(\.cheapest).filter { $0 > 0 }
        if let min = fares.min() { return min }
        return turn.result?.options.values.map(\.itinerary.price).min()
    }

    /// `POST /api/trips` body for a finished turn, or nil when there's nothing to save.
    static func saveRequest(_ turn: PlanTurn, filters: SearchFilters) -> SaveTripRequest? {
        guard let plan = turn.plan, let result = turn.result, !plan.searches.isEmpty,
              let price = savePrice(turn), price > 0 else { return nil }
        let searches = turn.searches.map { s in
            SearchProgress(state: s.state == .unknown ? .waiting : s.state, count: s.count, cheapest: s.cheapest, error: s.error)
        }
        let snapshot = Snapshot(prompt: String(turn.prompt.prefix(maxPrompt)), plan: plan, canvas: result.canvas,
                                options: result.options, hacks: result.hacks, searches: searches)
        return SaveTripRequest(snapshot: snapshot, searches: Array(plan.searches.prefix(5)), filters: filters, price: price)
    }

    /// "SFO/OAK→JFK Thu, Nov 26–Sun, Nov 30"
    static func route(_ s: PlannedSearch) -> String {
        let dates = DateText.short(s.depart) + (s.returnDate.map { "–\(DateText.short($0))" } ?? "")
        return "\(s.from.joined(separator: "/"))→\(s.to.joined(separator: "/")) \(dates)"
    }

    /// Right side of a search row: "from $412", "none" or "failed".
    static func outcome(_ progress: SearchProgress?) -> String {
        switch progress?.state {
        case .done: progress?.cheapest.map { "from \(Money.usd($0))" } ?? "none"
        case .error: "failed"
        default: ""
        }
    }

    /// The search form as Plan's starting point (only when it has both airports).
    static func context(_ query: SearchQuery?) -> CanvasContext? {
        guard let query, !query.from.isEmpty, !query.to.isEmpty else { return nil }
        return CanvasContext(query: query)
    }

    /// The model's provider: the one picked when still connected, else codex, else grok.
    static func provider(picked: AIProvider?, status: AIStatus) -> AIProvider? {
        if let picked, status.isConnected(picked) { return picked }
        return status.defaultProvider
    }

    static let examples = [
        "Bay Area to New York for Thanksgiving week, back the Sunday after. Cheapest that isn't miserable.",
        "A long weekend in Mexico City from LA in early December, nonstop only.",
        "Business class Seattle to Tokyo in March for under $3,000 if possible.",
        "Chicago to London next spring, flexible by a few days, I'm bringing a checked bag.",
    ]

    static let lostConnection = "Lost the connection to the AI. Try again."

    /// What a failed stream shows: the server's sentence, or the lost-connection line.
    static func streamError(_ error: any Error) -> String? {
        if error.isCancellation { return nil }
        switch error as? APIError {
        case .server(_, let message)?: return message
        case .http?: return (error as? APIError)?.message
        default: return lostConnection
        }
    }
}
