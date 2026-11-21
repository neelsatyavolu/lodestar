import SwiftUI

/// Where the Trips stack can go.
struct TripsRoute: Hashable {
    let id: String
    var tab: TripsTab = .overview
    /// "Create and draft": run the full AI draft once the page opens.
    var draftWishes: String?
}

/// The Trips tab. RootView always shows it, so it appears at launch with the other tabs;
/// signed out it asks to sign in.
struct TripsRootView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        switch app.session {
        case .checking:
            LoadingStateView(message: "Loading…").padding(Spacing.gutter).canvasBackground()
        case .signedOut:
            TripsSignedOutView()
        case .signedIn:
            TripsHomeScreen(app: app)
        }
    }
}

private struct TripsSignedOutView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                HeroTitle(line1: "Trips", paragraph: TripsHomeView.heroParagraph)
                EmptyStateView(title: "Sign in to see your trips.",
                               message: "Your trips, checklists and fare alerts live with your account.",
                               actionTitle: "Sign in") { app.present(.signIn) }
            }
            .padding(Spacing.gutter)
        }
        .canvasBackground()
    }
}

/// Owns the list model and the navigation stack.
struct TripsHomeScreen: View {
    @State private var model: TripsListModel
    @State private var path: [TripsRoute] = []

    init(app: AppState) {
        _model = State(initialValue: TripsListModel(app: app))
    }

    var body: some View {
        NavigationStack(path: $path) {
            TripsHomeView(model: model) { path.append($0) }
                .navigationDestination(for: TripsRoute.self) { route in
                    if let journey = model.journey(id: route.id) {
                        TripDetailScreen(app: model.app, journey: journey, route: route) { detail in
                            if detail == nil {
                                // Deleted or left: drop it once the page has popped, so the closing
                                // page doesn't flash "That trip doesn't exist."
                                Task {
                                    try? await Task.sleep(for: .milliseconds(600))
                                    model.apply(nil, removing: route.id)
                                }
                            } else {
                                model.apply(detail, removing: nil)
                            }
                        }
                    } else {
                        ErrorStateView(message: "That trip doesn't exist.").padding(Spacing.gutter).canvasBackground()
                    }
                }
        }
        #if DEBUG
        .task { await openDebugTrip() }
        #endif
    }

    #if DEBUG
    /// `-LodestarTrip <id> -LodestarTripTab flights` opens a trip on a tab, for simulator screenshots.
    private func openDebugTrip() async {
        let defaults = UserDefaults.standard
        guard let id = defaults.string(forKey: "LodestarTrip"), path.isEmpty else { return }
        let tab = defaults.string(forKey: "LodestarTripTab").flatMap(TripsTab.init(rawValue:)) ?? .overview
        for _ in 0..<40 where model.journey(id: id) == nil {
            try? await Task.sleep(for: .milliseconds(250))
        }
        if model.journey(id: id) != nil { path.append(TripsRoute(id: id, tab: tab)) }
    }
    #endif
}
