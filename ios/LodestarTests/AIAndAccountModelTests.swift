import Foundation
import Testing
@testable import Lodestar

enum PlanFixtures {
    static let plan = #"""
    {"understanding":"Bay Area to New York over Thanksgiving week.","assumptions":["One adult","Economy"],
     "searches":[{"label":"SFO/OAK to NYC","why":"Main option","from":["SFO","OAK"],"to":["JFK","EWR"],
       "depart":"2026-11-21","return":"2026-11-29","cabin":"ECONOMY","stops":"ANY","adults":1,"bags":0,"nearby":true,"flexible":false}],
     "question":null,"needsOrigin":false}
    """#

    static let canvas = #"""
    {"type":"canvas","canvas":{"headline":"Fly Saturday, back Sunday","summary":"United nonstop is the pick.",
      "picks":[{"ref":"S1-1","title":"United nonstop","why":"Cheapest nonstop.","tradeoff":null,"tag":"best"},
               {"ref":"S1-2","title":"JetBlue","why":"Later.","tradeoff":"Red-eye back","tag":"comfortable"}],
      "tips":["Book by Friday."],"followups":["What about Newark?"]},
     "options":{"S1-1":{"itinerary":\#(SearchFixtures.itinerary),"search":0}},
     "hacks":[{"kind":"nearby","title":"Fly from Oakland","detail":"Saves $28.","saving":28,"price":412,"itineraryIds":["a1b2c3d4e5f6"],"search":"SFO/OAK to NYC"}]}
    """#
}

@Suite("Plan and AI models")
struct AIModelTests {
    @Test func decodesStatus() throws {
        let status = try decodeEnvelope(#"""
        {"connected":{"codex":false,"grok":true},
         "models":{"codex":[{"id":"gpt-6-astra","label":"GPT-6 Astra"}],"grok":[{"id":"grok-4.7","label":"Grok 4.7"}]}}
        """#, as: AIStatus.self)
        #expect(status.defaultProvider == .grok)
        #expect(status.anyConnected)
        #expect(status.models(for: .codex).first?.label == "GPT-6 Astra")
        #expect(AIStatus.disconnected.defaultProvider == nil)
    }

    @Test func decodesSignInAnswers() throws {
        let start = try decodeEnvelope(#"{"authorizeUrl":"https://auth.openai.com/oauth/authorize?x=1"}"#, as: AISignInStart.self)
        #expect(start.authorizeUrl.hasPrefix("https://auth.openai.com"))
        #expect(try decodeEnvelope(#"{"connected":"codex"}"#, as: AIConnected.self).connected == .codex)
        #expect(try decodeEnvelope(#"{"disconnected":"grok"}"#, as: AIDisconnected.self).disconnected == .grok)
        #expect(AIProvider.codex.loopbackPort == 1455)
        #expect(AIProvider.grok.loopbackPort == 56121)
    }

    @Test func decodesEveryStreamEvent() throws {
        let lines = [
            #"{"type":"status","text":"Reading your request"}"#,
            #"{"type":"plan","plan":\#(PlanFixtures.plan)}"#,
            #"{"type":"search","index":0,"state":"running"}"#,
            #"{"type":"search","index":0,"state":"done","count":42,"cheapest":389.5}"#,
            #"{"type":"search","index":1,"state":"error","error":"The fare search took too long. Try again."}"#,
            PlanFixtures.canvas,
            #"{"type":"error","error":"Your AI connection expired. Reconnect it."}"#,
            #"{"type":"heartbeat"}"#,
            #"{"type":"done"}"#,
        ]
        let events = try lines.map { try JSONCoding.decoder.decode(CanvasEvent.self, from: Data($0.utf8)) }
        #expect(events[0] == .status("Reading your request"))
        guard case .plan(let plan) = events[1] else { Issue.record("not a plan"); return }
        #expect(plan.searches[0].returnDate == date("2026-11-29"))
        #expect(plan.searches[0].from == ["SFO", "OAK"])
        guard case .search(let done) = events[3] else { Issue.record("not a search"); return }
        #expect(done.state == .done && done.count == 42 && done.cheapest == 389.5)
        guard case .search(let failed) = events[4] else { Issue.record("not a search"); return }
        #expect(failed.error?.hasPrefix("The fare search") == true)
        guard case .canvas(let result) = events[5] else { Issue.record("not a canvas"); return }
        #expect(result.canvas.picks[0].tag == .best)
        #expect(result.canvas.picks[1].tag == .unknown)
        #expect(result.options["S1-1"]?.search == 0)
        #expect(result.hacks[0].search == "SFO/OAK to NYC")
        #expect(result.hacks[0].hack.saving == 28)
        #expect(events[6] == .error("Your AI connection expired. Reconnect it."))
        #expect(events[7] == .ignored(type: "heartbeat"))
        #expect(events[8] == .done)
    }

    @Test func planWithoutSearchesDecodesDefaults() throws {
        let plan = try JSONCoding.decoder.decode(TripPlan.self, from: Data(#"{"question":"Where from?","needsOrigin":true}"#.utf8))
        #expect(plan.searches.isEmpty)
        #expect(plan.needsOrigin)
    }

    @Test func canvasRequestEncodesNullsLikeTheWeb() throws {
        let request = CanvasRequest(provider: .codex, prompt: "Chicago to London in spring")
        let json = try jsonObject(request)
        #expect(json["provider"] as? String == "codex")
        #expect(json["model"] == nil)
        #expect(json["context"] is NSNull)
        #expect((json["history"] as? [Any])?.isEmpty == true)

        let query = SearchQuery(from: ["ORD"], to: ["LHR"], depart: date("2027-04-01"))
        var withContext = request
        withContext.context = CanvasContext(query: query)
        withContext.defaults = CanvasDefaults(preferences: .default)
        let full = try jsonObject(withContext)
        let context = try #require(full["context"] as? [String: Any])
        #expect(context["return"] is NSNull)
        #expect(context["alliances"] == nil)
        #expect((full["defaults"] as? [String: Any])?["cabin"] as? String == "ECONOMY")
    }
}

@Suite("Account and preferences models")
struct AccountModelTests {
    @Test func decodesSignedInAndSignedOut() throws {
        let signedIn = try decodeEnvelope(#"""
        {"user":{"email":"neel@example.com","createdAt":1762500000000},
         "preferences":{"homeAirports":["SFO","OAK"],"alliances":["STAR_ALLIANCE"],"preferredAirlines":["UA"],"avoidedAirlines":[],
          "cabin":"BUSINESS","stops":"0","adults":2,"bags":1,"avoidRedEyes":true,"avoidSelfTransfer":true,"noBasicEconomy":true,
          "trustedOnly":false,"nearby":true,"flexible":false,"split":true,"cuisines":["Seafood"],"dietary":[],"diningBudget":"$$",
          "interests":["Museums"],"pace":"packed","hotelBudget":250,"hotelPriorities":["Quiet"]}}
        """#, as: AccountState.self)
        #expect(signedIn.user?.displayName == "neel")
        #expect(signedIn.user?.createdAt == 1_762_500_000_000)
        let prefs = try #require(signedIn.preferences)
        #expect(prefs.cabin == .business)
        #expect(prefs.stops == .nonstop)
        #expect(prefs.diningBudget == .two)
        #expect(prefs.pace == .packed)
        #expect(prefs.hotelBudget == 250)
        #expect(!prefs.trustedOnly)

        let signedOut = try decodeEnvelope(#"{"user":null,"preferences":null}"#, as: AccountState.self)
        #expect(signedOut.user == nil && signedOut.preferences == nil)
    }

    @Test func loginAnswerHasNoCreatedAt() throws {
        let session = try decodeEnvelope(#"{"user":{"email":"a@b.co"},"preferences":{}}"#, as: AccountSession.self)
        #expect(session.user.createdAt == nil)
        #expect(session.preferences == .default)
    }

    @Test func preferencesFallBackPerField() throws {
        let prefs = try JSONCoding.decoder.decode(Preferences.self, from: Data(#"""
        {"cabin":"COACH","stops":3,"adults":"two","alliances":["ONEWORLD","NEWALLIANCE"],"pace":"zen","diningBudget":null,"newField":1}
        """#.utf8))
        #expect(prefs.cabin == .economy)
        #expect(prefs.stops == .any)
        #expect(prefs.adults == 1)
        #expect(prefs.alliances == [.oneworld])
        #expect(prefs.pace == .balanced)
        #expect(prefs.trustedOnly)
        #expect(prefs.diningBudget == nil)
    }

    @Test func preferencesAlwaysEncodeEveryField() throws {
        let json = try jsonObject(Preferences.default)
        #expect(json.count == 22)
        #expect(json["diningBudget"] is NSNull)
        #expect(json["hotelBudget"] is NSNull)
        #expect(json["stops"] as? String == "ANY")
        #expect(json["avoidSelfTransfer"] as? Bool == true)
        let roundTrip = try JSONCoding.decoder.decode(Preferences.self, from: JSONCoding.encoder.encode(Preferences.default))
        #expect(roundTrip == .default)
    }

    @Test func forgotAndResetHelpers() throws {
        let forgot = try decodeEnvelope(#"{"message":"If an account exists for that address, a reset link is on its way."}"#, as: ForgotResponse.self)
        #expect(forgot.message.hasPrefix("If an account exists"))
        let token = "Ab3_-xYz0123456789Ab3_-xYz0123456789Ab3_-xY"
        #expect(ResetRequest.token(fromLink: "https://lodestar.xanom.co/reset?token=\(token)") == token)
        #expect(ResetRequest.token(fromLink: "  \(token)\n") == token)
        #expect(ResetRequest.token(fromLink: "https://lodestar.xanom.co/reset") == nil)
        #expect(try jsonObject(SignOutEverywhereRequest())["action"] as? String == "signout-everywhere")
    }

    @Test func tasteSanitizing() {
        #expect(TasteChoices.sanitize("  Tapas & wine! 🍷 ") == "Tapas & wine")
        #expect(TasteChoices.sanitize(String(repeating: "a", count: 60)).count == 40)
    }
}
