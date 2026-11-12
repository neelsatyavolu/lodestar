import SwiftUI
import UIKit

extension TripsFlightView.Tone {
    var color: Color {
        switch self {
        case .ok: .ok
        case .warn: .warn
        case .danger: .danger
        case .idle: .mute
        }
    }
}

/// The status capsule: a dot in the tone's colour (pulsing while live) and the word.
struct TripsFlightStatusBadge: View {
    let view: TripsFlightView
    var onBrand = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    var body: some View {
        HStack(spacing: Spacing.xs + 2) {
            Circle()
                .fill(onBrand && view.tone == .idle ? Color.white.opacity(0.7) : view.tone.color)
                .frame(width: 7, height: 7)
                .opacity(dim ? 0.35 : 1)
            Text(view.status).font(.geist(.sansMedium, size: 12, relativeTo: .caption)).lineLimit(1)
        }
        .foregroundStyle(onBrand ? Color.white : Color.bodyText)
        .padding(.horizontal, 10)
        .frame(minHeight: 26)
        .background(onBrand ? Color.white.opacity(0.15) : Color.elevated, in: Capsule())
        .fixedSize()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Status: \(view.status)")
        .onAppear {
            guard TripsFlightText.pulses(view), !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1).repeatForever()) { dim = true }
        }
    }
}

/// A mono label over a mono value (the facts rows on flight and hotel cards).
struct TripsFact<Value: View>: View {
    let label: String
    @ViewBuilder var value: () -> Value

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs + 2) {
            Text(label).font(.geist(.mono, size: 12, relativeTo: .caption)).foregroundStyle(Color.mute).lineLimit(1)
            value().font(.geist(.monoMedium, size: 14, relativeTo: .footnote)).monospacedDigit().foregroundStyle(Color.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// A confirmation code that copies on tap.
struct TripsCopyCode: View {
    let code: String
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = code
            copied = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                copied = false
            }
        } label: {
            HStack(spacing: Spacing.xs) {
                Text(code).lineLimit(1).minimumScaleFactor(0.8)
                Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 11)).foregroundStyle(Color.mute)
            }
            .frame(minHeight: 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.success, trigger: copied) { _, new in new }
        .accessibilityLabel("Confirmation \(code)")
        .accessibilityHint(copied ? "Copied" : "Copies the code")
    }
}

/// The dashed route line between the airports, with a plane that moves with progress.
struct TripsFlightTrack: View {
    let progress: Double
    let label: String?

    var body: some View {
        VStack(spacing: Spacing.xs + 2) {
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    Path { p in p.move(to: CGPoint(x: 0, y: 10)); p.addLine(to: CGPoint(x: w, y: 10)) }
                        .stroke(Color.hairlineHover, style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                    Rectangle().fill(Color.accent).frame(width: w * progress, height: 1.5).offset(y: 0)
                        .frame(height: 20, alignment: .center)
                    endDot.offset(x: -1)
                    endDot.offset(x: w - 8)
                    Image(systemName: "airplane")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.ink)
                        .frame(width: 20, height: 20)
                        .background(Color.card)
                        .offset(x: min(max(0, w * progress - 10), w - 20))
                        .animation(Motion.enter, value: progress)
                }
            }
            .frame(height: 20)
            if let label {
                Text(label).font(.geist(.mono, size: 12, relativeTo: .caption)).monospacedDigit().foregroundStyle(Color.mute)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label.map { "Route, \($0)" } ?? "Route")
    }

    private var endDot: some View {
        Circle().strokeBorder(Color.hairlineHover, lineWidth: 1.5).background(Circle().fill(Color.card)).frame(width: 9, height: 9)
    }
}

extension Color {
    /// A fixed sRGB colour (airline liveries), the same in light and dark.
    static func livery(_ hex: UInt32) -> Color { Color(hex: hex) }
}
