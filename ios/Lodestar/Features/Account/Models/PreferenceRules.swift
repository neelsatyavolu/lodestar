import Foundation

/// The server's limits and validation for `PUT /api/preferences` (lib/preferences.ts), checked on
/// device first so the strict server rarely refuses a save. Messages match the server's.
enum PreferenceRules {
    static let maxHomeAirports = 4
    static let maxPreferredAirlines = 10
    static let maxAvoidedAirlines = 20
    static let adultChoices = Array(1...6)
    static let bagChoices = [0, 1, 2]
    static let hotelBudgetRange = 20...5000
    static let hotelBudgetDigits = 4
    static let tasteMaxLength = 40

    static let airportMessage = "Use a three-letter airport code."
    static let airlineMessage = "Use a two-character airline code."
    static let tasteMessage = "Use plain words."

    /// "1 adult", "2 adults".
    static func adultsLabel(_ count: Int) -> String {
        plural(count, "adult")
    }

    /// 0 "None", 1 "1 checked bag", 2 "2 checked bags".
    static func bagsLabel(_ count: Int) -> String {
        count == 0 ? "None" : plural(count, "checked bag")
    }

    static func isAirportCode(_ code: String) -> Bool {
        code.count == 3 && code.allSatisfy { $0.isASCII && $0.isUppercase && $0.isLetter }
    }

    static func isAirlineCode(_ code: String) -> Bool {
        code.count == 2 && code.allSatisfy { $0.isASCII && ($0.isUppercase || $0.isNumber) }
    }

    static func isTaste(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        return !trimmed.isEmpty && trimmed.count <= tasteMaxLength && TasteChoices.sanitize(trimmed) == trimmed
    }

    /// The first problem the server would report, or nil when the save should go through.
    static func validationMessage(for p: Preferences) -> String? {
        if p.homeAirports.count > maxHomeAirports { return "Pick up to \(maxHomeAirports) home airports." }
        if !p.homeAirports.allSatisfy(isAirportCode) { return airportMessage }
        if p.preferredAirlines.count > maxPreferredAirlines {
            return "Pick up to \(maxPreferredAirlines) airlines to prefer."
        }
        if p.avoidedAirlines.count > maxAvoidedAirlines { return "Pick up to \(maxAvoidedAirlines) airlines to avoid." }
        if !(p.preferredAirlines + p.avoidedAirlines).allSatisfy(isAirlineCode) { return airlineMessage }
        if !(1...9).contains(p.adults) { return "Pick between 1 and 9 travellers." }
        if !bagChoices.contains(p.bags) { return "Pick up to 2 checked bags." }
        for field in TasteField.allCases {
            let values = p[keyPath: field.keyPath]
            if values.count > field.max { return "Pick up to \(field.max) for \(field.label.lowercased())." }
            if !values.allSatisfy(isTaste) { return tasteMessage }
        }
        if let budget = p.hotelBudget, !hotelBudgetRange.contains(budget) {
            return "Set a hotel budget between $20 and $5,000, or leave it empty."
        }
        return nil
    }
}

/// The four free-text chip lists (food, dietary, interests, hotel priorities).
enum TasteField: String, CaseIterable, Sendable {
    case cuisines, dietary, interests, hotelPriorities

    var keyPath: WritableKeyPath<Preferences, [String]> {
        switch self {
        case .cuisines: \.cuisines
        case .dietary: \.dietary
        case .interests: \.interests
        case .hotelPriorities: \.hotelPriorities
        }
    }

    var max: Int {
        switch self {
        case .cuisines, .interests: 12
        case .dietary, .hotelPriorities: 8
        }
    }

    var label: String {
        switch self {
        case .cuisines: "Food you love"
        case .dietary: "Dietary needs"
        case .interests: "What you like doing"
        case .hotelPriorities: "In a hotel you care about"
        }
    }

    var choices: [String] {
        switch self {
        case .cuisines: TasteChoices.cuisines
        case .dietary: TasteChoices.dietary
        case .interests: TasteChoices.interests
        case .hotelPriorities: TasteChoices.hotelPriorities
        }
    }

    /// Suggested choices first, then custom values already selected (the web's order).
    func displayed(selected: [String]) -> [String] {
        choices + selected.filter { !choices.contains($0) }
    }
}

/// The three code lists (home airports, preferred and avoided airlines).
enum CodeField: String, CaseIterable, Sendable {
    case homeAirports, preferredAirlines, avoidedAirlines

    var keyPath: WritableKeyPath<Preferences, [String]> {
        switch self {
        case .homeAirports: \.homeAirports
        case .preferredAirlines: \.preferredAirlines
        case .avoidedAirlines: \.avoidedAirlines
        }
    }

    var max: Int {
        switch self {
        case .homeAirports: PreferenceRules.maxHomeAirports
        case .preferredAirlines: PreferenceRules.maxPreferredAirlines
        case .avoidedAirlines: PreferenceRules.maxAvoidedAirlines
        }
    }

    var kind: CodePickerKind { self == .homeAirports ? .airport : .airline }
}
