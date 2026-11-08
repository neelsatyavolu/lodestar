import Foundation
import Observation

/// Pure helpers for the ChatGPT / Grok sign-in (api-search.md 4.2).
enum AIConnectLogic {
    /// What the loopback listener saw.
    enum Outcome: Equatable, Sendable {
        /// The full redirect URL to send to `/complete`.
        case callback(String)
        /// The provider redirected with `error=…`.
        case refused
        /// Something else (a favicon request): keep listening.
        case ignore
    }

    static let refusedMessage = "Sign-in was cancelled or refused. Try again."
    static let successPage = "Connected. You can return to Lodestar."

    /// The redirect URI's origin and path for each provider's CLI OAuth client.
    static func redirect(_ provider: AIProvider) -> (origin: String, path: String)? {
        switch provider {
        case .codex: ("http://localhost:1455", "/auth/callback")
        case .grok: ("http://127.0.0.1:56121", "/callback")
        case .unknown: nil
        }
    }

    /// "GET /auth/callback?code=…&state=… HTTP/1.1" → "/auth/callback?code=…&state=…".
    static func requestTarget(_ rawRequest: String) -> String? {
        guard let line = rawRequest.split(whereSeparator: \.isNewline).first else { return nil }
        let parts = line.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET", parts[1].hasPrefix("/") else { return nil }
        return String(parts[1])
    }

    static func outcome(target: String, provider: AIProvider) -> Outcome {
        guard let redirect = redirect(provider),
              let components = URLComponents(string: redirect.origin + target),
              components.path == redirect.path else { return .ignore }
        let items = components.queryItems ?? []
        if items.contains(where: { $0.name == "code" && !($0.value ?? "").isEmpty }) {
            return .callback(redirect.origin + target)
        }
        if items.contains(where: { $0.name == "error" }) { return .refused }
        return .ignore
    }

    /// The minimal HTTP reply the listener sends back to the browser.
    static func httpResponse(body: String) -> String {
        let html = "<!doctype html><meta charset=utf-8><title>Lodestar</title><p>\(body)</p>"
        return "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(html.utf8.count)\r\nConnection: close\r\n\r\n\(html)"
    }

    /// The server's copy says "Click"; on iOS it's "Tap".
    static func nativeMessage(_ message: String) -> String {
        message.replacingOccurrences(of: "Click Connect again", with: "Tap Connect again")
    }

    static func intro(signedIn: Bool) -> String {
        let lead = "Lodestar's AI runs on your own ChatGPT or Grok subscription. "
        return lead + (signedIn
            ? "The sign-in token is encrypted and saved to your Lodestar account, so it works wherever you sign in. Disconnect to remove it."
            : "The sign-in token is encrypted and kept only on this device. Sign in to Lodestar first to save it to your account.")
    }

    static func howTo(_ provider: AIProvider) -> String {
        switch provider {
        case .grok:
            "Sign in with your X / Grok account. Grok then shows a code. Copy it and paste it below."
        case .codex, .unknown:
            "Sign in with your ChatGPT account. Lodestar picks the sign-in up when it finishes. If it doesn't, open it in Safari instead: you'll land on a page that doesn't load (a localhost address). That's expected: copy the full address from the address bar and paste it below."
        }
    }

    static func pastePlaceholder(_ provider: AIProvider) -> String {
        provider == .grok ? "Code from Grok" : "http://localhost:1455/auth/callback?code=…"
    }

    static func pasteLabel(_ provider: AIProvider) -> String {
        "Paste the \(provider == .grok ? "code" : "address") here"
    }
}

/// State of the Connect sheet. The browser and loopback listener live in the view's coordinator;
/// this holds the steps, the pasted text and the calls.
@MainActor
@Observable
final class AIConnectModel {
    typealias Start = @Sendable (AIProvider) async throws -> String
    typealias Complete = @Sendable (AIProvider, String) async throws -> AIProvider

    private(set) var provider: AIProvider = .codex
    private(set) var authorizeURL: URL?
    var pasted = ""
    private(set) var isStarting = false
    private(set) var isConnecting = false
    private(set) var error: String?
    private(set) var connected: AIProvider?

    @ObservationIgnored private let start: Start
    @ObservationIgnored private let complete: Complete

    init(start: @escaping Start, complete: @escaping Complete) {
        self.start = start
        self.complete = complete
    }

    convenience init(api: APIClient) {
        self.init(
            start: { try await api.send(API.AI.start($0)).authorizeUrl },
            complete: { try await api.send(API.AI.complete($0, callback: $1)).connected }
        )
    }

    var hasStarted: Bool { authorizeURL != nil }
    var canConnect: Bool { hasStarted && !pasted.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isConnecting }

    func select(_ next: AIProvider) {
        provider = next
        authorizeURL = nil
        pasted = ""
        error = nil
    }

    /// `POST /api/ai/{provider}/start`. Each call replaces the pending attempt.
    func begin() async -> URL? {
        error = nil
        isStarting = true
        defer { isStarting = false }
        do {
            let raw = try await start(provider)
            guard let url = URL(string: raw) else {
                error = "Could not start sign-in."
                return nil
            }
            authorizeURL = url
            return url
        } catch {
            self.error = error.isCancellation ? nil : AIConnectLogic.nativeMessage(error.userMessage)
            return nil
        }
    }

    /// The listener saw the provider refuse.
    func refused() {
        error = AIConnectLogic.refusedMessage
    }

    /// `POST /complete` with the captured redirect or the pasted text. True when connected.
    func finish(callback: String? = nil) async -> Bool {
        let text = (callback ?? pasted).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isConnecting else { return false }
        isConnecting = true
        error = nil
        defer { isConnecting = false }
        do {
            connected = try await complete(provider, text)
            return true
        } catch {
            self.error = error.isCancellation ? nil : AIConnectLogic.nativeMessage(error.userMessage)
            return false
        }
    }
}
