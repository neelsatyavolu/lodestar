import Foundation
@testable import Lodestar

/// Builds trip items without JSON for the logic tests.
enum TripsMake {
    static func item(
        _ id: String,
        kind: ItemKind = .activity,
        status: ItemStatus = .planned,
        title: String? = nil,
        day: String,
        time: String? = nil,
        end: String? = nil,
        endTime: String? = nil,
        details: ItemDetails = ItemDetails(),
        journeyId: String? = "j1"
    ) -> TripItem {
        TripItem(id: id, journeyId: journeyId, kind: kind, status: status, title: title ?? id, startDate: date(day),
                 startTime: time, endDate: end.map(date), endTime: endTime, place: nil, confirmation: nil,
                 details: details, source: .manual, dedupeKey: nil, updatedAt: 0)
    }

    static func details(_ build: (inout ItemDetails) -> Void) -> ItemDetails {
        var d = ItemDetails()
        build(&d)
        return d
    }

    static func journey(id: String = "j1", start: String? = "2026-11-20", end: String? = "2026-11-24", travelers: Int? = 2) -> Journey {
        Journey(id: id, title: "Lisbon, Nov 2026", destination: "Lisbon", startDate: start.map(date), endDate: end.map(date),
                travelers: travelers, tripType: .city, shareToken: nil, source: .manual, createdAt: 0)
    }

    static func cost(_ id: String, _ amount: Double, currency: String = "USD", category: CostCategory = .other, paid: Bool = false) -> TripCost {
        TripCost(id: id, journeyId: "j1", label: id, amount: amount, currency: currency, category: category, paid: paid, source: .manual)
    }

    static func savedTrip(lastPrice: Double? = nil, booking: FareBooking? = nil, targetPrice: Double? = nil, checkedAt: EpochMillis? = nil) -> SavedTrip {
        SavedTrip(id: "s1", title: "SFO → MAA · Dec 7 – Dec 20", prompt: "Chennai in December", savedPrice: 1200, lastPrice: lastPrice,
                  checkedAt: checkedAt, alertDrop: true, targetPrice: targetPrice, targetHit: false, remindOn: nil, reminded: false,
                  firstDepart: date("2026-12-07"), createdAt: 0, booking: booking)
    }
}

/// Answers requests for one fake host with canned envelopes, recording what was sent.
final class TripsStubProtocol: URLProtocol, @unchecked Sendable {
    struct Reply: Sendable {
        let status: Int
        let body: String
    }

    typealias Handler = @Sendable (URLRequest, Data?) -> Reply

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handlers: [String: Handler] = [:]
    nonisolated(unsafe) private static var logs: [String: [String]] = [:]

    /// A client whose requests go to `handler`. Each call gets its own host, so suites can run in parallel.
    static func client(_ handler: @escaping Handler) -> (APIClient, host: String) {
        let host = "stub-\(UUID().uuidString.lowercased()).test"
        lock.withLock { handlers[host] = handler; logs[host] = [] }
        let client = APIClient(config: APIConfig(baseURL: URL(string: "https://\(host)")!), protocolClasses: [TripsStubProtocol.self])
        return (client, host)
    }

    /// "METHOD /path" for every request sent to the host, in order.
    static func log(_ host: String) -> [String] {
        lock.withLock { logs[host] ?? [] }
    }

    static func ok(_ data: String) -> Reply { Reply(status: 200, body: #"{"ok":true,"data":"# + data + "}") }
    static func fail(_ status: Int, _ message: String) -> Reply { Reply(status: status, body: #"{"ok":false,"error":"\#(message)"}"#) }

    override class func canInit(with request: URLRequest) -> Bool {
        guard let host = request.url?.host() else { return false }
        return lock.withLock { handlers[host] != nil }
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let host = request.url?.host() ?? ""
        let body = request.httpBody ?? request.httpBodyStream.map(Self.read)
        let handler = Self.lock.withLock { () -> Handler? in
            Self.logs[host, default: []].append("\(request.httpMethod ?? "GET") \(request.url?.path() ?? "")")
            return Self.handlers[host]
        }
        let reply = handler?(request, body) ?? Self.fail(500, "No stub.")
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}

/// JSON for a trip item, as the server sends it.
func tripsItemJSON(_ id: String, kind: String = "activity", status: String = "planned", day: String = "2026-11-21",
                   details: String = "{}", journeyId: String = "\"j1\"") -> String {
    #"{"id":"\#(id)","journeyId":\#(journeyId),"kind":"\#(kind)","status":"\#(status)","title":"\#(id)","startDate":"\#(day)","startTime":null,"endDate":null,"endTime":null,"place":null,"confirmation":null,"details":\#(details),"source":"manual","dedupeKey":null,"updatedAt":0}"#
}

/// JSON for a full trip.
func tripsDetailJSON(items: [String], tasks: String = "[]") -> String {
    #"{"id":"j1","title":"Lisbon","destination":"Lisbon","startDate":"2026-11-20","endDate":"2026-11-24","travelers":2,"tripType":"city","shareToken":null,"source":"manual","createdAt":0,"items":[\#(items.joined(separator: ","))],"tasks":\#(tasks),"notes":[],"costs":[]}"#
}
