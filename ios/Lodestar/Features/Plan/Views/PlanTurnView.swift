import SwiftUI

/// One turn, top to bottom: the prompt, the searches box, status, error, then the canvas
/// with its picks (each a real itinerary card), hacks, tips and follow-ups (web `BoardView`).
struct PlanTurnView<Save: View>: View {
    let turn: PlanTurn
    let isLatest: Bool
    let checks: FlightSellerChecks
    let trustedOnly: Bool
    let onFollowup: (String) -> Void
    @ViewBuilder var save: () -> Save

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("You asked").textStyle(.caption).foregroundStyle(Color.ash)
                Text(turn.prompt).textStyle(.bodyMD).foregroundStyle(Color.bodyText)
            }
            if let plan = turn.plan, !plan.searches.isEmpty { searchesBox(plan) }
            if let status = turn.status {
                LoadingStateView(message: "\(status)…")
            }
            if let error = turn.error {
                InlineError(message: error).card()
            }
            if let canvas = turn.canvas { canvasView(canvas) }
        }
    }

    // MARK: - Searches

    private func searchesBox(_ plan: TripPlan) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if !plan.understanding.isEmpty {
                Text(plan.understanding).textStyle(.chip).foregroundStyle(Color.bodyText)
            }
            ForEach(Array(plan.searches.enumerated()), id: \.offset) { index, search in
                searchRow(search, progress: turn.searches.indices.contains(index) ? turn.searches[index] : nil)
            }
            if !plan.assumptions.isEmpty {
                Hairline()
                Text("Assumed: \(plan.assumptions.joined(separator: " · "))").textStyle(.caption).foregroundStyle(Color.ash)
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
    }

    private func searchRow(_ search: PlannedSearch, progress: SearchProgress?) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            stateIcon(progress?.state).frame(width: 14, height: 14).padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(search.label).textStyle(.chip).foregroundStyle(Color.ink)
                Text(PlanLogic.route(search)).textStyle(.codeSmall).foregroundStyle(Color.ash)
                if !search.why.isEmpty {
                    Text(search.why).textStyle(.caption).foregroundStyle(Color.ash)
                }
            }
            Spacer(minLength: Spacing.sm)
            Text(PlanLogic.outcome(progress)).textStyle(.caption).monospacedDigit().foregroundStyle(Color.mute)
                .lineLimit(1)
                .layoutPriority(1)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func stateIcon(_ state: SearchProgress.State?) -> some View {
        switch state {
        case .done: Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.ink)
        case .error: Image(systemName: "exclamationmark.circle").font(.system(size: 12)).foregroundStyle(Color.danger)
        case .running: Spinner(color: .charcoal, size: 12)
        default: Circle().strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline)
        }
    }

    // MARK: - Canvas

    private func canvasView(_ canvas: Canvas) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(canvas.headline)
                    .textStyle(turn.hasPicks ? .display : .headingMD)
                    .foregroundStyle(Color.ink)
                if !canvas.summary.isEmpty {
                    Text(canvas.summary).textStyle(.bodyLG).foregroundStyle(Color.bodyText)
                }
                save()
            }
            ForEach(turn.citedPicks, id: \.pick.ref) { cited in pickView(cited.pick, option: cited.option) }
            if let hacks = turn.result?.hacks, !hacks.isEmpty { hacksBox(hacks) }
            if !canvas.tips.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.xs + 2) {
                    ForEach(canvas.tips, id: \.self) { Text("— \($0)").textStyle(.chip).foregroundStyle(Color.mute) }
                }
            }
            if isLatest, !turn.isRunning, !canvas.followups.isEmpty {
                FlowLayout(spacing: Spacing.sm, lineSpacing: Spacing.sm) {
                    ForEach(canvas.followups, id: \.self) { followup in
                        Chip(title: followup, isOn: false) { onFollowup(followup) }
                    }
                }
            }
        }
    }

    private func pickView(_ pick: Pick, option: CanvasOption) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            FlowLayout(spacing: Spacing.sm, lineSpacing: Spacing.xs) {
                Pill(text: pick.tag.planLabel, style: pick.tag == .best ? .accent : .neutral)
                Text(pick.title).textStyle(.bodyMD).fontWeight(.medium).foregroundStyle(Color.ink)
                if let label = turn.searchLabel(for: option) {
                    Text("from \(label)").textStyle(.caption).foregroundStyle(Color.ash)
                }
            }
            whyText(pick)
            NavigationLink(value: option.itinerary) {
                ItineraryCardView(itinerary: option.itinerary, badges: [], state: checks.state(for: option.itinerary.id),
                                  trustedOnly: trustedOnly, nearby: [])
            }
            .buttonStyle(.plain)
        }
    }

    private func whyText(_ pick: Pick) -> some View {
        let why = Text(pick.why).foregroundStyle(Color.bodyText)
        let tradeoff = Text(pick.tradeoff.map { " Tradeoff: \($0)" } ?? "").foregroundStyle(Color.mute)
        return Text("\(why)\(tradeoff)").textStyle(.bodySM)
    }

    private func hacksBox(_ hacks: [CanvasHack]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Hacks the searches found").textStyle(.bodySM).foregroundStyle(Color.ink)
            ForEach(Array(hacks.enumerated()), id: \.offset) { _, item in
                let saving = Text(Money.saving(item.hack.saving)).foregroundStyle(Color.ink)
                let title = Text(item.hack.title).foregroundStyle(Color.bodyText)
                let rest = Text(" (\(item.search)). \(item.hack.detail)").foregroundStyle(Color.mute)
                Text("\(saving) \(title)\(rest)").textStyle(.chip).monospacedDigit()
            }
        }
        .card()
    }
}

extension Pick.Tag {
    /// "Best", "Cheapest", … (the web capitalises the tag).
    var planLabel: String { self == .unknown ? "Alternative" : rawValue.capitalized }
}
