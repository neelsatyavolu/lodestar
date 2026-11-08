import Foundation
import Observation

/// Forwarding address and Flint pairing (`/api/connectors`).
@MainActor
@Observable
final class TripsConnectorsModel {
    let app: AppState
    private(set) var state: LoadState<ConnectorsState> = .idle
    private(set) var code: FlintPairingCode?
    private(set) var isBusy = false
    var error: String?

    init(app: AppState) {
        self.app = app
    }

    func load() async {
        if state.value == nil { state = .loading }
        do {
            state = .loaded(try await app.api.send(API.Connectors.get))
        } catch {
            let message = app.handle(error) ?? "Couldn't load your connections."
            if state.value == nil { state = .failed(message) } else { self.error = message }
        }
    }

    /// "Make a new address": the old one stops working.
    func rotateAddress() async {
        await busy {
            let fresh = try await self.app.api.send(API.Connectors.newAddress)
            if let s = self.state.value { self.state = .loaded(ConnectorsState(address: fresh.address, flint: s.flint)) }
        }
    }

    func getCode() async {
        await busy { self.code = try await self.app.api.send(API.Connectors.flintCode) }
    }

    func disconnect(_ linkId: String) async {
        await busy {
            _ = try await self.app.api.send(API.Connectors.disconnectFlint(linkId))
            if let s = self.state.value { self.state = .loaded(ConnectorsState(address: s.address, flint: s.flint.filter { $0.id != linkId })) }
        }
    }

    /// "<deviceName> · last sent Sat, Nov 21" or "· nothing sent yet".
    static func linkLine(_ link: FlintLink) -> String {
        link.lastDeliveryAt.map { "\(link.deviceName) · last sent \(DateText.short(epochMillis: $0))" }
            ?? "\(link.deviceName) · nothing sent yet"
    }

    private func busy(_ work: @MainActor () async throws -> Void) async {
        isBusy = true
        error = nil
        defer { isBusy = false }
        do { try await work() } catch { self.error = app.handle(error) }
    }
}

/// "Import from Wanderlog": paste the session, pick trips, import.
@MainActor
@Observable
final class TripsWanderlogModel {
    let app: AppState
    var session = ""
    private(set) var trips: [WanderlogTrip]?
    var picked: Set<String> = []
    private(set) var isBusy = false
    private(set) var error: String?

    init(app: AppState) {
        self.app = app
    }

    var canList: Bool { !isBusy && session.trimmingCharacters(in: .whitespaces).count >= 10 }
    var canImport: Bool { !isBusy && !picked.isEmpty }
    var importTitle: String { "Import \(plural(picked.count, "trip"))" }

    /// "Find my trips". Every trip (up to 50) starts picked.
    func list() async {
        isBusy = true
        error = nil
        defer { isBusy = false }
        do {
            let found = try await app.api.send(API.Journeys.wanderlogList(session: session.trimmingCharacters(in: .whitespacesAndNewlines))).trips
            trips = found
            picked = Set(found.prefix(50).map(\.key))
        } catch {
            self.error = app.handle(error)
        }
    }

    func toggle(_ key: String) {
        picked = picked.contains(key) ? picked.subtracting([key]) : picked.union([key])
    }

    /// Returns the number imported, or nil (the error is shown).
    func importPicked() async -> Int? {
        isBusy = true
        error = nil
        defer { isBusy = false }
        do {
            let imported = try await app.api.send(API.Journeys.wanderlogImport(
                session: session.trimmingCharacters(in: .whitespacesAndNewlines), keys: Array(picked).sorted())).imported
            session = ""
            return imported
        } catch {
            self.error = app.handle(error) ?? "The import didn't finish. Try again; trips already imported won't be doubled."
            return nil
        }
    }
}
