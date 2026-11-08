import Foundation

/// One priced fare from Google Flights (`lib/types.ts`). Codable both ways because
/// Plan snapshots send itineraries back to the server as they came.
struct Itinerary: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let price: Double
    let currency: String
    /// One slice for one-way, two (outbound, return) for a round trip.
    let slices: [FlightSlice]
    let bookingURL: String
    /// Google's itinerary token. nil means the seller check is impossible.
    let tfs: String?

    enum CodingKeys: String, CodingKey {
        case id, price, currency, slices, tfs
        case bookingURL = "booking_url"
    }

    var isRoundTrip: Bool { slices.count > 1 }
    var totalMinutes: Int { slices.reduce(0) { $0 + $1.minutes } }
    var isNonstop: Bool { slices.allSatisfy { $0.stops == 0 } }
    var hasSelfTransfer: Bool { slices.contains(where: \.selfTransfer) }

    /// Unique marketing airlines across every leg, first appearance first.
    var airlines: [AirlineRef] {
        var seen = Set<String>()
        return slices.flatMap(\.legs).map(\.airline).filter { seen.insert($0.code).inserted }
    }
}

struct FlightSlice: Codable, Hashable, Sendable {
    let minutes: Int
    let stops: Int
    let legs: [FlightLeg]
    /// `layovers[i]` sits between `legs[i]` and `legs[i+1]`.
    let layovers: [Layover]
    let selfTransfer: Bool
    let co2Kg: Int?
    let co2DeltaPct: Int?

    enum CodingKeys: String, CodingKey {
        case minutes, stops, legs, layovers
        case selfTransfer = "self_transfer"
        case co2Kg = "co2_kg"
        case co2DeltaPct = "co2_delta_pct"
    }

    var origin: String? { legs.first?.from }
    var destination: String? { legs.last?.to }
    /// Naive local departure of the first leg.
    var depart: String? { legs.first?.depart }
    var arrive: String? { legs.last?.arrive }
}

struct FlightLeg: Codable, Hashable, Sendable {
    let from: String
    let fromName: String?
    let to: String
    let toName: String?
    /// Naive local ISO datetime at the departure airport, e.g. "2026-11-26T08:15:00".
    /// Never convert time zones; format with `FlightTime`.
    let depart: String
    /// Naive local ISO datetime at the arrival airport.
    let arrive: String
    let minutes: Int
    let airline: AirlineRef
    let operating: AirlineRef?
    /// Digits only; show as "\(airline.code) \(flightNumber)".
    let flightNumber: String
    let aircraft: String?
    let legroom: String?
    let overnight: Bool
    let amenities: Amenities?

    enum CodingKeys: String, CodingKey {
        case from, to, depart, arrive, minutes, airline, operating, aircraft, legroom, overnight, amenities
        case fromName = "from_name"
        case toName = "to_name"
        case flightNumber = "flight_number"
    }

    var flightCode: String { "\(airline.code) \(flightNumber)" }
    var isOperatedByOther: Bool { operating.map { $0.code != airline.code } ?? false }
}

/// `{code, name}`. `name` is fli's raw name; show `displayName` (applies `AirlineNames`).
struct AirlineRef: Codable, Hashable, Sendable {
    let code: String
    let name: String

    var displayName: String { AirlineNames.display(code: code, fallback: name) }
}

/// Tri-state amenities: nil means unknown. Decoded leniently; unknown keys are ignored.
struct Amenities: Codable, Hashable, Sendable {
    var wifi: Bool?
    var power: Bool?
    var usbPower: Bool?
    var inSeatVideo: Bool?
    var onDemandVideo: Bool?
    var legroomRating: Int?
    var wifiTier: String?
    var powerType: String?
    var videoType: String?
    var seatQuality: String?
    var legroomInches: Double?

    enum CodingKeys: String, CodingKey {
        case wifi, power
        case usbPower = "usb_power"
        case inSeatVideo = "in_seat_video"
        case onDemandVideo = "on_demand_video"
        case legroomRating = "legroom_rating"
        case wifiTier = "wifi_tier"
        case powerType = "power_type"
        case videoType = "video_type"
        case seatQuality = "seat_quality"
        case legroomInches = "legroom_inches"
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        wifi = try? c.decodeIfPresent(Bool.self, forKey: .wifi)
        power = try? c.decodeIfPresent(Bool.self, forKey: .power)
        usbPower = try? c.decodeIfPresent(Bool.self, forKey: .usbPower)
        inSeatVideo = try? c.decodeIfPresent(Bool.self, forKey: .inSeatVideo)
        onDemandVideo = try? c.decodeIfPresent(Bool.self, forKey: .onDemandVideo)
        legroomRating = try? c.decodeIfPresent(Int.self, forKey: .legroomRating)
        wifiTier = try? c.decodeIfPresent(String.self, forKey: .wifiTier)
        powerType = try? c.decodeIfPresent(String.self, forKey: .powerType)
        videoType = try? c.decodeIfPresent(String.self, forKey: .videoType)
        seatQuality = try? c.decodeIfPresent(String.self, forKey: .seatQuality)
        legroomInches = try? c.decodeIfPresent(Double.self, forKey: .legroomInches)
    }

    /// The web shows "Power" for `power || usb_power`.
    var hasPower: Bool { power == true || usbPower == true }
}

struct Layover: Codable, Hashable, Sendable {
    let airport: String?
    let city: String?
    let minutes: Int
    let overnight: Bool
    let changeOfAirport: Bool

    enum CodingKeys: String, CodingKey {
        case airport, city, minutes, overnight
        case changeOfAirport = "change_of_airport"
    }

    /// Under 60 minutes.
    var isTight: Bool { minutes < 60 }
    /// Gets a yellow dot: tight, overnight or a change of airport.
    var needsCaution: Bool { isTight || overnight || changeOfAirport }
}

/// fli's airline names are stale; the web overrides these (`lib/airlines.ts NAME_OVERRIDES`).
enum AirlineNames {
    static let overrides: [String: String] = [
        "AZ": "ITA Airways", "AA": "American", "UA": "United", "DL": "Delta", "WN": "Southwest",
        "B6": "JetBlue", "AS": "Alaska", "NK": "Spirit", "F9": "Frontier", "HA": "Hawaiian",
        "G4": "Allegiant", "SY": "Sun Country", "MX": "Breeze", "XP": "Avelo", "AC": "Air Canada",
        "WS": "WestJet", "BA": "British Airways", "VS": "Virgin Atlantic", "LH": "Lufthansa",
        "AF": "Air France", "KL": "KLM",
    ]

    static func display(code: String, fallback: String) -> String {
        overrides[code.uppercased()] ?? fallback
    }
}
