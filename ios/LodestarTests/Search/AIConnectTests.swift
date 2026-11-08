import Foundation
import Testing
@testable import Lodestar

@Suite("AI sign-in: loopback parsing, copy and the connect model")
@MainActor
struct AIConnectTests {
    @Test func requestTargetFromHTTP() {
        let raw = "GET /auth/callback?code=abc&state=xyz HTTP/1.1\r\nHost: localhost:1455\r\n\r\n"
        #expect(AIConnectLogic.requestTarget(raw) == "/auth/callback?code=abc&state=xyz")
        #expect(AIConnectLogic.requestTarget("POST /auth/callback HTTP/1.1") == nil)
        #expect(AIConnectLogic.requestTarget("") == nil)
    }

    @Test func outcomes() {
        #expect(AIConnectLogic.outcome(target: "/auth/callback?code=abc&state=xyz", provider: .codex)
                == .callback("http://localhost:1455/auth/callback?code=abc&state=xyz"))
        #expect(AIConnectLogic.outcome(target: "/callback?code=g1", provider: .grok)
                == .callback("http://127.0.0.1:56121/callback?code=g1"))
        #expect(AIConnectLogic.outcome(target: "/auth/callback?error=access_denied", provider: .codex) == .refused)
        #expect(AIConnectLogic.outcome(target: "/favicon.ico", provider: .codex) == .ignore)
        #expect(AIConnectLogic.outcome(target: "/callback?code=abc", provider: .codex) == .ignore)
        #expect(AIConnectLogic.outcome(target: "/auth/callback?code=", provider: .codex) == .ignore)
    }

    @Test func httpReplyAndCopy() {
        let reply = AIConnectLogic.httpResponse(body: AIConnectLogic.successPage)
        #expect(reply.hasPrefix("HTTP/1.1 200 OK\r\n"))
        #expect(reply.contains("Connected. You can return to Lodestar."))
        #expect(AIConnectLogic.nativeMessage("This sign-in expired. Click Connect again.") == "This sign-in expired. Tap Connect again.")
        #expect(AIConnectLogic.intro(signedIn: false).contains("on this device"))
        #expect(AIConnectLogic.intro(signedIn: true).contains("saved to your Lodestar account"))
        #expect(AIConnectLogic.pastePlaceholder(.grok) == "Code from Grok")
        #expect(AIConnectLogic.pasteLabel(.codex) == "Paste the address here")
    }

    @Test func connectModelSteps() async {
        let model = AIConnectModel(
            start: { provider in "https://auth.x.ai/oauth2/authorize?client=\(provider.rawValue)" },
            complete: { provider, callback in
                guard callback == "code-123" else {
                    throw APIError.server(status: 400, message: "That link is from a different sign-in attempt. Click Connect again.")
                }
                return provider
            }
        )
        model.select(.grok)
        #expect(!model.hasStarted && !model.canConnect)
        let url = await model.begin()
        #expect(url?.absoluteString.hasSuffix("client=grok") == true)
        model.pasted = "  "
        #expect(!model.canConnect)
        model.pasted = "wrong"
        #expect(await model.finish() == false)
        #expect(model.error == "That link is from a different sign-in attempt. Tap Connect again.")
        #expect(await model.finish(callback: "code-123"))
        #expect(model.connected == .grok)
        model.select(.codex)
        #expect(!model.hasStarted && model.pasted.isEmpty && model.error == nil)
        model.refused()
        #expect(model.error == AIConnectLogic.refusedMessage)
    }

    @Test func startFailureShowsMessage() async {
        let model = AIConnectModel(start: { _ in throw APIError.server(status: 429, message: "Too many requests. Wait a minute and try again.") },
                                   complete: { p, _ in p })
        #expect(await model.begin() == nil)
        #expect(model.error == "Too many requests. Wait a minute and try again.")
        #expect(!model.isStarting)
    }
}
