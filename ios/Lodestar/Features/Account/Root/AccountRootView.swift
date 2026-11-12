import SwiftUI

/// The Account tab: who is signed in, Travel preferences, the AI connection, appearance and
/// the session controls. On the web these live in the header pill and its dialogs.
struct AccountRootView: View {
    @Environment(AppState.self) private var app
    @State private var localSheet: AccountLocalSheet?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xxl) {
                    content
                    AccountAppearanceSection()
                }
                .padding(.horizontal, Spacing.gutter)
                .padding(.top, Spacing.screenTop)
                .padding(.bottom, Spacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .canvasBackground()
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await app.bootstrap() }
        }
        .sheet(item: $localSheet) { sheet in
            sheetContent(sheet).presentationBackground(Color.card)
        }
    }

    @ViewBuilder private var content: some View {
        switch app.session {
        case .checking:
            LoadingStateView(message: "Checking your account…")
        case .signedOut:
            AccountSignedOutView(open: { localSheet = $0 })
        case .signedIn(let profile):
            AccountSignedInView(profile: profile, open: { localSheet = $0 })
        }
    }

    @ViewBuilder private func sheetContent(_ sheet: AccountLocalSheet) -> some View {
        switch sheet {
        case .forgot: SignInSheet(startMode: .forgot, email: app.account?.email ?? "")
        case .reset: SignInSheet(startMode: .reset)
        case .deleteAccount: DeleteAccountSheet()
        case .agents: AgentsSheet(app: app)
        }
    }
}

/// Sheets the Account tab presents itself (RootView's `AppSheet` covers sign in and preferences).
enum AccountLocalSheet: String, Identifiable {
    case forgot, reset, deleteAccount, agents
    var id: String { rawValue }
}

/// Signed out: why to make an account, Create account / Sign in, preferences for now, reset link.
private struct AccountSignedOutView: View {
    let open: (AccountLocalSheet) -> Void
    @Environment(AppState.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxl) {
            HeroTitle(line1: "Your account.", line2: "Your preferences, everywhere.",
                      paragraph: "An account saves your travel preferences (home airports, alliances, airlines to prefer or avoid) and applies them to every search, on any device.")
                .rise()
            VStack(spacing: Spacing.sm) {
                Button("Create account") { app.present(.register) }.buttonStyle(.lodestar(.primary, fullWidth: true))
                Button("Sign in") { app.present(.signIn) }.buttonStyle(.lodestar(.ghost, fullWidth: true))
            }
            VStack(alignment: .leading, spacing: 0) {
                AccountRow(title: "Travel preferences",
                           detail: "Set alliances and preferences · create an account to keep them") {
                    app.present(.preferences)
                }
                Hairline()
                AccountRow(title: "Have a reset link?", detail: "Paste the link from the email to choose a new password.") {
                    open(.reset)
                }
            }
            .card(padding: 0)
        }
    }
}

/// Signed in: the profile, preferences, AI, and the session controls.
private struct AccountSignedInView: View {
    let profile: AccountProfile
    let open: (AccountLocalSheet) -> Void
    @Environment(AppState.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxl) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(Preferences.displayName(app.preferences.displayName, email: profile.email)).textStyle(.display).foregroundStyle(Color.ink)
                    .lineLimit(1).minimumScaleFactor(0.5)
                    .accessibilityAddTraits(.isHeader)
                Text(profile.email).textStyle(.bodySM).foregroundStyle(Color.bodyText)
                if let since = AccountFormatting.memberSince(profile.createdAt) {
                    Text(since).textStyle(.caption).foregroundStyle(Color.ash)
                }
            }
            .rise()
            VStack(alignment: .leading, spacing: 0) {
                AccountRow(title: "Travel preferences", detail: AccountFormatting.preferencesSummary(app.preferences)) {
                    app.present(.preferences)
                }
                Hairline()
                AccountRow(title: "Agents", detail: "Connect Claude, ChatGPT or Codex to your trips") {
                    open(.agents)
                }
            }
            .card(padding: 0)
            AccountAISection()
            AccountSessionSection(open: open)
        }
    }
}

/// A tappable card row: title, muted detail, chevron.
struct AccountRow: View {
    let title: String
    var detail: String?
    var destructive = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(title).textStyle(.bodyMD).foregroundStyle(destructive ? Color.danger : Color.ink)
                    if let detail {
                        Text(detail).textStyle(.caption).foregroundStyle(Color.mute).multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .medium)).foregroundStyle(Color.ash)
                    .accessibilityHidden(true)
            }
            .padding(Sizes.cardPadding)
            .frame(minHeight: Sizes.button)
            .contentShape(Rectangle())
        }
        .buttonStyle(AccountRowStyle())
    }
}

private struct AccountRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.background(configuration.isPressed ? Color.pressedFill : Color.clear)
    }
}
