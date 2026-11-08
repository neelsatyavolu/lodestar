import Foundation

/// The flight search form as the web holds it (`components/search-form.tsx FormState`).
/// `returnDate` is kept while one-way is selected, so switching back restores it.
struct SearchForm: Hashable, Sendable {
    var from: [String] = []
    var to: [String] = []
    var depart: LocalDate
    var returnDate: LocalDate?
    var roundTrip = true
    var adults = 1
    var cabin: Cabin = .economy
    var stops: MaxStops = .any
    var bags = 0
    var nearby = true
    var flexible = true
    var split = true

    /// A field holds up to 4 codes as chips (the search accepts up to 6).
    static let maxCodesPerField = 4
    static let adultChoices = Array(1...9)
    static let bagChoices = [0, 1, 2]
    static let defaultTripLength = 5

    /// Web default: leave in three weeks, back five days later, round trip.
    static func initial(today: LocalDate = .today()) -> SearchForm {
        let depart = today.adding(days: 21)
        return SearchForm(depart: depart, returnDate: depart.adding(days: defaultTripLength))
    }

    /// A query another feature asked Search to run (Plan, Trips, a hack).
    init(query: SearchQuery) {
        from = query.from
        to = query.to
        depart = query.depart
        returnDate = query.returnDate
        roundTrip = query.returnDate != nil
        adults = query.adults
        cabin = query.cabin == .unknown ? .economy : query.cabin
        stops = query.stops == .unknown ? .any : query.stops
        bags = query.bags
        nearby = query.nearby
        flexible = query.flexible
        split = query.split
    }

    init(depart: LocalDate, returnDate: LocalDate?) {
        self.depart = depart
        self.returnDate = returnDate
    }

    // MARK: - Validation

    enum Issue: Equatable, Sendable {
        case missingFrom, missingTo, departPassed, returnBeforeDepart, sameAirports

        /// Shown under the button. Missing airports need no message: the empty field says it.
        var message: String? {
            switch self {
            case .missingFrom, .missingTo: nil
            case .departPassed: "Pick a departure date from today on."
            case .returnBeforeDepart: "Return is before departure."
            case .sameAirports: "From and to are the same place."
            }
        }
    }

    /// The first thing stopping a search, or nil when it can run (web `ready`).
    func issue(today: LocalDate = .today()) -> Issue? {
        if from.isEmpty { return .missingFrom }
        if to.isEmpty { return .missingTo }
        if Set(from) == Set(to) { return .sameAirports }
        if depart < today { return .departPassed }
        if roundTrip, returnDate.map({ $0 < depart }) ?? true { return .returnBeforeDepart }
        return nil
    }

    func isReady(today: LocalDate = .today()) -> Bool { issue(today: today) == nil }

    // MARK: - Building the request

    /// The search request: the form plus the traveller's saved filters (web `queryFor`).
    func query(applying prefs: Preferences) -> SearchQuery {
        var query = SearchQuery(from: from, to: to, depart: depart, returnDate: roundTrip ? returnDate : nil)
        query.cabin = cabin
        query.stops = stops
        query.adults = adults
        query.bags = bags
        query.nearby = nearby
        query.flexible = flexible
        query.split = split
        return query.applying(prefs)
    }

    // MARK: - Edits (each returns a new form)

    /// Saved preferences as form defaults. Airports already typed are kept (web `applyPreferences`).
    func applyingPreferences(_ p: Preferences) -> SearchForm {
        var copy = self
        if copy.from.isEmpty { copy.from = Array(p.homeAirports.prefix(Self.maxCodesPerField)) }
        copy.cabin = p.cabin
        copy.stops = p.stops
        copy.adults = p.adults
        copy.bags = p.bags
        copy.nearby = p.nearby
        copy.flexible = p.flexible
        copy.split = p.split
        return copy
    }

    /// Round trip on: keep a valid return, else five days after departure.
    func settingRoundTrip(_ on: Bool) -> SearchForm {
        var copy = self
        copy.roundTrip = on
        if on, returnDate.map({ $0 < depart }) ?? true {
            copy.returnDate = depart.adding(days: Self.defaultTripLength)
        }
        return copy
    }

    /// Moving departure keeps the trip length when the return would fall before it.
    func settingDepart(_ date: LocalDate) -> SearchForm {
        var copy = self
        let length = returnDate.map { max(depart.days(to: $0), 0) } ?? Self.defaultTripLength
        copy.depart = date
        if let ret = returnDate, ret < date { copy.returnDate = date.adding(days: length) }
        return copy
    }

    func settingReturn(_ date: LocalDate) -> SearchForm {
        var copy = self
        copy.returnDate = max(date, depart)
        return copy
    }

    func swapped() -> SearchForm {
        var copy = self
        copy.from = to
        copy.to = from
        return copy
    }

    /// A hack's search changes on top of this (the last searched) form (web `onHack`).
    func applying(_ apply: HackApply) -> SearchForm {
        var copy = self
        if let from = apply.from { copy.from = from }
        if let depart = apply.depart { copy.depart = depart }
        if let cabin = apply.cabin { copy.cabin = cabin }
        if let adults = apply.adults { copy.adults = adults }
        if let ret = apply.returnDate {
            copy.returnDate = ret
            if ret != nil { copy.roundTrip = true }
        }
        return copy
    }

    /// Tapping a day on the date strip: that departure, and its return on a round trip.
    func picking(_ day: DayPrice) -> SearchForm {
        var copy = self
        copy.depart = day.depart
        if roundTrip { copy.returnDate = day.returnDate ?? returnDate }
        return copy
    }
}

/// Short labels for the filters in effect, shown under the form (web `preferenceChips`).
enum SearchPreferenceChips {
    static func chips(_ p: Preferences) -> [String] {
        var chips = p.alliances.filter { $0 != .unknown }.map { "\($0.label) only" }
        if !p.preferredAirlines.isEmpty { chips.append("Prefer \(p.preferredAirlines.joined(separator: ", "))") }
        if !p.avoidedAirlines.isEmpty { chips.append("Never \(p.avoidedAirlines.joined(separator: ", "))") }
        if p.avoidRedEyes { chips.append("No red-eyes") }
        if p.noBasicEconomy { chips.append("No basic economy") }
        if p.avoidSelfTransfer { chips.append("No self-transfers") }
        return chips
    }
}
