import SwiftUI

/// One hotel: photo, facts, every amenity, and who sells it with taxes and fees.
/// Fetches `/api/stays/prices` once per result set (the model caches it).
struct StayDetailView: View {
    let model: StaysSearchModel
    let hotel: Hotel
    let trustedOnly: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                RemoteImage(source: hotel.image, cornerRadius: Radius.lg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 200)
                HStack(alignment: .top, spacing: Spacing.md) {
                    StayFacts(hotel: hotel, amenityLines: nil)
                    Spacer(minLength: 0)
                    StayFromPrice(price: hotel.price)
                }
                if let query = model.results?.query {
                    Text(StaysCopy.subtitle(query)).textStyle(.bodySM).foregroundStyle(Color.mute)
                }
                sellers
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.sm)
            .padding(.bottom, Spacing.xxxl)
        }
        .canvasBackground()
        .navigationTitle(hotel.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(Color.canvas, for: .navigationBar)
        .onAppear { model.loadPrices(for: hotel) }
    }

    private var sellers: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(StaysCopy.sellersTitle).textStyle(.caption).foregroundStyle(Color.ash)
            switch model.priceState(for: hotel) {
            case .idle, .loading:
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    ForEach(0..<3, id: \.self) { _ in Skeleton(height: 48, radius: Radius.md) }
                    LoadingStateView(message: StaysCopy.pricesLoading)
                }
            case .failed(let message):
                ErrorStateView(message: message) { model.loadPrices(for: hotel, force: true) }
            case .loaded(let prices):
                StayOffersPanel(prices: prices, nights: model.results?.query.nights ?? 1, trustedOnly: trustedOnly)
            }
        }
        .card()
    }
}
