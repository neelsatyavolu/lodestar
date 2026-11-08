import Foundation

/// Account and preference actions. Each throws `APIError` (show `message`) on failure and
/// updates the shared state on success, so screens only handle their own busy/error UI.
extension AppState {
    func signIn(email: String, password: String) async throws {
        let result = try await api.send(API.Account.login(LoginRequest(email: email, password: password)))
        await finishSignIn(result)
    }

    /// Sends the in-memory preferences so nothing set before sign-up is lost, then queues onboarding.
    func register(email: String, password: String) async throws {
        let request = RegisterRequest(email: email, password: password, preferences: preferences)
        let result = try await api.send(API.Account.register(request))
        await finishSignIn(result)
        queueOnboarding()
    }

    /// Signs out this device. Never fails from the user's view: local state is cleared regardless.
    func signOut() async {
        _ = try? await api.send(API.Account.logout)
        becomeSignedOut()
        await refreshAIStatus()
    }

    /// Deletes the account (App Store 5.1.1(v)). A wrong password throws
    /// "That password isn't right." and leaves the session as is.
    func deleteAccount(password: String) async throws {
        do {
            _ = try await api.send(API.Account.delete(password: password))
        } catch let error as APIError where error.isSignedOut {
            becomeSignedOut()
            throw error
        }
        becomeSignedOut()
        await refreshAIStatus()
    }

    /// Kills every other session; this device stays signed in.
    func signOutEverywhereElse() async throws {
        do {
            _ = try await api.send(API.Account.signOutEverywhere)
        } catch {
            handle(error)
            throw error
        }
    }

    /// Returns the neutral "If an account exists…" message to show.
    func requestPasswordReset(email: String) async throws -> String {
        try await api.send(API.Account.forgot(email: email)).message
    }

    /// Sets a new password from a reset token; the server signs this device in.
    func resetPassword(token: String, password: String) async throws {
        _ = try await api.send(API.Account.reset(ResetRequest(token: token, password: password)))
        await refreshAccount()
        await refreshAIStatus()
    }

    /// Signed in: `PUT /api/preferences` with the complete object and adopts the normalized result.
    /// Signed out: applies in memory only ("Use for now").
    func savePreferences(_ newPreferences: Preferences) async throws {
        guard isSignedIn else {
            adopt(newPreferences)
            return
        }
        do {
            let saved = try await api.send(API.Account.savePreferences(newPreferences))
            adopt(saved.preferences)
        } catch {
            handle(error)
            throw error
        }
    }

    /// Connect flow finished or the user disconnected: refresh what's connected.
    func disconnectAI(_ provider: AIProvider) async {
        _ = try? await api.send(API.AI.logout(provider))
        await refreshAIStatus()
    }

    private func finishSignIn(_ result: AccountSession) async {
        becomeSignedIn(result.user, preferences: result.preferences)
        await refreshAIStatus()
    }
}
