import Foundation

struct LatLng: Codable, Hashable, Sendable {
    let lat: Double
    let lng: Double
}

/// `data` of `GET /api/places/search`.
struct PlaceSearchResult: Codable, Hashable, Sendable {
    let suggestions: [PlaceSuggestion]
    let provider: Provider

    enum Provider: String, LenientEnum {
        case google, osm, unknown
        static let unknownCase = Provider.unknown
    }
}

struct PlaceSuggestion: Codable, Hashable, Sendable, Identifiable {
    /// "g:<id>" (Google: location and address are nil) or "osm:<type><id>" (carries a location).
    let id: String
    let name: String
    let secondary: String
    let category: String?
    let kind: PlaceKind
    let location: LatLng?
    let address: String?

    var isGoogle: Bool { id.hasPrefix("g:") }
}

/// `data` of `GET /api/places/details`.
struct PlaceDetailsResponse: Codable, Hashable, Sendable {
    let place: PlaceDetails
}

struct PlaceDetails: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
    let address: String?
    let location: LatLng?
    let category: String?
    let kind: PlaceKind
    let rating: Double?
    let ratingCount: Int?
    let priceLevel: String?
    let phone: String?
    let website: String?
    let mapsUrl: String
    let openNow: Bool?
    /// Up to 7, Monday first.
    let hours: [String]
    let summary: String?
    /// Opaque photo names for `API.Places.photoPath(name:width:)`.
    let photos: [String]
}
