import Foundation
import Testing
@testable import Lodestar

@Suite("Xanom flow")
struct XanomFlowTests {
    @Test func challengeIsTheRFC7636Vector() {
        #expect(XanomFlow.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func secretsAreFreshAndURLSafe() {
        let a = XanomFlow.Secret.make()
        let b = XanomFlow.Secret.make()
        #expect(a != b)
        #expect(a.verifier.count == 43)
        #expect(a.challenge.count == 43)
        #expect(a.verifier.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
    }

    @Test func signInURLGoesToTheBackendStart() throws {
        let url = XanomFlow.signInURL(base: URL(string: "https://lodestar.xanom.co")!, challenge: "abc")
        let parts = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        #expect(parts.path == "/api/xanom/start")
        #expect(parts.queryItems == [
            URLQueryItem(name: "platform", value: "ios"),
            URLQueryItem(name: "intent", value: "signin"),
            URLQueryItem(name: "ios_challenge", value: "abc"),
        ])
    }

    @Test func parsesTheCallback() {
        #expect(XanomFlow.parseCallback(URL(string: "lodestar://xanom?ticket=t_1")!) == .ticket("t_1"))
        #expect(XanomFlow.parseCallback(URL(string: "lodestar://xanom?error=denied")!) == .failed(code: "denied"))
        #expect(XanomFlow.parseCallback(URL(string: "lodestar://reset?ticket=t_1")!) == nil)
        #expect(XanomFlow.parseCallback(URL(string: "https://xanom/?ticket=t_1")!) == nil)
        #expect(XanomFlow.parseCallback(URL(string: "lodestar://xanom")!) == nil)
    }

    @Test func messagesMatchTheWeb() {
        #expect(XanomFlow.message(for: "denied") == "Xanom sign-in was cancelled.")
        #expect(XanomFlow.message(for: "anything-else") == "Xanom sign-in didn't work. Try again in a moment.")
    }

    @Test func deleteSendsPasswordOrConfirm() throws {
        #expect(try jsonObject(DeleteAccountRequest(password: "pw")) as NSDictionary == ["password": "pw"])
        #expect(try jsonObject(DeleteAccountRequest(confirm: true)) as NSDictionary == ["confirm": true])
    }

    @Test func accountProfileReadsTheXanomFields() throws {
        let state = try decodeEnvelope(#"{"user":{"email":"a@b.co","createdAt":1,"hasPassword":false,"xanomEmail":"x@b.co"},"preferences":null}"#, as: AccountState.self)
        #expect(state.user?.hasPassword == false)
        #expect(state.user?.xanomEmail == "x@b.co")
    }
}

@MainActor
@Suite("Xanom sign-in against a stub server")
struct XanomAppTests {
    nonisolated private static func exchangeReply(created: Bool) -> TripsStubProtocol.Reply {
        let prefs = String(data: try! JSONCoding.encoder.encode(Preferences.default), encoding: .utf8)!
        return TripsStubProtocol.ok(#"{"user":{"email":"ada@example.com"},"preferences":"# + prefs + #","created":\#(created)}"#)
    }

    @Test func signInRedeemsTheTicketWithTheSecretBehindTheChallenge() async throws {
        let sent = SentBodies()
        let (client, host) = TripsStubProtocol.client { request, body in
            sent.add(body)
            return request.url?.path() == "/api/xanom/ios-exchange" ? Self.exchangeReply(created: true) : TripsStubProtocol.fail(404, "No.")
        }
        let app = AppState(api: client)
        var opened: URL?
        let created = try await app.continueWithXanom(.signIn) { url in
            opened = url
            return URL(string: "lodestar://xanom?ticket=the_ticket")!
        }
        #expect(created)
        #expect(app.account?.email == "ada@example.com")
        #expect(app.isOnboardingQueued)
        let openedURL = try #require(opened)
        let items = URLComponents(url: openedURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let challenge = try #require(items.first { $0.name == "ios_challenge" }?.value)
        let body = try #require(sent.first)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(json["ticket"] == "the_ticket")
        let verifier = try #require(json["verifier"])
        #expect(XanomFlow.challenge(for: verifier) == challenge)
        #expect(TripsStubProtocol.log(host).contains("POST /api/xanom/ios-exchange"))
    }

    @Test func anErrorFromTheBackendIsShownAsItsSentence() async {
        let (client, _) = TripsStubProtocol.client { _, _ in TripsStubProtocol.fail(404, "No.") }
        let app = AppState(api: client)
        await #expect(throws: APIError.server(status: 400, message: XanomFlow.message(for: "already_linked"))) {
            try await app.continueWithXanom(.signIn) { _ in URL(string: "lodestar://xanom?error=already_linked")! }
        }
        #expect(!app.isSignedIn)
    }

    @Test func linkAsksForAStartLinkFirst() async throws {
        let (client, host) = TripsStubProtocol.client { request, _ in
            switch request.url?.path() {
            case "/api/xanom/ios-start": TripsStubProtocol.ok(#"{"url":"https://example.test/api/xanom/start?as=x"}"#)
            case "/api/xanom/ios-exchange": Self.exchangeReply(created: false)
            case "/api/account": TripsStubProtocol.ok(#"{"user":{"email":"ada@example.com","xanomEmail":"ada@x.co"},"preferences":null}"#)
            default: TripsStubProtocol.ok("{}")
            }
        }
        let app = AppState(api: client)
        var opened: URL?
        try await app.continueWithXanom(.link) { url in
            opened = url
            return URL(string: "lodestar://xanom?ticket=t")!
        }
        #expect(opened?.absoluteString == "https://example.test/api/xanom/start?as=x")
        #expect(app.account?.xanomEmail == "ada@x.co")
        #expect(Array(TripsStubProtocol.log(host).prefix(3)) == ["POST /api/xanom/ios-start", "POST /api/xanom/ios-exchange", "GET /api/account"])
    }

    @Test func cancellingTheSheetIsNotAnError() async {
        let (client, _) = TripsStubProtocol.client { _, _ in TripsStubProtocol.fail(404, "No.") }
        let model = XanomModel()
        let finished = await model.run(.signIn, app: AppState(api: client)) { _ in throw CancellationError() }
        #expect(!finished)
        #expect(model.error == nil)
        #expect(model.busy == nil)
    }
}

/// Request bodies seen by a stub, in order.
private final class SentBodies: @unchecked Sendable {
    private let lock = NSLock()
    private var bodies: [Data] = []
    func add(_ body: Data?) { lock.withLock { if let body { bodies.append(body) } } }
    var first: Data? { lock.withLock { bodies.first } }
}
