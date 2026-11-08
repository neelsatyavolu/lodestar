import Foundation
import Observation

/// The eight question pages of "Set up Lodestar" (web `components/onboarding.tsx`), in order.
enum OnboardingPage: Int, CaseIterable, Sendable {
    case homeAirports, alliance, avoidAirlines, travel, bagsAndStops, wontFly, dining, doing

    var title: String {
        switch self {
        case .homeAirports: "Where do you usually fly from?"
        case .alliance: "Do you stick to an alliance?"
        case .avoidAirlines: "Any airlines you'd rather skip?"
        case .travel: "How do you usually travel?"
        case .bagsAndStops: "Bags and stops?"
        case .wontFly: "Anything you won't fly?"
        case .dining: "How do you like to eat when you travel?"
        case .doing: "And the rest of the day?"
        }
    }

    var hint: String {
        switch self {
        case .homeAirports:
            "Your home airports fill in new searches, and Plan uses them when you don't say where you're leaving from."
        case .alliance: "Handy if you collect miles or have status. Leave it blank to see every airline."
        case .avoidAirlines: "They won't show up in search results or in Plan."
        case .travel: "The defaults for new searches. You can change them on any search."
        case .bagsAndStops: "Prices include checked bags when you add them, so the cheapest fare is the real cheapest."
        case .wontFly: "Turn these on to hide those flights everywhere."
        case .dining: "Trips uses this when you ask for a dining plan. Pick a few, or skip."
        case .doing: "For activity ideas and hotel picks on your trips."
        }
    }
}

/// Paging and saving for onboarding. Pages 1-7 just advance (Skip keeps edits); leaving page 8
/// by Skip or Next saves the whole object, so closing on the AI page keeps the answers.
@MainActor
@Observable
final class OnboardingModel {
    static let questionCount = OnboardingPage.allCases.count
    /// The question pages plus the AI page.
    static let pageCount = questionCount + 1

    let draft: PreferencesDraft
    private(set) var step = 0
    private(set) var hasSaved = false

    init(preferences: Preferences) {
        draft = PreferencesDraft(preferences)
    }

    var page: OnboardingPage? { OnboardingPage(rawValue: step) }
    var isAIPage: Bool { step == Self.questionCount }
    var canGoBack: Bool { step > 0 }
    var isSaving: Bool { draft.isSaving }
    var nextTitle: String { draft.isSaving ? "Saving…" : "Next" }

    func back() {
        guard step > 0, !draft.isSaving else { return }
        draft.clearError()
        step -= 1
    }

    /// Next and Skip behave the same: both advance, and both save on the last question.
    func advance(save: @MainActor (Preferences) async throws -> Void,
                 report: @MainActor (any Error) -> String?) async {
        guard !isAIPage, !draft.isSaving else { return }
        draft.clearError()
        if step < Self.questionCount - 1 {
            step += 1
            return
        }
        if await draft.save(using: save, report: report) {
            hasSaved = true
            step = Self.questionCount
        }
    }

    /// AI page copy depends on whether ChatGPT or Grok is connected.
    static func aiTitle(connected: Bool) -> String {
        connected ? "Plan is ready to go." : "Last step: connect your AI."
    }

    static func aiHint(connected: Bool) -> String {
        connected
            ? "Your AI account is connected. Next, a quick look at how Plan works."
            : "Plan turns a sentence like “Chennai over the holidays, nonstop if it's close” into several live searches and a shortlist. It runs on your own ChatGPT or Grok subscription, and the connection is saved to your account."
    }
}
