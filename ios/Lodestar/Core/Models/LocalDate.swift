import Foundation

/// A calendar day with no time zone, on the wire as `"YYYY-MM-DD"`.
/// The server compares these as strings; never convert them to a `Date` in a local time zone.
/// `date` gives midnight UTC for formatting with a UTC formatter (see `DateText`).
struct LocalDate: Hashable, Comparable, Sendable, Codable, CustomStringConvertible {
    let year: Int
    let month: Int
    let day: Int

    init?(year: Int, month: Int, day: Int) {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        guard (1...12).contains(month), (1...31).contains(day),
              let date = Self.utc.date(from: components),
              Self.utc.component(.day, from: date) == day
        else { return nil }
        self.year = year
        self.month = month
        self.day = day
    }

    /// Parses `"YYYY-MM-DD"`, or the first 10 characters of a naive ISO datetime.
    init?(_ string: String) {
        let parts = string.prefix(10).split(separator: "-")
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2])
        else { return nil }
        self.init(year: y, month: m, day: d)
    }

    /// The device's local calendar day for an instant (the web's `toLocaleDateString("en-CA")`).
    init(localDayOf date: Date, calendar: Calendar = .current) {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        self.year = c.year ?? 1970
        self.month = c.month ?? 1
        self.day = c.day ?? 1
    }

    /// Today on the device's calendar.
    static func today(calendar: Calendar = .current, now: Date = .now) -> LocalDate {
        LocalDate(localDayOf: now, calendar: calendar)
    }

    /// Today in UTC (the server's "today").
    static func todayUTC(now: Date = .now) -> LocalDate {
        LocalDate(localDayOf: now, calendar: utc)
    }

    var string: String { String(format: "%04d-%02d-%02d", year, month, day) }
    var description: String { string }

    /// Midnight UTC on this day.
    var date: Date {
        Self.utc.date(from: DateComponents(year: year, month: month, day: day)) ?? .distantPast
    }

    /// Midnight on this day in the device's calendar, for `DatePicker` bindings
    /// (read back with `init(localDayOf:)`).
    var pickerDate: Date {
        Calendar.current.date(from: DateComponents(year: year, month: month, day: day)) ?? .now
    }

    func adding(days: Int) -> LocalDate {
        let shifted = Self.utc.date(byAdding: .day, value: days, to: date) ?? date
        return LocalDate(localDayOf: shifted, calendar: Self.utc)
    }

    /// Whole days from `self` to `other` (negative when `other` is earlier).
    func days(to other: LocalDate) -> Int {
        Self.utc.dateComponents([.day], from: date, to: other.date).day ?? 0
    }

    static func < (lhs: LocalDate, rhs: LocalDate) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        guard let value = LocalDate(raw) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not a YYYY-MM-DD date: \(raw)")
        }
        self = value
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(string)
    }

    static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.locale = Locale(identifier: "en_US_POSIX")
        return calendar
    }()
}

/// Server timestamps are integer milliseconds since the Unix epoch.
typealias EpochMillis = Int64

extension EpochMillis {
    var asDate: Date { Date(timeIntervalSince1970: TimeInterval(self) / 1000) }
    static func from(_ date: Date) -> EpochMillis { EpochMillis((date.timeIntervalSince1970 * 1000).rounded()) }
}
