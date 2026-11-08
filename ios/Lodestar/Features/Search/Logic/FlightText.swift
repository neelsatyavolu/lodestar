import Foundation

/// Text for itinerary cards (web `itinerary-card.tsx`). Flight times stay wall-clock strings.
enum FlightText {
    /// Unique marketing airlines of one slice, display names applied.
    static func airlines(_ slice: FlightSlice) -> [AirlineRef] {
        var seen = Set<String>()
        return slice.legs.map(\.airline).filter { seen.insert($0.code).inserted }
    }

    /// "8:15am – 4:40pm"; `dayShift` gives the "+1".
    static func times(_ slice: FlightSlice) -> String {
        guard let depart = slice.depart, let arrive = slice.arrive else { return "" }
        return "\(ClockText.flightClock(depart)) – \(ClockText.flightClock(arrive))"
    }

    static func dayShift(_ slice: FlightSlice) -> Int {
        guard let depart = slice.depart, let arrive = slice.arrive else { return 0 }
        return ClockText.dayShift(depart: depart, arrive: arrive)
    }

    /// "Out · Thu, Nov 26 · United, Delta" (the label only on round trips).
    static func subtitle(_ slice: FlightSlice, label: String?) -> String {
        let day = slice.depart.flatMap(LocalDate.init).map(DateText.short) ?? ""
        let names = airlines(slice).map(\.displayName).joined(separator: ", ")
        return [label, day, names].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// "Nonstop" or "2 stops".
    static func stops(_ slice: FlightSlice) -> String {
        slice.stops == 0 ? "Nonstop" : plural(slice.stops, "stop")
    }

    /// Via airports in mono: "DEN, ORD".
    static func via(_ slice: FlightSlice) -> String {
        slice.layovers.compactMap(\.airport).joined(separator: ", ")
    }

    /// Collapsed-card labels "Out"/"Back"; expanded "Outbound"/"Return"/"Flight".
    static func shortLabel(index: Int, of it: Itinerary) -> String? {
        it.isRoundTrip ? (index == 0 ? "Out" : "Back") : nil
    }

    static func longLabel(index: Int, of it: Itinerary) -> String {
        it.isRoundTrip ? (index == 0 ? "Outbound" : "Return") : "Flight"
    }

    /// "Outbound · Thu, Nov 26 · 5h 30m"
    static func sliceHeader(_ slice: FlightSlice, label: String) -> String {
        let day = slice.depart.flatMap(LocalDate.init).map(DateText.short) ?? ""
        return [label, day, DurationText.minutes(slice.minutes)].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// "312 kg CO₂ (−8% vs typical)", nil without a figure.
    static func co2(_ slice: FlightSlice) -> String? {
        guard let kg = slice.co2Kg, kg > 0 else { return nil }
        guard let pct = slice.co2DeltaPct else { return "\(kg) kg CO₂" }
        return "\(kg) kg CO₂ (\(pct > 0 ? "+" : "")\(pct)% vs typical)"
    }

    /// "2h 25m · United · UA 1234 · operated by SkyWest · Boeing 737 · 31 in legroom"
    static func legLine(_ leg: FlightLeg) -> String {
        var parts = [DurationText.minutes(leg.minutes), leg.airline.displayName, leg.flightCode]
        if leg.isOperatedByOther, let operating = leg.operating { parts.append("operated by \(operating.name)") }
        if let aircraft = leg.aircraft { parts.append(aircraft) }
        if let legroom = leg.legroom { parts.append("\(legroom) legroom") }
        return parts.joined(separator: " · ")
    }

    /// "1h 5m layover in Denver · overnight · change airports · tight connection"
    static func layover(_ l: Layover) -> String {
        var text = "\(DurationText.minutes(l.minutes)) layover in \(l.city ?? l.airport ?? "a connecting airport")"
        if l.overnight { text += " · overnight" }
        if l.changeOfAirport { text += " · change airports" }
        if l.isTight { text += " · tight connection" }
        return text
    }

    static func tripKind(_ it: Itinerary) -> String { it.isRoundTrip ? "round trip" : "one way" }
}
