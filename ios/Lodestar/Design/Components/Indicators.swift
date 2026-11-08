import SwiftUI

/// The only place green, yellow and red appear: an 8 pt dot beside a short label.
struct StatusDot: View {
    enum Tone: Sendable {
        case ok, warn, danger, neutral, accent

        var color: Color {
            switch self {
            case .ok: .ok
            case .warn: .warn
            case .danger: .danger
            case .neutral: .ash
            case .accent: .accent
            }
        }
    }

    let tone: Tone
    var size: CGFloat = Sizes.statusDot

    var body: some View {
        Circle().fill(tone.color).frame(width: size, height: size).accessibilityHidden(true)
    }
}

extension StatusDot.Tone {
    /// Green for airline/hotel direct and trusted, yellow for not vetted.
    init(tier: SellerTier) {
        self = tier.isTrusted ? .ok : .warn
    }
}

/// A dot with its label ("Airline direct", "Booked").
struct StatusLabel: View {
    let text: String
    let tone: StatusDot.Tone

    var body: some View {
        HStack(spacing: Spacing.sm) {
            StatusDot(tone: tone)
            Text(text).textStyle(.caption).foregroundStyle(Color.mute)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Capsule label. `.accent` is the blue badge ("Best"); `.neutral` the elevated pill.
struct Pill: View {
    enum Style: Sendable { case neutral, accent }

    let text: String
    var style: Style = .neutral
    var dot: StatusDot.Tone?

    var body: some View {
        HStack(spacing: Spacing.xs + 2) {
            if let dot { StatusDot(tone: dot, size: Sizes.statusDotInPill) }
            Text(text)
        }
        .textStyle(.caption)
        .foregroundStyle(style == .accent ? Color.accent : Color.bodyText)
        .padding(.vertical, Spacing.xs)
        .padding(.horizontal, 10)
        .background(style == .accent ? Color.accentTint : Color.elevated, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// A selectable capsule (multi or single select).
struct Chip: View {
    let title: String
    let isOn: Bool
    var mono = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(mono ? TextStyle.code.font : TextStyle.chip.font)
                .foregroundStyle(isOn ? Color.ink : Color.mute)
                .padding(.horizontal, 14)
                .frame(minHeight: Sizes.chip)
                .background(isOn ? Color.elevated : Color.clear, in: Capsule())
                .overlay(Capsule().strokeBorder(isOn ? Color.hairlineHover : Color.hairlineStrong, lineWidth: Sizes.hairline))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// A capsule with a mini switch and a label ("Trusted sellers only", "Nonstop").
struct ToggleChip: View {
    let title: String
    @Binding var isOn: Bool

    var body: some View {
        Button { isOn.toggle() } label: {
            HStack(spacing: Spacing.sm) {
                ZStack(alignment: isOn ? .trailing : .leading) {
                    Capsule().fill(isOn ? Color.accent : Color.stone).frame(width: 24, height: 14)
                    Circle().fill(Color.canvas).frame(width: 10, height: 10).padding(.horizontal, 2)
                }
                Text(title).textStyle(.chip)
            }
            .foregroundStyle(isOn ? Color.ink : Color.mute)
            .padding(.horizontal, 12)
            .frame(minHeight: Sizes.chip)
            .overlay(Capsule().strokeBorder(isOn ? Color.hairlineHover : Color.hairlineStrong, lineWidth: Sizes.hairline))
            .contentShape(Capsule())
            .animation(Motion.fast, value: isOn)
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation { Toggle(title, isOn: $isOn) }
    }
}

/// 14 pt ring spinner: hairline track with an ink segment.
struct Spinner: View {
    var color: Color = .ink
    var size: CGFloat = 14
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spinning = false

    var body: some View {
        ZStack {
            Circle().stroke(Color.hairlineStrong, lineWidth: 1.5)
            Circle().trim(from: 0, to: 0.25).stroke(color, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                .rotationEffect(.degrees(spinning ? 360 : 0))
        }
        .frame(width: size, height: size)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 0.8).repeatForever(autoreverses: false)) { spinning = true }
        }
        .accessibilityLabel("Loading")
    }
}

/// A flat placeholder that breathes while a live request runs.
struct Skeleton: View {
    var height: CGFloat = 96
    var radius: CGFloat = Radius.lg
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    var body: some View {
        RoundedRectangle(cornerRadius: radius)
            .fill(Color.elevated)
            .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(Color.hairline, lineWidth: Sizes.hairline))
            .frame(height: height)
            .opacity(dim ? 0.55 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(Motion.ease(0.8).repeatForever(autoreverses: true)) { dim = true }
            }
            .accessibilityHidden(true)
    }
}

/// Segmented progress (onboarding pages, trip draft parts).
struct SegmentedProgress: View {
    let total: Int
    /// Segments up to and including this index (0-based) are filled.
    let current: Int

    var body: some View {
        HStack(spacing: Spacing.xs) {
            ForEach(0..<max(total, 0), id: \.self) { index in
                Capsule().fill(index <= current ? Color.accent : Color.hairlineStrong).frame(height: 4)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Step \(current + 1) of \(total)")
    }
}
