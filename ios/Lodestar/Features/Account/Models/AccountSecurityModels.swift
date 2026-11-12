import Foundation
import Observation

/// "Delete account" (App Store 5.1.1(v); `DELETE /api/account`). Needs the password and an
/// explicit confirmation before it calls the server.
@MainActor
@Observable
final class DeleteAccountModel {
    static let missingPassword = "Enter your password to delete your account."

    var password = ""
    private(set) var isBusy = false
    private(set) var error: String?

    var canSubmit: Bool { !password.isEmpty && !isBusy }

    /// Returns true once the account is gone (AppState is already signed out).
    func delete(using delete: @MainActor (String) async throws -> Void,
                report: @MainActor (any Error) -> String?) async -> Bool {
        guard !isBusy else { return false }
        error = nil
        guard !password.isEmpty, password.count <= AccountFormModel.maxPasswordLength else {
            error = Self.missingPassword
            return false
        }
        isBusy = true
        defer { isBusy = false }
        do {
            try await delete(password)
            password = ""
            return true
        } catch {
            self.error = report(error)
            return false
        }
    }

    /// For an account with no password (made through Xanom). True once it is gone.
    func deleteWithoutPassword(using delete: @MainActor () async throws -> Void,
                               report: @MainActor (any Error) -> String?) async -> Bool {
        guard !isBusy else { return false }
        error = nil
        isBusy = true
        defer { isBusy = false }
        do {
            try await delete()
            return true
        } catch {
            self.error = report(error)
            return false
        }
    }
}

/// "Sign out of other devices" (`POST /api/account`). This device stays signed in.
@MainActor
@Observable
final class SignOutEverywhereModel {
    static let doneNotice = "Every other device is signed out. You're still signed in here."

    private(set) var isBusy = false
    private(set) var error: String?
    private(set) var notice: String?

    func run(using signOut: @MainActor () async throws -> Void,
             report: @MainActor (any Error) -> String?) async {
        guard !isBusy else { return }
        error = nil
        notice = nil
        isBusy = true
        defer { isBusy = false }
        do {
            try await signOut()
            notice = Self.doneNotice
        } catch {
            self.error = report(error)
        }
    }
}
