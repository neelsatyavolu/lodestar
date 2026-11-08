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

struct DeleteAccountRequest: Codable, Hashable, Sendable {
    let password: String
}

struct SignOutEverywhereRequest: Codable, Hashable, Sendable {
    var action = "signout-everywhere"
}

/// `data` of `PUT /api/preferences`: adopt the normalized value.
struct PreferencesResponse: Codable, Hashable, Sendable {
    let preferences: Preferences
}
