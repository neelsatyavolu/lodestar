import SwiftUI

/// Shown under the latest turn when the planner only lacks an origin and no home airport is
/// saved. "Save and plan" writes `homeAirports` and re-runs the same prompt in place.
struct PlanOriginAskView: View {
    /// Returns an error message, or nil on success.
    let onSave: ([String]) async -> String?

    @State private var codes: [String] = []
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            AirportFieldView(label: "Where you usually fly from. Saved to your preferences, so Plan won't ask again.",
                             codes: $codes)
            if let error { InlineError(message: error) }
            Button(isSaving ? "Saving…" : "Save and plan") {
                Task {
                    isSaving = true
                    error = await onSave(codes)
                    isSaving = false
                }
            }
            .buttonStyle(.lodestar(.primary, small: true, isLoading: isSaving))
            .disabled(codes.isEmpty || isSaving)
        }
        .card()
    }
}
