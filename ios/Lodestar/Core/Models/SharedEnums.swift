import Foundation

enum Cabin: String, LenientEnum {
    case economy = "ECONOMY"
    case premiumEconomy = "PREMIUM_ECONOMY"
    case business = "BUSINESS"
    case first = "FIRST"
    case unknown

    static let unknownCase = Cabin.unknown

    var label: String {
        switch self {
        case .economy: "Economy"
        case .premiumEconomy: "Premium economy"
        case .business: "Business"
        case .first: "First"
        case .unknown: "Economy"
        }
    }
}

/// Wire values are strings: "ANY", "0", "1", "2".
enum MaxStops: String, LenientEnum {
    case any = "ANY"
    case nonstop = "0"
    case oneOrFewer = "1"
    case twoOrFewer = "2"
    case unknown

    static let unknownCase = MaxStops.unknown

    var label: String {
        switch self {
        case .any, .unknown: "Any"
        case .nonstop: "Nonstop only"
        case .oneOrFewer: "1 stop or fewer"
        case .twoOrFewer: "2 stops or fewer"
        }
    }
}

enum Alliance: String, LenientEnum {
    case starAlliance = "STAR_ALLIANCE"
    case oneworld = "ONEWORLD"
    case skyteam = "SKYTEAM"
    case unknown

    static let unknownCase = Alliance.unknown

    var label: String {
        switch self {
        case .starAlliance: "Star Alliance"
        case .oneworld: "oneworld"
        case .skyteam: "SkyTeam"
        case .unknown: "Alliance"
        }
    }
}

/// Seller trust. For Stays, `.airline` means the hotel's own site ("Hotel direct").
enum SellerTier: String, LenientEnum {
    case airline
    case trusted
    case unvetted
    case unknown

    static let unknownCase = SellerTier.unknown

    var flightLabel: String {
        switch self {
        case .airline: "Airline direct"
        case .trusted: "Trusted agency"
        case .unvetted, .unknown: "Not vetted"
        }
    }

    var stayLabel: String {
        switch self {
        case .airline: "Hotel direct"
        case .trusted: "Trusted agency"
        case .unvetted, .unknown: "Not vetted"
        }
    }

    /// Green for airline and trusted, yellow otherwise.
    var isTrusted: Bool { self == .airline || self == .trusted }
}

/// The user's own AI subscription. Display: codex -> "ChatGPT", grok -> "Grok".
enum AIProvider: String, LenientEnum {
    case codex
    case grok
    case unknown

    static let unknownCase = AIProvider.unknown

    var displayName: String {
        switch self {
        case .codex: "ChatGPT"
        case .grok: "Grok"
        case .unknown: "AI"
        }
    }

    /// The loopback port the provider's OAuth client redirects to.
    var loopbackPort: UInt16? {
        switch self {
        case .codex: 1455
        case .grok: 56121
        case .unknown: nil
        }
    }
}
