import Foundation

/// A flight with the airport stops it absorbs (`FlightGroup` in `lib/journeys/flights.ts`).
struct TripsFlightGroup: Hashable, Sendable {
    let flight: TripItem
    let departure: TripItem?
    let arrival: TripItem?
}

/// Port of `lib/journeys/flights.ts`: reading a flight's number and airports from what sources and
/// agents wrote, and folding the "SFO Terminal 1" / "Land at PHX" stops around it into its card.
enum TripsFlights {
    /// How long before departure an airport stop still belongs to the flight.
    static let beforeMinutes = 4 * 60
    /// How long after landing an arrival stop still belongs to the flight.
    static let afterMinutes = 2 * 60

    struct Code: Hashable, Sendable {
        let airline: String
        let number: String
    }

    /// "WN 4623" → (WN, 4623), from details first, then the title; nil when there's none.
    static func code(_ item: TripItem) -> Code? {
        for text in [item.details.flightNumber, item.title].compactMap({ $0 }) {
            let groups = TripsRegex.groups(#"\b([A-Z][A-Z0-9]|[A-Z0-9][A-Z])\s?(\d{1,4})[A-Z]?\b"#, in: text.uppercased())
            if let airline = groups?[0], let number = groups?[1] { return Code(airline: airline, number: number) }
        }
        return nil
    }

    /// The IATA codes a flight leaves from and lands at: details first, then "SFO → PHX" in the title.
    static func airports(_ item: TripItem) -> (from: String?, to: String?) {
        var from = iata(item.details.from)
        var to = iata(item.details.to)
        if from == nil || to == nil {
            let m = TripsRegex.groups(#"\b([A-Z]{3})\s*(?:→|->|–|-|to)\s*([A-Z]{3})\b"#, in: item.title)
            from = from ?? m?[0]
            to = to ?? m?[1]
        }
        return (from, to)
    }

    /// Codes are written in capitals; a bare "sfo" is the only lowercase form taken.
    private static func iata(_ text: String?) -> String? {
        guard let text else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        if TripsRegex.matches(#"^[a-z]{3}$"#, in: trimmed, caseInsensitive: true) { return trimmed.uppercased() }
        return TripsRegex.groups(#"\b([A-Z]{3})\b"#, in: text)?[0]
    }

    /// "HH:MM" → minutes since midnight.
    static func minutes(_ hhmm: String?) -> Int? {
        guard let hhmm, hhmm.count >= 5, let h = Int(hhmm.prefix(2)), let m = Int(hhmm.dropFirst(3).prefix(2)) else { return nil }
        return h * 60 + m
    }

    private static func mentions(_ item: TripItem, _ code: String) -> Bool {
        let word = #"\b\#(NSRegularExpression.escapedPattern(for: code))\b"#
        if TripsRegex.matches(word, in: item.title, caseInsensitive: true) { return true }
        // "Terminal 4 parking" whose address names the airport.
        return TripsRegex.matches(#"\b(airport|terminal)\b"#, in: item.title, caseInsensitive: true)
            && TripsRegex.matches(word, in: "\(item.place ?? "") \(item.details.address ?? "")", caseInsensitive: true)
    }

    private static func canFold(_ item: TripItem) -> Bool {
        item.isLive && item.kind != .flight && item.kind != .note && item.kind != .stay
    }

    /// The closest stop on `date` naming `code` whose time falls in `range`; a stop without a time counts.
    private static func nearest(_ items: [TripItem], date: LocalDate, code: String?, range: ClosedRange<Int>,
                                target: Int, taken: Set<String>) -> TripItem? {
        guard let code else { return nil }
        let fits = items.filter { item in
            guard item.startDate == date, canFold(item), !taken.contains(item.id), mentions(item, code) else { return false }
            guard let t = minutes(item.startTime) else { return true }
            return range.contains(t)
        }
        let distance: (TripItem) -> Int = { abs((minutes($0.startTime) ?? target) - target) }
        return TripsPlan.stableSorted(fits) { distance($0) < distance($1) }.first
    }

    /// Each live flight with the airport stops it absorbs: one before departure at the airport it
    /// leaves from, one after landing at the airport it lands at.
    static func groups(_ items: [TripItem]) -> [TripsFlightGroup] {
        var taken = Set<String>()
        return TripsPlan.byItinerary(items.filter { $0.kind == .flight && $0.isLive }).map { flight in
            let (from, to) = airports(flight)
            var departure: TripItem?
            if let dep = minutes(flight.startTime) {
                departure = nearest(items, date: flight.startDate, code: from, range: (dep - beforeMinutes)...dep, target: dep, taken: taken)
            }
            if let departure { taken.insert(departure.id) }
            var arrival: TripItem?
            if let arr = minutes(flight.endTime) {
                arrival = nearest(items, date: flight.endDate ?? flight.startDate, code: to, range: arr...(arr + afterMinutes), target: arr, taken: taken)
            }
            if let arrival { taken.insert(arrival.id) }
            return TripsFlightGroup(flight: flight, departure: departure, arrival: arrival)
        }
    }

    /// Ids of the stops a flight card shows instead of their own cards.
    static func foldedIds(_ groups: [TripsFlightGroup]) -> Set<String> {
        Set(groups.flatMap { [$0.departure?.id, $0.arrival?.id].compactMap { $0 } })
    }

    /// True when a flight takes off between two stops on `date`, so driving between them makes no sense.
    static func flightBetween(_ items: [TripItem], date: LocalDate, _ a: TripItem, _ b: TripItem) -> Bool {
        let lo = minutes(a.startTime)
        let hi = minutes(b.startTime)
        return items.contains { f in
            guard f.kind == .flight, f.isLive, f.startDate == date, f.id != a.id else { return false }
            // Without times, the itinerary order (a before b) is all there is: any flight that day counts.
            guard let t = minutes(f.startTime), let lo, let hi else { return true }
            return t >= lo && t <= hi
        }
    }
}

extension TripsFlights {
    /// True while some flight leaves within the next day or is still in the air (`use-flights.ts`):
    /// only then is live status worth asking for again. Times are read in the device's zone, as the web does.
    static func leavesSoon(_ items: [TripItem], now: Date, calendar: Calendar = .current) -> Bool {
        items.contains { item in
            guard item.kind == .flight, item.isLive else { return false }
            let t = minutes(item.startTime) ?? 12 * 60
            let c = DateComponents(year: item.startDate.year, month: item.startDate.month, day: item.startDate.day,
                                   hour: t / 60, minute: t % 60)
            guard let at = calendar.date(from: c) else { return false }
            let ahead = at.timeIntervalSince(now)
            return ahead < 24 * 3600 && -ahead < 12 * 3600
        }
    }
}

/// The "Edit" action on a stop (`StopEditor` in `stop-card.tsx`): title and note, sending only what changed.
enum TripsStopEdit {
    /// The note the editor starts from: the stop's note, else the AI's reason for it.
    static func startingNote(_ item: TripItem) -> String {
        item.details.note ?? item.details.why ?? ""
    }

    /// nil when nothing changed (the editor just closes). An emptied note is cleared.
    static func patch(_ item: TripItem, title: String, note: String) -> ItemPatch? {
        var p = ItemPatch()
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty && t != item.title { p.title = t }
        if n != startingNote(item) { p.note = .some(n.isEmpty ? nil : n) }
        return p.title == nil && p.note == nil ? nil : p
    }
}

/// JavaScript-compatible regex helpers (NSRegularExpression shares JS's `\b` and class semantics).
enum TripsRegex {
    /// The capture groups of the first match (nil groups as nil), or nil without a match.
    static func groups(_ pattern: String, in text: String, caseInsensitive: Bool = false) -> [String?]? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : []) else { return nil }
        let ns = text as NSString
        guard let m = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (1..<max(1, m.numberOfRanges)).map { i in
            let r = m.range(at: i)
            return r.location == NSNotFound ? nil : ns.substring(with: r)
        }
    }

    static func matches(_ pattern: String, in text: String, caseInsensitive: Bool = false) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : []) else { return false }
        return regex.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil
    }
}
