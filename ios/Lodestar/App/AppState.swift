import Foundation
import Observation

/// Tabs of the root TabView. Trips exists only when signed in (as on the web).
enum AppTab: String, Hashable, Sendable {
    case search, stays, plan, trips, account
}

/// App-wide sheets any feature can ask for, presented by `RootView`.
enum AppSheet: Identifiable, Hashable, Sendable {
    /// Sign in / create account / forgot (Account feature).
    case signIn
    /// Create account directly.
    case register
    /// Travel preferences (Account feature).
    case preferences
    /// Connect ChatGPT or Grok (Plan feature).
    case connectAI
    /// Set a new password from a reset link (Account feature), e.g. opened from a deep link.
    case resetPassword(link: String)
    /// A page that only exists on the web, in Safari View.
    case web(URL)

    var id: String {
        switch self {
        case .signIn: "signIn"
        case .register: "register"
        case .preferences: "preferences"
        case .connectAI: "connectAI"
        case .resetPassword(let link): "reset:\(link)"
        case .web(let url): "web:\(url.absoluteString)"
        }
    }
}

enum SessionPhase: Equatable, Sendable {
    /// Before the first `GET /api/account` answers.
    case checking
    case signedOut
    case signedIn(AccountProfile)
}

/// The app's shared state: who is signed in, their preferences, AI connection status,
/// navigation between tabs and the app-wide sheets. Features read it with
/// `@Environment(AppState.self)` and call its methods; they keep their own screen state.
@MainActor
@Observable
final class AppState {
    let api: APIClient
    let imageLoader: ImageLoader

    private(set) var session: SessionPhase = .checking
    /// Saved preferences when signed in; in-memory only when signed out (reset on sign-out).
    private(set) var preferences: Preferences = .default
    /// Bumps whenever `preferences` is adopted (sign-in, save), so the search form can re-apply.
    private(set) var preferencesRevision = 0
    private(set) var aiStatus: AIStatus = .disconnected
    /// "Trusted sellers only", shared by Search, Plan and Stays as on the web. Starts from the
    /// preference each time preferences are adopted; Search's toggle changes it for the session.
    var trustedOnly = Preferences.default.trustedOnly

    var selectedTab: AppTab = .search
    var sheet: AppSheet?
    /// Shown once, right after a successful register.
    var isOnboardingPresented = false
    /// Set by `register`; RootView starts onboarding once the sign-in sheet has closed.
    private(set) var isOnboardingQueued = false
    /// A saved fare watch the Trips tab should scroll to (Trips clears it).
    var focusedSavedTripID: String?

    /// The flight search form as last edited (Search writes it; Plan sends it as `context`).
    var flightForm: SearchQuery?
    /// A query another feature wants Search to run (Search clears it after running).
    var pendingFlightSearch: SearchQuery?

    init(api: APIClient = APIClient()) {
        self.api = api
        self.imageLoader = ImageLoader(api: api)
        #if DEBUG
        // `-LodestarTab plan` opens on a tab, for simulator screenshots (see ios/README.md).
        if let tab = UserDefaults.standard.string(forKey: "LodestarTab").flatMap(AppTab.init(rawValue:)) {
            selectedTab = tab
        }
        #endif
    }

    var account: AccountProfile? {
        if case .signedIn(let profile) = session { return profile }
        return nil
    }

    var isSignedIn: Bool { account != nil }

    /// Loads the account and AI status. Call once at launch.
    func bootstrap() async {
        await refreshAccount()
        await refreshAIStatus()
    }

    /// `GET /api/account`. A failure keeps the previous state (a cookie may still be valid).
    func refreshAccount() async {
        do {
            let state = try await api.send(API.Account.current)
            if let user = state.user {
                session = .signedIn(user)
                adopt(state.preferences ?? .default)
            } else {
                becomeSignedOut()
            }
        } catch {
            if session == .checking { session = .signedOut }
        }
    }

    /// `GET /api/ai/status`. A failure counts as nothing connected, like the web.
    func refreshAIStatus() async {
        do {
            aiStatus = try await api.send(API.AI.status)
        } catch {
            if !error.isCancellation { aiStatus = .disconnected }
        }
    }

    /// Every feature routes errors through this: a sign-in 401 drops to signed-out.
    /// Returns the message to show (nil for cancellation).
    @discardableResult
    func handle(_ error: any Error) -> String? {
        if error.isCancellation { return nil }
        if let api = error as? APIError, api.isSignedOut { becomeSignedOut() }
        return error.userMessage
    }

    /// Switch tab and present a sheet, e.g. `present(.connectAI)`.
    func present(_ sheet: AppSheet) {
        self.sheet = sheet
    }

    /// Starts onboarding if `register` queued it. RootView calls this when its sheet closes,
    /// because a second sheet can't appear while the sign-in sheet is still on screen.
    func startQueuedOnboarding() {
        guard isOnboardingQueued else { return }
        isOnboardingQueued = false
        isOnboardingPresented = true
    }

    /// Open the Trips tab on a fare watch just saved from Search or Plan.
    func openSavedTrip(id: String) {
        guard isSignedIn else { return }
        focusedSavedTripID = id
        selectedTab = .trips
    }

    /// Handles a link the system hands the app. Returns false for links it doesn't know.
    @discardableResult
    func open(_ url: URL) -> Bool {
        switch DeepLink.parse(url, webBase: api.baseURL) {
        case .resetPassword(let link):
            selectedTab = .account
            sheet = .resetPassword(link: link)
            return true
        case .sharedTrip(let page):
            sheet = .web(page)
            return true
        case nil:
            return false
        }
    }

    /// Ask Search to run a query (from Plan, Trips, a hack).
    func runFlightSearch(_ query: SearchQuery) {
        pendingFlightSearch = query
        selectedTab = .search
    }

    // MARK: - Internal state changes (used by AppState+Session)

    func queueOnboarding() {
        isOnboardingQueued = true
    }

    func adopt(_ newPreferences: Preferences) {
        preferences = newPreferences
        trustedOnly = newPreferences.trustedOnly
        preferencesRevision += 1
    }

    func becomeSignedIn(_ profile: AccountProfile, preferences newPreferences: Preferences) {
        session = .signedIn(profile)
        adopt(newPreferences)
    }

    func becomeSignedOut() {
        let wasSignedIn = isSignedIn
        session = .signedOut
        api.clearSessionCookie()
        if wasSignedIn { adopt(.default) }
        if selectedTab == .trips { selectedTab = .search }
    }
}
