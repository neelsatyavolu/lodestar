import Foundation

/// What one itinerary day draws (`day-section.tsx`): the stays that open and close it, the firm
/// stops with flights folded into one card, the drive between each pair of stops (never across a
/// flight), and the hotel the route ends at. Pure, so tests cover the drive rules.
struct TripsDayPlan: Sendable {
    let date: LocalDate
    /// The stays you wake up in or check out of.
    let morning: [TripItem]
    /// The stays you check into.
    let evening: [TripItem]
    /// Stops, notes and flights in order, without folded airport stops.
    let firm: [TripItem]
    let ideas: [TripItem]
    /// Flight id → the flight and the airport stops folded into its card.
    let groups: [String: TripsFlightGroup]
    let folded: Set<String>
    /// The drive route: morning hotel → stops (a flight at its arrival airport) → night hotel.
    let stops: [TripItem]
    /// Stops whose next leg is a flight, not a drive.
    let flown: Set<String>
    /// The hotel the route ends at, on a day you didn't check into it ("back to the hotel").
    let night: TripItem?

    init(items: [TripItem], date: LocalDate) {
        self.date = date
        let onDay = items.filter { $0.startDate == date && !($0.kind == .stay && $0.status == .suggested) }
        let groupList = TripsFlights.groups(items)
        groups = Dictionary(uniqueKeysWithValues: groupList.map { ($0.flight.id, $0) })
        folded = TripsFlights.foldedIds(groupList)
        let folded = self.folded
        firm = TripsPlan.byItinerary(onDay.filter { $0.status != .suggested && $0.kind != .stay && !folded.contains($0.id) })
        ideas = TripsPlan.byItinerary(onDay.filter { $0.status == .suggested })
        let stays = items.filter {
            $0.kind == .stay && ($0.status == .booked || $0.status == .planned) && $0.startDate <= date && ($0.endDate ?? $0.startDate) >= date
        }
        morning = stays.filter { $0.startDate < date }
        evening = stays.filter { $0.startDate == date }
        let stops = TripsPlan.dayStops(items, date: date)
        self.stops = stops
        flown = Set(stops.indices.dropLast().filter { k in
            let s = stops[k], next = stops[k + 1]
            // Into a flight, across one, or from the plane to a stop folded into its card.
            return next.kind == .flight || TripsFlights.flightBetween(items, date: date, s, next) || (s.kind == .flight && folded.contains(next.id))
        }.map { stops[$0].id })
        let last = stops.last
        let evening = self.evening
        night = stops.count > 1 && last?.kind == .stay && !evening.contains(where: { $0.id == last?.id }) ? last : nil
    }

    /// The drive after `item` on the route, as (from, to), or nil when there's none to show.
    func legAfter(_ item: TripItem) -> (from: TripItem, to: TripItem)? {
        guard let k = stops.firstIndex(where: { $0.id == item.id }), k + 1 < stops.count, !flown.contains(item.id) else { return nil }
        return (item, stops[k + 1])
    }

    /// The leg drawn under a flight card: from its folded arrival stop when that's on the route, else from the flight.
    func legAfterFlight(_ group: TripsFlightGroup) -> (from: TripItem, to: TripItem)? {
        if let arrival = group.arrival, stops.contains(where: { $0.id == arrival.id }) { return legAfter(arrival) }
        return legAfter(group.flight)
    }

    /// The morning stay that starts the route gets the first leg.
    func legAfterMorning(_ stay: TripItem) -> (from: TripItem, to: TripItem)? {
        stops.first?.id == stay.id ? legAfter(stay) : nil
    }

    /// A note sits inside a drive when there's a stop before it (or the morning's stay starts the route) and one after it.
    func noteInLeg(at k: Int) -> Bool {
        let before = firm[..<k].contains { $0.kind != .note } || morning.contains { $0.id == stops.first?.id }
        return before && firm[(k + 1)...].contains { $0.kind != .note }
    }

    /// Seconds of driving between stops, skipping legs into or across a flight.
    func driveSeconds(_ legs: [StopLeg]) -> Double {
        legs.filter { !flown.contains($0.from) }.compactMap(\.leg).map(\.seconds).reduce(0, +)
    }
}
