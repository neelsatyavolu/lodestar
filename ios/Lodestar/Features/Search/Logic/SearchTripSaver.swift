import Foundation

/// Saves a flight search to Trips as a watched shortlist (`POST /api/trips`, the same endpoint
/// Plan uses). The server re-runs the planned search daily and emails when the fare drops.
/// The web has no save on Search; this builds the snapshot a one-search Plan turn would have.
enum SearchTripSaver {
    static let maxPicks = 6

    /// The itineraries to keep: the focused one first, then best, cheapest and fastest.
    static func picks(result: SearchResult, focus: Itinerary?) -> [(Itinerary, Pick.Tag)] {
        var seen = Set<String>()
        var picks: [(Itinerary, Pick.Tag)] = []
        func add(_ it: Itinerary?, _ tag: Pick.Tag) {
            guard let it, seen.insert(it.id).inserted else { return }
            picks.append((it, tag))
        }
        let byID = { (id: String?) in id.flatMap { id in result.itineraries.first { $0.id == id } } }
        if let focus { add(focus, tag(for: focus.id, labels: result.labels)) }
        add(byID(result.labels.best), .best)
        add(byID(result.labels.cheapest), .cheapest)
        add(byID(result.labels.fastest), .fastest)
        if picks.isEmpty { add(result.itineraries.first, .alternative) }
        return Array(picks.prefix(maxPicks))
    }

    static func tag(for id: String, labels: SearchResult.SearchLabels) -> Pick.Tag {
        if labels.best == id { return .best }
        if labels.cheapest == id { return .cheapest }
        if labels.fastest == id { return .fastest }
        return .alternative
    }

    /// nil when there is nothing to save (no itineraries).
    static func request(form: SearchForm, preferences: Preferences, result: SearchResult,
                        focus: Itinerary?) -> SaveTripRequest? {
        let picks = picks(result: result, focus: focus)
        guard !picks.isEmpty else { return nil }
        let search = plannedSearch(form)
        var options: [String: CanvasOption] = [:]
        let canvasPicks = picks.enumerated().map { index, pick in
            let ref = "S1-\(index + 1)"
            options[ref] = CanvasOption(itinerary: pick.0, search: 0)
            return Pick(ref: ref, title: title(pick.0), why: why(pick.0), tradeoff: nil, tag: pick.1)
        }
        let cheapest = result.itineraries.map(\.price).min()
        let plan = TripPlan(understanding: "", assumptions: [], searches: [search], question: nil, needsOrigin: false)
        let canvas = Canvas(headline: headline(form), summary: "", picks: canvasPicks, tips: [], followups: [])
        let progress = SearchProgress(state: .done, count: result.itineraries.count, cheapest: cheapest)
        let snapshot = Snapshot(prompt: prompt(form), plan: plan, canvas: canvas, options: options,
                                hacks: [], searches: [progress])
        let price = picks.map(\.0.price).min() ?? cheapest ?? 0
        return SaveTripRequest(snapshot: snapshot, searches: [search],
                               filters: SearchFilters(preferences: preferences), price: price)
    }

    static func plannedSearch(_ f: SearchForm) -> PlannedSearch {
        PlannedSearch(label: String(route(f).prefix(80)), why: "", from: f.from, to: f.to, depart: f.depart,
                      returnDate: f.roundTrip ? f.returnDate : nil, cabin: f.cabin, stops: f.stops,
                      adults: f.adults, bags: f.bags, nearby: f.nearby, flexible: f.flexible)
    }

    /// "SFO/OAK to JFK"
    static func route(_ f: SearchForm) -> String {
        "\(f.from.joined(separator: "/")) to \(f.to.joined(separator: "/"))"
    }

    /// "SFO → JFK · Thu, Nov 26 – Mon, Nov 30"
    static func headline(_ f: SearchForm) -> String {
        let dates = DateText.shortRange(f.depart, f.roundTrip ? f.returnDate : nil)
        return String("\(f.from.joined(separator: "/")) → \(f.to.joined(separator: "/")) · \(dates)".prefix(140))
    }

    static func prompt(_ f: SearchForm) -> String {
        "Flight search: \(route(f)), \(DateText.shortRange(f.depart, f.roundTrip ? f.returnDate : nil))"
    }

    /// "United · 1 stop"
    static func title(_ it: Itinerary) -> String {
        let names = it.airlines.prefix(2).map(\.displayName).joined(separator: ", ")
        let stops = it.slices.first.map(FlightText.stops) ?? ""
        return String([names, stops].filter { !$0.isEmpty }.joined(separator: " · ").prefix(80))
    }

    /// "8:15am – 4:40pm, 5h 30m. Back 7:00pm – 3:30am, 6h 30m."
    static func why(_ it: Itinerary) -> String {
        let parts = it.slices.enumerated().map { index, slice in
            let lead = it.isRoundTrip ? (index == 0 ? "Out " : "Back ") : ""
            return "\(lead)\(FlightText.times(slice)), \(DurationText.minutes(slice.minutes))."
        }
        return String(parts.joined(separator: " ").prefix(400))
    }
}
