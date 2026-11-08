import SwiftUI

/// Blackletter buttons. One `.primary` (or `.accent`) per screen; `.ghost` next to it;
/// `.quiet` for text links. Usage: `Button("Search") { … }.buttonStyle(.lodestar(.primary))`.
struct LodestarButtonStyle: ButtonStyle {
    enum Kind: Sendable {
        /// Ink fill, canvas text: the brightest thing on screen.
        case primary
        /// Blue fill, for the single most important action (sign up, connect).
        case accent
        /// Elevated fill, strong hairline.
        case ghost
        /// Canvas fill, strong hairline.
        case outline
        /// No fill, charcoal text.
        case quiet
        /// No fill, accent text (inline links).
        case link
        /// Ghost shape with danger text, for destructive confirmations.
        case destructive
    }

    var kind: Kind = .primary
    var small = false
    var fullWidth = false
    var isLoading = false

    func makeBody(configuration: Configuration) -> some View {
        StyledButton(configuration: configuration, kind: kind, small: small, fullWidth: fullWidth, isLoading: isLoading)
    }
}

private struct StyledButton: View {
    let configuration: ButtonStyleConfiguration
    let kind: LodestarButtonStyle.Kind
    let small: Bool
    let fullWidth: Bool
    let isLoading: Bool
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let pressed = configuration.isPressed
        HStack(spacing: Spacing.sm) {
            if isLoading { Spinner(color: foreground(pressed: pressed)) }
            configuration.label
        }
        .textStyle(small ? .buttonSmall : .button)
        .foregroundStyle(foreground(pressed: pressed))
        .padding(.horizontal, hasChrome ? Spacing.lg : 0)
        .frame(minHeight: hasChrome ? (small ? Sizes.buttonSmall : Sizes.button) : nil)
        .frame(maxWidth: fullWidth ? .infinity : nil)
        .background(background(pressed: pressed), in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay {
            if let border = border(pressed: pressed) {
                RoundedRectangle(cornerRadius: Radius.md).strokeBorder(border, lineWidth: Sizes.hairline)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: Radius.md))
        .opacity(isEnabled ? 1 : 0.4)
        .animation(Motion.fast, value: pressed)
    }

    private var hasChrome: Bool { kind != .quiet && kind != .link }

    private func foreground(pressed: Bool) -> Color {
        switch kind {
        case .primary: .primaryOn
        case .accent: .accentOn
        case .ghost, .outline: .ink
        case .quiet: pressed ? .ink : .charcoal
        case .link: pressed ? .accentPressed : .accent
        case .destructive: .danger
        }
    }

    private func background(pressed: Bool) -> Color {
        switch kind {
        case .primary: pressed ? .primaryPressed : .primaryFill
        case .accent: pressed ? .accentPressed : .accent
        case .ghost, .destructive: .elevated
        case .outline: pressed ? .pressedFill : .canvas
        case .quiet, .link: .clear
        }
    }

    private func border(pressed: Bool) -> Color? {
        switch kind {
        case .ghost, .outline, .destructive: pressed ? .hairlineHover : .hairlineStrong
        case .primary, .accent, .quiet, .link: nil
        }
    }
}

extension ButtonStyle where Self == LodestarButtonStyle {
    static func lodestar(_ kind: LodestarButtonStyle.Kind, small: Bool = false, fullWidth: Bool = false,
                         isLoading: Bool = false) -> LodestarButtonStyle {
        LodestarButtonStyle(kind: kind, small: small, fullWidth: fullWidth, isLoading: isLoading)
    }
}

/// A square icon button with the ghost look (close, menu, share).
struct IconButton: View {
    let systemName: String
    let accessibilityLabel: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .medium))
                .frame(width: Sizes.button, height: Sizes.button)
        }
        .buttonStyle(IconButtonStyle())
        .accessibilityLabel(accessibilityLabel)
    }
}

private struct IconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(configuration.isPressed ? Color.ink : Color.charcoal)
            .background(configuration.isPressed ? Color.pressedFill : Color.clear,
                        in: RoundedRectangle(cornerRadius: Radius.md))
            .contentShape(Rectangle())
    }
}
