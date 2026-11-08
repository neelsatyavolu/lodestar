import Foundation

enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

/// Request timeouts. Each is the route's server `maxDuration` plus a margin.
enum Timeouts {
    static let standard: TimeInterval = 30
    /// /api/search, /api/calendar, /api/sellers, /api/stays/*, /api/journeys/:id/locate
    static let live: TimeInterval = 70
    /// /api/journeys/import/wanderlog
    static let wanderlog: TimeInterval = 130
    /// /api/ai/canvas, journeys generate/suggest/read
    static let ai: TimeInterval = 310
}

/// One API call: where it goes, what it sends and what `data` decodes to.
/// Build these with the factories in `API` (Endpoints*.swift), not by hand.
struct Endpoint<Response: Decodable & Sendable>: Sendable {
    let method: HTTPMethod
    let path: String
    var query: [URLQueryItem] = []
    var body: (any Encodable & Sendable)?
    var timeout: TimeInterval = Timeouts.standard

    /// Builds the URLRequest. Never sets `Origin` (the server refuses cross-site writes that carry one).
    /// Non-GET requests without a body send `{}`, because the server rejects an empty body as "not JSON".
    func makeRequest(baseURL: URL) throws(APIError) -> URLRequest {
        guard var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false) else {
            throw .invalidRequest(detail: "Bad path \(path)")
        }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw .invalidRequest(detail: "Bad query for \(path)") }

        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if method != .get {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encodedBody()
        }
        return request
    }

    private func encodedBody() throws(APIError) -> Data {
        guard let body else { return Data("{}".utf8) }
        do {
            return try JSONCoding.encoder.encode(body)
        } catch {
            throw .invalidRequest(detail: "Couldn't encode body for \(path): \(error)")
        }
    }
}

/// Shared coders. Keys are spelled out with CodingKeys in every model (the API mixes
/// snake_case and camelCase, and key strategies would also rewrite dictionary keys).
enum JSONCoding {
    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }

    static var decoder: JSONDecoder { JSONDecoder() }
}

/// For routes whose `data` is `{}` or ignored.
struct EmptyResponse: Codable, Sendable, Equatable {}
