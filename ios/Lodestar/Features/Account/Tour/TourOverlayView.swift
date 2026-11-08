import SwiftUI

/// The tour (web `components/tour.tsx`): dims the screen to 60% black, outlines one tab bar item
/// with a 2 pt accent border and explains it in a card. Tapping the dim area ends the tour.
struct TourOverlayView: View {
    let model: TourModel
    let locator: TabBarLocator
    let onDone: () -> Void
    @Environment(AppState.self) private var app
    @State private var target: CGRect?
    @State private var measured = false
    @State private var cardHeight: CGFloat = 160

    var body: some View {
        GeometryReader { proxy in
            let container = proxy.size
            ZStack(alignment: .topLeading) {
                dim(container: container)
                if let target, measured {
                    RoundedRectangle(cornerRadius: Radius.md)
                        .strokeBorder(Color.accent, lineWidth: 2)
                        .frame(width: TourLayout.highlight(for: target).width, height: TourLayout.highlight(for: target).height)
                        .offset(x: TourLayout.highlight(for: target).minX, y: TourLayout.highlight(for: target).minY)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                if let step = model.step, measured {
                    card(step)
                        .frame(width: TourLayout.cardWidth(in: container))
                        .onGeometryChange(for: CGFloat.self, of: \.size.height) { cardHeight = $0 }
                        .offset(cardOffset(container: container, topInset: proxy.safeAreaInsets.top))
                }
            }
        }
        .ignoresSafeArea()
        .animation(Motion.ease(0.2), value: model.index)
        .task(id: model.index) { await openStep() }
        .accessibilityAddTraits(.isModal)
        .accessibilityLabel("Quick tour")
    }

    private func dim(container: CGSize) -> some View {
        Path { path in
            path.addRect(CGRect(origin: .zero, size: container))
            if let target, measured {
                path.addRoundedRect(in: TourLayout.highlight(for: target), cornerSize: CGSize(width: Radius.md, height: Radius.md))
            }
        }
        .fill(Color.black.opacity(0.6), style: FillStyle(eoFill: true))
        .contentShape(Rectangle())
        .onTapGesture(perform: finish)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("Close tour")
    }

    private func cardOffset(container: CGSize, topInset: CGFloat) -> CGSize {
        let origin = TourLayout.cardOrigin(target: target, cardHeight: cardHeight, container: container, topInset: topInset)
        return CGSize(width: origin.x, height: origin.y)
    }

    private func card(_ step: TourStep) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(model.counter).textStyle(.caption).monospacedDigit().foregroundStyle(Color.ash)
            Text(step.title)
                .font(Font.geist(.sansMedium, size: 15, relativeTo: .headline))
                .foregroundStyle(Color.ink)
                .padding(.top, Spacing.xs)
            Text(step.body).textStyle(.chip).foregroundStyle(Color.bodyText).padding(.top, Spacing.xs + 2)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Spacing.sm) {
                Button("Skip tour", action: finish).buttonStyle(.lodestar(.quiet, small: true))
                Spacer(minLength: 0)
                if model.index > 0 {
                    Button("Back") { model.back() }.buttonStyle(.lodestar(.ghost, small: true))
                }
                Button(model.primaryTitle, action: next).buttonStyle(.lodestar(.primary, small: true))
            }
            .padding(.top, Spacing.lg)
        }
        .padding(Sizes.cardPadding)
        .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
        .accessibilityElement(children: .contain)
    }

    /// Switches tab when the step asks, waits a frame for the view to settle, then measures.
    private func openStep() async {
        guard let step = model.step else { return finish() }
        if let tab = step.opens, app.selectedTab != tab {
            measured = false
            app.selectedTab = tab
            try? await Task.sleep(for: .milliseconds(250))
        }
        target = step.tab.flatMap { locator.frame(of: $0, signedIn: app.isSignedIn) }
        measured = true
    }

    private func next() {
        model.next()
        if model.isFinished { finish() }
    }

    private func finish() {
        model.finish()
        onDone()
    }
}
