import Foundation

/// Money as the web shows it (`lib/format.ts money`, `components/journeys/shared.ts amount`).
enum Money {
    private static let usLocale = Locale(identifier: "en_US")

    /// "$1,234" (whole dollars); nil shows as "—".
    static func usd(_ value: Double?) -> String {
        guard let value else { return "—" }
        let rounded = Int(value.rounded())
        let digits = abs(rounded).formatted(.number.locale(usLocale))
        return rounded < 0 ? "−$\(digits)" : "$\(digits)"
    }

    /// A saving: "−$120" (uses the minus sign, as the web does).
    static func saving(_ dollars: Int) -> String {
        "−$\(abs(dollars).formatted(.number.locale(usLocale)))"
    }

    /// "$1,240" or "€30.50": whole amounts drop the cents.
    static func amount(_ value: Double, currency: String = "USD") -> String {
        let whole = abs(value - value.rounded()) < 0.005
        let code = currency.uppercased()
        return value.formatted(
            .currency(code: code).locale(usLocale).precision(.fractionLength(whole ? 0 : 2))
        )
    }
}

/// Durations.
enum DurationText {
    /// Flight minutes: "5h 20m", "5h", "45m".
    static func minutes(_ minutes: Int) -> String {
        let h = minutes / 60
        let m = minutes % 60
        if h == 0 { return "\(m)m" }
        return m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }

    /// Drive leg: "36 min · 23.7 mi", "1 hr 5 min · 120 mi".
    static func leg(seconds: Double, meters: Double) -> String {
        let total = max(1, Int((seconds / 60).rounded()))
        let time = total < 60 ? "\(total) min" : "\(total / 60) hr" + (total % 60 == 0 ? "" : " \(total % 60) min")
        let miles = meters / 1609.344
        let distance = miles < 99.95 ? String(format: "%.1f", miles) : String(Int(miles.rounded()))
        return "\(time) · \(distance) mi"
    }
}

/// Calendar-day text. Everything formats in UTC so nothing shifts across time zones.
enum DateText {
    private static let locale = Locale(identifier: "en_US")
    private static let utc = TimeZone(identifier: "UTC")!

    private static func style(_ build: (Date.FormatStyle) -> Date.FormatStyle) -> Date.FormatStyle {
        build(Date.FormatStyle(locale: locale, calendar: LocalDate.utc, timeZone: utc))
    }

    /// "Thu, Nov 26"
    static func short(_ date: LocalDate) -> String {
        date.date.formatted(style { $0.weekday(.abbreviated).month(.abbreviated).day() })
    }

    /// "Nov 26"
    static func monthDay(_ date: LocalDate) -> String {
        date.date.formatted(style { $0.month(.abbreviated).day() })
    }

    /// "Saturday, November 21"
    static func long(_ date: LocalDate) -> String {
        date.date.formatted(style { $0.weekday(.wide).month(.wide).day() })
    }

    /// "Thu, Nov 26 – Mon, Nov 30", or "Thu, Nov 26" with no end.
    static func shortRange(_ start: LocalDate, _ end: LocalDate?) -> String {
        guard let end, end != start else { return short(start) }
        return "\(short(start)) – \(short(end))"
    }

    /// Trips: "Mar 1 – Mar 10, 2027", "Mar 1, 2027", or "Dates not set". The year is the end's.
    static func tripRange(_ start: LocalDate?, _ end: LocalDate?) -> String {
        guard let start else { return "Dates not set" }
        let year = (end ?? start).year
        guard let end, end != start else { return "\(monthDay(start)), \(year)" }
        return "\(monthDay(start)) – \(monthDay(end)), \(year)"
    }

    /// "Checked Sat, Nov 21" style text for an epoch-ms timestamp, in the device's time zone.
    static func short(epochMillis: EpochMillis) -> String {
        short(LocalDate(localDayOf: epochMillis.asDate))
    }
}

/// Clock text for "HH:MM" strings and the naive flight datetimes ("2026-11-26T08:15:00").
/// Flight times are local to their airport: read the characters, never convert zones.
enum ClockText {
    /// Trips: "19:05" -> "7:05 PM".
    static func time12(_ hhmm: String) -> String {
        guard let (h, m) = parse(hhmm) else { return hhmm }
        return "\((h + 11) % 12 + 1):\(String(format: "%02d", m)) \(h >= 12 ? "PM" : "AM")"
    }

    /// Flights: "2026-11-26T08:15:00" -> "8:15am".
    static func flightClock(_ iso: String) -> String {
        guard iso.count >= 16, let (h, m) = parse(String(iso.dropFirst(11).prefix(5))) else { return iso }
        return "\((h + 11) % 12 + 1):\(String(format: "%02d", m))\(h >= 12 ? "pm" : "am")"
    }

    /// The calendar day of a naive flight datetime.
    static func flightDay(_ iso: String) -> LocalDate? { LocalDate(iso) }

    /// Days between departure and arrival dates (for "+1").
    static func dayShift(depart: String, arrive: String) -> Int {
        guard let a = LocalDate(depart), let b = LocalDate(arrive) else { return 0 }
        return a.days(to: b)
    }

    private static func parse(_ hhmm: String) -> (Int, Int)? {
        let parts = hhmm.split(separator: ":")
        guard parts.count >= 2, let h = Int(parts[0]), let m = Int(parts[1]), (0..<24).contains(h), (0..<60).contains(m)
        else { return nil }
        return (h, m)
    }
}

/// "1 flight", "3 flights".
func plural(_ count: Int, _ word: String, _ pluralWord: String? = nil) -> String {
    "\(count) \(count == 1 ? word : (pluralWord ?? word + "s"))"
}
