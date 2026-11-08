import Foundation
import Testing
@testable import Lodestar

@Suite("Search form: defaults, validation and request building")
struct SearchFormTests {
    let today = date("2026-11-07")

    private func ready() -> SearchForm {
        var form = SearchForm.initial(today: today)
        form.from = ["SFO"]
        form.to = ["JFK"]
        return form
    }

    @Test func initialLeavesInThreeWeeksForFiveDays() {
        let form = SearchForm.initial(today: today)
        #expect(form.depart == date("2026-11-28"))
        #expect(form.returnDate == date("2026-12-03"))
        #expect(form.roundTrip)
        #expect(form.adults == 1 && form.cabin == .economy && form.stops == .any && form.bags == 0)
        #expect(form.nearby && form.flexible && form.split)
    }

    @Test func validation() {
        var form = SearchForm.initial(today: today)
        #expect(form.issue(today: today) == .missingFrom)
        form.from = ["SFO"]
        #expect(form.issue(today: today) == .missingTo)
        form.to = ["SFO"]
        #expect(form.issue(today: today) == .sameAirports)
        form.to = ["JFK"]
        #expect(form.isReady(today: today))
        form.depart = date("2026-11-06")
        #expect(form.issue(today: today) == .departPassed)
        #expect(form.issue(today: today)?.message == "Pick a departure date from today on.")
        form.depart = date("2026-12-10")
        #expect(form.issue(today: today) == .returnBeforeDepart)
        form.roundTrip = false
        #expect(form.isReady(today: today))
        #expect(SearchForm.Issue.missingFrom.message == nil)
    }

    @Test func roundTripQueryCarriesFormAndPreferenceFilters() throws {
        var prefs = Preferences.default
        prefs.alliances = [.oneworld]
        prefs.avoidedAirlines = ["NK"]
        prefs.preferredAirlines = ["AS"]
        prefs.avoidRedEyes = true
        var form = ready()
        form.cabin = .business
        form.bags = 1
        let query = form.query(applying: prefs)
        #expect(query.returnDate == date("2026-12-03"))
        #expect(query.cabin == .business)
        #expect(query.bags == 1)
        #expect(query.alliances == [.oneworld])
        #expect(query.avoidAirlines == ["NK"])
        #expect(query.preferAirlines == ["AS"])
        #expect(query.avoidRedEyes)
        let body = try jsonObject(query)
        #expect(body["return"] as? String == "2026-12-03")
        #expect(body["avoidAirlines"] as? [String] == ["NK"])
    }

    @Test func oneWayKeepsReturnInFormButSendsNull() throws {
        let form = ready().settingRoundTrip(false)
        #expect(form.returnDate != nil)
        let body = try jsonObject(form.query(applying: .default))
        #expect(body["return"] is NSNull)
    }

    @Test func roundTripOnRepairsAMissingOrEarlyReturn() {
        var form = ready()
        form.returnDate = nil
        form.roundTrip = false
        let on = form.settingRoundTrip(true)
        #expect(on.returnDate == form.depart.adding(days: 5))
    }

    @Test func movingDepartKeepsTripLengthWhenReturnWouldBeBefore() {
        let form = ready()
        let later = form.settingDepart(date("2026-12-10"))
        #expect(later.returnDate == date("2026-12-15"))
        let earlier = form.settingDepart(date("2026-11-20"))
        #expect(earlier.returnDate == date("2026-12-03"))
        #expect(form.settingReturn(date("2026-11-01")).returnDate == form.depart)
    }

    @Test func preferencesFillDefaultsButKeepTypedAirports() {
        var prefs = Preferences.default
        prefs.homeAirports = ["OAK", "SJC"]
        prefs.cabin = .premiumEconomy
        prefs.adults = 2
        prefs.split = false
        let empty = SearchForm.initial(today: today).applyingPreferences(prefs)
        #expect(empty.from == ["OAK", "SJC"])
        #expect(empty.cabin == .premiumEconomy && empty.adults == 2 && !empty.split)
        let typed = ready().applyingPreferences(prefs)
        #expect(typed.from == ["SFO"])
    }

    @Test func hacksApplyOnTopOfTheSearchedForm() {
        let oneWay = ready().settingRoundTrip(false)
        let throwaway = oneWay.applying(HackApply(returnDate: .some(date("2026-12-05"))))
        #expect(throwaway.roundTrip && throwaway.returnDate == date("2026-12-05"))
        let flexOneWay = oneWay.applying(HackApply(depart: date("2026-11-27"), returnDate: .some(nil)))
        #expect(!flexOneWay.roundTrip && flexOneWay.depart == date("2026-11-27"))
        let position = ready().applying(HackApply(from: ["OAK"], cabin: .business, adults: 1))
        #expect(position.from == ["OAK"] && position.cabin == .business)
        #expect(ready().applying(HackApply()) == ready())
    }

    @Test func pickingADayKeepsTheTripShape() {
        let day = DayPrice(depart: date("2026-11-30"), returnDate: date("2026-12-05"), price: 300)
        #expect(ready().picking(day).returnDate == date("2026-12-05"))
        let oneWay = ready().settingRoundTrip(false).picking(DayPrice(depart: date("2026-11-30"), returnDate: nil, price: 1))
        #expect(oneWay.depart == date("2026-11-30"))
    }

    @Test func swapAndPendingQuery() {
        let swapped = ready().swapped()
        #expect(swapped.from == ["JFK"] && swapped.to == ["SFO"])
        var query = SearchQuery(from: ["LAX"], to: ["MEX"], depart: date("2026-12-04"))
        query.stops = .nonstop
        let form = SearchForm(query: query)
        #expect(!form.roundTrip && form.stops == .nonstop && form.from == ["LAX"])
    }

    @Test func preferenceChips() {
        var prefs = Preferences.default
        #expect(SearchPreferenceChips.chips(prefs) == ["No self-transfers"])
        prefs.alliances = [.starAlliance]
        prefs.preferredAirlines = ["UA", "LH"]
        prefs.avoidedAirlines = ["NK"]
        prefs.avoidRedEyes = true
        prefs.noBasicEconomy = true
        prefs.avoidSelfTransfer = false
        #expect(SearchPreferenceChips.chips(prefs) == [
            "Star Alliance only", "Prefer UA, LH", "Never NK", "No red-eyes", "No basic economy",
        ])
    }

    @Test func airportChipRules() {
        #expect(AirportLookup.adding("sfo", to: []) == ["SFO"])
        #expect(AirportLookup.adding("SFO", to: ["SFO"]) == ["SFO"])
        #expect(AirportLookup.adding("BUR", to: ["SFO", "OAK", "SJC", "LAX"]).count == 4)
        #expect(AirportLookup.typedCode(" jfk ") == "JFK")
        #expect(AirportLookup.typedCode("JFKX") == nil)
        #expect(AirportLookup.typedCode("J1K") == nil)
    }
}
