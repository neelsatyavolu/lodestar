import Foundation

extension API {
    /// Account contract (docs/api-account.md). Prefer the `AppState` session methods, which
    /// also update the signed-in state; call these directly only for screens AppState doesn't cover.
    enum Account {
        static var current: Endpoint<AccountState> {
            Endpoint(method: .get, path: "/api/account")
        }

        static func register(_ request: RegisterRequest) -> Endpoint<AccountSession> {
            Endpoint(method: .post, path: "/api/account/register", body: request)
        }

        static func login(_ request: LoginRequest) -> Endpoint<AccountSession> {
            Endpoint(method: .post, path: "/api/account/login", body: request)
        }

        static var logout: Endpoint<EmptyResponse> {
            Endpoint(method: .post, path: "/api/account/logout")
        }

        static var signOutEverywhere: Endpoint<EmptyResponse> {
            Endpoint(method: .post, path: "/api/account", body: SignOutEverywhereRequest())
        }

        static func delete(password: String) -> Endpoint<EmptyResponse> {
            Endpoint(method: .delete, path: "/api/account", body: DeleteAccountRequest(password: password))
        }

        /// Deletes an account that has no password (made through Xanom).
        static var deleteWithoutPassword: Endpoint<EmptyResponse> {
            Endpoint(method: .delete, path: "/api/account", body: DeleteAccountRequest(confirm: true))
        }

        static func xanomStart(_ request: XanomStartRequest) -> Endpoint<XanomStartResponse> {
            Endpoint(method: .post, path: "/api/xanom/ios-start", body: request)
        }

        static func xanomExchange(_ request: XanomExchangeRequest) -> Endpoint<XanomExchangeResponse> {
            Endpoint(method: .post, path: "/api/xanom/ios-exchange", body: request)
        }

        static func forgot(email: String) -> Endpoint<ForgotResponse> {
            Endpoint(method: .post, path: "/api/account/forgot", body: ForgotRequest(email: email))
        }

        static func reset(_ request: ResetRequest) -> Endpoint<EmptyResponse> {
            Endpoint(method: .post, path: "/api/account/reset", body: request)
        }

        /// Full replace: always send the complete object.
        static func savePreferences(_ preferences: Preferences) -> Endpoint<PreferencesResponse> {
            Endpoint(method: .put, path: "/api/preferences", body: preferences)
        }
    }
}
