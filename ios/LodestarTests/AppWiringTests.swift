import Foundation
import Testing
@testable import Lodestar

@Suite("Deep links")
struct DeepLinkTests {
    let base = URL(string: "https://lodestar.xanom.co")!

    @Test func resetLinkOnTheWebHost() {
        let url = URL(string: "https://lodestar.xanom.co/reset?token=abc_123")!
        #expect(DeepLink.parse(url, webBase: base) == .resetPassword(link: "abc_123"))
    }

    @Test func resetLinkOnTheAppScheme() {
        let url = URL(string: "lodestar://reset?token=abc-123")!
        #expect(DeepLink.parse(url, webBase: base) == .resetPassword(link: "abc-123"))
    }

    @Test func shareLinkOpensOnTheConfiguredHost() {
        let local = URL(string: "http://localhost:3000")!
        let web = DeepLink.parse(URL(string: "lodestar://t/tok_9")!, webBase: local)
        #expect(web == .sharedTrip(URL(string: "http://localhost:3000/t/tok_9")!))
        let https = DeepLink.parse(URL(string: "https://lodestar.xanom.co/t/tok_9")!, webBase: base)
        #expect(https == .sharedTrip(URL(string: "https://lodestar.xanom.co/t/tok_9")!))
    }

    @Test(arguments: [
        "https://evil.example/reset?token=abc",
        "https://lodestar.xanom.co/reset",
        "https://lodestar.xanom.co/reset?token=a%20b",
        "https://lodestar.xanom.co/t/",
        "https://lodestar.xanom.co/t/a/b",
        "https://lodestar.xanom.co/trips",
        "lodestar://unknown",
        "mailto:a@b.co",
    ])
    func ignoresOtherLinks(_ text: String) {
        #expect(DeepLink.parse(URL(string: text)!, webBase: base) == nil)
    }
}

@MainActor
@Suite("App wiring")
struct AppWiringTests {
    private let profile = AccountProfile(email: "ada@example.com", createdAt: nil)

    @Test func openingAResetLinkShowsTheResetSheetOnAccount() {
        let app = AppState()
        #expect(app.open(URL(string: "lodestar://reset?token=abc")!))
        #expect(app.sheet == .resetPassword(link: "abc"))
        #expect(app.selectedTab == .account)
    }

    @Test func openingAShareLinkShowsTheWebPage() {
        let app = AppState()
        #expect(app.open(URL(string: "lodestar://t/tok")!))
        guard case .web(let url) = app.sheet else {
            Issue.record("expected a web sheet")
            return
        }
        #expect(url.path() == "/t/tok")
    }

    @Test func unknownLinksChangeNothing() {
        let app = AppState()
        #expect(!app.open(URL(string: "lodestar://nope")!))
        #expect(app.sheet == nil)
    }

    @Test func onboardingWaitsForTheSheetToClose() {
        let app = AppState()
        app.startQueuedOnboarding()
        #expect(!app.isOnboardingPresented)
        app.queueOnboarding()
        #expect(!app.isOnboardingPresented)
        app.startQueuedOnboarding()
        #expect(app.isOnboardingPresented)
        #expect(!app.isOnboardingQueued)
    }

    @Test func setAlertsOpensTripsOnTheSavedWatch() {
        let app = AppState()
        app.openSavedTrip(id: "t1")
        #expect(app.selectedTab == .search && app.focusedSavedTripID == nil)
        app.becomeSignedIn(profile, preferences: .default)
        app.openSavedTrip(id: "t1")
        #expect(app.selectedTab == .trips && app.focusedSavedTripID == "t1")
    }

    @Test func trustedOnlyFollowsAdoptedPreferences() {
        let app = AppState()
        app.trustedOnly = false
        var prefs = Preferences.default
        prefs.trustedOnly = true
        app.adopt(prefs)
        #expect(app.trustedOnly)
        prefs.trustedOnly = false
        app.adopt(prefs)
        #expect(!app.trustedOnly)
    }
}
