import Foundation

/// Where one itinerary's seller check stands (web `SellerCheck`). No entry means not checked.
enum FlightSellerState: Hashable, Sendable {
    case loading
    case done(SellerCheck)
    case failed(String)

    var check: SellerCheck? {
        if case .done(let check) = self { return check }
        return nil
    }
}

enum FlightSort: String, CaseIterable, Identifiable, Sendable {
    case best, cheapest, fastest

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

/// The list controls above the results.
struct FlightListFilters: Hashable, Sendable {
    var sort: FlightSort = .best
    var trustedOnly = true
    var nonstop = false
    /// Selected carrier codes; empty means all.
    var airlines: Set<String> = []
}

/// One airline chip: logo, name and the cheapest fare it appears on.
struct FlightCarrier: Hashable, Sendable, Identifiable {
    let code: String
    let name: String
    let minPrice: Double

    var id: String { code }
    var airline: AirlineRef { AirlineRef(code: code, name: name) }
}

enum FlightBadge: String, Hashable, Sendable {
    case best = "Best"
    case cheapest = "Cheapest"
    case fastest = "Fastest"
    case nearby = "Nearby airport"
    case selfTransfer = "Self-transfer"
}

/// Ports of the web's result helpers (`components/results.tsx`, `itinerary-card.tsx`).
enum FlightResults {
    static let pageSize = 12
    static let maxCarriers = 10

    /// `lowestTrusted` when "trusted only" is on and the check found one; otherwise Google's price.
    static func displayPrice(_ it: Itinerary, state: FlightSellerState?, trustedOnly: Bool) -> Double {
        if trustedOnly, let trusted = state?.check?.lowestTrusted { return trusted }
        return it.price
    }

    /// Filters then sorts. Best keeps the server order.
    static func shown(_ itineraries: [Itinerary], checks: [String: FlightSellerState],
                      filters: FlightListFilters) -> [Itinerary] {
        let filtered = itineraries.filter { it in
            if filters.nonstop, !it.isNonstop { return false }
            if !filters.airlines.isEmpty,
               !it.slices.allSatisfy({ $0.legs.allSatisfy { filters.airlines.contains($0.airline.code) } }) {
                return false
            }
            if filters.trustedOnly, let check = checks[it.id]?.check, check.lowestTrusted == nil { return false }
            return true
        }
        let price = { (it: Itinerary) in displayPrice(it, state: checks[it.id], trustedOnly: filters.trustedOnly) }
        switch filters.sort {
        case .best:
            return filtered
        case .cheapest:
            return stableSorted(filtered) { price($0) < price($1) }
        case .fastest:
            return stableSorted(filtered) {
                $0.totalMinutes != $1.totalMinutes ? $0.totalMinutes < $1.totalMinutes : price($0) < price($1)
            }
        }
    }

    /// Up to 10 carriers, ordered by the cheapest itinerary each appears on.
    static func carriers(_ itineraries: [Itinerary]) -> [FlightCarrier] {
        var best: [String: FlightCarrier] = [:]
        var order: [String] = []
        for it in itineraries {
            for leg in it.slices.flatMap(\.legs) {
                let code = leg.airline.code
                if let current = best[code], current.minPrice <= it.price { continue }
                if best[code] == nil { order.append(code) }
                best[code] = FlightCarrier(code: code, name: leg.airline.displayName, minPrice: it.price)
            }
        }
        let list = order.compactMap { best[$0] }
        return Array(stableSorted(list) { $0.minPrice < $1.minPrice }.prefix(maxCarriers))
    }

    /// Codes of the extra airports `nearby` added; shown in blue.
    static func nearbyCodes(_ result: SearchResult) -> Set<String> {
        Set(result.airports.nearbyFrom + result.airports.nearbyTo)
    }

    static func badges(_ it: Itinerary, labels: SearchResult.SearchLabels, nearby: Set<String>) -> [FlightBadge] {
        var badges: [FlightBadge] = []
        if labels.best == it.id { badges.append(.best) }
        if labels.cheapest == it.id { badges.append(.cheapest) }
        if labels.fastest == it.id { badges.append(.fastest) }
        let touchesNearby = it.slices.contains { slice in
            [slice.origin, slice.destination].compactMap { $0 }.contains(where: nearby.contains)
        }
        if touchesNearby { badges.append(.nearby) }
        if it.hasSelfTransfer { badges.append(.selfTransfer) }
        return badges
    }

    /// Server hacks plus the client-side flex hack, by saving, largest first.
    static func hacks(_ result: SearchResult, flex: Hack?) -> [Hack] {
        stableSorted(result.hacks + [flex].compactMap { $0 }) { $0.saving > $1.saving }
    }

    /// The two tickets of the split hack, when both are in `oneWays`.
    static func splitPair(_ result: SearchResult) -> (hack: Hack, out: Itinerary, back: Itinerary)? {
        guard let hack = result.hacks.first(where: { $0.kind == .split }), hack.itineraryIds.count >= 2,
              let oneWays = result.oneWays,
              let out = oneWays.out.first(where: { $0.id == hack.itineraryIds[0] }),
              let back = oneWays.back.first(where: { $0.id == hack.itineraryIds[1] })
        else { return nil }
        return (hack, out, back)
    }

    /// Sort that keeps the original order for ties (Swift's `sorted` makes no promise).
    static func stableSorted<T>(_ list: [T], by less: (T, T) -> Bool) -> [T] {
        list.enumerated().sorted { a, b in
            if less(a.element, b.element) { return true }
            if less(b.element, a.element) { return false }
            return a.offset < b.offset
        }.map(\.element)
    }
}

/// The client-side flex-dates hack (api-search.md 2.2), computed from `/api/calendar`.
enum FlexHack {
    static let minSaving = 15.0

    static func make(days: [DayPrice], depart: LocalDate, returnDate: LocalDate?, baseline: Double?) -> Hack? {
        let chosen = days.first(where: { $0.depart == depart })?.price ?? baseline
        guard let chosen, let best = days.min(by: { $0.price < $1.price }) else { return nil }
        let saving = chosen - best.price
        guard best.depart != depart, saving >= minSaving else { return nil }
        let shift = depart.days(to: best.depart)
        let newReturn = returnDate.map { best.returnDate ?? $0.adding(days: shift) }
        let count = abs(shift)
        let title = "\(shift < 0 ? "Leave" : "Go") \(count) day\(count == 1 ? "" : "s") \(shift < 0 ? "earlier" : "later")"
        let when = DateText.shortRange(best.depart, newReturn)
        let rounded = Int(saving.rounded())
        return Hack(kind: .flex, title: title, detail: "\(when) is $\(rounded) less than your dates.",
                    saving: rounded, price: best.price, itineraryIds: [],
                    apply: HackApply(depart: best.depart, returnDate: .some(newReturn)), caution: nil)
    }
}
