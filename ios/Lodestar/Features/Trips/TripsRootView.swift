import SwiftUI

/// Where the Trips stack can go.
struct TripsRoute: Hashable {
    let id: String
    var tab: TripsTab = .overview
    /// "Create and draft": run the full AI draft once the page opens.
    var draftWishes: String?
}

/// The Trips tab. RootView shows it only when signed in; the signed-out state is still handled
/// in case the session ends while the tab is on screen.
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
                            model.apply(detail, removing: detail == nil ? route.id : nil)
                        }
                    } else {
                        ErrorStateView(message: "That trip doesn't exist.").padding(Spacing.gutter).canvasBackground()
                    }
                }
        }
    }
}
