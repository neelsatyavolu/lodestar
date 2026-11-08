import SwiftUI

/// Card surface: card fill, 1 pt strong hairline, 12 pt radius. `featured` uses the elevated
/// fill with an accent border (one per screen at most).
struct CardSurface: ViewModifier {
    var padding: CGFloat = Sizes.cardPadding
    var featured = false

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(featured ? Color.elevated : Color.card, in: RoundedRectangle(cornerRadius: Radius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(featured ? Color.accent : Color.hairlineStrong, lineWidth: Sizes.hairline)
            )
    }
}

extension View {
    func card(padding: CGFloat = Sizes.cardPadding, featured: Bool = false) -> some View {
        modifier(CardSurface(padding: padding, featured: featured))
    }
}

/// A container card with an optional title row.
struct Card<Content: View>: View {
    var title: String?
    var featured = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if let title {
                Text(title).textStyle(.bodyMD).foregroundStyle(Color.ink)
            }
            content()
        }
        .card(featured: featured)
    }
}

/// A 1 pt divider in the hairline color.
struct Hairline: View {
    var strong = false

    var body: some View {
        Rectangle()
            .fill(strong ? Color.hairlineStrong : Color.hairline)
            .frame(height: Sizes.hairline)
            .accessibilityHidden(true)
    }
}

/// A section header: title plus optional muted detail, used across tabs and sheets.
struct SectionHeader: View {
    let title: String
    var detail: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(title).textStyle(.headingSM).foregroundStyle(Color.ink)
            if let detail {
                Text(detail).textStyle(.bodySM).foregroundStyle(Color.mute)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// The serif hero that opens a screen: two lines, the second dimmer
/// ("Hotels too." / "Same sellers you can trust."), then an optional paragraph.
struct HeroTitle: View {
    let line1: String
    var line2: String?
    var paragraph: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            VStack(alignment: .leading, spacing: 0) {
                Text(line1).foregroundStyle(Color.ink)
                if let line2 { Text(line2).foregroundStyle(Color.mute) }
            }
            .textStyle(.display)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            if let paragraph {
                Text(paragraph).textStyle(.bodyLG).foregroundStyle(Color.bodyText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
