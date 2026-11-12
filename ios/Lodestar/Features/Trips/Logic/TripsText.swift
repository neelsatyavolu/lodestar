import Foundation

/// Ports of the text helpers in `components/journeys/shared.ts` (contract 11.9).
enum TripsText {
    enum Tone: Sendable, Equatable { case danger, warn }

    /// "In 12 days", "Tomorrow", "Day 3 of 8", or nil before dates / after the trip.
    static func countdown(start: LocalDate?, end: LocalDate?, today: LocalDate) -> String? {
        guard let start else { return nil }
        let last = end ?? start
        if today < start {
            let n = today.days(to: start)
            return n == 1 ? "Tomorrow" : "In \(n) days"
        }
        if today <= last { return "Day \(start.days(to: today) + 1) of \(start.days(to: last) + 1)" }
        return nil
    }

    static func isPast(start: LocalDate?, end: LocalDate?, today: LocalDate) -> Bool {
        guard let start else { return false }
        return (end ?? start) < today
    }

    private static let kindWords: [ItemKind: (String, String)] = [
        .flight: ("flight", "flights"), .stay: ("stay", "stays"), .dining: ("reservation", "reservations"),
        .activity: ("plan", "plans"), .transport: ("transfer", "transfers"),
    ]

    /// "2 flights · 1 stay · 3 reservations", in first-seen kind order, or "Nothing booked yet".
    static func tally(_ items: [TripItem]) -> String {
        var order: [ItemKind] = []
        var counts: [ItemKind: Int] = [:]
        for item in items where item.isLive && kindWords[item.kind] != nil {
            if counts[item.kind] == nil { order.append(item.kind) }
            counts[item.kind, default: 0] += 1
        }
        let parts = order.compactMap { kind -> String? in
            guard let n = counts[kind], let words = kindWords[kind] else { return nil }
            return "\(n) \(n == 1 ? words.0 : words.1)"
        }
        return parts.isEmpty ? "Nothing booked yet" : parts.joined(separator: " · ")
    }

    /// How urgent a book-by date is.
    static func deadline(_ bookBy: LocalDate?, today: LocalDate) -> (text: String, tone: Tone?)? {
        guard let bookBy else { return nil }
        let n = today.days(to: bookBy)
        if n < 0 { return ("Was due \(DateText.monthDay(bookBy))", .danger) }
        if n == 0 { return ("Book today", .danger) }
        return ("Book by \(DateText.monthDay(bookBy))", n <= 7 ? .warn : nil)
    }

    /// "1 traveller" / "3 travellers".
    static func travellers(_ n: Int?) -> String? {
        guard let n, n > 0 else { return nil }
        return "\(n) \(n == 1 ? "traveller" : "travellers")"
    }

    /// "7:00 PM – 9:00 PM", "+1" for the next day, a named day later on; nil without a start time.
    static func timeRange(_ item: TripItem) -> String? {
        guard let start = item.startTime else { return nil }
        let s = ClockText.time12(start)
        guard let endTime = item.endTime, item.kind != .stay else { return s }
        let e = ClockText.time12(endTime)
        guard let endDate = item.endDate, endDate != item.startDate else { return "\(s) – \(e)" }
        if endDate == item.startDate.adding(days: 1) { return "\(s) – \(e) +1" }
        return "\(s) – \(DateText.short(endDate)), \(e)"
    }

    /// When a booking happens (Bookings tab rows).
    static func bookingWhen(_ item: TripItem) -> String {
        if item.kind == .stay {
            return item.endDate.map { "\(DateText.monthDay(item.startDate)) – \(DateText.monthDay($0))" }
                ?? DateText.monthDay(item.startDate)
        }
        if item.kind != .flight, let end = item.endDate, end != item.startDate {
            let from = [DateText.short(item.startDate), item.startTime.map(ClockText.time12)].compactMap { $0 }.joined(separator: " ")
            let to = [DateText.short(end), item.endTime.map(ClockText.time12)].compactMap { $0 }.joined(separator: " ")
            return "\(from) → \(to)"
        }
        return [DateText.short(item.startDate), timeRange(item)].compactMap { $0 }.joined(separator: " · ")
    }

    /// The status pill a stop card shows (nil for a plain planned item).
    struct StatusPill: Equatable, Sendable {
        enum Dot: Sendable, Equatable { case ok, warn, danger, accent }
        let text: String
        let dot: Dot
    }

    static func statusPill(_ item: TripItem, today: LocalDate) -> StatusPill? {
        switch item.status {
        case .booked: return StatusPill(text: "Booked", dot: .ok)
        case .cancelled: return StatusPill(text: "Cancelled", dot: .danger)
        case .suggested: return StatusPill(text: "Idea", dot: .accent)
        case .planned where item.details.reserve == true:
            guard let by = item.details.bookBy else { return StatusPill(text: "To book", dot: .warn) }
            let overdue = today.days(to: by) <= 0
            return StatusPill(text: "To book · by \(DateText.monthDay(by))", dot: overdue ? .danger : .warn)
        default: return nil
        }
    }

    /// The word the place panel's status line starts with.
    static func statusWord(_ item: TripItem) -> String {
        switch item.status {
        case .booked: "Booked"
        case .suggested: "Idea"
        case .cancelled: "Cancelled"
        case .planned, .unknown: item.details.reserve == true ? "To book" : "Planned"
        }
    }

    /// A stay's row on a day (`StayRow`): "Check in 3:00 PM", "Check out 11:00 AM", or nil mid-stay.
    static func stayLine(_ stay: TripItem, on day: LocalDate) -> String? {
        if stay.startDate == day { return "Check in" + (stay.startTime.map { " \(ClockText.time12($0))" } ?? "") }
        if stay.endDate == day { return "Check out" + (stay.endTime.map { " \(ClockText.time12($0))" } ?? "") }
        return nil
    }

    /// Total driving for a day: "1 hr 5 min", "36 min".
    static func driveTotal(seconds: Double) -> String {
        let total = max(1, Int((seconds / 60).rounded()))
        if total < 60 { return "\(total) min" }
        return "\(total / 60) hr" + (total % 60 == 0 ? "" : " \(total % 60) min")
    }

    private static let rentalWords = ["car", "rental", "hertz", "avis", "alamo", "enterprise", "national", "budget", "sixt"]

    /// Transport that's a rental car (Overview's "Rental car" count).
    static func isRentalCar(_ item: TripItem) -> Bool {
        guard item.kind == .transport else { return false }
        let text = (item.title + " " + (item.details.provider ?? "")).lowercased()
        return rentalWords.contains { text.contains($0) }
    }

    /// "Seafood · Rua da Prata 10 · Conf. ABC123" under a stop's title.
    static func stopSubtitle(_ item: TripItem) -> String {
        let where_ = item.kind == .flight ? nil : (item.details.address ?? item.place)
        return [item.details.cuisine, where_, item.confirmation.map { "Conf. \($0)" }]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// "SFO → NRT" for a flight with both ends.
    static func route(_ item: TripItem) -> String? {
        guard item.kind == .flight, let from = item.details.from, let to = item.details.to else { return nil }
        return "\(from) → \(to)"
    }
}
