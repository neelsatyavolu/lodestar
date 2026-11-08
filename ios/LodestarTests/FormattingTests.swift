import Foundation
import Testing
import UIKit
@testable import Lodestar

@Suite("Formatting and design helpers")
struct FormattingTests {
    @Test func money() {
        #expect(Money.usd(1234.4) == "$1,234")
        #expect(Money.usd(nil) == "—")
        #expect(Money.usd(-40) == "−$40")
        #expect(Money.saving(120) == "−$120")
        #expect(Money.amount(1240, currency: "USD") == "$1,240")
        #expect(Money.amount(30.5, currency: "eur") == "€30.50")
    }

    @Test func durations() {
        #expect(DurationText.minutes(320) == "5h 20m")
        #expect(DurationText.minutes(300) == "5h")
        #expect(DurationText.minutes(45) == "45m")
        #expect(DurationText.leg(seconds: 2160, meters: 38141) == "36 min · 23.7 mi")
        #expect(DurationText.leg(seconds: 3900, meters: 200_000) == "1 hr 5 min · 124 mi")
        #expect(DurationText.leg(seconds: 10, meters: 100) == "1 min · 0.1 mi")
    }

    @Test func dates() {
        #expect(DateText.short(date("2026-11-26")) == "Thu, Nov 26")
        #expect(DateText.monthDay(date("2026-11-21")) == "Nov 21")
        #expect(DateText.long(date("2026-11-21")) == "Saturday, November 21")
        #expect(DateText.tripRange(date("2027-03-01"), date("2027-03-10")) == "Mar 1 – Mar 10, 2027")
        #expect(DateText.tripRange(date("2027-03-01"), nil) == "Mar 1, 2027")
        #expect(DateText.tripRange(nil, nil) == "Dates not set")
        #expect(DateText.shortRange(date("2026-11-26"), date("2026-11-30")) == "Thu, Nov 26 – Mon, Nov 30")
    }

    @Test func clocks() {
        #expect(ClockText.time12("19:05") == "7:05 PM")
        #expect(ClockText.time12("00:30") == "12:30 AM")
        #expect(ClockText.flightClock("2026-11-26T08:15:00") == "8:15am")
        #expect(ClockText.flightClock("2026-11-26T16:40:00.123000") == "4:40pm")
        #expect(ClockText.dayShift(depart: "2026-11-26T22:00:00", arrive: "2026-11-27T06:10:00") == 1)
        #expect(plural(1, "flight") == "1 flight")
        #expect(plural(2, "agency", "agencies") == "2 agencies")
    }

    @Test func localDate() throws {
        #expect(LocalDate("2026-02-30") == nil)
        #expect(LocalDate("2026-1-05") == nil)
        let d = date("2026-12-30")
        #expect(d.adding(days: 3).string == "2027-01-02")
        #expect(d.days(to: date("2027-01-02")) == 3)
        #expect(date("2026-11-26") < date("2026-12-01"))
        #expect(LocalDate("2026-11-26T08:15:00") == date("2026-11-26"))
        let encoded = try JSONCoding.encoder.encode([d])
        #expect(String(decoding: encoded, as: UTF8.self) == #"["2026-12-30"]"#)
        #expect(throws: DecodingError.self) { try JSONCoding.decoder.decode([LocalDate].self, from: Data(#"["Nov 26"]"#.utf8)) }
    }

    @Test(arguments: [
        ("UA", "UA"), ("expedia.com", "EX"), ("Booking.com", "BO"), ("Fly Cheap Travel", "FC"),
        ("kiwi-com", "KC"), ("", "?"), ("B6", "B6"), ("trip_advisor", "TA"),
    ])
    func monogramInitials(name: String, expected: String) {
        #expect(Monogram.initials(name) == expected)
    }

    @Test func svgLogoFallsBackToMonogram() {
        let svg = Data("<svg xmlns='http://www.w3.org/2000/svg'/>".utf8)
        guard case .monogram = ImageLoader.decode(data: svg, contentType: "image/svg+xml") else {
            Issue.record("SVG should draw a monogram"); return
        }
        guard case .monogram = ImageLoader.decode(data: Data([0, 1, 2]), contentType: "image/png") else {
            Issue.record("Undecodable bytes should draw a monogram"); return
        }
    }

    @Test(arguments: FontFace.allCases)
    func bundledFontsRegister(face: FontFace) {
        #expect(UIFont(name: face.rawValue, size: 14) != nil, "\(face.rawValue) is not registered")
    }

    @Test func lenientEnumsKnownCases() {
        #expect(Cabin.knownCases == [.economy, .premiumEconomy, .business, .first])
        #expect(MaxStops.nonstop.label == "Nonstop only")
        #expect(SellerTier.unvetted.flightLabel == "Not vetted")
        #expect(AirlineNames.display(code: "az", fallback: "Alitalia") == "ITA Airways")
    }
}
