import SwiftUI

/// Budget (`budget-tab.tsx`).
struct TripBudgetTab: View {
    let model: TripDetailModel

    @State private var label = ""
    @State private var amount = ""
    @State private var category: CostCategory = .other
    @State private var formError: String?
    @State private var adding = false

    var body: some View {
        let b = model.budget
        VStack(alignment: .leading, spacing: Spacing.lg) {
            SectionHeader(title: "Budget", detail: subtitle(b))
            if b.total == 0 {
                EmptyStateView(title: "No costs yet",
                               message: "Prices from your bookings add up here on their own. Your AI can estimate the rest: meals, activities, gas, fees.")
                aiButton(PlanPart.budget.draftAction)
            } else {
                table(b)
                Text(perPersonLine(b)).textStyle(.caption).foregroundStyle(Color.mute)
                aiButton("Re-estimate")
            }
            otherCosts(b)
            fromPlan
        }
    }

    private func subtitle(_ b: TripsBudget) -> String {
        guard !b.otherCurrencies.isEmpty else { return "In \(b.currency)." }
        return "In \(b.currency). Costs in \(b.otherCurrencies.joined(separator: ", ")) aren't counted."
    }

    private func perPersonLine(_ b: TripsBudget) -> String {
        if let each = b.perPerson, let n = model.journey.travelers {
            return "About \(Money.amount(each, currency: b.currency)) per person for \(n) travellers."
        }
        return "Set how many are going in Edit to see a per-person figure."
    }

    private func table(_ b: TripsBudget) -> some View {
        Grid(alignment: .leading, horizontalSpacing: Spacing.md, verticalSpacing: Spacing.sm) {
            GridRow {
                Text("Category"); Text("Paid"); Text("Estimated"); Text("Total")
            }
            .textStyle(.label).foregroundStyle(Color.ash)
            ForEach(b.lines) { line in
                GridRow {
                    Text(line.category.label).foregroundStyle(Color.ink)
                    money(line.paid, b.currency, estimate: false)
                    money(line.estimated, b.currency, estimate: true)
                    Text(Money.amount(line.total, currency: b.currency)).foregroundStyle(Color.ink)
                }
                .textStyle(.caption)
            }
            Divider().gridCellUnsizedAxes(.horizontal)
            GridRow {
                Text("All in").foregroundStyle(Color.ink)
                money(b.paid, b.currency, estimate: false)
                money(b.estimated, b.currency, estimate: true)
                Text(Money.amount(b.total, currency: b.currency)).foregroundStyle(Color.ink)
            }
            .textStyle(.bodySM)
        }
        .monospacedDigit()
        .card()
    }

    private func money(_ value: Double, _ currency: String, estimate: Bool) -> some View {
        Text(value == 0 ? "—" : (estimate ? "~" : "") + Money.amount(value, currency: currency)).foregroundStyle(Color.bodyText)
    }

    private func aiButton(_ title: String) -> some View {
        Button(title) { Task { await model.draft(.budget) } }
            .buttonStyle(.lodestar(.ghost, small: true, isLoading: model.drafter.running == .budget))
            .disabled(model.drafter.isBusy)
    }

    private func otherCosts(_ b: TripsBudget) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionHeader(title: "Other costs")
            ForEach(model.trip.costs) { cost in
                HStack(spacing: Spacing.sm) {
                    TripsCheckbox(isOn: cost.paid, label: "Paid: \(cost.label)") { Task { await model.setPaid(cost, !cost.paid) } }
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        Text(cost.label).textStyle(.bodySM).foregroundStyle(Color.ink)
                        Text(Self.costSource(cost)).textStyle(.caption).foregroundStyle(Color.mute)
                    }
                    Spacer()
                    Text((cost.paid ? "" : "~") + Money.amount(cost.amount, currency: cost.currency))
                        .textStyle(.bodySM).monospacedDigit().foregroundStyle(Color.ink)
                    IconButton(systemName: "trash", accessibilityLabel: "Delete \(cost.label)") { Task { await model.deleteCost(cost.id) } }
                        .frame(width: 32, height: 32)
                }
            }
            addForm
        }
    }

    private var addForm: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            LodestarField(label: "Add a cost", text: $label, placeholder: "Gas, tips, resort fee")
            HStack(spacing: Spacing.sm) {
                Picker("Category", selection: $category) {
                    ForEach(CostCategory.knownCases, id: \.self) { Text($0.label).tag($0) }
                }
                .tint(Color.ink)
                LodestarField(label: "", text: $amount, placeholder: "Amount", keyboard: .decimalPad)
                Button("Add") {
                    adding = true
                    Task {
                        formError = await model.addCost(label: label, amount: amount, category: category)
                        if formError == nil { label = ""; amount = "" }
                        adding = false
                    }
                }
                .buttonStyle(.lodestar(.ghost, small: true, isLoading: adding))
                .disabled(adding)
            }
            if let formError { InlineError(message: formError) }
        }
    }

    @ViewBuilder private var fromPlan: some View {
        let priced = model.trip.items.compactMap { item in TripsBudget.entry(for: item).map { (item, $0) } }
        if !priced.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                SectionHeader(title: "From your plan")
                ForEach(priced, id: \.0.id) { item, entry in
                    HStack {
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            Text(item.title).textStyle(.bodySM).foregroundStyle(Color.ink)
                            Text("\(TripsBudget.category(of: item.kind).label) · \(entry.paid ? "paid" : "estimate")")
                                .textStyle(.caption).foregroundStyle(Color.mute)
                        }
                        Spacer()
                        Text((entry.paid ? "" : "~") + Money.amount(entry.amount, currency: item.details.currencyCode))
                            .textStyle(.bodySM).monospacedDigit().foregroundStyle(Color.bodyText)
                    }
                }
            }
        }
    }

    /// "Food and drink · AI estimate" / "· added by an agent".
    nonisolated static func costSource(_ cost: TripCost) -> String {
        let label = cost.category == .unknown ? CostCategory.other.label : cost.category.label
        switch cost.source {
        case .ai: return "\(label) · AI estimate"
        case .agent: return "\(label) · added by an agent"
        default: return label
        }
    }
}
