import Foundation
import Observation

/// What the sign-in sheet calls. Built from `AppState` in the view; stubbed in tests.
struct AccountActions {
    var signIn: @MainActor (_ email: String, _ password: String) async throws -> Void
    var register: @MainActor (_ email: String, _ password: String) async throws -> Void
    var forgot: @MainActor (_ email: String) async throws -> String
    var reset: @MainActor (_ token: String, _ password: String) async throws -> Void
    /// Turns an error into the message to show (nil for cancellation). `AppState.handle`.
    var report: @MainActor (any Error) -> String?
}

extension AccountActions {
    @MainActor
    init(app: AppState) {
        self.init(
            signIn: { try await app.signIn(email: $0, password: $1) },
            register: { try await app.register(email: $0, password: $1) },
            forgot: { try await app.requestPasswordReset(email: $0) },
            reset: { try await app.resetPassword(token: $0, password: $1) },
            report: { app.handle($0) }
        )
    }
}

/// State for the sign in / create account / forgot / reset sheet (web `AccountDialog` and
/// `ResetForm`). Validation runs on device with the server's own sentences.
@MainActor
@Observable
final class AccountFormModel {
    enum Outcome: Equatable, Sendable { case signedIn, registered, resetDone, noticeShown }

    nonisolated static let minPasswordLength = 8
    nonisolated static let maxPasswordLength = 200
    nonisolated static let fallbackError = "That didn't work. Try again."
    nonisolated static let missingTokenMessage = "This link is missing its code. Open the link from the email again."

    private(set) var mode: SignInSheet.Mode
    var email = ""
    var password = ""
    /// The pasted reset link (or bare token) in reset mode.
    var resetLink = ""
    private(set) var isBusy = false
    private(set) var error: String?
    private(set) var notice: String?
    private(set) var resetDone = false

    init(mode: SignInSheet.Mode, email: String = "", resetLink: String = "") {
        self.mode = mode
        self.email = email
        self.resetLink = resetLink
    }

    /// Switching modes clears the error and the notice.
    func switchTo(_ newMode: SignInSheet.Mode) {
        mode = newMode
        error = nil
        notice = nil
        resetDone = false
    }

    var title: String {
        switch mode {
        case .signIn: "Sign in"
        case .register: "Create an account"
        case .forgot: "Reset your password"
        case .reset: "Choose a new password"
        }
    }

    var primaryTitle: String {
        if isBusy { return mode == .reset ? "Saving…" : "One moment…" }
        switch mode {
        case .signIn: return "Sign in"
        case .register: return "Create account"
        case .forgot: return "Email me a reset link"
        case .reset: return "Set new password"
        }
    }

    var resetToken: String? { ResetRequest.token(fromLink: resetLink) }

    var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The server's message for what's wrong with the form, or nil.
    var validationMessage: String? {
        switch mode {
        case .signIn:
            return trimmedEmail.isEmpty || password.isEmpty || password.count > Self.maxPasswordLength
                ? "Enter your email and password." : nil
        case .register:
            return Self.isEmail(trimmedEmail) && Self.isNewPassword(password)
                ? nil : "Enter a valid email and a password of at least 8 characters."
        case .forgot:
            return Self.isEmail(trimmedEmail) ? nil : "Enter a valid email."
        case .reset:
            if resetToken == nil { return Self.missingTokenMessage }
            return Self.isNewPassword(password) ? nil : "Choose a password of at least 8 characters."
        }
    }

    func submit(_ actions: AccountActions) async -> Outcome? {
        guard !isBusy else { return nil }
        error = nil
        notice = nil
        if let problem = validationMessage {
            error = problem
            return nil
        }
        isBusy = true
        defer { isBusy = false }
        do {
            return try await perform(actions)
        } catch {
            self.error = actions.report(error)
            return nil
        }
    }

    private func perform(_ actions: AccountActions) async throws -> Outcome {
        switch mode {
        case .signIn:
            try await actions.signIn(trimmedEmail, password)
            password = ""
            return .signedIn
        case .register:
            try await actions.register(trimmedEmail, password)
            password = ""
            return .registered
        case .forgot:
            notice = try await actions.forgot(trimmedEmail)
            return .noticeShown
        case .reset:
            try await actions.reset(resetToken ?? "", password)
            password = ""
            resetDone = true
            return .resetDone
        }
    }

    nonisolated static func isEmail(_ text: String) -> Bool {
        guard text.count <= 254, !text.contains(where: \.isWhitespace) else { return false }
        let parts = text.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty else { return false }
        let domain = parts[1]
        let labels = domain.split(separator: ".", omittingEmptySubsequences: false)
        return labels.count >= 2 && labels.allSatisfy { !$0.isEmpty }
    }

    nonisolated static func isNewPassword(_ text: String) -> Bool {
        (minPasswordLength...maxPasswordLength).contains(text.count)
    }
}
