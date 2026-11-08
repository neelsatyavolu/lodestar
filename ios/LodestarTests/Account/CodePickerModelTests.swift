import Foundation
import Testing
@testable import Lodestar

/// Records queries and answers with canned suggestions.
private actor FetchRecorder {
    private(set) var queries: [String] = []

    func fetch(_ kind: CodePickerKind, _ query: String) -> [CodeSuggestion] {
        queries.append(query)
        return [CodeSuggestion(code: kind == .airport ? "SFO" : "UA", label: "Result for \(query)", detail: "")]
    }
}

@MainActor
@Suite("Airport and airline picker")
struct CodePickerModelTests {
    @Test func addingUppercasesSkipsDuplicatesAndStopsAtMax() {
        #expect(CodePickerModel.add("sfo", to: [], max: 4) == ["SFO"])
        #expect(CodePickerModel.add("SFO", to: ["SFO"], max: 4) == ["SFO"])
        #expect(CodePickerModel.add("LAX", to: ["SFO", "OAK"], max: 2) == ["SFO", "OAK"])
    }

    @Test func typedCodesNeedTheRightLength() {
        #expect(CodePickerKind.airport.typedCode(" jfk ") == "JFK")
        #expect(CodePickerKind.airport.typedCode("jf") == nil)
        #expect(CodePickerKind.airline.typedCode("b6") == "B6")
        #expect(CodePickerKind.airline.typedCode("b-") == nil)
    }

    @Test func fetchesAfterTheDebounceAndShowsOnlyCurrentResults() async throws {
        let recorder = FetchRecorder()
        let model = CodePickerModel(kind: .airport, debounce: .milliseconds(10)) { kind, q in
            await recorder.fetch(kind, q)
        }
        model.setText("san")
        model.setText("san f")
        try await waitUntil { !model.suggestions.isEmpty }
        #expect(model.suggestions.map(\.label) == ["Result for san f"])
        #expect(await recorder.queries == ["san f"])
        model.setText("san fr")
        #expect(model.suggestions.isEmpty)
    }

    @Test func emptyTextNeverFetches() async throws {
        let recorder = FetchRecorder()
        let model = CodePickerModel(kind: .airline, debounce: .milliseconds(1)) { kind, q in
            await recorder.fetch(kind, q)
        }
        model.setText("   ")
        try await Task.sleep(for: .milliseconds(30))
        #expect(await recorder.queries.isEmpty)
        #expect(model.suggestions.isEmpty)
    }

    @Test func returnAddsTheFirstSuggestionOrATypedCode() async throws {
        let model = CodePickerModel(kind: .airport, debounce: .milliseconds(1)) { _, _ in
            [CodeSuggestion(code: "SFO", label: "San Francisco", detail: "SFO")]
        }
        model.setText("san")
        try await waitUntil { !model.suggestions.isEmpty }
        #expect(model.submit(to: [], max: 4) == ["SFO"])
        #expect(model.text.isEmpty)

        let offline = CodePickerModel(kind: .airport, debounce: .milliseconds(1)) { _, _ in throw APIError.offline }
        offline.setText("jfk")
        #expect(offline.submit(to: ["SFO"], max: 4) == ["SFO", "JFK"])
        offline.setText("new york")
        #expect(offline.submit(to: [], max: 4) == nil)
    }

    private func waitUntil(_ condition: () -> Bool) async throws {
        for _ in 0..<100 where !condition() {
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(condition())
    }
}
