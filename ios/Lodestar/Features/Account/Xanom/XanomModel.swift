import Foundation
import Observation

/// Opens a link in the browser sheet and returns the `lodestar://` URL it ends on.
typealias XanomOpener = @MainActor (URL) async throws -> URL

extension AppState {
    /// Continue with Xanom (sign in), or link / convert the signed-in account.
    /// Returns true when a new Lodestar account was made.
    @discardableResult
    func continueWithXanom(_ intent: XanomFlow.Intent, open: XanomOpener) async throws -> Bool {
        let secret = XanomFlow.Secret.make()
        let start: URL
        if intent == .signIn {
            start = XanomFlow.signInURL(base: api.baseURL, challenge: secret.challenge)
        } else {
            do {
                start = try await api.send(API.Account.xanomStart(XanomStartRequest(intent: intent.rawValue, challenge: secret.challenge))).url
            } catch {
                handle(error)
                throw error
            }
        }
        switch XanomFlow.parseCallback(try await open(start)) {
        case .ticket(let ticket):
            let result = try await api.send(API.Account.xanomExchange(XanomExchangeRequest(ticket: ticket, verifier: secret.verifier)))
            if intent == .signIn {
                becomeSignedIn(result.user, preferences: result.preferences)
            } else {
                await refreshAccount()
            }
            await refreshAIStatus()
            if result.created { queueOnboarding() }
            return result.created
        case .failed(let code):
            throw APIError.server(status: 400, message: XanomFlow.message(for: code))
        case nil:
            throw APIError.server(status: 400, message: XanomFlow.message(for: "failed"))
        }
    }

    /// Deletes an account made through Xanom, which has no password to confirm with.
    func deleteAccountWithoutPassword() async throws {
        do {
            _ = try await api.send(API.Account.deleteWithoutPassword)
        } catch let error as APIError where error.isSignedOut {
            becomeSignedOut()
            throw error
        }
        becomeSignedOut()
        await refreshAIStatus()
    }
}

/// Busy and error state for a Xanom button. One attempt at a time.
@MainActor
@Observable
final class XanomModel {
    private(set) var busy: XanomFlow.Intent?
    private(set) var error: String?
    @ObservationIgnored private let browser = XanomBrowser()

    /// Runs the flow; true when it finished (cancelling is not an error).
    @discardableResult
    func run(_ intent: XanomFlow.Intent, app: AppState, open: XanomOpener? = nil) async -> Bool {
        guard busy == nil else { return false }
        busy = intent
        error = nil
        defer { busy = nil }
        do {
            try await app.continueWithXanom(intent, open: open ?? { [browser] in try await browser.open($0) })
            return true
        } catch {
            self.error = error.isCancellation ? nil : error.userMessage
            return false
        }
    }
}
