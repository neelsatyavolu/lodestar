import AuthenticationServices
import Foundation
import Network
import os
import UIKit

/// A one-shot HTTP listener on the provider's loopback port. The OAuth redirect from the
/// sign-in sheet lands here, so the app can finish without the user copying anything.
/// Untested on a device (see ARCHITECTURE.md "Known native gaps"); the paste fallback always works.
final class AILoopbackListener: @unchecked Sendable {
    private let provider: AIProvider
    private let queue = DispatchQueue(label: "co.xanom.lodestar.ai-loopback")
    /// Touched from the main actor (start/stop) and the listener queue (state and connection
    /// handlers), so it sits behind a lock.
    private let listener = OSAllocatedUnfairLock<NWListener?>(initialState: nil)
    private let onOutcome: @Sendable (AIConnectLogic.Outcome) -> Void

    init(provider: AIProvider, onOutcome: @escaping @Sendable (AIConnectLogic.Outcome) -> Void) {
        self.provider = provider
        self.onOutcome = onOutcome
    }

    /// False when the port can't be opened (busy, or no port for the provider): use the paste fallback.
    func start() -> Bool {
        guard let rawPort = provider.loopbackPort, let port = NWEndpoint.Port(rawValue: rawPort) else { return false }
        let parameters = NWParameters.tcp
        parameters.requiredInterfaceType = .loopback
        parameters.allowLocalEndpointReuse = true
        guard let listener = try? NWListener(using: parameters, on: port) else { return false }
        listener.newConnectionHandler = { [weak self] connection in self?.handle(connection) }
        listener.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.stop() }
        }
        self.listener.withLock { $0 = listener }
        listener.start(queue: queue)
        return true
    }

    func stop() {
        let current = listener.withLock { current in
            defer { current = nil }
            return current
        }
        current?.cancel()
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, _, _ in
            guard let self else { return connection.cancel() }
            let raw = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let outcome = AIConnectLogic.requestTarget(raw).map { AIConnectLogic.outcome(target: $0, provider: self.provider) } ?? .ignore
            let body = outcome == .ignore ? "" : (outcome == .refused ? AIConnectLogic.refusedMessage : AIConnectLogic.successPage)
            let reply = Data(AIConnectLogic.httpResponse(body: body).utf8)
            connection.send(content: reply, completion: .contentProcessed { _ in connection.cancel() })
            if outcome != .ignore {
                self.stop()
                self.onOutcome(outcome)
            }
        }
    }
}

/// Shows the provider's sign-in in a secure browser sheet (`ASWebAuthenticationSession`) and
/// listens on the loopback port for the redirect. The custom scheme never fires: the session
/// exists only to show the sheet, and is cancelled once the listener has the code.
@MainActor
final class AISignInBrowser: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var listener: AILoopbackListener?

    /// Opens the sheet. `onOutcome` runs on the main actor with the captured redirect.
    func present(_ url: URL, provider: AIProvider, onOutcome: @escaping @MainActor (AIConnectLogic.Outcome) -> Void) {
        close()
        let listener = AILoopbackListener(provider: provider) { [weak self] outcome in
            Task { @MainActor in
                self?.session?.cancel()
                self?.session = nil
                onOutcome(outcome)
            }
        }
        _ = listener.start()
        self.listener = listener
        // The completion handler only reports the sheet closing (cancelled by us or the user).
        let session = ASWebAuthenticationSession(url: url, callback: .customScheme("lodestar")) { _, _ in }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        session.start()
    }

    func close() {
        session?.cancel()
        session = nil
        listener?.stop()
        listener = nil
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let windows = scenes.flatMap(\.windows)
            if let window = windows.first(where: \.isKeyWindow) ?? windows.first { return window }
            // The sheet is only presented from a visible scene, so a scene always exists here.
            return ASPresentationAnchor(windowScene: scenes[0])
        }
    }
}
