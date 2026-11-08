import SwiftUI

/// "Delete account" (App Store 5.1.1(v); the web has no screen for it). Password, then a
/// destructive confirmation, then `DELETE /api/account`.
struct DeleteAccountSheet: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var model = DeleteAccountModel()
    @State private var confirming = false

    var body: some View {
        AccountSheetScaffold(title: "Delete account", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text("This deletes your account and everything saved to it: preferences, trips, saved fares, connections and your AI sign-in. It can't be undone.")
                    .textStyle(.bodySM).foregroundStyle(Color.bodyText)
                if let email = app.account?.email {
                    Text("Signed in as \(email)").textStyle(.caption).foregroundStyle(Color.ash)
                }
                LodestarField(label: "Password", text: $model.password, secure: true, contentType: .password,
                              autocapitalization: .never, submitLabel: .done, onSubmit: askToConfirm)
                if let error = model.error { InlineError(message: error) }
                Button(model.isBusy ? "Deleting…" : "Delete account", action: askToConfirm)
                    .buttonStyle(.lodestar(.destructive, fullWidth: true, isLoading: model.isBusy))
                    .disabled(model.isBusy)
            }
        }
        .confirmationDialog("Delete your account?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Delete account", role: .destructive) { Task { await delete() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Everything saved to it goes too. This can't be undone.")
        }
    }

    private func askToConfirm() {
        guard model.canSubmit else {
            Task { await delete() } // shows "Enter your password to delete your account."
            return
        }
        confirming = true
    }

    private func delete() async {
        let deleted = await model.delete(using: { try await app.deleteAccount(password: $0) }, report: { error in
            error.isCancellation ? nil : error.userMessage
        })
        if deleted || !app.isSignedIn { dismiss() }
    }
}
