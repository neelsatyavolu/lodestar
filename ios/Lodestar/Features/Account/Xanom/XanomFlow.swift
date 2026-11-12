import CryptoKit
import Foundation
import Security

/// The pure parts of "Continue with Xanom" (accounts.xanom.co). The web backend runs the OIDC
/// flow as Lodestar's confidential client; the app opens its start link in a browser sheet,
/// gets `lodestar://xanom?ticket=…` back, and redeems the ticket with the secret only it knows.
enum XanomFlow {
    enum Intent: String, Sendable { case signIn = "signin", link, convert }

    /// The app's secret for one attempt and its SHA-256, sent ahead as the challenge.
    struct Secret: Equatable, Sendable {
        let verifier: String
        var challenge: String { XanomFlow.challenge(for: verifier) }

        static func make() -> Secret {
            var bytes = [UInt8](repeating: 0, count: 32)
            let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
            precondition(status == errSecSuccess, "No system randomness")
            return Secret(verifier: base64URL(Data(bytes)))
        }
    }

    enum Callback: Equatable, Sendable {
        case ticket(String)
        case failed(code: String)
    }

    static let callbackScheme = "lodestar"
    static let manageURL = URL(string: "https://accounts.xanom.co")!

    static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// `GET /api/xanom/start` for signing in. Link and convert get their link from `ios-start`.
    static func signInURL(base: URL, challenge: String) -> URL {
        var components = URLComponents(url: base.appending(path: "api/xanom/start"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "platform", value: "ios"),
            URLQueryItem(name: "intent", value: Intent.signIn.rawValue),
            URLQueryItem(name: "ios_challenge", value: challenge),
        ]
        return components.url!
    }

    /// nil for anything that isn't `lodestar://xanom?ticket=…` or `?error=…`.
    static func parseCallback(_ url: URL) -> Callback? {
        guard url.scheme?.lowercased() == callbackScheme, url.host()?.lowercased() == "xanom",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        else { return nil }
        if let ticket = items.first(where: { $0.name == "ticket" })?.value, !ticket.isEmpty, ticket.count <= 100 {
            return .ticket(ticket)
        }
        if let code = items.first(where: { $0.name == "error" })?.value, !code.isEmpty {
            return .failed(code: code)
        }
        return nil
    }

    /// The same sentences as the web (lib/xanom/messages.ts).
    static func message(for code: String) -> String {
        switch code {
        case "denied": "Xanom sign-in was cancelled."
        case "expired": "That Xanom sign-in took too long or was started elsewhere. Try again."
        case "unavailable": "Xanom sign-in isn't available right now. Use your email and password."
        case "already_linked": "That Xanom account is already linked to a different Lodestar account."
        case "other_xanom": "This Lodestar account is already linked to a different Xanom account."
        case "email_mismatch": "To convert, sign in to Xanom with the same email as this Lodestar account. To use a different email, choose Link an existing Xanom account."
        case "email_taken": "A Lodestar account with that email is linked to a different Xanom account. Sign in with its password."
        case "signed_out": "Sign in to Lodestar first, then try again."
        case "too_many": "Too many attempts. Try again in a few minutes."
        default: "Xanom sign-in didn't work. Try again in a moment."
        }
    }
}
