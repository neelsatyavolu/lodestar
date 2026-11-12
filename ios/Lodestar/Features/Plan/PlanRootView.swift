import SwiftUI

/// The Plan tab. Keeps the type name `PlanRootView()` (RootView references it).
struct PlanRootView: View {
    @Environment(AppState.self) private var app
    @State private var model: PlanModel?

    var body: some View {
        Group {
            if let model {
                PlanScreen(model: model)
            } else {
                Color.canvas.ignoresSafeArea()
            }
        }
        .onAppear {
            if model == nil { model = PlanModel(service: .live(app.api), handle: { [app] in app.handle($0) }) }
        }
    }
}

private struct PlanScreen: View {
    @Bindable var model: PlanModel
    @Environment(AppState.self) private var app

    private var inputs: PlanInputs {
        PlanInputs(status: app.aiStatus, preferences: app.preferences, flightForm: app.flightForm)
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.xl) {
                        PlanConnectionRow()
                        if !model.hasStarted {
                            HeroTitle(line1: "Say the trip.", line2: "Get the shortlist.", paragraph: PlanCopy.hero)
                        }
                        ForEach(Array(model.turns.enumerated()), id: \.element.id) { index, turn in
                            if index > 0 { Hairline() }
                            turnView(turn, isLatest: index == model.turns.count - 1).id(turn.id)
                        }
                        PlanComposerView(model: model, inputs: inputs, onConnect: { app.present(.connectAI) })
                            .id(PlanCopy.composerAnchor)
                        if !model.hasStarted { examples }
                    }
                    .padding(.horizontal, Spacing.gutter)
                    .padding(.vertical, Spacing.xl)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: model.turns.last?.id) { _, id in
                    guard let id else { return }
                    withAnimation(Motion.enter) { proxy.scrollTo(id, anchor: .top) }
                }
            }
            .canvasBackground()
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Itinerary.self) { it in
                ItineraryDetailView(itinerary: it, checks: model.checks, trustedOnly: app.trustedOnly)
            }
        }
    }

    private func turnView(_ turn: PlanTurn, isLatest: Bool) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            PlanTurnView(
                turn: turn,
                isLatest: isLatest,
                checks: model.checks,
                trustedOnly: app.trustedOnly,
                onFollowup: { model.run($0, inputs: inputs) }
            ) {
                if !turn.isRunning, turn.hasPicks {
                    TripSaveControl(
                        state: turn.save,
                        isSignedIn: app.isSignedIn,
                        onSave: { Task { await model.saveTrip(turn.id, preferences: app.preferences) } },
                        onSignIn: { app.present(.signIn) },
                        onOpen: { app.openSavedTrip(id: $0) }
                    )
                }
            }
            if isLatest, model.needsOrigin(homeAirports: app.preferences.homeAirports) {
                PlanOriginAskView { codes in await saveHome(codes) }
            }
        }
    }

    private var examples: some View {
        VStack(spacing: Spacing.sm) {
            ForEach(PlanLogic.examples, id: \.self) { example in
                Button {
                    if PlanLogic.provider(picked: model.pickedProvider, status: app.aiStatus) != nil {
                        model.run(example, inputs: inputs)
                    } else {
                        model.prompt = example
                    }
                } label: {
                    Text(example)
                        .textStyle(.chip)
                        .foregroundStyle(Color.mute)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Spacing.lg)
                        .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.lg))
                        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairline, lineWidth: Sizes.hairline))
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// Writes home airports to preferences, then asks the same thing again in place.
    private func saveHome(_ codes: [String]) async -> String? {
        var prefs = app.preferences
        prefs.homeAirports = codes
        do {
            try await app.savePreferences(prefs)
        } catch {
            return error.userMessage
        }
        model.replanWithHome(codes, inputs: inputs)
        return nil
    }
}

/// The Connect button while no AI is connected. Once one is, the row goes away (as the web's
/// header badge did); disconnecting lives in Account.
private struct PlanConnectionRow: View {
    @Environment(AppState.self) private var app

    var body: some View {
        if !app.aiStatus.anyConnected {
            HStack(spacing: Spacing.sm) {
                Pill(text: "No AI connected", dot: .neutral)
                Button("Connect AI") { app.present(.connectAI) }.buttonStyle(.lodestar(.link)).textStyle(.caption)
                    .frame(minHeight: Sizes.button)
                Spacer()
            }
        }
    }
}

enum PlanCopy {
    static let hero = "Your ChatGPT or Grok account plans several live searches at once (other airports, other days, other cabins), then lays the best options out with the reasons and the catches."
    static let composerAnchor = "plan-composer"
}
