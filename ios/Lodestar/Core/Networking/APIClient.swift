import Foundation
import os

/// The one way the app talks to Lodestar. All calls share one URLSession and one cookie
/// store, so the `ls_session` cookie, the AI device cookie and the AI PKCE cookie all flow.
///
/// Every method throws either `APIError` (show `message`) or `CancellationError` (show nothing).
final class APIClient: Sendable {
    let config: APIConfig
    let session: URLSession
    let cookies: HTTPCookieStorage
    private static let log = Logger(subsystem: "co.xanom.lodestar", category: "api")

    init(config: APIConfig = .current(), cookies: HTTPCookieStorage = .shared, protocolClasses: [AnyClass]? = nil) {
        self.config = config
        self.cookies = cookies
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = cookies
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = Timeouts.ai
        configuration.timeoutIntervalForResource = 600
        configuration.waitsForConnectivity = false
        if let protocolClasses { configuration.protocolClasses = protocolClasses }
        self.session = URLSession(configuration: configuration)
    }

    var baseURL: URL { config.baseURL }

    /// Sends a JSON route and returns its unwrapped `data`.
    func send<R>(_ endpoint: Endpoint<R>) async throws -> R {
        let request = try endpoint.makeRequest(baseURL: baseURL)
        let (data, status) = try await perform(request)
        do {
            return try ResponseDecoder.decode(R.self, data: data, status: status)
        } catch {
            if case .decoding(let detail) = error {
                Self.log.error("Decoding \(endpoint.path, privacy: .public) failed: \(detail, privacy: .public)")
            }
            throw error
        }
    }

    /// Streams an NDJSON route (`/api/ai/canvas`). Lines that don't decode are skipped.
    /// A non-200 answer throws the envelope's error. Cancelling the consuming task cancels the request,
    /// which also stops the server spending the user's AI subscription.
    func stream<Event: Decodable & Sendable>(_ endpoint: Endpoint<Event>) -> AsyncThrowingStream<Event, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let request = try endpoint.makeRequest(baseURL: baseURL)
                    let (bytes, response) = try await session.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard status == 200 else {
                        var body = Data()
                        for try await byte in bytes { body.append(byte) }
                        throw ResponseDecoder.failure(data: body, status: status)
                    }
                    for try await line in bytes.lines {
                        let trimmed = line.trimmingCharacters(in: .whitespaces)
                        guard !trimmed.isEmpty,
                              let event = try? JSONCoding.decoder.decode(Event.self, from: Data(trimmed.utf8))
                        else { continue }
                        continuation.yield(event)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: Self.mapped(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Raw bytes for image routes (`/api/logo/*`, `/api/places/photo`, absolute thumbnails).
    /// Follows redirects. Returns the body and its Content-Type.
    func fetchData(_ pathOrURL: String) async throws -> (data: Data, contentType: String?) {
        guard let url = config.resolve(pathOrURL) else {
            throw APIError.invalidRequest(detail: "Bad image URL \(pathOrURL)")
        }
        var request = URLRequest(url: url, timeoutInterval: Timeouts.standard)
        request.setValue("image/*,*/*;q=0.8", forHTTPHeaderField: "Accept")
        let (data, response) = try await performRaw(request)
        let status = response.statusCode
        guard (200..<300).contains(status) else { throw ResponseDecoder.failure(data: data, status: status) }
        return (data, response.value(forHTTPHeaderField: "Content-Type"))
    }

    /// True while an `ls_session` cookie is stored (it may still be revoked on the server).
    var hasSessionCookie: Bool {
        (cookies.cookies(for: baseURL) ?? []).contains { $0.name == "ls_session" }
    }

    /// Deletes the session cookie locally (used after logout, even if the call failed).
    func clearSessionCookie() {
        for cookie in cookies.cookies(for: baseURL) ?? [] where cookie.name == "ls_session" {
            cookies.deleteCookie(cookie)
        }
    }

    // MARK: - Transport

    private func perform(_ request: URLRequest) async throws -> (Data, Int) {
        let (data, response) = try await performRaw(request)
        return (data, response.statusCode)
    }

    private func performRaw(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIError.http(status: 0) }
            return (data, http)
        } catch {
            throw Self.mapped(error)
        }
    }

    private static func mapped(_ error: any Error) -> any Error {
        if let api = error as? APIError { return api }
        guard let mapped = APIError.from(transport: error) else { return CancellationError() }
        return mapped
    }
}
