import Foundation

/// Every endpoint the app calls, grouped by area. Each factory returns a typed `Endpoint`
/// for `APIClient.send(_:)`, e.g. `try await api.send(API.Flights.search(query))`.
enum API {}

extension API {
    /// Flight search contract (docs/api-search.md sections 2 and 2.6).
    enum Flights {
        /// 20/min/IP. Send preferences in the body (`SearchQuery.applying(_:)`).
        static func search(_ query: SearchQuery) -> Endpoint<SearchResult> {
            Endpoint(method: .post, path: "/api/search", body: query, timeout: Timeouts.live)
        }

        /// Bare array. 30/min/IP. Fetch only when `flexible`, after the results arrive.
        static func calendar(_ query: SearchQuery, window: CalendarQuery.DateWindow? = nil) -> Endpoint<[DayPrice]> {
            Endpoint(method: .post, path: "/api/calendar", body: CalendarQuery(query: query, window: window), timeout: Timeouts.live)
        }

        /// 40/min/IP. Skip when `itinerary.tfs` is nil.
        static func sellers(_ request: SellerCheckRequest) -> Endpoint<SellerCheck> {
            Endpoint(method: .post, path: "/api/sellers", body: request, timeout: Timeouts.live)
        }

        /// Up to 8; metros first. Debounce ~120 ms and drop stale answers.
        static func airports(query: String) -> Endpoint<[AirportSuggestion]> {
            Endpoint(method: .get, path: "/api/airports", query: [URLQueryItem(name: "q", value: String(query.prefix(60)))])
        }

        static func airlines(query: String) -> Endpoint<[AirlineSuggestion]> {
            Endpoint(method: .get, path: "/api/airlines", query: [URLQueryItem(name: "q", value: String(query.prefix(40)))])
        }
    }

    /// Image routes (not JSON). Load through `LogoView`, which handles the SVG monogram fallback.
    enum Logos {
        static func airlinePath(code: String) -> String {
            "/api/logo/airline/\(code.uppercased())"
        }

        /// `domain` "_" always yields a monogram for `name`.
        static func sitePath(domain: String, name: String) -> String {
            var components = URLComponents()
            components.path = "/api/logo/site/\(domain)"
            components.queryItems = [URLQueryItem(name: "name", value: String(name.prefix(60)))]
            return components.string ?? "/api/logo/site/_"
        }
    }

    /// Stays contract (docs/api-search.md section 3).
    enum Stays {
        /// Shares a 20/min bucket with `flex`.
        static func search(_ query: StaySearchQuery) -> Endpoint<StaySearchResult> {
            Endpoint(method: .post, path: "/api/stays/search", body: query, timeout: Timeouts.live)
        }

        static func prices(_ query: StayPricesQuery) -> Endpoint<StayPrices> {
            Endpoint(method: .post, path: "/api/stays/prices", body: query, timeout: Timeouts.live)
        }

        /// Fire in the background after a search with the same body.
        static func flex(_ query: StaySearchQuery) -> Endpoint<StayFlexResult> {
            Endpoint(method: .post, path: "/api/stays/flex", body: query, timeout: Timeouts.live)
        }
    }

    /// Plan / AI contract (docs/api-search.md section 4).
    enum AI {
        /// Always 200. Call on launch, after sign-in/out and after connect/disconnect.
        static var status: Endpoint<AIStatus> {
            Endpoint(method: .get, path: "/api/ai/status")
        }

        static func start(_ provider: AIProvider) -> Endpoint<AISignInStart> {
            Endpoint(method: .post, path: "/api/ai/\(provider.rawValue)/start")
        }

        static func complete(_ provider: AIProvider, callback: String) -> Endpoint<AIConnected> {
            Endpoint(method: .post, path: "/api/ai/\(provider.rawValue)/complete",
                     body: AISignInComplete(callback: String(callback.trimmingCharacters(in: .whitespacesAndNewlines).prefix(4000))))
        }

        static func logout(_ provider: AIProvider) -> Endpoint<AIDisconnected> {
            Endpoint(method: .post, path: "/api/ai/\(provider.rawValue)/logout")
        }

        /// NDJSON: consume with `APIClient.stream(_:)`, not `send`.
        static func canvas(_ request: CanvasRequest) -> Endpoint<CanvasEvent> {
            Endpoint(method: .post, path: "/api/ai/canvas", body: request, timeout: Timeouts.ai)
        }
    }
}
