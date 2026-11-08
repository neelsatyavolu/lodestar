import SwiftUI
import UIKit

/// Blackletter color tokens (app/globals.css). Each resolves per appearance: dark is the
/// black canvas, light follows the system setting or the in-app override (`ThemePreference`).
/// Blue (`accent`) is the only color; `ok`, `warn`, `danger` are for small status dots
/// (and `danger` for error text). Never use them as fills or buttons.
extension Color {
    static let canvas = Color(dark: 0x000000, light: 0xFCFCFD)
    static let card = Color(dark: 0x0A0A0C, light: 0xFFFFFF)
    static let elevated = Color(dark: 0x111114, light: 0xF4F5F7)
    /// Inset panels: text inputs, selects.
    static let deep = Color(dark: 0x06060A, light: 0xF7F8FA)

    static let ink = Color(dark: 0xFCFDFF, light: 0x0A0A0C)
    /// Body text (long prose uses this, not ink).
    static let bodyText = Color(dark: 0xFCFDFF, darkAlpha: 0.86, light: 0x0A0A0C, lightAlpha: 0.82)
    /// Field labels, secondary icons.
    static let charcoal = Color(dark: 0xFCFDFF, darkAlpha: 0.70, light: 0x0A0A0C, lightAlpha: 0.66)
    static let mute = Color(dark: 0xA1A4A5, light: 0x5F6366)
    /// Captions, counters.
    static let ash = Color(dark: 0x888E90, light: 0x7A7F82)
    /// Placeholders, disabled.
    static let stone = Color(dark: 0x464A4D, light: 0xC4C7CA)

    static let hairline = Color(dark: 0xFFFFFF, darkAlpha: 0.06, light: 0x000000, lightAlpha: 0.06)
    static let hairlineStrong = Color(dark: 0xFFFFFF, darkAlpha: 0.14, light: 0x000000, lightAlpha: 0.12)
    static let hairlineHover = Color(dark: 0xFFFFFF, darkAlpha: 0.30, light: 0x000000, lightAlpha: 0.28)
    /// Pressed row / selected segment fill.
    static let pressedFill = Color(dark: 0xFFFFFF, darkAlpha: 0.04, light: 0x000000, lightAlpha: 0.035)

    /// Primary button fill: the brightest thing on screen.
    static let primaryFill = Color(dark: 0xFCFDFF, light: 0x0A0A0C)
    static let primaryOn = Color(dark: 0x000000, light: 0xFCFDFF)
    static let primaryPressed = Color(dark: 0xE8F0FF, light: 0x26262B)

    /// The one color: links, focus, toggles on, progress, selected state.
    static let accent = Color(dark: 0x4C8DFF, light: 0x2F6FE0)
    static let accentPressed = Color(dark: 0x6FA3FF, light: 0x2459BA)
    static let accentOn = Color(dark: 0x000000, light: 0xFFFFFF)
    /// Accent badge background.
    static let accentTint = Color(dark: 0x4C8DFF, darkAlpha: 0.12, light: 0x2F6FE0, lightAlpha: 0.08)
    static let ring = Color(dark: 0x4C8DFF, darkAlpha: 0.55, light: 0x2F6FE0, lightAlpha: 0.45)

    static let ok = Color(dark: 0x3DD68C, light: 0x14915A)
    static let warn = Color(dark: 0xFFC53D, light: 0xB7791F)
    static let danger = Color(dark: 0xFF4D5E, light: 0xD92D3F)
    static let scrim = Color(dark: 0x000000, darkAlpha: 0.70, light: 0x0A0A0C, lightAlpha: 0.40)

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
