import SwiftUI

/// "Edit" on a stop (`StopEditor` in `stop-card.tsx`): its title and note, PATCHed together.
struct TripsStopEditSheet: View {
    let model: TripDetailModel
    let item: TripItem
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                LodestarField(label: "Title", text: $title, submitLabel: .next)
                VStack(alignment: .leading, spacing: Spacing.xs + 2) {
                    Text("Note").textStyle(.label).foregroundStyle(Color.charcoal)
                    TextEditor(text: $note)
                        .font(TextStyle.bodySM.font)
                        .scrollContentBackground(.hidden)
                        .padding(Spacing.sm)
                        .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.md))
                        .overlay(alignment: .topLeading) {
                            if note.isEmpty {
                                Text("What to order, who's coming, how to get there")
                                    .textStyle(.bodySM).foregroundStyle(Color.mute)
                                    .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.md + 4)
                                    .allowsHitTesting(false)
                            }
                        }
                        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairlineHover, lineWidth: Sizes.hairline))
                        .frame(minHeight: 160)
                        .accessibilityLabel("Note")
                }
                if let error { InlineError(message: error) }
                Spacer(minLength: 0)
            }
            .padding(Sizes.sheetPadding)
            .canvasBackground()
            .navigationTitle("Edit stop")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).disabled(busy) }
            }
        }
        .onAppear {
            title = item.title
            note = TripsStopEdit.startingNote(item)
        }
    }

    private func save() {
        guard let patch = TripsStopEdit.patch(item, title: String(title.prefix(160)), note: String(note.prefix(2000))) else {
            dismiss()
            return
        }
        busy = true
        Task {
            error = await model.patchItem(item.id, patch)
            busy = false
            if error == nil { dismiss() }
        }
    }
}
