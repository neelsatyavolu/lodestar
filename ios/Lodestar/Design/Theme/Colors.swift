import SwiftUI
import UIKit

/// Ink & Instrument color tokens (app/globals.css, v3). Each resolves per appearance: dark is the
/// warm off-black canvas, light is paper, following the system setting or the in-app override
/// (`ThemePreference`). Blue (`accent`) is the only color; `ok`, `warn`, `danger` are for status
/// (dots, the flight status line, error text). Never use them as buttons.
extension Color {
    static let canvas = Color(dark: 0x0E0E0D, light: 0xF7F5EF)
    static let card = Color(dark: 0x141413, light: 0xFBFAF6)
    static let elevated = Color(dark: 0x1A1A18, light: 0xEFECE4)
    /// Inset panels.
    static let deep = Color(dark: 0x090908, light: 0xEFECE4)

    static let ink = Color(dark: 0xF2F0EA, light: 0x16161A)
    /// Body text (long prose uses this, not ink).
    static let bodyText = Color(dark: 0xF2F0EA, darkAlpha: 0.86, light: 0x16161A, lightAlpha: 0.86)
    /// Field labels, secondary icons.
    static let charcoal = Color(dark: 0xF2F0EA, darkAlpha: 0.86, light: 0x16161A, lightAlpha: 0.86)
    static let mute = Color(dark: 0xF2F0EA, darkAlpha: 0.55, light: 0x16161A, lightAlpha: 0.64)
    /// Captions, counters.
    static let ash = Color(dark: 0xF2F0EA, darkAlpha: 0.55, light: 0x16161A, lightAlpha: 0.64)
    /// Disabled.
    static let stone = Color(dark: 0xF2F0EA, darkAlpha: 0.28, light: 0x16161A, lightAlpha: 0.28)

    static let hairline = Color(dark: 0xF2F0EA, darkAlpha: 0.08, light: 0x16161A, lightAlpha: 0.10)
    static let hairlineStrong = Color(dark: 0xF2F0EA, darkAlpha: 0.18, light: 0x16161A, lightAlpha: 0.22)
    static let hairlineHover = Color(dark: 0xF2F0EA, darkAlpha: 0.42, light: 0x16161A, lightAlpha: 0.50)
    /// Pressed row / selected segment fill (the web's `hover`).
    static let pressedFill = Color(dark: 0x1A1A18, light: 0xEFECE4)

    /// Primary button fill: ink on canvas, inverted in light mode.
    static let primaryFill = Color(dark: 0xF2F0EA, light: 0x16161A)
    static let primaryOn = Color(dark: 0x0E0E0D, light: 0xF7F5EF)
    static let primaryPressed = Color(dark: 0xE4E1D9, light: 0x2A2A2F)

    /// The one color: links, focus, toggles on, progress, selected state.
    static let accent = Color(dark: 0x4C8DFF, light: 0x2A63CC)
    static let accentPressed = Color(dark: 0x6FA3FF, light: 0x1F4FA8)
    static let accentOn = Color(dark: 0x0E0E0D, light: 0xFFFFFF)
    /// Accent badge background.
    static let accentTint = Color(dark: 0x4C8DFF, darkAlpha: 0.10, light: 0x2A63CC, lightAlpha: 0.09)
    static let ring = Color(dark: 0x4C8DFF, darkAlpha: 0.55, light: 0x2A63CC, lightAlpha: 0.45)

    static let ok = Color(dark: 0x4FBF85, light: 0x1A7048)
    static let warn = Color(dark: 0xD9A23A, light: 0x8A5E12)
    static let danger = Color(dark: 0xEE5A4B, light: 0xBC2E23)
    static let scrim = Color(dark: 0x090908, darkAlpha: 0.70, light: 0x16161A, lightAlpha: 0.40)

    /// Trip day colours (cycle per distinct day). Map pins and day dots only.
    static let dayColors: [Color] = [0x4C8DFF, 0xF59E0B, 0x16A34A, 0xE5484D, 0x8B5CF6, 0x06B6D4, 0xEC4899, 0x84CC16]
        .map { Color(hex: $0) }

    static func dayColor(_ index: Int) -> Color {
        dayColors[((index % dayColors.count) + dayColors.count) % dayColors.count]
    }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(uiColor: UIColor(hex: hex, alpha: alpha))
    }

    init(dark: UInt32, darkAlpha: Double = 1, light: UInt32, lightAlpha: Double = 1) {
        let darkColor = UIColor(hex: dark, alpha: darkAlpha)
        let lightColor = UIColor(hex: light, alpha: lightAlpha)
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .light ? lightColor : darkColor
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: Double = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: CGFloat(alpha)
        )
    }
}

/// The per-device appearance override (web theme toggle: System -> Light -> Dark).
enum ThemePreference: String, CaseIterable, Sendable {
    case system, light, dark

    static let storageKey = "themePreference"

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    var label: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
}
