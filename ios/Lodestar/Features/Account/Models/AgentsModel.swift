import Foundation
import Observation

/// "Agents" (web `agent-access.tsx`): the MCP server address, connected apps and personal tokens.
@MainActor
@Observable
final class AgentsModel {
    static let maxNameLength = 60

    let app: AppState
    private(set) var state: LoadState<AgentsState> = .idle
    /// The token just made. Shown once, never stored.
    private(set) var freshToken: String?
    private(set) var isBusy = false
    var name = ""
    var error: String?

    init(app: AppState) {
        self.app = app
    }

    var mcpURL: String? { state.value?.mcpUrl }
    var apps: [AgentGrant] { state.value?.grants.filter { $0.kind == .oauth } ?? [] }
    var tokens: [AgentGrant] { state.value?.grants.filter { $0.kind == .personal } ?? [] }
    var trimmedName: String { String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxNameLength)) }
    var canCreate: Bool { !isBusy && !trimmedName.isEmpty }

    func load() async {
        if state.value == nil { state = .loading }
        do {
            state = .loaded(try await app.api.send(API.Agents.list))
        } catch {
            let message = app.handle(error) ?? "Couldn't load your connections."
            if state.value == nil { state = .failed(message) } else { self.error = message }
        }
    }

    /// "Make token": the new grant goes first, as the list is newest first.
    func createToken() async {
        guard canCreate else { return }
        let requested = trimmedName
        isBusy = true
        error = nil
        defer { isBusy = false }
        do {
            let created = try await app.api.send(API.Agents.createToken(name: requested))
            freshToken = created.token
            name = ""
            if let current = state.value {
                state = .loaded(AgentsState(mcpUrl: current.mcpUrl, grants: [created.grant] + current.grants))
            }
        } catch {
            self.error = app.handle(error) ?? "Couldn't make a token."
        }
    }

    func revoke(_ grant: AgentGrant) async {
        error = nil
        do {
            _ = try await app.api.send(API.Agents.revoke(grant.id))
            if let current = state.value {
                state = .loaded(AgentsState(mcpUrl: current.mcpUrl, grants: current.grants.filter { $0.id != grant.id }))
            }
        } catch {
            self.error = app.handle(error) ?? "Couldn't revoke it."
        }
    }

    /// `claude mcp add --transport http lodestar <url>`.
    static func claudeCommand(_ url: String) -> String {
        "claude mcp add --transport http lodestar \(url)"
    }

    /// "Connected Nov 21, 2026 · last used never" (web `when`).
    static func grantLine(_ grant: AgentGrant) -> String {
        let made = grant.kind == .oauth ? "Connected" : "Made"
        return "\(made) \(day(grant.createdAt)) · last used \(grant.lastUsedAt.map(day) ?? "never")"
    }

    private static func day(_ ms: EpochMillis) -> String {
        ms.asDate.formatted(.dateTime.month(.abbreviated).day().year())
    }
}
