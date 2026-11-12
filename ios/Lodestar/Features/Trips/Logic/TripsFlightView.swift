import Foundation

/// What a flight card shows (`lib/journeys/flight-view.ts`): the booking's own facts, overlaid
/// with live status where AeroDataBox has it. Pure, so cards and tests share it.
struct TripsFlightView: Hashable, Sendable {
    enum Tone: Hashable, Sendable { case ok, warn, danger, idle }

    /// A live phase, or `nil` for "booked/planned, no live status".
    enum Phase: Hashable, Sendable {
        case booked
        case live(FlightPhase)
    }

    struct End: Hashable, Sendable {
        let code: String?
        /// "San Francisco International": live, else the folded stop's address.
        let name: String?
        let city: String?
        /// "10:20" local: the latest known time, else the booked one.
        let time: String?
        let date: LocalDate
        /// The booked time when the latest differs from it, for striking through.
        let was: String?
        let zone: String?
        let terminal: String?
        let gate: String?
        let baggage: String?
        /// The folded airport stop's time: when to be at the airport.
        let beThere: String?
        /// The folded stop's own note, like how to reach the rental cars.
        let note: String?
    }

    let airline: String?
    let airlineName: String
    /// "WN 4623", or the item's title when there's no number.
    let label: String
    let from: End
    let to: End
    let minutes: Int?
    /// How far clocks move between the two airports, in minutes.
    let shift: Int?
    let phase: Phase
    let status: String
    let tone: Tone
    /// 0 before take-off, 1 once landed, in between while in the air.
    let progress: Double
    let aircraft: String?
    let live: Bool

    var isCancelled: Bool { phase == .live(.cancelled) }
}

extension TripsFlightView {
    private static let labels: [FlightPhase: (String, Tone)] = [
        .scheduled: ("On time", .ok), .checkin: ("Check-in open", .ok), .boarding: ("Boarding", .ok),
        .departed: ("In the air", .ok), .landed: ("Landed", .ok), .delayed: ("Delayed", .warn),
        .cancelled: ("Cancelled", .danger), .diverted: ("Diverted", .danger), .unknown: ("Scheduled", .idle),
    ]

    init(group: TripsFlightGroup, status s: FlightStatus?, now: EpochMillis = EpochMillis.from(.now)) {
        let flight = group.flight
        let code = TripsFlights.code(flight)
        let airports = TripsFlights.airports(flight)

        let schedMinutes: Int? = {
            guard let d = s?.departure.scheduled, let a = s?.arrival.scheduled else { return nil }
            return Int((Double(a.utc - d.utc) / 60_000).rounded())
        }()
        let shift: Int? = {
            guard let sched = schedMinutes, let d = s?.departure.scheduled, let a = s?.arrival.scheduled,
                  let ld = Self.wallClock(d), let la = Self.wallClock(a) else { return nil }
            return la - ld - sched
        }()
        let phase: Phase = flight.status == .cancelled ? .live(.cancelled) : (s.map { .live($0.phase) } ?? .booked)
        let (word, tone): (String, Tone) = switch phase {
        case .booked: (flight.status == .booked ? "Booked" : "Planned", .idle)
        case .live(let p): Self.labels[p] ?? ("Scheduled", .idle)
        }
        let cancelled = flight.status == .cancelled || s?.phase == .cancelled

        airline = code?.airline
        airlineName = flight.details.airline
            ?? code.map { AirlineNames.display(code: $0.airline, fallback: s?.airline ?? $0.airline) }
            ?? s?.airline ?? "Flight"
        label = code.map { "\($0.airline) \($0.number)" } ?? flight.title
        from = Self.end(.from, group: group, live: s?.departure, airport: airports.from)
        to = Self.end(.to, group: group, live: s?.arrival, airport: airports.to)
        minutes = schedMinutes ?? Self.bookedMinutes(flight)
        self.shift = shift
        self.phase = phase
        status = phase == .live(.delayed) && (s?.delay ?? 0) != 0 ? "Delayed \(s?.delay ?? 0) min" : word
        self.tone = cancelled ? .danger : tone
        progress = Self.progress(phase: phase, status: s, now: now)
        aircraft = s?.aircraft
        live = s != nil
    }

    private enum Side { case from, to }

    private static func end(_ side: Side, group: TripsFlightGroup, live: FlightEndpoint?, airport: String?) -> End {
        let flight = group.flight
        let stop = side == .from ? group.departure : group.arrival
        let booked = side == .from ? flight.startTime : flight.endTime
        let scheduled = live?.scheduled?.time ?? booked
        let latest = live?.latest?.time
        let bookedDate = side == .from ? flight.startDate : (flight.endDate ?? flight.startDate)
        let addressName = stop?.details.address?.split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces) }
        return End(
            code: live?.code ?? airport,
            name: live?.name ?? addressName,
            city: live?.city,
            time: latest ?? scheduled,
            date: live?.latest?.date ?? live?.scheduled?.date ?? bookedDate,
            was: latest != nil && scheduled != nil && latest != scheduled ? scheduled : nil,
            zone: live?.zone,
            terminal: live?.terminal ?? terminal(in: stop),
            gate: live?.gate,
            baggage: live?.baggage,
            beThere: side == .from ? stop?.startTime : nil,
            note: stop?.details.note
        )
    }

    private static func progress(phase: Phase, status s: FlightStatus?, now: EpochMillis) -> Double {
        if phase == .live(.landed) { return 1 }
        guard phase == .live(.departed),
              let dep = s?.departure.latest?.utc ?? s?.departure.scheduled?.utc,
              let arr = s?.arrival.latest?.utc ?? s?.arrival.scheduled?.utc, arr > dep else { return 0 }
        return min(1, max(0, Double(now - dep) / Double(arr - dep)))
    }

    /// A local date and time read as if it were UTC, in minutes: the wall clock, for the clock shift.
    private static func wallClock(_ m: FlightMoment) -> Int? {
        guard let t = TripsFlights.minutes(m.time) else { return nil }
        return Int(m.date.date.timeIntervalSince1970 / 60) + t
    }

    private static func terminal(in stop: TripItem?) -> String? {
        guard let title = stop?.title else { return nil }
        return TripsRegex.groups(#"\bterminal\s+([A-Z0-9]{1,3})\b"#, in: title, caseInsensitive: true)?[0]?.uppercased()
    }

    /// "2h05", "2 hr 05 min", "2h 5m" in the title or note → 125.
    static func bookedMinutes(_ item: TripItem) -> Int? {
        let text = "\(item.title) \(item.details.note ?? "")"
        let pattern = #"\b(\d{1,2})\s*(?:h|hr|hrs|hours?)\s*(\d{1,2})?\s*(?:m|min|mins|minutes?)?\b"#
        guard let g = TripsRegex.groups(pattern, in: text, caseInsensitive: true), let h = g[0].flatMap(Int.init) else { return nil }
        return h * 60 + (g[1].flatMap(Int.init) ?? 0)
    }

    /// "2h 05m".
    static func duration(_ minutes: Int) -> String {
        "\(minutes / 60)h \(String(format: "%02d", minutes % 60))m"
    }
}
