import SwiftUI

/// Itinerary (`itinerary-tab.tsx`): day by day, with drive times, ideas and hotel picks.
struct TripItineraryTab: View {
    let model: TripDetailModel
    let present: (TripsTripSheet) -> Void

    var body: some View {
        let days = model.days
        VStack(alignment: .leading, spacing: Spacing.lg) {
            SectionHeader(title: "Itinerary", detail: days.isEmpty ? nil : "Tap a stop for details. Numbers match the map.")
            if model.journey.canEdit { actions(hasDays: !days.isEmpty) }
            if let kind = model.drafter.suggesting {
                LoadingStateView(message: kind == .dining ? "Planning meals around your days…" : "Searching live hotel prices…")
            }
            TripsHotelIdeas(model: model, present: present)
            if days.isEmpty {
                EmptyStateView(title: "Add dates to plan day by day",
                               message: "Once the trip has dates, each day gets its own list, and your AI can draft them.",
                               actionTitle: "Add dates") { present(.edit) }
            } else {
                if !model.trip.items.contains(where: { $0.isLive && $0.kind != .stay && $0.kind != .flight }) {
                    EmptyStateView(title: "The days are empty",
                                   message: "Your AI can draft a day-by-day plan around what's already booked and what you like. Or add places to each day below.")
                }
                ForEach(days, id: \.self) { day in
                    TripsDaySection(model: model, day: day, index: days.firstIndex(of: day) ?? 0, present: present)
                        .id(day.string)
                }
                if model.trip.items.contains(where: { $0.kind == .dining && $0.status == .suggested }) {
                    Text("Meal ideas come from the AI's knowledge, not live listings. Check hours and book ahead.")
                        .textStyle(.caption).foregroundStyle(Color.ash)
                }
            }
        }
    }

    private func actions(hasDays: Bool) -> some View {
        let day = model.activeDay ?? model.days.first ?? model.journey.startDate ?? .today()
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                Button("Add") { present(.addItem(.activity, day)) }.buttonStyle(.lodestar(.primary, small: true))
                Button(model.itineraryAILabel) { Task { await model.draft(.itinerary) } }
                    .buttonStyle(.lodestar(.ghost, small: true, isLoading: model.drafter.running == .itinerary))
                    .disabled(model.drafter.isBusy || !hasDays)
                Button("Plan meals") { Task { await model.suggest(.dining) } }
                    .buttonStyle(.lodestar(.ghost, small: true, isLoading: model.drafter.suggesting == .dining))
                    .disabled(model.drafter.isBusy || !model.canPlanMeals)
                Button("Find hotels") { Task { await model.suggest(.hotels) } }
                    .buttonStyle(.lodestar(.ghost, small: true, isLoading: model.drafter.suggesting == .hotels))
                    .disabled(model.drafter.isBusy || !model.canFindHotels)
                Button { present(.map) } label: { Label("Map", systemImage: "map") }
                    .buttonStyle(.lodestar(.ghost, small: true))
            }
        }
        .scrollClipDisabled()
    }
}

/// Suggested stays: Keep / Dismiss / See prices.
struct TripsHotelIdeas: View {
    let model: TripDetailModel
    let present: (TripsTripSheet) -> Void

    var body: some View {
        let ideas = model.trip.items.filter { $0.kind == .stay && $0.status == .suggested }
        if !ideas.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(title: "Hotel ideas")
                ForEach(ideas) { item in
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(item.title).textStyle(.bodyMD).foregroundStyle(Color.ink)
                        if let line = Self.priceLine(item) {
                            Text(line).textStyle(.caption).foregroundStyle(Color.mute)
                        }
                        if let why = item.details.why { Text(why).textStyle(.bodySM).foregroundStyle(Color.bodyText) }
                        HStack(spacing: Spacing.sm) {
                            Button("Keep") { Task { await model.patchItem(item.id, TripsRequests.status(.planned)) } }
                                .buttonStyle(.lodestar(.ghost, small: true))
                            Button("Dismiss") { Task { await model.removeItem(item.id) } }
                                .buttonStyle(.lodestar(.quiet, small: true))
                            if let url = item.details.url.flatMap(URL.init(string:)) {
                                Button("See prices") { present(.web(url)) }.buttonStyle(.lodestar(.link))
                            }
                        }
                        .disabled(model.busyItems.contains(item.id))
                    }
                    .card()
                }
            }
        }
    }

    /// "From $X a night on today's search · rated R".
    nonisolated static func priceLine(_ item: TripItem) -> String? {
        let price = item.details.price.map { "From \(Money.amount($0, currency: item.details.currencyCode)) a night on today's search" }
        let rating = item.details.rating.map { "rated \(String(format: "%.1f", $0))" }
        let parts = [price, rating].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
