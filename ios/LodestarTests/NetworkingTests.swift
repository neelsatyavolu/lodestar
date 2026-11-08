import Foundation
import Testing
@testable import Lodestar

@Suite("Envelope decoding")
struct EnvelopeTests {
    @Test func decodesSuccessData() throws {
        let value = try decodeEnvelope(#"{"address":"abc@in.example","flint":[]}"#, as: ConnectorsState.self)
        #expect(value.address == "abc@in.example")
        #expect(value.flint.isEmpty)
    }

    @Test func errorEnvelopeCarriesServerMessage() {
        let body = Data(#"{"ok":false,"error":"Too many requests. Wait a minute and try again."}"#.utf8)
        #expect(throws: APIError.server(status: 429, message: "Too many requests. Wait a minute and try again.")) {
            try ResponseDecoder.decode(ConnectorsState.self, data: body, status: 429)
        }
    }

    @Test func okFalseWithStatus200IsStillAnError() {
        let body = Data(#"{"ok":false,"error":"Nope."}"#.utf8)
        #expect(throws: APIError.server(status: 200, message: "Nope.")) {
            try ResponseDecoder.decode(EmptyResponse.self, data: body, status: 200)
        }
    }

    @Test func nonJSONBodyFallsBackToHTTPStatus() {
        let body = Data("<html>Bad gateway</html>".utf8)
        do {
            _ = try ResponseDecoder.decode(EmptyResponse.self, data: body, status: 502)
            Issue.record("Expected an error")
        } catch {
            #expect(error == .http(status: 502))
            #expect(error.message == "Request failed (HTTP 502).")
        }
    }

    @Test func non2xxWithoutErrorTextFallsBack() {
        let body = Data(#"{"ok":true,"data":{}}"#.utf8)
        #expect(throws: APIError.http(status: 500)) {
            try ResponseDecoder.decode(EmptyResponse.self, data: body, status: 500)
        }
    }

    @Test func emptyDataObjectDecodes() throws {
        _ = try decodeEnvelope("{}", as: EmptyResponse.self)
        let missing = Data(#"{"ok":true}"#.utf8)
        _ = try ResponseDecoder.decode(EmptyResponse.self, data: missing, status: 200)
    }

    @Test func wrongShapeIsADecodingError() {
        do {
            _ = try decodeEnvelope(#"{"address":42,"flint":[]}"#, as: ConnectorsState.self)
            Issue.record("Expected an error")
        } catch {
            guard let api = error as? APIError, case .decoding = api else { Issue.record("Wrong error \(error)"); return }
            #expect(api.message == APIError.decodingMessage)
        }
    }

    @Test func bareArrayData() throws {
        let days = try decodeEnvelope(#"[{"depart":"2026-11-26","return":null,"price":312.4}]"#, as: [DayPrice].self)
        #expect(days.count == 1)
        #expect(days[0].returnDate == nil)
    }

    @Test func streamFailureReadsEnvelope() {
        let error = ResponseDecoder.failure(data: Data(#"{"ok":false,"error":"Connect your ChatGPT account first."}"#.utf8), status: 401)
        #expect(error.needsAIConnection)
        #expect(ResponseDecoder.failure(data: Data(), status: 503) == .http(status: 503))
    }
}

@Suite("API errors")
struct APIErrorTests {
    @Test func userMessages() {
        #expect(APIError.offline.message == "Can't reach Lodestar. Check your connection.")
        #expect(APIError.http(status: 504).message == "Request failed (HTTP 504).")
        #expect(APIError.server(status: 400, message: "Use YYYY-MM-DD.").message == "Use YYYY-MM-DD.")
        #expect(APIError.offline.status == 0)
    }

    @Test(arguments: ["Sign in first.", "Sign in to see your trips.", "Sign in to save trips.", "Sign in to save preferences."])
    func signInMessagesMeanSignedOut(message: String) {
        let error = APIError.server(status: 401, message: message)
        #expect(error.isSignedOut)
        #expect(!error.needsAIConnection)
    }

    @Test func aiConnection401IsNotSignedOut() {
        let error = APIError.server(status: 401, message: "Connect your Grok account first.")
        #expect(!error.isSignedOut)
        #expect(error.needsAIConnection)
        #expect(!APIError.server(status: 401, message: "That password isn't right.").isSignedOut)
    }

    @Test func rateLimitAndNotFound() {
        #expect(APIError.server(status: 429, message: "x").isRateLimited)
        #expect(APIError.server(status: 404, message: "That trip doesn't exist.").isNotFound)
    }

    @Test func transportMapping() {
        #expect(APIError.from(transport: URLError(.notConnectedToInternet)) == .offline)
        #expect(APIError.from(transport: URLError(.timedOut)) == .timedOut)
        #expect(APIError.from(transport: URLError(.cancelled)) == nil)
        #expect(APIError.from(transport: CancellationError()) == nil)
        #expect(URLError(.cancelled).isCancellation)
        #expect(!APIError.offline.isCancellation)
    }
}

@Suite("Endpoint requests")
struct EndpointTests {
    let base = URL(string: "https://lodestar.xanom.co")!

    @Test func postWithoutBodySendsEmptyObjectAndNoOrigin() throws {
        let request = try API.Account.logout.makeRequest(baseURL: base)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://lodestar.xanom.co/api/account/logout")
        #expect(request.httpBody == Data("{}".utf8))
        #expect(request.value(forHTTPHeaderField: "Origin") == nil)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    }

    @Test func getHasQueryAndNoBody() throws {
        let request = try API.Flights.airports(query: "san fr").makeRequest(baseURL: base)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "https://lodestar.xanom.co/api/airports?q=san%20fr")
        #expect(request.httpBody == nil)
    }

    @Test func timeoutsFollowRouteLimits() throws {
        let query = SearchQuery(from: ["SFO"], to: ["JFK"], depart: date("2026-11-26"))
        #expect(try API.Flights.search(query).makeRequest(baseURL: base).timeoutInterval == 70)
        #expect(API.Journeys.generate("x", GenerateRequest(provider: .codex, part: .itinerary)).timeout == 310)
        #expect(API.Journeys.wanderlogList(session: "s:abcdefghij").timeout == 130)
    }

    @Test func pathsResolveAgainstBase() throws {
        let local = URL(string: "http://localhost:3000")!
        let request = try API.Journeys.legs("abc", date: date("2026-11-21")).makeRequest(baseURL: local)
        #expect(request.url?.absoluteString == "http://localhost:3000/api/journeys/abc/legs?date=2026-11-21")
    }

    @Test func configResolvesRelativeLogoPaths() {
        let config = APIConfig(baseURL: base)
        #expect(config.resolve("/api/logo/airline/UA")?.absoluteString == "https://lodestar.xanom.co/api/logo/airline/UA")
        #expect(config.resolve("https://lh3.googleusercontent.com/x")?.host() == "lh3.googleusercontent.com")
        #expect(config.shareURL(token: "abc").absoluteString == "https://lodestar.xanom.co/t/abc")
        #expect(API.Logos.sitePath(domain: "_", name: "Fly Cheap") == "/api/logo/site/_?name=Fly%20Cheap")
        #expect(API.Places.photoPath(name: "places/a/photos/b", width: 5000).hasSuffix("w=1200"))
    }

    @Test func configOverrideFromDefaults() throws {
        let defaults = try #require(UserDefaults(suiteName: "lodestar-tests-\(UUID().uuidString)"))
        #expect(APIConfig.current(defaults: defaults).baseURL == APIConfig.defaultBaseURL)
        defaults.set("http://localhost:3000", forKey: APIConfig.overrideKey)
        #expect(APIConfig.current(defaults: defaults).baseURL.absoluteString == "http://localhost:3000")
        defaults.set("not a url", forKey: APIConfig.overrideKey)
        #expect(APIConfig.current(defaults: defaults).baseURL == APIConfig.defaultBaseURL)
    }
}
