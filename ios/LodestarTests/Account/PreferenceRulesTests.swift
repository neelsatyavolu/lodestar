import Foundation
import Testing
@testable import Lodestar

@Suite("Preference rules and Account text")
struct PreferenceRulesTests {
    @Test func defaultsAreValid() {
        #expect(PreferenceRules.validationMessage(for: .default) == nil)
    }

    @Test func airlineCodesMustBeTwoUppercaseCharacters() {
        var p = Preferences.default
        p.preferredAirlines = ["UA", "B6"]
        #expect(PreferenceRules.validationMessage(for: p) == nil)
        p.avoidedAirlines = ["ua"]
        #expect(PreferenceRules.validationMessage(for: p) == "Use a two-character airline code.")
    }

    @Test func tastesMustBePlainWords() {
        var p = Preferences.default
        p.interests = ["Art & galleries", "Cafés & bakeries"]
        #expect(PreferenceRules.validationMessage(for: p) == nil)
        p.interests = ["Raves!"]
        #expect(PreferenceRules.validationMessage(for: p) == "Use plain words.")
    }

    @Test func listLimitsAndRanges() {
        var p = Preferences.default
        p.hotelPriorities = Array(TasteChoices.hotelPriorities.prefix(9))
        #expect(PreferenceRules.validationMessage(for: p) != nil)
        p = .default
        p.hotelBudget = 19
        #expect(PreferenceRules.validationMessage(for: p) != nil)
        p.hotelBudget = 20
        #expect(PreferenceRules.validationMessage(for: p) == nil)
        p.bags = 3
        #expect(PreferenceRules.validationMessage(for: p) != nil)
    }

    @Test func pickerLabels() {
        #expect(PreferenceRules.adultsLabel(1) == "1 adult")
        #expect(PreferenceRules.adultsLabel(3) == "3 adults")
        #expect(PreferenceRules.bagsLabel(0) == "None")
        #expect(PreferenceRules.bagsLabel(1) == "1 checked bag")
        #expect(PreferenceRules.bagsLabel(2) == "2 checked bags")
        #expect(PreferenceRules.adultChoices == [1, 2, 3, 4, 5, 6])
    }

    @Test func tasteFieldLimitsMatchTheContract() {
        #expect(TasteField.cuisines.max == 12)
        #expect(TasteField.dietary.max == 8)
        #expect(TasteField.interests.max == 12)
        #expect(TasteField.hotelPriorities.max == 8)
        #expect(CodeField.preferredAirlines.max == 10)
        #expect(CodeField.avoidedAirlines.max == 20)
    }

    @Test func memberSinceUsesMonthAndYear() {
        let utc = TimeZone(identifier: "UTC")!
        #expect(AccountFormatting.memberSince(1_762_473_600_000, timeZone: utc) == "Member since November 2025")
        #expect(AccountFormatting.memberSince(nil) == nil)
    }

    @Test func preferencesSummary() {
        var p = Preferences.default
        #expect(AccountFormatting.preferencesSummary(p) == "No home airports · Economy · 1 adult")
        p.homeAirports = ["SFO", "OAK"]
        p.adults = 2
        p.bags = 1
        p.stops = .nonstop
        p.alliances = [.starAlliance]
        #expect(AccountFormatting.preferencesSummary(p)
            == "From SFO, OAK · Economy · 2 adults · 1 checked bag · Nonstop only · Star Alliance only")
    }

    @Test func aiSummary() throws {
        let both = try decodeEnvelope(#"{"connected":{"codex":true,"grok":true},"models":{"codex":[],"grok":[]}}"#, as: AIStatus.self)
        #expect(AccountFormatting.aiSummary(both) == "ChatGPT and Grok connected")
        #expect(AccountFormatting.aiSummary(.disconnected) == nil)
    }
}
