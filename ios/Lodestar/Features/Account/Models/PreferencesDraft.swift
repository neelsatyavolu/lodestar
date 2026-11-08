import Foundation
import Observation

/// An editable copy of the preferences, shared by Travel preferences and onboarding.
/// Every edit produces a new `Preferences` value; nothing reaches `AppState` until `save`.
@MainActor
@Observable
final class PreferencesDraft {
    private(set) var value: Preferences
    /// The hotel budget box as typed (digits only, up to 4). Committed on Return or blur.
    private(set) var hotelBudgetText: String
    private(set) var isSaving = false
    private(set) var error: String?

    init(_ preferences: Preferences) {
        value = preferences
        hotelBudgetText = preferences.hotelBudget.map(String.init) ?? ""
    }

    /// Applies one edit to a copy and swaps it in.
    func update(_ edit: (inout Preferences) -> Void) {
        var next = value
        edit(&next)
        value = next
    }

    // MARK: Airlines and airports

    func toggle(_ alliance: Alliance) {
        update { p in
            p.alliances = p.alliances.contains(alliance)
                ? p.alliances.filter { $0 != alliance }
                : p.alliances + [alliance]
        }
    }

    func setCodes(_ field: CodeField, _ codes: [String]) {
        update { $0[keyPath: field.keyPath] = Array(codes.prefix(field.max)) }
    }

    // MARK: Taste chips

    /// Tapping a chip at the max does nothing (web behaviour).
    func toggle(_ choice: String, in field: TasteField) {
        update { p in
            let current = p[keyPath: field.keyPath]
            if current.contains(choice) {
                p[keyPath: field.keyPath] = current.filter { $0 != choice }
            } else if current.count < field.max {
                p[keyPath: field.keyPath] = current + [choice]
            }
        }
    }

    /// The "Other…" box: strips characters the server refuses, cuts to 40, and ignores an
    /// empty value, a duplicate or a full list. Returns whether it was added.
    @discardableResult
    func addOther(_ text: String, to field: TasteField) -> Bool {
        let cleaned = TasteChoices.sanitize(text)
        let current = value[keyPath: field.keyPath]
        guard !cleaned.isEmpty, !current.contains(cleaned), current.count < field.max else { return false }
        update { $0[keyPath: field.keyPath] = current + [cleaned] }
        return true
    }

    /// Tapping the selected level clears it.
    func toggle(_ level: PriceLevel) {
        update { $0.diningBudget = $0.diningBudget == level ? nil : level }
    }

    // MARK: Hotel budget

    func setHotelBudgetText(_ text: String) {
        hotelBudgetText = String(text.filter(\.isASCII).filter(\.isNumber).prefix(PreferenceRules.hotelBudgetDigits))
    }

    /// A value under 20 clears to nil (and empties the box), like the web's blur handler.
    func commitHotelBudget() {
        let number = Int(hotelBudgetText)
        if let number, number >= PreferenceRules.hotelBudgetRange.lowerBound {
            update { $0.hotelBudget = min(number, PreferenceRules.hotelBudgetRange.upperBound) }
        } else {
            hotelBudgetText = ""
            update { $0.hotelBudget = nil }
        }
    }

    // MARK: Saving

    /// Validates on device, then calls `save`. Returns true on success; on failure `error`
    /// holds the message to show above the buttons and the screen stays open.
    func save(using save: @MainActor (Preferences) async throws -> Void,
              report: @MainActor (any Error) -> String?) async -> Bool {
        guard !isSaving else { return false }
        commitHotelBudget()
        error = nil
        if let problem = PreferenceRules.validationMessage(for: value) {
            error = problem
            return false
        }
        isSaving = true
        defer { isSaving = false }
        do {
            try await save(value)
            return true
        } catch {
            self.error = report(error)
            return false
        }
    }

    func clearError() {
        error = nil
    }
}
