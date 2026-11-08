import Foundation

/// Ports of `lib/journeys/plan.ts` and `lib/journeys/locate.ts`: what the trip page's tabs show,
/// worked out from a trip's items, checklist and costs. Pure and nonisolated, so tests call them directly.
enum TripsPlan {
    /// The web's `when(i)`: start day, then start time with no time last.
    static func whenKey(_ item: TripItem) -> String {
        "\(item.startDate.string) \(item.startTime ?? "99:99")"
    }

    /// `byItinerary`: within a day, timed items first; untimed after them; an untimed stay ends the day.
    static func itineraryKey(_ item: TripItem) -> String {
        item.startDate.string + (item.startTime ?? (item.kind == .stay ? "99:99" : "98:00"))
    }

    static func byItinerary(_ items: [TripItem]) -> [TripItem] {
        stableSorted(items) { itineraryKey($0) < itineraryKey($1) }
    }

    static func byWhen(_ items: [TripItem]) -> [TripItem] {
        stableSorted(items) { whenKey($0) < whenKey($1) }
    }

    /// Planned things that still need reserving, soonest deadline first.
    static func toBook(_ items: [TripItem]) -> [TripItem] {
        let due: (TripItem) -> String = { ($0.details.bookBy ?? $0.startDate).string }
        return stableSorted(items.filter { $0.status == .planned && $0.details.reserve == true }) { a, b in
            due(a) != due(b) ? due(a) < due(b) : whenKey(a) < whenKey(b)
        }
    }

    struct BookingGroup: Hashable, Sendable, Identifiable {
        let kind: ItemKind
        let items: [TripItem]
        var id: ItemKind { kind }

        var label: String {
            switch kind {
            case .flight: "Flights"
            case .stay: "Stays"
            case .transport: "Cars and transfers"
            case .activity: "Activities"
            case .dining: "Restaurants"
            case .note, .unknown: "Other"
            }
        }
    }

    static let bookingOrder: [ItemKind] = [.flight, .stay, .transport, .activity, .dining]

    /// Booked (and cancelled) reservations by kind, flights first, each in date order.
    static func bookings(_ items: [TripItem]) -> [BookingGroup] {
        bookingOrder.compactMap { kind in
            let group = byWhen(items.filter { $0.kind == kind && ($0.status == .booked || $0.status == .cancelled) })
            return group.isEmpty ? nil : BookingGroup(kind: kind, items: group)
        }
    }

    /// Every day the trip covers (capped at 60) plus any day an item falls on, in order.
    static func days(start: LocalDate?, end: LocalDate?, items: [TripItem]) -> [LocalDate] {
        var set = Set<LocalDate>()
        if let start {
            var day = start
            let last = end ?? start
            while day <= last && set.count < 60 {
                set.insert(day)
                day = day.adding(days: 1)
            }
        }
        items.forEach { set.insert($0.startDate) }
        return set.sorted()
    }

    /// The day the trip page opens on: the first day on or after today, else the first.
    static func defaultDay(_ days: [LocalDate], today: LocalDate) -> LocalDate? {
        days.first { $0 >= today } ?? days.first
    }

    static let locationTTL: EpochMillis = 30 * 86_400_000
    static let retryFailed: EpochMillis = 7 * 86_400_000

    /// Whether `locate` should still look this item up.
    static func needsLocation(_ item: TripItem, now: EpochMillis) -> Bool {
        if item.status == .cancelled || item.kind == .note { return false }
        let d = item.details
        if (d.locateFailedAt ?? 0) >= now - retryFailed { return false }
        if !d.isPinned { return item.kind != .transport || d.address != nil }
        return d.isGooglePlace && (d.locatedAt ?? 0) < now - locationTTL
    }

    /// Where to search from when adding a place on `date`.
    static func searchCenter(_ items: [TripItem], date: LocalDate?) -> LatLng? {
        let pinned = items.filter { $0.details.isPinned && $0.status != .cancelled }
        let places = pinned.filter { $0.kind != .flight }
        let onDay = places.filter { item in
            guard let date else { return false }
            if item.startDate == date { return true }
            return item.kind == .stay && item.startDate <= date && (item.endDate ?? item.startDate) >= date
        }
        if let c = center(onDay) { return c }
        if let c = center(places) { return c }
        return byItinerary(pinned.filter { $0.kind == .flight }).first.flatMap { center([$0]) }
    }

    /// A day's stops in order, for drive times: pinned, not cancelled, not ideas, not flights or notes.
    static func dayStops(_ items: [TripItem], date: LocalDate) -> [TripItem] {
        byItinerary(items.filter {
            $0.startDate == date && $0.isLive && $0.kind != .flight && $0.kind != .note && $0.details.isPinned
        })
    }

    /// Day colour index per distinct item start day (sorted, cycling through `Color.dayColors`).
    static func dayColorIndex(_ items: [TripItem]) -> [LocalDate: Int] {
        let days = Set(items.map(\.startDate)).sorted()
        return Dictionary(uniqueKeysWithValues: days.enumerated().map { ($1, $0) })
    }

    /// Map pin numbers: pinned, non-cancelled items within each day, in itinerary order, from 1.
    static func pinNumbers(_ items: [TripItem]) -> [String: Int] {
        var out: [String: Int] = [:]
        var perDay: [LocalDate: Int] = [:]
        for item in byItinerary(items.filter { $0.details.isPinned && $0.status != .cancelled }) {
            let n = (perDay[item.startDate] ?? 0) + 1
            perDay[item.startDate] = n
            out[item.id] = n
        }
        return out
    }

    /// Activity and dining ideas without a time ("Places to visit" on Overview).
    static func placesToVisit(_ items: [TripItem]) -> [TripItem] {
        byItinerary(items.filter {
            ($0.kind == .activity || $0.kind == .dining) && ($0.status == .suggested || ($0.status == .planned && $0.startTime == nil))
        })
    }

    private static func center(_ items: [TripItem]) -> LatLng? {
        let points = items.compactMap { i -> LatLng? in
            guard let lat = i.details.lat, let lng = i.details.lng else { return nil }
            return LatLng(lat: lat, lng: lng)
        }
        guard !points.isEmpty else { return nil }
        let n = Double(points.count)
        return LatLng(lat: points.map(\.lat).reduce(0, +) / n, lng: points.map(\.lng).reduce(0, +) / n)
    }

    /// Sort that keeps the input order for ties (the web relies on a stable sort).
    static func stableSorted<T>(_ values: [T], by less: (T, T) -> Bool) -> [T] {
        values.enumerated().sorted { a, b in
            if less(a.element, b.element) { return true }
            if less(b.element, a.element) { return false }
            return a.offset < b.offset
        }.map(\.element)
    }
}
