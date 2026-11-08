import Foundation
import Observation

/// Copy for each part the AI can draft (`ai-draft.tsx`).
extension PlanPart {
    static let draftOrder: [PlanPart] = [.itinerary, .toBook, .checklist, .notes, .budget]

    var draftLabel: String {
        switch self {
        case .itinerary: "Days"
        case .toBook: "To book"
        case .checklist: "Checklist"
        case .notes: "Notes"
        case .budget, .unknown: "Budget"
        }
    }

    var draftDoing: String {
        switch self {
        case .itinerary: "Drafting the days"
        case .toBook: "Finding what to book"
        case .checklist: "Writing the checklist"
        case .notes: "Writing notes"
        case .budget, .unknown: "Estimating costs"
        }
    }

    var draftAction: String {
        switch self {
        case .itinerary: "Draft the days"
        case .toBook: "Find what to book"
        case .checklist: "Write a checklist"
        case .notes: "Write notes"
        case .budget, .unknown: "Estimate costs"
        }
    }
}

/// Progress of AI drafting on one trip: a single part, or the full five-part draft.
@MainActor
@Observable
final class TripsDraftRunner {
    enum PartState: Equatable, Sendable { case waiting, running, done, failed }

    let app: AppState
    private(set) var running: PlanPart?
    private(set) var parts: [PlanPart: PartState] = [:]
    private(set) var isFullDraft = false
    private(set) var elapsed = 0
    private(set) var suggesting: SuggestRequest.Kind?
    private var ticker: Task<Void, Never>?

    init(app: AppState) {
        self.app = app
    }

    var isBusy: Bool { running != nil || suggesting != nil }

    var doneCount: Int { parts.values.filter { $0 == .done }.count }

    /// "Drafting the days… 12s · this usually takes under a minute".
    var runningLine: String? {
        guard let running else { return nil }
        if isFullDraft {
            return "\(running.draftDoing)… \((PlanPart.draftOrder.firstIndex(of: running) ?? 0) + 1)/5"
        }
        return "\(running.draftDoing)… \(elapsed)s" + (elapsed >= 20 ? " · this usually takes under a minute" : "")
    }

    /// Runs one part. `apply` receives the trip the server answers.
    /// Returns the notice or error line to show.
    func run(_ part: PlanPart, tripId: String, wishes: String?, apply: (TripDetail) -> Void) async -> (notice: String?, error: String?) {
        guard let provider = app.aiStatus.defaultProvider else {
            app.present(.connectAI)
            return (nil, nil)
        }
        start(part)
        defer { stop() }
        do {
            let answer = try await app.api.send(API.Journeys.generate(tripId, GenerateRequest(provider: provider, part: part, wishes: wishes)))
            apply(answer.journey)
            parts[part] = .done
            let name = provider.displayName
            return (answer.added > 0 ? "Added \(answer.added) from \(name). Edit or remove anything." : "\(name) had nothing new to add.", nil)
        } catch {
            parts[part] = .failed
            return (nil, message(for: error))
        }
    }

    /// "Create and draft": every part in order; failures don't stop the rest.
    func runAll(tripId: String, wishes: String?, apply: (TripDetail) -> Void) async -> (notice: String?, error: String?) {
        guard let provider = app.aiStatus.defaultProvider else { return (nil, nil) }
        isFullDraft = true
        parts = Dictionary(uniqueKeysWithValues: PlanPart.draftOrder.map { ($0, PartState.waiting) })
        var lastError: String?
        for part in PlanPart.draftOrder {
            let result = await run(part, tripId: tripId, wishes: wishes, apply: apply)
            if let e = result.error { lastError = e }
            if Task.isCancelled { break }
        }
        isFullDraft = false
        return ("\(provider.displayName) drafted \(doneCount) of 5 parts. Look it over and change anything.", lastError)
    }

    /// "Plan meals" / "Find hotels": replaces earlier suggestions of that kind.
    func suggest(_ kind: SuggestRequest.Kind, tripId: String, apply: ([TripItem]) -> Void) async -> String? {
        guard let provider = app.aiStatus.defaultProvider else {
            app.present(.connectAI)
            return nil
        }
        suggesting = kind
        defer { suggesting = nil }
        do {
            apply(try await app.api.send(API.Journeys.suggest(tripId, SuggestRequest(provider: provider, kind: kind))).journey.items)
            return nil
        } catch {
            return message(for: error)
        }
    }

    private func message(for error: any Error) -> String? {
        if let api = error as? APIError {
            if api.needsAIConnection { app.present(.connectAI) }
            if api.isNotFound { return "AI drafting isn't available on this server yet. Add things by hand for now." }
        }
        return app.handle(error)
    }

    private func start(_ part: PlanPart) {
        running = part
        parts[part] = .running
        elapsed = 0
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { return }
                self?.elapsed += 1
            }
        }
    }

    private func stop() {
        running = nil
        ticker?.cancel()
        ticker = nil
    }
}
