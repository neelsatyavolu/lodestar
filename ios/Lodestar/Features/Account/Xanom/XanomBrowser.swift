import AuthenticationServices
import UIKit

/// Shows a Xanom start link in `ASWebAuthenticationSession` and returns the `lodestar://` URL it
/// ends on. Not ephemeral: the browser keeps the Xanom cookie, so the next Xanom app is one tap.
@MainActor
final class XanomBrowser: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    /// Throws `CancellationError` when the user closes the sheet.
    func open(_ url: URL) async throws -> URL {
        session?.cancel()
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callback: .customScheme(XanomFlow.callbackScheme)) { [weak self] callback, error in
                Task { @MainActor in self?.session = nil }
                if let callback {
                    continuation.resume(returning: callback)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: CancellationError())
                } else {
                    continuation.resume(throwing: error ?? CancellationError())
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                continuation.resume(throwing: APIError.invalidRequest(detail: "The sign-in sheet couldn't open"))
            }
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let windows = scenes.flatMap(\.windows)
            if let window = windows.first(where: \.isKeyWindow) ?? windows.first { return window }
            return ASPresentationAnchor(windowScene: scenes[0])
        }
    }
}
