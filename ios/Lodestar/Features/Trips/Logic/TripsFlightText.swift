import Foundation

/// Copy for the flight cards (`flight-card.tsx`, `flight-segment.tsx`), kept pure for tests.
enum TripsFlightText {
    /// "10:20 AM", or "—" without a time.
    static func clock(_ hhmm: String?) -> String {
        hhmm.map(ClockText.time12) ?? "—"
    }

    /// "Terminal 1 · Gate B12", or what's known of it.
    static func gateLine(_ e: TripsFlightView.End) -> String? {
        let parts = [e.terminal.map { "Terminal \($0)" }, e.gate.map { "Gate \($0)" }].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// One line on what's happening, shown in the status colour; nil before there's live status.
    static func liveLine(_ v: TripsFlightView) -> String? {
        let from = v.from, to = v.to
        let gate = from.gate.map { " · Gate \($0)" } ?? ""
        switch v.phase {
        case .booked, .live(.unknown): return nil
        case .live(.scheduled): return from.gate.map { "On time · Gate \($0)" } ?? "On time · the gate is posted on travel day"
        case .live(.checkin): return "Check-in open\(gate)"
        case .live(.boarding): return "Boarding now\(gate)"
        case .live(.departed):
            return "In the air · lands \(clock(to.time))" + (to.zone.map { " \($0)" } ?? "") + (to.gate.map { " at gate \($0)" } ?? "")
        case .live(.delayed): return "\(v.status) · now leaves \(clock(from.time))" + (from.gate.map { " from gate \($0)" } ?? "")
        case .live(.landed): return "Landed \(clock(to.time))" + (to.baggage.map { " · bags on carousel \($0)" } ?? "")
        case .live(.cancelled): return "Cancelled. Rebook with the airline."
        case .live(.diverted): return "Diverted. Check with the airline for where it's landing."
        }
    }

    /// The route line's caption: "lands 1:25 PM" in the air, else the duration.
    static func trackLabel(_ v: TripsFlightView) -> String? {
        if v.phase == .live(.departed), let t = v.to.time { return "lands \(clock(t))" }
        return v.minutes.map(TripsFlightView.duration)
    }

    /// "2h 05m in the air · clocks jump 1 hr" (the itinerary's flight card).
    static func airLine(_ v: TripsFlightView) -> String {
        let air = v.minutes.map { "\(TripsFlightView.duration($0)) in the air" } ?? "In the air"
        guard let shift = v.shift, shift != 0 else { return air }
        return "\(air) · clocks \(shift > 0 ? "jump" : "go back") \(hours(shift)) hr"
    }

    /// "Clocks go forward 1 hr on landing." (the Flights tab card's footer).
    static func shiftLine(_ v: TripsFlightView) -> String? {
        guard let shift = v.shift, shift != 0 else { return nil }
        return "Clocks \(shift > 0 ? "go forward" : "go back") \(hours(shift)) hr on landing."
    }

    /// "2h 05m · 4 travelers · Boeing 737-800" under the itinerary card's title.
    static func segmentSubtitle(_ v: TripsFlightView, guests: Int?) -> String {
        [v.minutes.map(TripsFlightView.duration), guests.map { "\($0) travelers" }, v.aircraft].compactMap { $0 }.joined(separator: " · ")
    }

    /// Whole hours print without a decimal; half-hour zones keep one ("5.5").
    private static func hours(_ minutes: Int) -> String {
        let h = Double(abs(minutes)) / 60
        return h == h.rounded() ? String(Int(h)) : String(format: "%g", h)
    }

    /// Live phases pulse their status dot.
    static func pulses(_ v: TripsFlightView) -> Bool {
        switch v.phase {
        case .live(.checkin), .live(.boarding), .live(.departed), .live(.delayed): true
        default: false
        }
    }
}

/// Airline colours for the flight card's header (`airline-brand.ts`): the one place the trip page
/// uses colour beyond its blue accent. `stripe` is the livery band under it. Every `bg` takes white text.
struct TripsAirlineBrand: Hashable, Sendable {
    let bg: UInt32
    let stripe: [UInt32]

    private static let brands: [String: TripsAirlineBrand] = [
        "WN": .init(bg: 0x304CB2, stripe: [0xE31837, 0xFFBF27, 0x22388A]),
        "AA": .init(bg: 0x0B5AA6, stripe: [0xC30019, 0x9DA6AB]),
        "UA": .init(bg: 0x0A3A7E, stripe: [0x1E6FD9, 0x8FB8EE]),
        "DL": .init(bg: 0x0B2A5B, stripe: [0xC8102E, 0xE8414F]),
        "AS": .init(bg: 0x01426A, stripe: [0x48A9C5, 0x7BC142]),
        "B6": .init(bg: 0x003876, stripe: [0x0F6CC4, 0x5EB3E4]),
        "NK": .init(bg: 0x2B2B2B, stripe: [0xFFEC00]),
        "F9": .init(bg: 0x0D5640, stripe: [0x6FB33F]),
        "HA": .init(bg: 0x413691, stripe: [0xD3175A, 0xF5A2C1]),
        "AC": .init(bg: 0xB5202A, stripe: [0x1F1F1F]),
        "BA": .init(bg: 0x075AAA, stripe: [0xEB2226, 0xFFFFFF]),
        "VS": .init(bg: 0x8A0F3A, stripe: [0xE10A0A]),
        "LH": .init(bg: 0x05164D, stripe: [0xF9BA00]),
        "AF": .init(bg: 0x002157, stripe: [0xED1C24, 0xFFFFFF]),
        "KL": .init(bg: 0x006DB5, stripe: [0x00A1DE]),
        "EK": .init(bg: 0xA3151C, stripe: [0xC8A974]),
        "QR": .init(bg: 0x5C0632, stripe: [0xA6A6A6]),
        "SQ": .init(bg: 0x1D3C78, stripe: [0xF5B335]),
        "NH": .init(bg: 0x13448F, stripe: [0x2E8BD6]),
        "JL": .init(bg: 0x7A0C16, stripe: [0xCC0000]),
        "QF": .init(bg: 0xB5121B, stripe: [0x1F1F1F]),
    ]

    /// Unknown airlines get a quiet ink header in the app's own colours.
    static let plain = TripsAirlineBrand(bg: 0x2A2A27, stripe: [0x4C8DFF])

    static func of(_ code: String?) -> TripsAirlineBrand {
        code.flatMap { brands[$0] } ?? plain
    }
}
