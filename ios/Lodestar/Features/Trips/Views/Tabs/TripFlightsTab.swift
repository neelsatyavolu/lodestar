import SwiftUI

/// Flights (`flights-tab.tsx`): every flight on the trip as a card, in order, with live status on travel day.
struct TripFlightsTab: View {
    let model: TripDetailModel
    let present: (TripsTripSheet) -> Void

    var body: some View {
        let items = model.trip.items
        let groups = Dictionary(uniqueKeysWithValues: TripsFlights.groups(items).map { ($0.flight.id, $0) })
        let list = TripsPlan.byItinerary(items.filter { $0.kind == .flight && $0.status != .suggested })
        let day = model.activeDay ?? model.journey.startDate ?? .today()
        VStack(alignment: .leading, spacing: Spacing.lg) {
            HStack(alignment: .bottom) {
                SectionHeader(title: "Flights", detail: list.isEmpty ? nil
                              : (model.flights.live ? "Live status, gates and delays refresh every few minutes on travel day." : "Times as booked."))
                if model.journey.canEdit && !list.isEmpty {
                    Button { present(.addItem(.flight, day)) } label: { Label("Add flight", systemImage: "plus") }
                        .buttonStyle(.lodestar(.ghost, small: true))
                }
            }
            if list.isEmpty {
                EmptyStateView(title: "No flights yet",
                               message: "Forward an airline confirmation to your Lodestar address, or add a flight by hand. Each one gets live status on travel day.",
                               actionTitle: model.journey.canEdit ? "Add flight" : nil) { present(.addItem(.flight, day)) }
            }
            ForEach(list) { flight in
                let group = groups[flight.id] ?? TripsFlightGroup(flight: flight, departure: nil, arrival: nil)
                let status = model.flightStatus(flight.id)
                TripsFlightCard(item: flight, view: TripsFlightView(group: group, status: status), travelers: model.journey.travelers,
                                checkedAt: status?.checkedAt, liveOn: model.flights.live) { present(.place(flight.id)) }
                    .id(flight.id)
            }
        }
    }
}
