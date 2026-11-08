import CoreGraphics
import Foundation
import Observation

/// One coach mark. `tab` is the tab bar item it outlines (nil: the card sits alone near the
/// top); `opens` is the tab to switch to before it shows.
struct TourStep: Hashable, Sendable {
    let title: String
    let body: String
    let tab: AppTab?
    let opens: AppTab?

    /// The web's steps (components/tour.tsx), mapped to iOS: the anchors are tab bar items,
    /// the Plan input step shows its card over the Plan tab, and the header's preferences
    /// button and account pill become the Account tab. Trips is dropped when signed out.
    static func steps(signedIn: Bool) -> [TourStep] {
        let all = [
            TourStep(title: "Plan", body: "Start here. Plan finds flights from a plain sentence instead of a form.",
                     tab: .plan, opens: .plan),
            TourStep(title: "Say the trip",
                     body: "Type where and roughly when, like “Chennai Dec 7 to 20, nonstop if it's close”. Plan runs several live searches with your preferences and shortlists the best options. Reply to change anything.",
                     tab: nil, opens: .plan),
            TourStep(title: "Search",
                     body: "Prefer a form? Search shows live fares and also tries nearby airports, a few days either side, and two one-way tickets.",
                     tab: .search, opens: nil),
            TourStep(title: "Trips",
                     body: "All your trips, day by day. Forward a confirmation or connect Flint and it files itself. Saved Plan shortlists are watched here too, with an email when the fare drops.",
                     tab: .trips, opens: nil),
            TourStep(title: "Your account",
                     body: "Everything you just set lives here, with your AI connection and sign out. Tap Account to change it any time.",
                     tab: .account, opens: nil),
        ]
        return all.filter { signedIn || $0.tab != .trips }
    }
}

/// Paging for the tour overlay.
@MainActor
@Observable
final class TourModel {
    let steps: [TourStep]
    private(set) var index = 0
    private(set) var isFinished = false

    init(steps: [TourStep]) {
        self.steps = steps
        isFinished = steps.isEmpty
    }

    var step: TourStep? { isFinished || !steps.indices.contains(index) ? nil : steps[index] }
    var isLast: Bool { index == steps.count - 1 }
    var counter: String { "\(index + 1) of \(steps.count)" }
    var primaryTitle: String { isLast ? "Done" : "Next" }

    func next() {
        if isLast { finish() } else { index += 1 }
    }

    func back() {
        index = max(index - 1, 0)
    }

    func finish() {
        isFinished = true
    }
}

/// Where the card and the outline go (pure, for tests). Tab bar items sit at the bottom, so
/// the card goes above its item; with no item the card sits alone near the top.
enum TourLayout {
    static let cardWidth: CGFloat = 320
    static let gutter: CGFloat = 16
    static let gap: CGFloat = 12
    static let padding: CGFloat = 6
    static let topOffset: CGFloat = 80

    static func highlight(for target: CGRect) -> CGRect {
        target.insetBy(dx: -padding, dy: -padding)
    }

    static func cardWidth(in container: CGSize) -> CGFloat {
        min(cardWidth, container.width - gutter * 2)
    }

    /// Top-left corner of the card.
    static func cardOrigin(target: CGRect?, cardHeight: CGFloat, container: CGSize, topInset: CGFloat) -> CGPoint {
        let width = cardWidth(in: container)
        guard let target else {
            return CGPoint(x: (container.width - width) / 2, y: topInset + topOffset)
        }
        let centered = target.midX - width / 2
        let x = min(max(centered, gutter), container.width - width - gutter)
        let above = target.minY - padding - gap - cardHeight
        let y = above >= topInset ? above : target.maxY + padding + gap
        return CGPoint(x: x, y: y)
    }

    /// Splits a tab bar's frame evenly when the item views can't be found.
    static func evenItemFrames(in bar: CGRect, count: Int) -> [CGRect] {
        guard count > 0 else { return [] }
        let width = bar.width / CGFloat(count)
        return (0..<count).map { CGRect(x: bar.minX + CGFloat($0) * width, y: bar.minY, width: width, height: bar.height) }
    }

    /// Item frames sorted left to right with duplicates (same frame, other layer) removed.
    static func uniqueFrames(_ frames: [CGRect]) -> [CGRect] {
        frames.sorted { $0.minX < $1.minX }.reduce(into: [CGRect]()) { kept, frame in
            if let last = kept.last, abs(last.minX - frame.minX) < 1, abs(last.width - frame.width) < 1 { return }
            kept.append(frame)
        }
    }

    /// The tabs RootView shows, in order.
    static func visibleTabs(signedIn: Bool) -> [AppTab] {
        signedIn ? [.search, .stays, .plan, .trips, .account] : [.search, .stays, .plan, .account]
    }
}
