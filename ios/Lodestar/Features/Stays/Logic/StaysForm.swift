import Foundation

/// The Stays search form as a value (web `components/stays.tsx`). Every change returns a new form.
struct StaysForm: Hashable, Sendable {
    static let maxNights = 30
    static let maxAdults = 8
    static let maxCityLength = 80
    static let defaultLeadDays = 21
    static let defaultNights = 3

    let city: String
    let checkin: LocalDate
    let checkout: LocalDate
    let adults: Int

    /// Check-in `today + 21`, 3 nights, 2 adults, no city.
    static func initial(today: LocalDate) -> StaysForm {
        let checkin = today.adding(days: defaultLeadDays)
        return StaysForm(city: "", checkin: checkin, checkout: checkin.adding(days: defaultNights), adults: 2)
    }

    /// The form a past search was run with (a flex shift re-fills the form).
    init(query: StaySearchQuery) {
        self.init(city: query.city, checkin: query.checkin, checkout: query.checkout, adults: query.adults)
    }

    init(city: String, checkin: LocalDate, checkout: LocalDate, adults: Int) {
        self.city = city
        self.checkin = checkin
        self.checkout = checkout
        self.adults = adults
    }

    var nights: Int { checkin.days(to: checkout) }

    /// The city is capped at 80 characters, like the web's `maxLength`.
    func with(city: String) -> StaysForm {
        StaysForm(city: String(city.prefix(Self.maxCityLength)), checkin: checkin, checkout: checkout, adults: adults)
    }

    /// Moving check-in keeps the length of stay (when it was at least one night).
    func with(checkin newCheckin: LocalDate) -> StaysForm {
        let length = nights
        let newCheckout = length >= 1 ? newCheckin.adding(days: length) : checkout
        return StaysForm(city: city, checkin: newCheckin, checkout: newCheckout, adults: adults)
    }

    func with(checkout newCheckout: LocalDate) -> StaysForm {
        StaysForm(city: city, checkin: checkin, checkout: newCheckout, adults: adults)
    }

    func with(adults newAdults: Int) -> StaysForm {
        StaysForm(city: city, checkin: checkin, checkout: checkout, adults: min(max(newAdults, 1), Self.maxAdults))
    }

    func with(dates saving: FlexSaving) -> StaysForm {
        StaysForm(city: city, checkin: saving.checkin, checkout: saving.checkout, adults: adults)
    }

    /// Search is enabled when the city has 2+ characters, check-in is today or later
    /// (the server's UTC day) and the stay is 1 to 30 nights.
    func isReady(today: LocalDate) -> Bool {
        city.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
            && checkin >= today
            && (1...Self.maxNights).contains(nights)
    }

    /// "Stays are up to 30 nights." when the stay is too long, else nil.
    var lengthError: String? {
        nights > Self.maxNights ? "Stays are up to \(Self.maxNights) nights." : nil
    }

    /// The request body for `/api/stays/search` and `/api/stays/flex` (city trimmed).
    var query: StaySearchQuery {
        StaySearchQuery(
            city: city.trimmingCharacters(in: .whitespacesAndNewlines),
            checkin: checkin,
            checkout: checkout,
            adults: adults
        )
    }
}

extension StaySearchQuery {
    /// The `/api/stays/prices` body for one hotel of this search.
    func prices(for hotelKey: String) -> StayPricesQuery {
        StayPricesQuery(key: hotelKey, checkin: checkin, checkout: checkout, adults: adults)
    }
}
