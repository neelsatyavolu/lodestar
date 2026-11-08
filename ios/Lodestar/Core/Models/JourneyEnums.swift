import Foundation

/// What a trip item is.
enum ItemKind: String, LenientEnum {
    case flight, stay, dining, activity, transport, note, unknown
    static let unknownCase = ItemKind.unknown
}

enum ItemStatus: String, LenientEnum {
    case booked, planned, suggested, cancelled, unknown
    static let unknownCase = ItemStatus.unknown

    /// Not cancelled and not suggested.
    var isLive: Bool { self == .booked || self == .planned }
}

/// Where a record came from.
enum RecordSource: String, LenientEnum {
    case manual, email, flint, wanderlog, ai, agent, unknown
    static let unknownCase = RecordSource.unknown
}

enum TripType: String, LenientEnum {
    case city, beach, road, family, adventure, ski, business, other, unknown
    static let unknownCase = TripType.unknown

    var label: String {
        switch self {
        case .city: "City break"
        case .beach: "Beach"
        case .road: "Road trip"
        case .family: "Family"
        case .adventure: "Adventure"
        case .ski: "Ski"
        case .business: "Work"
        case .other, .unknown: "Something else"
        }
    }
}

enum CostCategory: String, LenientEnum {
    case flights, stays, transport, dining, activities, other, unknown
    static let unknownCase = CostCategory.unknown

    var label: String {
        switch self {
        case .flights: "Flights"
        case .stays: "Stays"
        case .transport: "Getting around"
        case .dining: "Food and drink"
        case .activities: "Activities"
        case .other, .unknown: "Other"
        }
    }
}

enum Meal: String, LenientEnum {
    case breakfast, lunch, dinner, unknown
    static let unknownCase = Meal.unknown
}

/// Which part of a trip `generate` drafts.
enum PlanPart: String, LenientEnum {
    case itinerary
    case toBook = "to_book"
    case checklist, notes, budget
    case unknown
    static let unknownCase = PlanPart.unknown
}

enum MailState: String, LenientEnum {
    case parsed
    case needsAI = "needs_ai"
    case failed, ignored, unknown
    static let unknownCase = MailState.unknown
}

enum PlaceKind: String, LenientEnum {
    case dining, stay, activity, unknown
    static let unknownCase = PlaceKind.unknown
}

enum GrantKind: String, LenientEnum {
    case oauth, personal, unknown
    static let unknownCase = GrantKind.unknown
}
