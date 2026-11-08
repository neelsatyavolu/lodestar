import Foundation

/// `data` of `GET /api/ai/status`. Never hardcode the model list; it refreshes server-side.
struct AIStatus: Codable, Hashable, Sendable {
    let connected: Connected
    let models: Models

    struct Connected: Codable, Hashable, Sendable {
        let codex: Bool
        let grok: Bool
    }

    struct Models: Codable, Hashable, Sendable {
        let codex: [AIModel]
        let grok: [AIModel]
    }

    /// What the web assumes when the status call fails.
    static let disconnected = AIStatus(
        connected: Connected(codex: false, grok: false),
        models: Models(codex: [], grok: [])
    )

    var anyConnected: Bool { connected.codex || connected.grok }

    /// codex when connected, otherwise grok, otherwise none.
    var defaultProvider: AIProvider? {
        if connected.codex { return .codex }
        if connected.grok { return .grok }
        return nil
    }

    func isConnected(_ provider: AIProvider) -> Bool {
        switch provider {
        case .codex: connected.codex
        case .grok: connected.grok
        case .unknown: false
        }
    }

    func models(for provider: AIProvider) -> [AIModel] {
        switch provider {
        case .codex: models.codex
        case .grok: models.grok
        case .unknown: []
        }
    }
}

struct AIModel: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let label: String
}

/// `data` of `POST /api/ai/{provider}/start`.
struct AISignInStart: Codable, Hashable, Sendable {
    let authorizeUrl: String
}

/// Body of `POST /api/ai/{provider}/complete`: the full loopback redirect URL, a query string,
/// or (Grok only) the bare code.
struct AISignInComplete: Codable, Hashable, Sendable {
    let callback: String
}

/// `data` of `/complete`.
struct AIConnected: Codable, Hashable, Sendable {
    let connected: AIProvider
}

/// `data` of `POST /api/ai/{provider}/logout`.
struct AIDisconnected: Codable, Hashable, Sendable {
    let disconnected: AIProvider
}
