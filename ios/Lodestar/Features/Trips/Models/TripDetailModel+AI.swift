import Foundation

/// AI drafting on the trip page, with the traveller's own ChatGPT or Grok.
extension TripDetailModel {
    var aiName: String { app.aiStatus.defaultProvider?.displayName ?? "ChatGPT" }
    var hasAI: Bool { app.aiStatus.anyConnected }

    /// One part ("Draft the days", "Write a checklist", ...).
    func draft(_ part: PlanPart) async {
        error = nil
        notice = nil
        let result = await drafter.run(part, tripId: id, wishes: nil) { [weak self] in self?.adopt($0) }
        notice = result.notice
        error = result.error
    }

    /// The full draft after "Create and draft".
    func draftEverything(wishes: String?) async {
        error = nil
        notice = nil
        let trimmed = wishes?.trimmingCharacters(in: .whitespacesAndNewlines)
        let result = await drafter.runAll(tripId: id, wishes: trimmed?.isEmpty == false ? trimmed : nil) { [weak self] in self?.adopt($0) }
        notice = result.notice
        error = result.error
    }

    /// "Plan meals" / "Find hotels". The web merges only the items.
    func suggest(_ kind: SuggestRequest.Kind) async {
        error = nil
        error = await drafter.suggest(kind, tripId: id) { [weak self] items in
            guard let self else { return }
            self.adopt(self.trip.with(items: items))
        }
    }

    var canPlanMeals: Bool { journey.startDate != nil }
    var canFindHotels: Bool { journey.startDate != nil && journey.destination != nil }

    /// "Fill gaps with AI" once the trip has its own plans, else "Draft the days".
    var itineraryAILabel: String {
        trip.items.contains { $0.kind != .flight && $0.kind != .stay && $0.status != .cancelled } ? "Fill gaps with AI" : "Draft the days"
    }
}
