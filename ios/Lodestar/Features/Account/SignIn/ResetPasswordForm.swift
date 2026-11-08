import SwiftUI

/// The web's `/reset` page in the app. The emailed link opens Safari (there are no Universal
/// Links), so the user pastes the link here; a link the app is handed fills it in.
struct ResetPasswordForm: View {
    @Bindable var model: AccountFormModel
    let submit: () -> Void
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            Text("Choose a new password")
                .textStyle(.display)
                .foregroundStyle(Color.ink)
                .accessibilityAddTraits(.isHeader)
            if model.resetDone { done } else { form }
        }
    }

    private var done: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text("Your password is changed and you're signed in. Every other session was signed out.")
                .textStyle(.bodyMD).foregroundStyle(Color.bodyText)
            Button("Back to Lodestar", action: onDone).buttonStyle(.lodestar(.link))
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            linkField
            LodestarField(label: "New password", text: $model.password, hint: "At least 8 characters.", secure: true,
                          contentType: .newPassword, autocapitalization: .never, submitLabel: .go, onSubmit: submit)
            if let error = model.error { InlineError(message: error) }
            Button(model.primaryTitle, action: submit)
                .buttonStyle(.lodestar(.primary, fullWidth: true, isLoading: model.isBusy))
                .disabled(model.isBusy || model.resetToken == nil)
            Button("Back to sign in") { model.switchTo(.signIn) }.buttonStyle(.lodestar(.link))
        }
    }

    private var linkField: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            LodestarField(label: "Reset link", text: $model.resetLink, placeholder: "https://lodestar.xanom.co/reset?token=…",
                          hint: hint, error: linkProblem, mono: true, contentType: .URL, keyboard: .URL,
                          autocapitalization: .never, submitLabel: .next)
            PasteButton(payloadType: String.self) { strings in
                guard let first = strings.first else { return }
                Task { @MainActor in model.resetLink = first }
            }
            .labelStyle(.titleAndIcon)
            .buttonBorderShape(.roundedRectangle(radius: Radius.md))
            .tint(Color.elevated)
            .foregroundStyle(Color.ink)
        }
    }

    private var hint: String {
        model.resetToken == nil
            ? "Copy the link from the reset email (press and hold it, then Copy Link) and paste it here."
            : "Link found. Choose your new password."
    }

    /// Only complain once something is typed that has no token in it.
    private var linkProblem: String? {
        let typed = !model.resetLink.trimmingCharacters(in: .whitespaces).isEmpty
        return typed && model.resetToken == nil ? AccountFormModel.missingTokenMessage : nil
    }
}
