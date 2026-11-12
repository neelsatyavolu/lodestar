import SwiftUI

/// "Travel preferences" (web `PreferencesDialog`), presented by RootView for `AppSheet.preferences`.
/// Signed in it saves with `PUT /api/preferences`; signed out it applies them for now.
struct PreferencesSheet: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var draft: PreferencesDraft?

    var body: some View {
        Group {
            if let draft {
                AccountSheetScaffold(title: "Travel preferences", onClose: { dismiss() }) {
                    PreferencesForm(draft: draft)
                } footer: {
                    PreferencesFooter(draft: draft, onDone: { dismiss() })
                }
            } else {
                Color.card
            }
        }
        .onAppear { if draft == nil { draft = PreferencesDraft(app.preferences) } }
    }
}

/// Every field of the contract, in the web's section order.
struct PreferencesForm: View {
    let draft: PreferencesDraft
    @Environment(AppState.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            if app.isSignedIn {
                AccountFormSection(title: "You", isFirst: true) {
                    LodestarField(label: "Your name", text: Binding(
                        get: { draft.value.displayName },
                        set: { name in draft.update { $0.displayName = String(name.prefix(60)) } }
                    ), placeholder: app.account.map { Preferences.displayName("", email: $0.email) } ?? "",
                       hint: "What Lodestar calls you. Leave it empty to use your email's name.",
                       contentType: .name, autocapitalization: .words)
                }
            }
            AccountFormSection(title: "Where you fly from", isFirst: !app.isSignedIn) {
                DraftCodePicker(draft: draft, field: .homeAirports, label: "Home airports (filled in for new searches)")
            }
            AccountFormSection(title: "Airlines") { airlines }
            AccountFormSection(title: "Trip defaults") {
                TripDefaultFields(draft: draft, fields: [.cabin, .stops, .adults, .bags])
            }
            AccountFormSection(title: "Comfort and sellers") {
                PreferenceToggles(draft: draft, items: [
                    ("Avoid red-eyes", \.avoidRedEyes),
                    ("Avoid self-transfers", \.avoidSelfTransfer),
                    ("No basic economy", \.noBasicEconomy),
                    ("Trusted sellers only", \.trustedOnly),
                ])
            }
            AccountFormSection(title: "Hacks to run on every search") {
                PreferenceToggles(draft: draft, items: [
                    ("Nearby airports", \.nearby),
                    ("±3 days", \.flexible),
                    ("Two one-ways", \.split),
                ])
            }
            AccountFormSection(title: "Food, for Trips' dining plans") { DiningFields(draft: draft) }
            AccountFormSection(title: "Things to do and hotels") { DoingFields(draft: draft) }
        }
    }

    private var airlines: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            VStack(alignment: .leading, spacing: Spacing.xs + 2) {
                AccountFieldLabel(text: "Alliances (only show these)")
                AllianceChips(draft: draft)
                Text("Leave all off to see every airline. Google also includes close partners of an alliance.")
                    .textStyle(.hint).foregroundStyle(Color.ash)
            }
            DraftCodePicker(draft: draft, field: .preferredAirlines,
                            label: "Prefer these airlines (ranked higher, e.g. where you have status)")
            DraftCodePicker(draft: draft, field: .avoidedAirlines, label: "Never show these airlines")
        }
    }
}

/// Error above the buttons; "Signed in as" or the signed-out note; Sign out / Create account;
/// the primary Save preferences / Use for now.
private struct PreferencesFooter: View {
    let draft: PreferencesDraft
    let onDone: () -> Void
    @Environment(AppState.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if let error = draft.error { InlineError(message: error) }
            Text(note).textStyle(.caption).foregroundStyle(Color.ash).lineLimit(2)
            HStack(spacing: Spacing.sm) {
                secondary
                Button(primaryTitle) { Task { await save() } }
                    .buttonStyle(.lodestar(.primary, fullWidth: true, isLoading: draft.isSaving))
                    .disabled(draft.isSaving)
            }
        }
    }

    private var note: String {
        if let account = app.account { return "Signed in as \(account.email)" }
        return "These apply now. Create an account to keep them."
    }

    private var primaryTitle: String {
        if draft.isSaving { return "Saving…" }
        return app.isSignedIn ? "Save preferences" : "Use for now"
    }

    @ViewBuilder private var secondary: some View {
        if app.isSignedIn {
            Button("Sign out") {
                onDone()
                Task { await app.signOut() }
            }
            .buttonStyle(.lodestar(.ghost))
        } else {
            Button("Create account") {
                draft.commitHotelBudget()
                Task {
                    try? await app.savePreferences(draft.value)
                    app.present(.register)
                }
            }
            .buttonStyle(.lodestar(.ghost))
        }
    }

    private func save() async {
        let saved = await draft.save(using: { try await app.savePreferences($0) }, report: { app.handle($0) })
        if saved { onDone() }
    }
}
