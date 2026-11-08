import SwiftUI

/// The drawn fallback logo, matching the server's SVG monogram (`lib/logos.ts`): an off-white
/// rounded square with black Geist SemiBold initials. Drawn natively because UIImage can't
/// decode the server's `image/svg+xml` fallback.
struct Monogram: View {
    let name: String
    var size: CGFloat = 28

    var body: some View {
        let text = Monogram.initials(name)
        RoundedRectangle(cornerRadius: size * 12 / 64)
            .fill(Color(hex: 0xFCFDFF))
            .overlay(
                Text(text)
                    .font(.custom(FontFace.sansSemibold.rawValue, fixedSize: size * (text.count > 2 ? 18 : 22) / 64))
                    .foregroundStyle(Color(hex: 0x000000))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
            )
            .frame(width: size, height: size)
            .accessibilityLabel(name)
    }

    /// Port of `initials()`: strip a trailing .com/.net/.org/.co/.io; keep 2-3 chars of [A-Z0-9]
    /// as they are; else the first letters of the first two words (split on space - _ .), or the
    /// first two letters of a single word, uppercased; "?" when nothing is left.
    nonisolated static func initials(_ name: String) -> String {
        let clean = name
            .replacingOccurrences(of: #"\.(com|net|org|co|io)$"#, with: "", options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if clean.range(of: #"^[A-Z0-9]{2,3}$"#, options: .regularExpression) != nil {
            return clean
        }
        let words = clean
            .split(whereSeparator: { $0.isWhitespace || $0 == "-" || $0 == "_" || $0 == "." })
            .filter { !$0.isEmpty }
        let letters: String
        if words.count > 1, let a = words[0].first, let b = words[1].first {
            letters = String([a, b])
        } else {
            letters = String(clean.prefix(2))
        }
        let upper = letters.uppercased()
        return upper.isEmpty ? "?" : upper
    }
}
