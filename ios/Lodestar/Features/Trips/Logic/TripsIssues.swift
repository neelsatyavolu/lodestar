import Foundation

/// A run of nights at one stay, or a run with none (`nights()` in `lib/journeys/plan.ts`).
struct TripsNightRun: Hashable, Sendable, Identifiable {
    let from: LocalDate
    /// The morning after the last night.
    let to: LocalDate
    let nights: Int
    let stay: TripItem?

    var id: String { from.string }
}

/// A "To sort out" row.
struct TripsIssue: Hashable, Sendable, Identifiable {
    enum Level: Sendable { case warn, info }

    let level: Level
    let text: String
    var itemId: String?

    var id: String { text }
}

extension TripsPlan {
    static func nights(start: LocalDate?, end: LocalDate?, items: [TripItem]) -> [TripsNightRun] {
        guard let start, let end, end > start else { return [] }
        let stays = items.filter { $0.kind == .stay && $0.isLive }
        var runs: [TripsNightRun] = []
        var day = start
        while day < end && runs.count < 120 {
            let night = day
            let stay = stays.first { $0.startDate <= night && ($0.endDate ?? $0.startDate) > night }
            if let last = runs.last, last.stay?.id == stay?.id {
                runs[runs.count - 1] = TripsNightRun(from: last.from, to: night.adding(days: 1), nights: last.nights + 1, stay: last.stay)
            } else {
                runs.append(TripsNightRun(from: night, to: night.adding(days: 1), nights: 1, stay: stay))
            }
            day = day.adding(days: 1)
        }
        return runs
    }

    /// Things to sort out before the trip. None once the trip has ended.
    static func issues(start: LocalDate?, end: LocalDate?, items: [TripItem], today: LocalDate) -> [TripsIssue] {
        if let end, end < today { return [] }
        let short = DateText.monthDay
        var out: [TripsIssue] = []

        for run in nights(start: start, end: end, items: items) where run.stay == nil {
            let span = run.nights == 1
                ? "the night of \(short(run.from))"
                : "\(run.nights) nights, \(short(run.from)) to \(short(run.to))"
            out.append(TripsIssue(level: .warn, text: "No place to stay for \(span)."))
        }

        for item in toBook(items) {
            if let by = item.details.bookBy, by < today {
                out.append(TripsIssue(level: .warn, text: "\(item.title) was to be booked by \(short(by)).", itemId: item.id))
            } else if let by = item.details.bookBy, today.days(to: by) <= 7 {
                out.append(TripsIssue(level: .warn, text: "Book \(item.title) by \(short(by)).", itemId: item.id))
            } else if item.details.bookBy == nil, item.startDate >= today, today.days(to: item.startDate) <= 14 {
                out.append(TripsIssue(level: .warn, text: "\(item.title) on \(short(item.startDate)) isn't booked yet.", itemId: item.id))
            }
        }

        var seen: [String: TripItem] = [:]
        for item in items where item.isLive && item.kind != .stay {
            guard let time = item.startTime else { continue }
            let key = "\(item.startDate.string) \(time)"
            if let other = seen[key] {
                out.append(TripsIssue(level: .warn, text: "\(other.title) and \(item.title) are both at \(time) on \(short(item.startDate)).", itemId: item.id))
            } else {
                seen[key] = item
            }
        }

        if let start, let end {
            let busy = Set(items.filter { $0.isLive && $0.kind != .stay }.map(\.startDate))
            var open: [LocalDate] = []
            var day = start
            while day <= end && open.count < 60 {
                if !busy.contains(day) { open.append(day) }
                day = day.adding(days: 1)
            }
            if !open.isEmpty {
                out.append(TripsIssue(level: .info, text: "Nothing planned yet on \(open.map(short).joined(separator: ", "))."))
            }
        }
        return out
    }

    /// A day in a line for its heading: "Fly in, Pizzeria Bianco, Penca".
    static func daySummary(start: LocalDate?, end: LocalDate?, items: [TripItem], date: LocalDate) -> String {
        let titles = byWhen(items.filter { $0.startDate == date && $0.isLive && $0.kind != .stay && $0.kind != .note })
            .map { item -> String in
                guard item.kind == .flight else { return item.title }
                if date == start { return "Fly in" }
                if date == end { return "Fly home" }
                return item.details.to.map { "Fly to \($0)" } ?? item.title
            }
        var unique: [String] = []
        for t in titles where !unique.contains(t) { unique.append(t) }
        return unique.joined(separator: ", ")
    }
}
