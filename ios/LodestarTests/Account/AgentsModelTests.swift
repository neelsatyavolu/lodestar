import Foundation
import Testing
@testable import Lodestar

/// The Agents sheet (`/api/agents`) against a stubbed server.
@MainActor
@Suite("Agents")
struct AgentsModelTests {
    nonisolated private static let grants = #"""
    [{"id":"g2","kind":"personal","clientId":null,"name":"Codex on my laptop","createdAt":1762500000000,"lastUsedAt":null},
     {"id":"g1","kind":"oauth","clientId":"c1","name":"Claude","createdAt":1762400000000,"lastUsedAt":1762450000000}]
    """#

    @Test func loadsAndSplitsAppsFromTokens() async {
        let (client, host) = TripsStubProtocol.client { _, _ in
            TripsStubProtocol.ok(#"{"mcpUrl":"https://lodestar.xanom.co/api/mcp","grants":\#(Self.grants)}"#)
        }
        let model = AgentsModel(app: AppState(api: client))
        await model.load()
        #expect(model.mcpURL == "https://lodestar.xanom.co/api/mcp")
        #expect(model.apps.map(\.id) == ["g1"])
        #expect(model.tokens.map(\.id) == ["g2"])
        #expect(TripsStubProtocol.log(host) == ["GET /api/agents"])
        #expect(AgentsModel.grantLine(model.tokens[0]).hasSuffix("· last used never"))
        #expect(AgentsModel.grantLine(model.apps[0]).hasPrefix("Connected "))
    }

    @Test func makesATokenAndShowsItOnce() async throws {
        let (client, host) = TripsStubProtocol.client { request, body in
            if request.httpMethod == "POST" {
                let sent = (try? JSONSerialization.jsonObject(with: body ?? Data())) as? [String: Any]
                guard sent?["name"] as? String == "My CLI" else { return TripsStubProtocol.fail(400, "Bad name.") }
                return TripsStubProtocol.ok(#"{"grant":{"id":"g3","kind":"personal","clientId":null,"name":"My CLI","createdAt":1762600000000,"lastUsedAt":null},"token":"lsp_secret"}"#)
            }
            return TripsStubProtocol.ok(#"{"mcpUrl":"https://x.test/api/mcp","grants":\#(Self.grants)}"#)
        }
        let model = AgentsModel(app: AppState(api: client))
        await model.load()
        model.name = "  My CLI  "
        await model.createToken()
        #expect(model.freshToken == "lsp_secret")
        #expect(model.name.isEmpty)
        #expect(model.tokens.map(\.id) == ["g3", "g2"])
        #expect(TripsStubProtocol.log(host) == ["GET /api/agents", "POST /api/agents"])
    }

    @Test func revokeRemovesTheGrantAndReportsFailures() async {
        let (client, _) = TripsStubProtocol.client { request, _ in
            switch (request.httpMethod, request.url?.path()) {
            case ("DELETE", "/api/agents/g1"): return TripsStubProtocol.ok("{}")
            case ("DELETE", _): return TripsStubProtocol.fail(404, "That connection doesn't exist.")
            default: return TripsStubProtocol.ok(#"{"mcpUrl":"https://x.test/api/mcp","grants":\#(Self.grants)}"#)
            }
        }
        let model = AgentsModel(app: AppState(api: client))
        await model.load()
        await model.revoke(model.apps[0])
        #expect(model.apps.isEmpty && model.error == nil)
        await model.revoke(model.tokens[0])
        #expect(model.tokens.count == 1)
        #expect(model.error == "That connection doesn't exist.")
    }

    @Test func blankNamesCannotBeSent() {
        let (client, _) = TripsStubProtocol.client { _, _ in TripsStubProtocol.fail(500, "No.") }
        let model = AgentsModel(app: AppState(api: client))
        model.name = "   "
        #expect(!model.canCreate)
        #expect(AgentsModel.claudeCommand("https://x.test/api/mcp") == "claude mcp add --transport http lodestar https://x.test/api/mcp")
    }
}
