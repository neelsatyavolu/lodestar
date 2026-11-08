import SwiftUI
import UIKit

/// Shows the coach-mark tour above everything (tab bar included) in its own passthrough-free
/// window, so it needs no anchors inside other features. Started when onboarding closes.
@MainActor
final class AccountTour {
    static let shared = AccountTour()

    private var window: UIWindow?

    private init() {}

    var isShowing: Bool { window != nil }

    func start(app: AppState) {
        guard window == nil, let scene = Self.activeScene() else { return }
        let model = TourModel(steps: TourStep.steps(signedIn: app.isSignedIn))
        guard !model.isFinished else { return }
        let overlay = TourOverlayView(model: model, locator: TabBarLocator(scene: scene)) { [weak self] in
            self?.stop()
        }
        .environment(app)
        let host = UIHostingController(rootView: overlay)
        host.view.backgroundColor = .clear
        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert
        window.rootViewController = host
        window.overrideUserInterfaceStyle = Self.storedInterfaceStyle()
        window.makeKeyAndVisible()
        self.window = window
    }

    func stop() {
        window?.isHidden = true
        window = nil
    }

    private static func activeScene() -> UIWindowScene? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    }

    /// The overlay window doesn't inherit `preferredColorScheme`, so apply the stored theme.
    private static func storedInterfaceStyle() -> UIUserInterfaceStyle {
        let raw = UserDefaults.standard.string(forKey: ThemePreference.storageKey) ?? ""
        switch ThemePreference(rawValue: raw) ?? .system {
        case .system: return .unspecified
        case .light: return .light
        case .dark: return .dark
        }
    }
}

/// Finds the tab bar item frames in the app's main window (window coordinates).
@MainActor
struct TabBarLocator {
    let scene: UIWindowScene

    func frame(of tab: AppTab, signedIn: Bool) -> CGRect? {
        let tabs = TourLayout.visibleTabs(signedIn: signedIn)
        guard let index = tabs.firstIndex(of: tab), let mainWindow, let bar = Self.findTabBar(in: mainWindow),
              !bar.isHidden, bar.window != nil else { return nil }
        let buttons = TourLayout.uniqueFrames(Self.itemViews(in: bar).map { $0.convert($0.bounds, to: mainWindow) })
        if buttons.count == tabs.count { return buttons[index] }
        let barFrame = bar.convert(bar.bounds, to: mainWindow)
        return TourLayout.evenItemFrames(in: barFrame, count: tabs.count)[index]
    }

    private var mainWindow: UIWindow? {
        scene.windows.first { $0.windowLevel == .normal && !$0.isHidden }
    }

    private static func findTabBar(in view: UIView) -> UITabBar? {
        if let bar = view as? UITabBar { return bar }
        for sub in view.subviews {
            if let bar = findTabBar(in: sub) { return bar }
        }
        return nil
    }

    /// Views inside the bar that look like tab buttons. iOS 26 draws each button twice (a normal
    /// and a selected layer), so callers dedupe the frames.
    private static func itemViews(in bar: UITabBar) -> [UIView] {
        var found: [UIView] = []
        func walk(_ view: UIView) {
            for sub in view.subviews where !sub.isHidden && sub.alpha > 0.01 {
                let name = String(describing: type(of: sub))
                if name.contains("TabButton") || name.contains("TabBarButton") {
                    found.append(sub)
                } else {
                    walk(sub)
                }
            }
        }
        walk(bar)
        return found.filter { $0.bounds.width > 1 && $0.bounds.height > 1 }
    }
}
