import SwiftUI

/// 4 pt base spacing scale.
enum Spacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    static let xxxl: CGFloat = 48
    static let section: CGFloat = 96
    static let band: CGFloat = 128
    /// Phone side gutter.
    static let gutter: CGFloat = 16
}

/// Ink & Instrument radii: 4 pt controls, 6 pt cards and panels; nothing above 6 except pills.
enum Radius {
    static let xs: CGFloat = 2
    /// Focus ring corners.
    static let sm: CGFloat = 4
    /// Buttons, inputs, selects, logos.
    static let md: CGFloat = 4
    /// Cards.
    static let lg: CGFloat = 6
    /// Panels inside sheets.
    static let xl: CGFloat = 6
}

/// Control sizes (iOS touch sizes where the web is smaller).
enum Sizes {
    static let button: CGFloat = 44
    static let buttonSmall: CGFloat = 32
    static let input: CGFloat = 48
    static let chip: CGFloat = 40
    static let statusDot: CGFloat = 8
    static let statusDotInPill: CGFloat = 6
    static let hairline: CGFloat = 1
    static let cardPadding: CGFloat = 16
    static let featureCardPadding: CGFloat = 32
    static let sheetPadding: CGFloat = 20
}

/// Motion tokens. Every animation should go through these so Reduce Motion is honored.
enum Motion {
    /// cubic-bezier(0.2, 0, 0, 1)
    static func ease(_ duration: Double) -> Animation {
        .timingCurve(0.2, 0, 0, 1, duration: duration)
    }

    static let fast = ease(0.15)
    static let enter = ease(0.25)
    static let stagger: Double = 0.04
}

private struct RiseModifier: ViewModifier {
    let delay: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 8)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(Motion.enter.delay(delay)) { shown = true }
            }
    }
}

extension View {
    /// Enter with an 8 pt rise and fade (250 ms). Stagger lists with `index * Motion.stagger`.
    func rise(delay: Double = 0) -> some View {
        modifier(RiseModifier(delay: delay))
    }

    /// The standard screen background.
    func canvasBackground() -> some View {
        background(Color.canvas.ignoresSafeArea())
    }
}
