import Foundation

/// The Hotels tab's derivations (`hotels-tab.tsx`).
enum TripsHotels {
    /// Every stay on the trip except ideas, in itinerary order.
    static func stays(_ items: [TripItem]) -> [TripItem] {
        TripsPlan.byItinerary(items.filter { $0.kind == .stay && $0.status != .suggested })
    }

    /// Nights between check-in and check-out (at least 1), nil without a check-out day.
    static func nights(_ stay: TripItem) -> Int? {
        stay.endDate.map { max(1, stay.startDate.days(to: $0)) }
    }

    /// "No hotel yet for the night of Nov 21, Nov 23 to Nov 25." or nil when every night has one.
    static func gapLine(start: LocalDate?, end: LocalDate?, items: [TripItem]) -> String? {
        let gaps = TripsPlan.nights(start: start, end: end, items: items).filter { $0.stay == nil }
        guard !gaps.isEmpty else { return nil }
        let parts = gaps.map { $0.nights == 1 ? "the night of \(DateText.monthDay($0.from))" : "\(DateText.monthDay($0.from)) to \(DateText.monthDay($0.to))" }
        return "No hotel yet for \(parts.joined(separator: ", "))."
    }

    /// Google Maps search for the hotel by name and address.
    static func directionsURL(title: String, address: String?) -> URL? {
        guard let address, !address.isEmpty else { return nil }
        var c = URLComponents(string: "https://www.google.com/maps/search/")
        c?.queryItems = [URLQueryItem(name: "api", value: "1"), URLQueryItem(name: "query", value: "\(title) \(address)")]
        return c?.url
    }

    /// `tel:` with only digits and a leading plus.
    static func phoneURL(_ phone: String?) -> URL? {
        guard let phone else { return nil }
        let digits = phone.filter { $0.isNumber || $0 == "+" }
        return digits.isEmpty ? nil : URL(string: "tel:\(digits)")
    }
}
