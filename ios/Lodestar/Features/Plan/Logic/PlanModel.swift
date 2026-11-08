import Foundation
import Observation

/// The calls Plan makes, as closures so the conversation can be tested offline.
struct PlanService: Sendable {
    var canvas: @Sendable (CanvasRequest) -> AsyncThrowingStream<CanvasEvent, any Error>
    var saveTrip: @Sendable (SaveTripRequest) async throws -> String
    var sellers: FlightSellerChecks.Sender

    static func live(_ api: APIClient) -> PlanService {
        PlanService(
            canvas: { api.stream(API.AI.canvas($0)) },
            saveTrip: { try await api.send(API.SavedTrips.save($0)).id },
            sellers: { try await api.send(API.Flights.sellers($0)) }
        )
    }
}

/// What a run needs from the rest of the app, captured when the message is sent.
struct PlanInputs: Sendable {
    let status: AIStatus
    let preferences: Preferences
    let flightForm: SearchQuery?
}

/// The Plan conversation (web `components/ai-canvas.tsx`). Only the newest run may touch its
/// turn; sending again or "New trip" cancels the stream, which stops the server spending the
/// user's subscription.
@MainActor
@Observable
final class PlanModel {
    var prompt = ""
    /// The provider chosen in the switch (shown only when both are connected).
    var pickedProvider: AIProvider?
    /// An `AIModel.id`; nil = "Default model".
    var modelID: String?

    private(set) var turns: [PlanTurn] = []
    let checks: FlightSellerChecks

    @ObservationIgnored private let service: PlanService
    @ObservationIgnored private let handle: @MainActor (any Error) -> String?
    @ObservationIgnored private var runTask: Task<Void, Never>?
    @ObservationIgnored private var runID: UUID?

    init(service: PlanService,
         handle: @escaping @MainActor (any Error) -> String? = { $0.isCancellation ? nil : $0.userMessage }) {
        self.service = service
        self.handle = handle
        self.checks = FlightSellerChecks(send: service.sellers)
    }

    var hasStarted: Bool { !turns.isEmpty }
    var isRunning: Bool { turns.last?.isRunning ?? false }

    func canSend(_ inputs: PlanInputs) -> Bool {
        PlanLogic.provider(picked: pickedProvider, status: inputs.status) != nil
            && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isRunning
    }

    /// Sends `text` as the next message. `history` and `defaults` let "Save and plan" replace
    /// the last turn with home airports filled in.
    func run(_ text: String, inputs: PlanInputs, replacingLast: Bool = false, defaults: CanvasDefaults? = nil) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let provider = PlanLogic.provider(picked: pickedProvider, status: inputs.status),
              !trimmed.isEmpty, !isRunning || replacingLast else { return }
        runTask?.cancel()
        let earlier = replacingLast ? Array(turns.dropLast()) : turns
        let turn = PlanTurn(prompt: trimmed)
        let models = inputs.status.models(for: provider)
        let request = CanvasRequest(
            provider: provider,
            model: modelID.flatMap { id in models.contains { $0.id == id } ? id : nil },
            prompt: String(trimmed.prefix(PlanLogic.maxPrompt)),
            context: PlanLogic.context(inputs.flightForm),
            history: PlanLogic.history(earlier),
            defaults: defaults ?? CanvasDefaults(preferences: inputs.preferences),
            filters: SearchFilters(preferences: inputs.preferences)
        )
        turns = earlier + [turn]
        prompt = ""
        runID = turn.id
        runTask = Task { await self.consume(request, turnID: turn.id) }
    }

    private func consume(_ request: CanvasRequest, turnID: UUID) async {
        do {
            for try await event in service.canvas(request) {
                guard runID == turnID else { return }
                replace(turnID) { $0.applying(event) }
            }
            replace(turnID) { $0.finished() }
        } catch {
            guard runID == turnID else { return }
            let message = PlanLogic.streamError(error)
            if message != nil { _ = handle(error) }
            replace(turnID) { $0.finished(error: message) }
        }
    }

    /// "New trip": clears the conversation and aborts the run.
    func newTrip() {
        runTask?.cancel()
        runTask = nil
        runID = nil
        turns = []
        prompt = ""
    }

    /// Stops the run when the screen goes away for good.
    func cancel() {
        runTask?.cancel()
        runID = nil
        if let last = turns.last, last.isRunning { turns = Array(turns.dropLast()) + [last.finished()] }
    }

    /// Saving a home airport answers the planner's question: ask the same thing again in place.
    func replanWithHome(_ codes: [String], inputs: PlanInputs) {
        guard let last = turns.last else { return }
        var defaults = CanvasDefaults(preferences: inputs.preferences)
        defaults.homeAirports = codes
        run(last.prompt, inputs: inputs, replacingLast: true, defaults: defaults)
    }

    /// Whether to ask for the origin under the latest finished turn.
    func needsOrigin(homeAirports: [String]) -> Bool {
        guard let last = turns.last else { return false }
        return !last.isRunning && (last.plan?.needsOrigin ?? false) && homeAirports.isEmpty
    }

    /// Saves a finished shortlist with its searches, so Trips can re-check the fare daily.
    func saveTrip(_ turnID: UUID, preferences: Preferences) async {
        guard let turn = turns.first(where: { $0.id == turnID }), !turn.save.isSaving else { return }
        guard let request = PlanLogic.saveRequest(turn, filters: SearchFilters(preferences: preferences)) else {
            replace(turnID) { $0.withSave(.failed("Nothing to save yet.")) }
            return
        }
        replace(turnID) { $0.withSave(.saving) }
        do {
            let id = try await service.saveTrip(request)
            replace(turnID) { $0.withSave(.saved(id: id)) }
        } catch {
            let message = handle(error)
            replace(turnID) { $0.withSave(message.map(TripSaveState.failed) ?? .idle) }
        }
    }

    private func replace(_ id: UUID, _ change: (PlanTurn) -> PlanTurn) {
        turns = turns.map { $0.id == id ? change($0) : $0 }
    }
}
