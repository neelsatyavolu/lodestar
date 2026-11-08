import Foundation

/// Text for the Account tab.
enum AccountFormatting {
    /// "Member since November 2026", or nil without a creation time.
    static func memberSince(_ createdAt: EpochMillis?, timeZone: TimeZone = .current) -> String? {
        guard let createdAt else { return nil }
        var style = Date.FormatStyle(locale: Locale(identifier: "en_US"), timeZone: timeZone)
        style = style.month(.wide).year()
        return "Member since \(createdAt.asDate.formatted(style))"
    }

    /// One line under "Travel preferences": "From SFO, OAK · Economy · 1 adult · Star Alliance only".
    static func preferencesSummary(_ p: Preferences) -> String {
        var parts: [String] = []
        parts.append(p.homeAirports.isEmpty ? "No home airports" : "From \(p.homeAirports.joined(separator: ", "))")
        parts.append(p.cabin.label)
        parts.append(PreferenceRules.adultsLabel(p.adults))
        if p.bags > 0 { parts.append(PreferenceRules.bagsLabel(p.bags)) }
        if p.stops != .any { parts.append(p.stops.label) }
        parts += p.alliances.map { "\($0.label) only" }
        return parts.joined(separator: " · ")
    }

    /// "ChatGPT and Grok connected", "ChatGPT connected", or nil when nothing is.
    static func aiSummary(_ status: AIStatus) -> String? {
        let names = [AIProvider.codex, .grok].filter(status.isConnected).map(\.displayName)
        guard !names.isEmpty else { return nil }
        return "\(names.joined(separator: " and ")) connected"
    }
}
