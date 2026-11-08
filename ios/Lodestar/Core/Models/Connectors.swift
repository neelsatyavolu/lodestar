import Foundation

/// `data` of `GET /api/connectors`.
struct ConnectorsState: Codable, Hashable, Sendable {
    /// Private forwarding address; nil = forwarding isn't set up on this server.
    let address: String?
    /// Paired Flint devices, oldest first.
    let flint: [FlintLink]
}

struct FlintLink: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let deviceName: String
    let createdAt: EpochMillis
    let lastDeliveryAt: EpochMillis?
}

/// `data` of `POST /api/connectors/address`.
struct ForwardingAddress: Codable, Hashable, Sendable {
    let address: String
}

/// `data` of `POST /api/connectors/flint/code`: single use, valid 10 minutes.
struct FlintPairingCode: Codable, Hashable, Sendable {
    /// "XXXX-XXXX".
    let code: String
    let expiresAt: EpochMillis
}

/// `data` of `GET /api/agents`.
struct AgentsState: Codable, Hashable, Sendable {
    let mcpUrl: String
    /// Newest first.
    let grants: [AgentGrant]
}

struct AgentGrant: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let kind: GrantKind
    let clientId: String?
    let name: String
    let createdAt: EpochMillis
    let lastUsedAt: EpochMillis?
}

struct NewAgentToken: Codable, Hashable, Sendable {
    /// 1...60 chars, e.g. "Codex on my laptop".
    let name: String
}

/// `data` of `POST /api/agents`. Show `token` once only.
struct AgentTokenCreated: Codable, Hashable, Sendable {
    let grant: AgentGrant
    let token: String
}
