import SwiftUI

/// ChatGPT / Grok: connect, or each connected provider with Disconnect.
struct AccountAISection: View {
    @Environment(AppState.self) private var app
    @State private var disconnecting: AIProvider?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionHeader(title: "AI for Plan",
                          detail: "Plan runs on your own ChatGPT or Grok subscription. The connection is saved to your account.")
            VStack(alignment: .leading, spacing: 0) {
                let connected = [AIProvider.codex, .grok].filter(app.aiStatus.isConnected)
                if connected.isEmpty {
                    AccountRow(title: "Connect ChatGPT or Grok", detail: "Not connected") { app.present(.connectAI) }
                } else {
                    ForEach(Array(connected.enumerated()), id: \.element) { index, provider in
                        if index > 0 { Hairline() }
                        providerRow(provider)
                    }
                    if connected.count < 2 {
                        Hairline()
                        AccountRow(title: "Connect another AI") { app.present(.connectAI) }
                    }
                }
            }
            .card(padding: 0)
        }
    }

    private func providerRow(_ provider: AIProvider) -> some View {
        HStack(spacing: Spacing.md) {
            StatusLabel(text: "\(provider.displayName) connected", tone: .ok)
            Spacer()
            Button("Disconnect") {
                Task {
                    disconnecting = provider
                    await app.disconnectAI(provider)
                    disconnecting = nil
                }
            }
            .buttonStyle(.lodestar(.ghost, small: true, isLoading: disconnecting == provider))
            .disabled(disconnecting != nil)
        }
        .padding(Sizes.cardPadding)
    }
}

/// Sign out, sign out of other devices, change password and delete account.
struct AccountSessionSection: View {
    let open: (AccountLocalSheet) -> Void
    @Environment(AppState.self) private var app
    @State private var everywhere = SignOutEverywhereModel()
    @State private var confirmEverywhere = false
    @State private var signingOut = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionHeader(title: "Sign-in and security")
            VStack(alignment: .leading, spacing: 0) {
                AccountRow(title: "Change password", detail: "We email you a reset link.") { open(.forgot) }
                Hairline()
                AccountRow(title: "Sign out of other devices",
                           detail: "Every other phone and browser signed in to this account is signed out.") {
                    confirmEverywhere = true
                }
                Hairline()
                AccountRow(title: "Delete account", destructive: true) { open(.deleteAccount) }
            }
            .card(padding: 0)
            if let error = everywhere.error { InlineError(message: error) }
            if let notice = everywhere.notice { InlineNotice(message: notice) }
            if everywhere.isBusy { LoadingStateView(message: "Signing out other devices…") }
            Button("Sign out") {
                signingOut = true
                Task {
                    await app.signOut()
                    signingOut = false
                }
            }
            .buttonStyle(.lodestar(.ghost, fullWidth: true, isLoading: signingOut))
            .disabled(signingOut)
        }
        .confirmationDialog("Sign out of other devices?", isPresented: $confirmEverywhere, titleVisibility: .visible) {
            Button("Sign out other devices", role: .destructive) {
                Task { await everywhere.run(using: { try await app.signOutEverywhereElse() }, report: { app.handle($0) }) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You stay signed in on this device.")
        }
    }
}

/// System / Light / Dark, stored on this device (web theme toggle).
struct AccountAppearanceSection: View {
    @AppStorage(ThemePreference.storageKey) private var theme: ThemePreference = .system

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionHeader(title: "Appearance", detail: "Saved on this device.")
            FlowLayout {
                ForEach(ThemePreference.allCases, id: \.self) { option in
                    Chip(title: option.label, isOn: theme == option) { theme = option }
                }
            }
        }
    }
}
