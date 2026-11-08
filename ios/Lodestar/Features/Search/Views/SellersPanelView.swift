import SwiftUI

/// "Who sells this": the price insight, seller rows with trust tiers and fare tiles.
/// Unvetted agencies are hidden while "trusted only" is on (web `SellersPanel`).
struct SellersPanelView: View {
    let check: SellerCheck
    let trustedOnly: Bool

    @State private var showUnvetted: Bool
    @Environment(\.openURL) private var openURL

    init(check: SellerCheck, trustedOnly: Bool) {
        self.check = check
        self.trustedOnly = trustedOnly
        _showUnvetted = State(initialValue: !trustedOnly)
    }

    var body: some View {
        let shown = SellerCopy.visibleSellers(check, showUnvetted: showUnvetted)
        let hiddenCount = SellerCopy.unvettedCount(check)
        VStack(alignment: .leading, spacing: Spacing.md) {
            insight
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(shown.enumerated()), id: \.offset) { index, seller in
                    if index > 0 { Hairline() }
                    sellerRow(seller)
                }
                if shown.isEmpty {
                    Text(SellerCopy.noTrusted).textStyle(.bodySM).foregroundStyle(Color.mute).padding(.vertical, Spacing.md)
                }
            }
            if hiddenCount > 0 { unvettedToggle(count: hiddenCount) }
        }
    }

    @ViewBuilder private var insight: some View {
        if let text = SellerCopy.insight(check.insight) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                StatusDot(tone: text.tone == .ok ? .ok : text.tone == .danger ? .danger : .warn)
                Text("\(Text(text.lead ?? "").foregroundStyle(Color.ink))\(Text(text.rest).foregroundStyle(Color.bodyText))")
                    .textStyle(.chip)
            }
            .padding(Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairline, lineWidth: Sizes.hairline))
            .accessibilityElement(children: .combine)
        }
    }

    private func sellerRow(_ seller: VerifiedSeller) -> some View {
        let tiers = SellerCopy.hasFareTiers(seller)
        return VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(spacing: Spacing.md) {
                LogoView(path: seller.logo, name: seller.name, size: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(seller.name).textStyle(.bodySM).foregroundStyle(Color.ink).lineLimit(1)
                    StatusLabel(text: seller.tier.flightLabel, tone: StatusDot.Tone(tier: seller.tier))
                }
                Spacer(minLength: Spacing.sm)
                VStack(alignment: .trailing, spacing: 0) {
                    Text(Money.usd(seller.lowest)).textStyle(.bodyMD).monospacedDigit().foregroundStyle(Color.ink)
                    if tiers { Text("from").textStyle(.hint).foregroundStyle(Color.ash) }
                }
                .fixedSize()
                Button { book() } label: {
                    Label("Book", systemImage: "arrow.up.right")
                }
                .buttonStyle(.lodestar(.ghost, small: true))
                .accessibilityHint("Opens this exact itinerary on Google Flights, where you continue to \(seller.name)")
            }
            if tiers {
                ForEach(Array(seller.fares.enumerated()), id: \.offset) { _, fare in fareTile(fare) }
            }
        }
        .padding(.vertical, Spacing.md)
    }

    private func fareTile(_ fare: Fare) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text(fare.displayName).textStyle(.chip).foregroundStyle(Color.ink).lineLimit(1)
                Spacer()
                Text(Money.usd(fare.price)).textStyle(.chip).monospacedDigit().foregroundStyle(Color.ink)
                    .fixedSize()
            }
            SearchPolicyChips(chips: SellerCopy.policyChips(fare.policy))
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairline, lineWidth: Sizes.hairline))
        .padding(.leading, 40)
    }

    private func unvettedToggle(count: Int) -> some View {
        let copy = SellerCopy.showUnvetted(count: count, check: check)
        return Button { showUnvetted.toggle() } label: {
            if showUnvetted {
                Text(SellerCopy.hideUnvetted).foregroundStyle(Color.accent)
            } else {
                Text("\(Text(copy.label).foregroundStyle(Color.accent))\(Text(copy.detail ?? "").foregroundStyle(Color.ash))")
            }
        }
        .buttonStyle(.plain)
        .textStyle(.chip)
    }

    private func book() {
        if let url = URL(string: check.bookingURL) { openURL(url) }
    }
}

/// Policy chips that wrap onto new lines: ✓ ink, ✗ muted and struck through, — neutral grey.
private struct SearchPolicyChips: View {
    let chips: [FarePolicyChip]

    var body: some View {
        FlowLayout(spacing: Spacing.md, lineSpacing: Spacing.xs) {
            ForEach(chips, id: \.label) { chip in
                HStack(spacing: Spacing.xs) {
                    Image(systemName: chip.ok == nil ? "minus" : chip.ok == true ? "checkmark" : "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(chip.ok == true ? Color.ink : Color.ash)
                    Text(chip.label)
                        .strikethrough(chip.ok == false, color: Color.stone)
                        .foregroundStyle(chip.ok == nil ? Color.ash : chip.ok == true ? Color.bodyText : Color.mute)
                }
                .textStyle(.caption)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(chip.ok == false ? "No \(chip.label)" : chip.label)
            }
        }
    }
}
