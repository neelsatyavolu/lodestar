import Foundation
import Testing
@testable import Lodestar

@MainActor
@Suite("Travel preferences draft")
struct PreferencesDraftTests {
    @Test func editsDoNotTouchTheOriginal() {
        let original = Preferences.default
        let draft = PreferencesDraft(original)
        draft.update { $0.cabin = .business }
        #expect(draft.value.cabin == .business)
        #expect(original.cabin == .economy)
    }

    @Test func alliancesToggleOnAndOff() {
        let draft = PreferencesDraft(.default)
        draft.toggle(Alliance.oneworld)
        draft.toggle(Alliance.skyteam)
        #expect(draft.value.alliances == [.oneworld, .skyteam])
        draft.toggle(Alliance.oneworld)
        #expect(draft.value.alliances == [.skyteam])
    }

    @Test func tappingAChipAtTheMaxDoesNothing() {
        let draft = PreferencesDraft(.default)
        for choice in TasteChoices.dietary { draft.toggle(choice, in: .dietary) }
        #expect(draft.value.dietary.count == 8)
        #expect(!draft.addOther("Keto", to: .dietary))
        draft.toggle("Vegan", in: .dietary)
        #expect(draft.value.dietary.count == 7)
        #expect(draft.addOther("Low sodium", to: .dietary))
        draft.toggle("Vegan", in: .dietary)
        #expect(!draft.value.dietary.contains("Vegan"))
        #expect(draft.value.dietary.last == "Low sodium")
    }

    @Test func otherBoxCleansTextAndIgnoresEmptyAndDuplicates() {
        let draft = PreferencesDraft(.default)
        #expect(draft.addOther("  Dim sum!! 🥟 ", to: .cuisines))
        #expect(draft.value.cuisines == ["Dim sum"])
        #expect(!draft.addOther("Dim sum", to: .cuisines))
        #expect(!draft.addOther("🥟🥟", to: .cuisines))
        draft.addOther(String(repeating: "a", count: 60), to: .cuisines)
        #expect(draft.value.cuisines.last?.count == 40)
    }

    @Test func customValuesShowAfterTheSuggestions() {
        let shown = TasteField.cuisines.displayed(selected: ["Thai", "Dim sum"])
        #expect(Array(shown.prefix(TasteChoices.cuisines.count)) == TasteChoices.cuisines)
        #expect(shown.last == "Dim sum")
        #expect(shown.filter { $0 == "Thai" }.count == 1)
    }

    @Test func diningBudgetDeselectsWhenTappedAgain() {
        let draft = PreferencesDraft(.default)
        draft.toggle(PriceLevel.two)
        #expect(draft.value.diningBudget == .two)
        draft.toggle(PriceLevel.three)
        #expect(draft.value.diningBudget == .three)
        draft.toggle(PriceLevel.three)
        #expect(draft.value.diningBudget == nil)
    }

    @Test func hotelBudgetKeepsDigitsOnlyAndCommitsLikeTheWeb() {
        let draft = PreferencesDraft(.default)
        draft.setHotelBudgetText("$2,50")
        #expect(draft.hotelBudgetText == "250")
        draft.setHotelBudgetText("123456")
        #expect(draft.hotelBudgetText == "1234")
        draft.commitHotelBudget()
        #expect(draft.value.hotelBudget == 1234)
        draft.setHotelBudgetText("15")
        draft.commitHotelBudget()
        #expect(draft.value.hotelBudget == nil)
        #expect(draft.hotelBudgetText.isEmpty)
        draft.setHotelBudgetText("9999")
        draft.commitHotelBudget()
        #expect(draft.value.hotelBudget == 5000)
    }

    @Test func startsFromTheSavedHotelBudget() {
        var saved = Preferences.default
        saved.hotelBudget = 300
        #expect(PreferencesDraft(saved).hotelBudgetText == "300")
    }

    @Test func codesStopAtTheirMax() {
        let draft = PreferencesDraft(.default)
        draft.setCodes(.homeAirports, ["SFO", "OAK", "SJC", "SMF", "LAX"])
        #expect(draft.value.homeAirports == ["SFO", "OAK", "SJC", "SMF"])
    }

    @Test func saveSendsTheWholeObjectWithTheTypedBudget() async {
        let draft = PreferencesDraft(.default)
        draft.update { $0.homeAirports = ["SFO"] }
        draft.setHotelBudgetText("250")
        var sent: Preferences?
        let ok = await draft.save(using: { sent = $0 }, report: { $0.userMessage })
        #expect(ok)
        #expect(sent?.homeAirports == ["SFO"])
        #expect(sent?.hotelBudget == 250)
    }

    @Test func saveRefusesInvalidCodesBeforeTheServer() async {
        let draft = PreferencesDraft(.default)
        draft.update { $0.homeAirports = ["SF"] }
        var called = false
        let ok = await draft.save(using: { _ in called = true }, report: { $0.userMessage })
        #expect(!ok)
        #expect(!called)
        #expect(draft.error == "Use a three-letter airport code.")
    }

    @Test func saveFailureKeepsTheMessage() async {
        let draft = PreferencesDraft(.default)
        let ok = await draft.save(using: { _ in
            throw APIError.server(status: 429, message: "Too many saves. Try again in a few minutes.")
        }, report: { $0.userMessage })
        #expect(!ok)
        #expect(draft.error == "Too many saves. Try again in a few minutes.")
        #expect(!draft.isSaving)
        draft.clearError()
        #expect(draft.error == nil)
    }

    @Test func savedBodyAlwaysHasAll23Keys() throws {
        let draft = PreferencesDraft(.default)
        draft.toggle(PriceLevel.one)
        draft.toggle(PriceLevel.one)
        let object = try jsonObject(draft.value)
        #expect(object.count == 23)
        #expect(object["diningBudget"] is NSNull)
        #expect(object["hotelBudget"] is NSNull)
        #expect(object["stops"] as? String == "ANY")
    }
}
