import Foundation

/// A saved Plan shortlist with fare alerts (`/api/trips`, "Watching fares" in the UI).
struct SavedTrip: Codable, Hashable, Sendable, Identifiable {
    let id: String
    /// "SFO → MAA · Dec 7 – Dec 20" (Geist Mono).
    let title: String
    let prompt: String
    let savedPrice: Double
    let lastPrice: Double?
    let checkedAt: EpochMillis?
    let alertDrop: Bool
    let targetPrice: Double?
    let targetHit: Bool
    let remindOn: LocalDate?
    let reminded: Bool
    /// Earliest departure (the booked flight's once booked).
    let firstDepart: LocalDate
    let createdAt: EpochMillis
    let booking: FareBooking?
}

/// The fare the traveller bought. `tfs` must be one of the trip's saved options.
struct FareBooking: Codable, Hashable, Sendable {
    let tfs: String
    let seller: String
    let isAirline: Bool
    let fare: String?
    /// > 0.
    let paid: Double
    let changes: ChangePolicy?
    let refunds: RefundPolicy?

    init(tfs: String, seller: String, isAirline: Bool, fare: String?, paid: Double,
         changes: ChangePolicy?, refunds: RefundPolicy?) {
        self.tfs = tfs
        self.seller = seller
        self.isAirline = isAirline
        self.fare = fare
        self.paid = paid
        self.changes = changes == .unknown ? nil : changes
        self.refunds = refunds == .unknown ? nil : refunds
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(tfs, forKey: .tfs)
        try c.encode(seller, forKey: .seller)
        try c.encode(isAirline, forKey: .isAirline)
        try c.encode(fare, forKey: .fare)
        try c.encode(paid, forKey: .paid)
        try c.encode(changes, forKey: .changes)
        try c.encode(refunds, forKey: .refunds)
    }
}

struct SavedTripList: Codable, Hashable, Sendable {
    let trips: [SavedTrip]
}

struct SavedTripResponse: Codable, Hashable, Sendable {
    let trip: SavedTrip
}

/// `data` of `GET /api/trips/:id`.
struct SnapshotResponse: Codable, Hashable, Sendable {
    let snapshot: Snapshot
}

/// The saved shortlist, as the Plan screen had it.
struct Snapshot: Codable, Hashable, Sendable {
    let prompt: String
    let plan: TripPlan
    let canvas: Canvas
    let options: [String: CanvasOption]
    let hacks: [CanvasHack]
    /// Per planned search, in order.
    let searches: [SearchProgress]

    init(prompt: String, plan: TripPlan, canvas: Canvas, options: [String: CanvasOption],
         hacks: [CanvasHack], searches: [SearchProgress]) {
        self.prompt = prompt
        self.plan = plan
        self.canvas = canvas
        self.options = options
        self.hacks = hacks
        self.searches = searches
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        prompt = try c.decodeIfPresent(String.self, forKey: .prompt) ?? ""
        plan = try c.decode(TripPlan.self, forKey: .plan)
        canvas = try c.decode(Canvas.self, forKey: .canvas)
        // Stored as the client sent them: skip any option or hack that no longer decodes.
        let rawOptions = try c.decodeIfPresent([String: Lossy<CanvasOption>].self, forKey: .options) ?? [:]
        options = rawOptions.compactMapValues(\.value)
        hacks = (try c.decodeIfPresent([Lossy<CanvasHack>].self, forKey: .hacks) ?? []).compactMap(\.value)
        searches = (try c.decodeIfPresent([Lossy<SearchProgress>].self, forKey: .searches) ?? []).compactMap(\.value)
    }
}

/// Body of `POST /api/trips` (save a Plan shortlist). Cap 400,000 bytes.
struct SaveTripRequest: Encodable, Sendable {
    let snapshot: Snapshot
    /// = snapshot.plan.searches (1...5).
    let searches: [PlannedSearch]
    let filters: SearchFilters?
    /// Min of done searches' cheapest > 0, else min option price.
    let price: Double
}

/// Body of `PATCH /api/trips/:id` (at least one field).
struct SavedTripPatch: Encodable, Sendable {
    var alertDrop: Bool?
    var targetPrice: Double??
    var remindOn: LocalDate??

    enum CodingKeys: String, CodingKey { case alertDrop, targetPrice, remindOn }

    var isEmpty: Bool { alertDrop == nil && targetPrice == nil && remindOn == nil }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(alertDrop, forKey: .alertDrop)
        try c.encodePatch(targetPrice, forKey: .targetPrice)
        try c.encodePatch(remindOn, forKey: .remindOn)
    }
}

/// Decodes a value or nil instead of failing the whole collection.
struct Lossy<T: Decodable & Sendable>: Decodable, Sendable {
    let value: T?

    init(from decoder: any Decoder) throws {
        value = try? T(from: decoder)
    }
}
