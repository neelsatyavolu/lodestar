import Foundation
import Observation

enum CodePickerKind: Sendable {
    case airport, airline

    var codeLength: Int { self == .airport ? 3 : 2 }

    /// The typed text counts as a code when it has the code's length and is letters/digits.
    func typedCode(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard trimmed.count == codeLength, trimmed.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) else {
            return nil
        }
        return trimmed.uppercased()
    }
}

/// One row of type-ahead suggestions (airports: code, city, detail; airlines: code, name, code).
struct CodeSuggestion: Hashable, Sendable, Identifiable {
    let code: String
    let label: String
    let detail: String

    var id: String { code }

    init(code: String, label: String, detail: String) {
        self.code = code
        self.label = label
        self.detail = detail
    }

    init(_ airport: AirportSuggestion) {
        self.init(code: airport.code, label: airport.label, detail: airport.detail)
    }

    init(_ airline: AirlineSuggestion) {
        self.init(code: airline.code, label: airline.name, detail: airline.code)
    }
}

/// Type-ahead state for a chip list of codes (web `AirportField`): 120 ms debounce, the older
/// request is cancelled, and suggestions only show for exactly what is typed now.
@MainActor
@Observable
final class CodePickerModel {
    typealias Fetch = @Sendable (CodePickerKind, String) async throws -> [CodeSuggestion]

    let kind: CodePickerKind
    private(set) var text = ""
    private(set) var results: (query: String, items: [CodeSuggestion]) = ("", [])
    @ObservationIgnored private let fetch: Fetch
    @ObservationIgnored private let debounce: Duration
    @ObservationIgnored private var task: Task<Void, Never>?

    init(kind: CodePickerKind, debounce: Duration = .milliseconds(120), fetch: @escaping Fetch) {
        self.kind = kind
        self.debounce = debounce
        self.fetch = fetch
    }

    var query: String { text.trimmingCharacters(in: .whitespaces) }

    /// Stale suggestions vanish as soon as the text changes.
    var suggestions: [CodeSuggestion] {
        !query.isEmpty && results.query == query ? results.items : []
    }

    func setText(_ newText: String) {
        text = newText
        task?.cancel()
        let q = query
        guard !q.isEmpty else { return }
        let fetch = fetch, kind = kind, debounce = debounce
        task = Task { [weak self] in
            do {
                try await Task.sleep(for: debounce)
                let items = try await fetch(kind, q)
                guard !Task.isCancelled else { return }
                self?.results = (q, items)
            } catch {
                // The web ignores suggestion failures; typing a full code still works.
            }
        }
    }

    /// Adds a code (no duplicates, never past `max`) and clears the box.
    func adding(_ code: String, to codes: [String], max: Int) -> [String] {
        text = ""
        task?.cancel()
        return Self.add(code, to: codes, max: max)
    }

    /// Return in the box: the first suggestion, else a typed full code, else nothing.
    func submit(to codes: [String], max: Int) -> [String]? {
        if let first = suggestions.first { return adding(first.code, to: codes, max: max) }
        if let typed = kind.typedCode(text) { return adding(typed, to: codes, max: max) }
        return nil
    }

    func cancel() {
        task?.cancel()
    }

    nonisolated static func add(_ code: String, to codes: [String], max: Int) -> [String] {
        let upper = code.uppercased()
        guard !codes.contains(upper), codes.count < max else { return codes }
        return codes + [upper]
    }
}
