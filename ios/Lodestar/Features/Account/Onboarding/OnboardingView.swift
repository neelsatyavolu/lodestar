import SwiftUI

/// "Set up Lodestar" (web `Onboarding`), presented by RootView while
/// `AppState.isOnboardingPresented` is true, right after a successful register. Closing it at any
/// point is "done" and starts the tour; the answers are saved when leaving the last question.
struct OnboardingView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var model: OnboardingModel?
    @State private var isConnectingAI = false

    var body: some View {
        Group {
            if let model {
                AccountSheetScaffold(title: "Set up Lodestar", onClose: { dismiss() }) {
                    OnboardingPageContent(model: model, aiConnected: app.aiStatus.anyConnected)
                } footer: {
                    OnboardingFooter(model: model, aiConnected: app.aiStatus.anyConnected,
                                     onConnect: { isConnectingAI = true }, onDone: { dismiss() })
                }
            } else {
                Color.card
            }
        }
        .onAppear { if model == nil { model = OnboardingModel(preferences: app.preferences) } }
        .sheet(isPresented: $isConnectingAI, onDismiss: aiSheetClosed) {
            AIConnectSheet().presentationBackground(Color.card)
        }
        .onDisappear { AccountTour.shared.start(app: app) }
    }

    /// The tour starts when the connect sheet closes (web), so finish onboarding then.
    private func aiSheetClosed() {
        Task {
            await app.refreshAIStatus()
            dismiss()
        }
    }
}

/// Progress bar, then the page's title, hint and controls; each page rises in.
private struct OnboardingPageContent: View {
    let model: OnboardingModel
    let aiConnected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            SegmentedProgress(total: OnboardingModel.pageCount, current: model.step)
                .animation(Motion.ease(0.2), value: model.step)
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(title)
                    .font(Font.geist(.sans, size: 22, relativeTo: .title2))
                    .foregroundStyle(Color.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(hint).textStyle(.bodySM).foregroundStyle(Color.mute)
                if let page = model.page {
                    OnboardingControls(page: page, draft: model.draft).padding(.top, Spacing.lg)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 220, alignment: .topLeading)
            .rise()
            .id(model.step)
        }
    }

    private var title: String {
        model.page?.title ?? OnboardingModel.aiTitle(connected: aiConnected)
    }

    private var hint: String {
        model.page?.hint ?? OnboardingModel.aiHint(connected: aiConnected)
    }
}

/// The controls for one question page (web `PAGES[n].body`).
private struct OnboardingControls: View {
    let page: OnboardingPage
    let draft: PreferencesDraft

    var body: some View {
        switch page {
        case .homeAirports:
            DraftCodePicker(draft: draft, field: .homeAirports, label: "Home airports")
        case .alliance:
            VStack(alignment: .leading, spacing: Spacing.xl) {
                AllianceChips(draft: draft)
                DraftCodePicker(draft: draft, field: .preferredAirlines, label: "Airlines to rank higher (optional)")
            }
        case .avoidAirlines:
            DraftCodePicker(draft: draft, field: .avoidedAirlines, label: "Never show these airlines")
        case .travel:
            TripDefaultFields(draft: draft, fields: [.cabin, .adults])
        case .bagsAndStops:
            TripDefaultFields(draft: draft, fields: [.bags, .stops])
        case .wontFly:
            PreferenceToggles(draft: draft, items: [("Red-eyes", \.avoidRedEyes), ("Basic economy", \.noBasicEconomy)])
        case .dining:
            DiningFields(draft: draft)
        case .doing:
            DoingFields(draft: draft)
        }
    }
}

/// Back; Skip and Next on questions (saving on the last); Maybe later / Connect, or Continue.
private struct OnboardingFooter: View {
    let model: OnboardingModel
    let aiConnected: Bool
    let onConnect: () -> Void
    let onDone: () -> Void
    @Environment(AppState.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if let error = model.draft.error { InlineError(message: error) }
            // One row when it fits; on narrow phones or large text (Back, Maybe later and
            // Connect ChatGPT or Grok don't fit in 335 pt) Back drops to its own row.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.sm) {
                    backButton
                    Spacer(minLength: 0)
                    actions
                }
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    HStack(spacing: Spacing.sm) {
                        Spacer(minLength: 0)
                        actions
                    }
                    backButton
                }
            }
        }
    }

    @ViewBuilder private var backButton: some View {
        if model.canGoBack {
            Button("Back") { model.back() }.buttonStyle(.lodestar(.ghost)).disabled(model.isSaving)
        }
    }

    @ViewBuilder private var actions: some View {
        if model.isAIPage { aiButtons } else { questionButtons }
    }

    @ViewBuilder private var aiButtons: some View {
        if aiConnected {
            Button("Continue", action: onDone).buttonStyle(.lodestar(.primary))
        } else {
            Button("Maybe later", action: onDone).buttonStyle(.lodestar(.ghost))
            Button("Connect ChatGPT or Grok", action: onConnect).buttonStyle(.lodestar(.primary))
        }
    }

    @ViewBuilder private var questionButtons: some View {
        Button("Skip") { advance() }
            .buttonStyle(.lodestar(.quiet))
            .padding(.horizontal, Spacing.sm)
            .disabled(model.isSaving)
        Button(model.nextTitle) { advance() }
            .buttonStyle(.lodestar(.primary, isLoading: model.isSaving))
            .disabled(model.isSaving)
    }

    private func advance() {
        Task { await model.advance(save: { try await app.savePreferences($0) }, report: { app.handle($0) }) }
    }
}
