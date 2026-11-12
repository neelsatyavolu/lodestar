import SwiftUI

/// Account tab, signed in. Linked: which Xanom account, and where to manage it.
/// Not linked: convert in one tap, or link a Xanom account under another email.
struct AccountXanomSection: View {
    let profile: AccountProfile
    @Environment(AppState.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var model = XanomModel()

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionHeader(title: "Xanom account",
                          detail: profile.xanomEmail == nil
                              ? "One Xanom account signs you in to Lodestar and the other Xanom apps. Your email and password keep working."
                              : nil)
            VStack(alignment: .leading, spacing: 0) {
                if let email = profile.xanomEmail {
                    AccountRow(title: "Signed in with Xanom · \(email)", detail: "Manage at accounts.xanom.co") {
                        openURL(XanomFlow.manageURL)
                    }
                } else {
                    AccountRow(title: model.busy == .convert ? "Converting…" : "Convert to Xanom account",
                               detail: "Uses \(profile.email)") { run(.convert) }
                    Hairline()
                    AccountRow(title: model.busy == .link ? "Linking…" : "Link an existing Xanom account",
                               detail: "For a Xanom account under another email") { run(.link) }
                }
            }
            .card(padding: 0)
            .disabled(model.busy != nil)
            if let error = model.error { InlineError(message: error) }
        }
    }

    private func run(_ intent: XanomFlow.Intent) {
        Task { await model.run(intent, app: app) }
    }
}

/// Account tab, signed out: the main way in.
struct ContinueWithXanomButton: View {
    @Environment(AppState.self) private var app
    @State private var model = XanomModel()

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Button("Continue with Xanom") {
                Task {
                    // No sheet is open here, so a new account's onboarding can start now.
                    if await model.run(.signIn, app: app) { app.startQueuedOnboarding() }
                }
            }
            .buttonStyle(.lodestar(.primary, fullWidth: true, isLoading: model.busy != nil))
            .disabled(model.busy != nil)
            if let error = model.error { InlineError(message: error) }
        }
    }
}
