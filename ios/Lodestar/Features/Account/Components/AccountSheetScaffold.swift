import SwiftUI

/// The web's Dialog on iOS: a fixed header (16 pt medium title, close button), a scrolling
/// body and an optional fixed footer, separated by hairlines, on the card fill.
struct AccountSheetScaffold<Content: View, Footer: View>: View {
    let title: String
    var onClose: () -> Void
    @ViewBuilder var content: () -> Content
    @ViewBuilder var footer: () -> Footer

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(title)
                    .font(Font.geist(.sansMedium, size: 16, relativeTo: .headline))
                    .foregroundStyle(Color.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                IconButton(systemName: "xmark", accessibilityLabel: "Close", action: onClose)
            }
            .padding(.leading, Sizes.sheetPadding)
            .padding(.trailing, Spacing.sm)
            .padding(.vertical, Spacing.xs)
            Hairline()
            ScrollView {
                content()
                    .padding(Sizes.sheetPadding)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDismissesKeyboard(.interactively)
            if Footer.self != EmptyView.self {
                Hairline()
                footer()
                    .padding(.horizontal, Sizes.sheetPadding)
                    .padding(.vertical, Spacing.lg)
            }
        }
        .background(Color.card)
    }
}

extension AccountSheetScaffold where Footer == EmptyView {
    init(title: String, onClose: @escaping () -> Void, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, onClose: onClose, content: content, footer: { EmptyView() })
    }
}

/// A preferences section: hairline above (except the first), a 13 pt medium title, then content.
struct AccountFormSection<Content: View>: View {
    let title: String
    var isFirst = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if !isFirst { Hairline().padding(.bottom, Spacing.sm) }
            Text(title)
                .font(Font.geist(.sansMedium, size: 13, relativeTo: .subheadline))
                .foregroundStyle(Color.ink)
                .accessibilityAddTraits(.isHeader)
            content()
        }
    }
}

/// A 12 pt charcoal field label (the web's `legend`).
struct AccountFieldLabel: View {
    let text: String

    var body: some View {
        Text(text).textStyle(.label).foregroundStyle(Color.charcoal)
    }
}
