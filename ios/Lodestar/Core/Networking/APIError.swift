import Foundation

/// Every failure the API layer reports. `message` is always safe to show the user as written.
/// Cancellation is never an `APIError`: a cancelled request throws `CancellationError`.
enum APIError: Error, Equatable, Sendable {
    /// The server answered `{ok:false, error}` (any status). `message` is the server's sentence.
    case server(status: Int, message: String)
    /// The server answered something that is not the envelope (proxy page, empty body).
    case http(status: Int)
    /// No response: offline, DNS, TLS, connection lost.
    case offline
    /// The request ran past its timeout.
    case timedOut
    /// The envelope said ok but `data` didn't match the model. `detail` is for logs only.
    case decoding(detail: String)
    /// The request could not be built (bad body, bad URL). `detail` is for logs only.
    case invalidRequest(detail: String)

    static let offlineMessage = "Can't reach Lodestar. Check your connection."
    static let timedOutMessage = "Lodestar took too long to answer. Try again."
    static let decodingMessage = "Lodestar sent something this version of the app can't read. Try again, or update the app."
    static let invalidRequestMessage = "That request couldn't be sent. Try again."

    /// Messages the server uses for "no valid session". Any other 401 is something else
    /// (on AI routes it means the ChatGPT or Grok connection is missing).
    static let signInMessages: Set<String> = [
        "Sign in first.",
        "Sign in to see your trips.",
        "Sign in to add trips.",
        "Sign in to see saved trips.",
        "Sign in to save trips.",
        "Sign in to save preferences.",
    ]

    var message: String {
        switch self {
        case .server(_, let message): message
        case .http(let status): "Request failed (HTTP \(status))."
        case .offline: Self.offlineMessage
        case .timedOut: Self.timedOutMessage
        case .decoding: Self.decodingMessage
        case .invalidRequest: Self.invalidRequestMessage
        }
    }

    /// HTTP status, or 0 when there was no response.
    var status: Int {
        switch self {
        case .server(let status, _), .http(let status): status
        case .offline, .timedOut, .decoding, .invalidRequest: 0
        }
    }

    /// True when the session cookie is missing or revoked: drop to signed-out.
    var isSignedOut: Bool {
        guard case .server(401, let message) = self else { return false }
        return Self.signInMessages.contains(message)
    }

    /// True when an AI route needs the user to connect ChatGPT or Grok.
    var needsAIConnection: Bool {
        guard case .server(401, let message) = self else { return false }
        return !Self.signInMessages.contains(message) && message.hasPrefix("Connect your")
    }

    /// 429. Show the message; never retry automatically (no Retry-After is sent).
    var isRateLimited: Bool { status == 429 }

    /// 404 (for example "That trip doesn't exist.").
    var isNotFound: Bool { status == 404 }

    /// Maps a transport error. Returns nil for cancellation, which callers rethrow as `CancellationError`.
    static func from(transport error: any Error) -> APIError? {
        if error is CancellationError { return nil }
        guard let urlError = error as? URLError else { return .offline }
        switch urlError.code {
        case .cancelled: return nil
        case .timedOut: return .timedOut
        default: return .offline
        }
    }
}

extension APIError: LocalizedError {
    var errorDescription: String? { message }
}

extension Error {
    /// A user-facing sentence for any error the app shows.
    var userMessage: String {
        if let api = self as? APIError { return api.message }
        return "That didn't work. Try again."
    }

    /// True for task or URL cancellation, which should never show an error banner.
    var isCancellation: Bool {
        if self is CancellationError { return true }
        if let url = self as? URLError, url.code == .cancelled { return true }
        return false
    }
}
