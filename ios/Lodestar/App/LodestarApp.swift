import SwiftUI

@main
struct LodestarApp: App {
    @State private var appState = AppState()
    @AppStorage(ThemePreference.storageKey) private var theme: ThemePreference = .system
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(\.imageLoader, appState.imageLoader)
                .preferredColorScheme(theme.colorScheme)
                .tint(Color.accent)
                .task { await appState.bootstrap() }
                .onChange(of: scenePhase) { _, phase in
                    // A launch while offline lands signed out with the cookie kept; coming back
                    // to the app checks that cookie again.
                    guard phase == .active, appState.session == .signedOut, appState.api.hasSessionCookie else { return }
                    Task { await appState.refreshAccount() }
                }
        }
    }
}
