import SwiftUI

/// Bundled faces (PostScript names). Registered through `UIAppFonts` in Info.plist.
enum FontFace: String, CaseIterable {
    case sans = "Geist-Regular"
    case sansMedium = "Geist-Medium"
    case sansSemibold = "Geist-SemiBold"
    case mono = "GeistMono-Regular"
    case monoMedium = "GeistMono-Medium"
    /// Newsreader: what people read (heroes, trip and hotel names). Has optical sizes per weight file.
    case serif = "Newsreader-Regular"
    case serifMedium = "Newsreader-Medium"
}

/// Ink & Instrument type scale (~/DESIGN.md v3: Newsreader display, Geist UI, Geist Mono numbers). Apply with `.textStyle(_:)`, which sets
/// the font (Dynamic Type aware), tracking and line spacing together.
enum TextStyle: CaseIterable {
    case displayXXL, displayXL, display, displayLG
    /// Newsreader 22: a hotel's or trip's name inside a card.
    case headline
    case headingMD, headingSM, subtitle
    case bodyLG, bodyMD, bodySM
    case button, buttonSmall, chip, label, caption, hint
    case code, codeSmall

    var face: FontFace {
        switch self {
        case .displayXXL, .displayXL, .display, .headline: .serif
        case .headingMD, .headingSM, .button, .buttonSmall: .sansMedium
        case .code, .codeSmall: .mono
        default: .sans
        }
    }

    var size: CGFloat {
        switch self {
        case .displayXXL: 72
        case .displayXL: 56
        case .display: 44
        case .displayLG: 48
        case .headline: 22
        case .headingMD: 22
        case .headingSM: 18
        case .subtitle: 19
        case .bodyLG: 17
        case .bodyMD: 15
        case .bodySM: 14
        case .button: 14
        case .buttonSmall: 13
        case .chip: 13
        case .label, .caption: 12
        case .hint: 11
        case .code: 13
        case .codeSmall: 12
        }
    }

    /// Line height as a multiple of the size (CSS `line-height`).
    var lineHeight: CGFloat {
        switch self {
        case .displayXXL, .displayXL, .display: 1.04
        case .displayLG: 1.1
        case .headline: 1.2
        case .headingMD: 1.4
        case .headingSM: 1.35
        case .subtitle: 1.45
        case .bodyLG: 1.6
        case .bodyMD: 1.55
        case .bodySM: 1.45
        case .button, .buttonSmall: 1.43
        case .code, .codeSmall: 1.65
        default: 1.5
        }
    }

    /// Tracking in em.
    var trackingEm: CGFloat {
        switch self {
        case .displayXXL, .displayXL, .display: -0.015
        case .displayLG: -0.04
        case .headingMD: -0.01
        default: 0
        }
    }

    var relativeTo: Font.TextStyle {
        switch self {
        case .displayXXL, .displayXL, .display, .displayLG: .largeTitle
        case .headingMD, .headline: .title2
        case .headingSM, .subtitle: .title3
        case .bodyLG: .body
        case .bodyMD, .bodySM, .button, .buttonSmall, .chip: .callout
        case .label, .caption, .codeSmall: .caption
        case .hint: .caption2
        case .code: .footnote
        }
    }

    var font: Font { .custom(face.rawValue, size: size, relativeTo: relativeTo) }
    var tracking: CGFloat { trackingEm * size }
    var lineSpacing: CGFloat { max(0, (lineHeight - 1.15) * size) }
}

extension Font {
    /// A bundled face at a fixed design size that still scales with Dynamic Type.
    static func geist(_ face: FontFace, size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(face.rawValue, size: size, relativeTo: style)
    }
}

private struct TextStyleModifier: ViewModifier {
    let style: TextStyle

    func body(content: Content) -> some View {
        content
            .font(style.font)
            .tracking(style.tracking)
            .lineSpacing(style.lineSpacing)
    }
}

extension View {
    /// Applies an Ink & Instrument type style. Numbers that line up should also get `.monospacedDigit()`.
    func textStyle(_ style: TextStyle) -> some View {
        modifier(TextStyleModifier(style: style))
    }
}
