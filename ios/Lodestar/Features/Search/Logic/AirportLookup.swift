import Foundation
import Observation

/// Autocomplete for one airport field (`GET /api/airports`): debounced 120 ms, the previous
/// request cancelled, and only answers for the current text kept (web `airport-field.tsx`).
@MainActor
@Observable
final class AirportLookup {
    typealias Fetcher = @Sendable (String) async throws -> [AirportSuggestion]

    static let debounce: Duration = .milliseconds(120)

    private(set) var suggestions: [AirportSuggestion] = []
    private(set) var currentText = ""

    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private let fetch: Fetcher

    init(fetch: @escaping Fetcher) {
        self.fetch = fetch
    }

    convenience init(api: APIClient) {
        self.init { text in try await api.send(API.Flights.airports(query: text)) }
    }

    /// Call on every keystroke.
    func update(text: String) {
        currentText = text
        task?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            suggestions = []
            return
        }
        task = Task { [fetch] in
            try? await Task.sleep(for: Self.debounce)
            guard !Task.isCancelled else { return }
            // A failed lookup just shows no suggestions; the field still accepts a typed code.
            let found = (try? await fetch(trimmed)) ?? []
            guard !Task.isCancelled, self.currentText.trimmingCharacters(in: .whitespaces) == trimmed else { return }
            self.suggestions = found
        }
    }

    func clear() {
        task?.cancel()
        currentText = ""
        suggestions = []
    }

    // MARK: - Chip rules

    /// Adds a code (uppercased, no duplicates, at most 4 per field).
    nonisolated static func adding(_ code: String, to codes: [String]) -> [String] {
        let upper = code.uppercased()
        guard !codes.contains(upper), codes.count < SearchForm.maxCodesPerField else { return codes }
        return codes + [upper]
    }

    /// Return on exactly three letters adds that code without a suggestion.
    nonisolated static func typedCode(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard trimmed.count == 3, trimmed.allSatisfy({ $0.isASCII && $0.isLetter }) else { return nil }
        return trimmed.uppercased()
    }
}
