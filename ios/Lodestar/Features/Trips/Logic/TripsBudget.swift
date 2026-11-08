import Foundation

/// One category row of the budget table.
struct TripsBudgetLine: Hashable, Sendable, Identifiable {
    let category: CostCategory
    let paid: Double
    let estimated: Double

    var id: CostCategory { category }
    var total: Double { paid + estimated }
}

/// The trip's budget (`budget()` in `lib/journeys/plan.ts`). Sums the most common currency;
/// entries in other currencies are named, not converted.
struct TripsBudget: Hashable, Sendable {
    let currency: String
    let lines: [TripsBudgetLine]
    let paid: Double
    let estimated: Double
    let perPerson: Double?
    let otherCurrencies: [String]

    var total: Double { paid + estimated }

    static let categoryOrder: [CostCategory] = [.flights, .stays, .transport, .dining, .activities, .other]

    static func category(of kind: ItemKind) -> CostCategory {
        switch kind {
        case .flight: .flights
        case .stay: .stays
        case .transport: .transport
        case .dining: .dining
        case .activity: .activities
        case .note, .unknown: .other
        }
    }

    private struct Entry {
        let category: CostCategory
        let amount: Double
        let currency: String
        let paid: Bool
    }

    /// One budget entry an item contributes, or nil when it isn't priced (or isn't live).
    static func entry(for item: TripItem) -> (amount: Double, paid: Bool)? {
        guard item.isLive else { return nil }
        let d = item.details
        if item.status == .booked, let price = d.price { return (price, true) }
        if let estimate = d.estimate { return (estimate, false) }
        if item.status == .planned, let price = d.price { return (price, false) }
        return nil
    }

    init(items: [TripItem], costs: [TripCost], travelers: Int?) {
        var entries: [Entry] = items.compactMap { item in
            Self.entry(for: item).map {
                Entry(category: Self.category(of: item.kind), amount: $0.amount, currency: item.details.currencyCode, paid: $0.paid)
            }
        }
        entries += costs.map {
            Entry(category: $0.category == .unknown ? .other : $0.category, amount: $0.amount,
                  currency: $0.currency.uppercased(), paid: $0.paid)
        }

        // Most frequent currency; ties go to the first seen.
        var seen: [String] = []
        var counts: [String: Int] = [:]
        for e in entries {
            if counts[e.currency] == nil { seen.append(e.currency) }
            counts[e.currency, default: 0] += 1
        }
        let top = counts.values.max() ?? 0
        let main = seen.first { counts[$0] == top } ?? "USD"

        let inMain = entries.filter { $0.currency == main }
        let lines = Self.categoryOrder.compactMap { category -> TripsBudgetLine? in
            let mine = inMain.filter { $0.category == category }
            guard !mine.isEmpty else { return nil }
            return TripsBudgetLine(
                category: category,
                paid: mine.filter(\.paid).map(\.amount).reduce(0, +),
                estimated: mine.filter { !$0.paid }.map(\.amount).reduce(0, +)
            )
        }
        let paid = lines.map(\.paid).reduce(0, +)
        let estimated = lines.map(\.estimated).reduce(0, +)
        self.currency = main
        self.lines = lines
        self.paid = paid
        self.estimated = estimated
        if let travelers, travelers > 1 {
            self.perPerson = ((paid + estimated) / Double(travelers)).rounded()
        } else {
            self.perPerson = nil
        }
        self.otherCurrencies = seen.filter { $0 != main }
    }

    init(trip: TripDetail) {
        self.init(items: trip.items, costs: trip.costs, travelers: trip.journey.travelers)
    }
}
