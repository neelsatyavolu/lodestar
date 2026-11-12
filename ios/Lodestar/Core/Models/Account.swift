import Foundation

/// `data` of `GET /api/account`. Signed out (or a revoked cookie) is `user == nil`.
struct AccountState: Codable, Hashable, Sendable {
    let user: AccountProfile?
    let preferences: Preferences?
}

struct AccountProfile: Codable, Hashable, Sendable {
    let email: String
    /// Missing on login/register answers; present on `GET /api/account`.
    let createdAt: EpochMillis?
    /// False for an account made through Xanom (no password). Present on `GET /api/account`.
    var hasPassword: Bool?
    /// The linked Xanom account's email, or nil when not linked. Present on `GET /api/account`.
    var xanomEmail: String?

    /// The part before "@", shown on the account pill.
    var displayName: String { email.split(separator: "@").first.map(String.init) ?? email }
}

/// `data` of login and register.
struct AccountSession: Codable, Hashable, Sendable {
    let user: AccountProfile
    let preferences: Preferences
}

struct LoginRequest: Codable, Hashable, Sendable {
    let email: String
    let password: String
}

struct RegisterRequest: Codable, Hashable, Sendable {
    let email: String
    let password: String
    /// Whatever the user set before signing up.
    let preferences: Preferences
}

struct ForgotRequest: Codable, Hashable, Sendable {
    let email: String
}

/// `data` of `POST /api/account/forgot`: show `message` as a neutral notice.
struct ForgotResponse: Codable, Hashable, Sendable {
    let message: String
}

struct ResetRequest: Codable, Hashable, Sendable {
    let token: String
    let password: String

    /// Pulls `token` out of a pasted reset link (`https://lodestar.xanom.co/reset?token=...`).
    static func token(fromLink text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let components = URLComponents(string: trimmed),
           let token = components.queryItems?.first(where: { $0.name == "token" })?.value, !token.isEmpty {
            return token
        }
        let isBareToken = !trimmed.isEmpty && trimmed.count <= 100
            && trimmed.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
        return isBareToken ? trimmed : nil
    }
}

/// `password` for an account that has one; `confirm: true` for one made through Xanom.
struct DeleteAccountRequest: Codable, Hashable, Sendable {
    var password: String?
    var confirm: Bool?
}

struct SignOutEverywhereRequest: Codable, Hashable, Sendable {
    var action = "signout-everywhere"
}

/// `data` of `PUT /api/preferences`: adopt the normalized value.
struct PreferencesResponse: Codable, Hashable, Sendable {
    let preferences: Preferences
}

/// `POST /api/xanom/ios-start`: the start link for linking or converting the signed-in account.
struct XanomStartRequest: Codable, Hashable, Sendable {
    let intent: String
    let challenge: String
}

struct XanomStartResponse: Codable, Hashable, Sendable {
    let url: URL
}

/// `POST /api/xanom/ios-exchange`: redeems the one-time ticket from `lodestar://xanom?ticket=…`.
struct XanomExchangeRequest: Codable, Hashable, Sendable {
    let ticket: String
    let verifier: String
}

/// `data` of the exchange: like login, plus whether the account was just made.
struct XanomExchangeResponse: Codable, Hashable, Sendable {
    let user: AccountProfile
    let preferences: Preferences
    let created: Bool
}
