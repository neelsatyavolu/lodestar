import SwiftUI

/// The Stays tab: hotel search over Google Hotels with every seller's price checked.
/// Works signed in or out (the Stays routes need no account).
struct StaysRootView: View {
    @Environment(AppState.self) private var app
    @State private var model: StaysSearchModel?

    var body: some View {
        NavigationStack {
            Group {
                if let model {
                    StaysScreen(model: model)
                } else {
                    Color.canvas
                }
            }
            .canvasBackground()
            .toolbar(.hidden, for: .navigationBar)
        }
        .onAppear { if model == nil { model = makeModel() } }
    }

    private func makeModel() -> StaysSearchModel {
        let app = app
        return StaysSearchModel(
            service: StaysAPIService(api: app.api),
            errorText: { error, fallback in
                guard let message = app.handle(error) else { return nil }
                return error is APIError ? message : fallback
            }
        )
    }
}

/// Hero (before the first search), form, then results.
private struct StaysScreen: View {
    let model: StaysSearchModel
    @Environment(AppState.self) private var app

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                if model.results == nil {
                    HeroTitle(line1: StaysCopy.heroLine1, line2: StaysCopy.heroLine2, paragraph: StaysCopy.heroBody)
                        .padding(.top, Spacing.screenTop - Spacing.lg)
                        .rise()
                }
                StaysFormView(model: model)
                if let error = model.searchError {
                    InlineError(message: error)
                        .card()
                }
                content
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.lg)
            .padding(.bottom, Spacing.xxxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationDestination(for: StaysDetailRoute.self) { route in
            if let hotel = model.results?.hotels.first(where: { $0.key == route.hotelKey }),
               model.results?.id == route.resultsID {
                StayDetailView(model: model, hotel: hotel, trustedOnly: app.trustedOnly)
            } else {
                EmptyStateView(title: "This stay is from an older search.")
                    .padding(Spacing.gutter)
            }
        }
    }

    @ViewBuilder private var content: some View {
        if let results = model.results {
            StaysResultsView(model: model, results: results)
        } else if model.isSearching {
            SkeletonList(count: 4, height: 112)
        }
    }
}

/// Navigation value for a hotel of one result set.
struct StaysDetailRoute: Hashable {
    let resultsID: Int
    let hotelKey: String
}
