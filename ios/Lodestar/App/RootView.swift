import SwiftUI

/// The tab bar plus the app-wide sheets and the onboarding hook.
/// Each tab's root view lives in Features/<Name>/ and is owned by that feature.
struct RootView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.selectedTab) {
            Tab("Search", systemImage: "airplane", value: AppTab.search) {
                SearchRootView()
            }
            Tab("Stays", systemImage: "bed.double", value: AppTab.stays) {
                StaysRootView()
            }
            Tab("Plan", systemImage: "sparkles", value: AppTab.plan) {
                PlanRootView()
            }
            if app.isSignedIn {
                Tab("Trips", systemImage: "suitcase", value: AppTab.trips) {
                    TripsRootView()
                }
            }
            Tab("Account", systemImage: "person.crop.circle", value: AppTab.account) {
                AccountRootView()
            }
        }
        .tint(Color.accent)
        .canvasBackground()
        .sheet(item: $app.sheet, onDismiss: app.startQueuedOnboarding) { sheet in
            sheetContent(sheet)
                .presentationBackground(Color.card)
        }
        .sheet(isPresented: $app.isOnboardingPresented) {
            OnboardingView()
                .presentationBackground(Color.card)
        }
        .onOpenURL { app.open($0) }
    }

    @ViewBuilder private func sheetContent(_ sheet: AppSheet) -> some View {
        switch sheet {
        case .signIn: SignInSheet(startMode: .signIn)
        case .register: SignInSheet(startMode: .register)
        case .preferences: PreferencesSheet()
        case .connectAI: AIConnectSheet()
        case .resetPassword(let link): SignInSheet(startMode: .reset, resetLink: link)
        case .web(let url): SafariView(url: url).ignoresSafeArea()
        }
    }
}
