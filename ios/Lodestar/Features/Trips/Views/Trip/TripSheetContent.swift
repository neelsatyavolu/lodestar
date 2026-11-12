import SwiftUI

/// Builds whichever sheet the trip page asked for.
struct TripSheetContent: View {
    let model: TripDetailModel
    let sheet: TripsTripSheet
    let present: (TripsTripSheet) -> Void

    var body: some View {
        switch sheet {
        case .edit:
            TripFormSheet(mode: .edit(model.journey)) { form in
                if let problem = await model.update(form) { throw TripsProblem(message: problem) }
            }
        case .share:
            TripsShareSheet(model: model)
                .presentationDetents([.medium, .large])
        case .addItem(let choice, let day):
            TripsAddItemSheet(model: model, choice: choice, day: day)
        case .addPlace(let day):
            TripsAddPlaceSheet(model: model, day: day)
        case .place(let id):
            TripsPlacePanel(model: model, startId: id, present: present)
                .presentationDetents([.medium, .large])
        case .map:
            TripsMapSheet(model: model) { present(.place($0)) }
        case .note(let id):
            TripsNoteSheet(model: model, note: id.flatMap { id in model.trip.notes.first { $0.id == id } })
        case .markBooked(let id):
            TripsMarkItemBookedSheet(model: model, itemId: id)
                .presentationDetents([.medium])
        case .editStop(let id):
            if let item = model.item(id) {
                TripsStopEditSheet(model: model, item: item)
                    .presentationDetents([.medium, .large])
            }
        case .web(let url):
            SafariView(url: url).ignoresSafeArea()
        }
    }
}

/// The share link: toggle, copy, share sheet, open.
struct TripsShareSheet: View {
    let model: TripDetailModel
    @State private var web: WebPage?

    var body: some View {
        TripsSheetFrame(title: "Share the plan") {
            Text("Anyone with the link can see the plan: the days, what's booked and what still needs booking, the checklist and notes. Confirmation numbers, prices and the budget stay private.")
                .textStyle(.bodySM).foregroundStyle(Color.bodyText)
            Toggle(isOn: Binding(get: { model.journey.shareToken != nil }, set: { on in Task { await model.setSharing(on) } })) {
                Text(model.journey.shareToken != nil ? "Link is on" : "Link is off").textStyle(.bodySM)
            }
            .tint(Color.accent)
            .disabled(model.isSharing)
            if let url = model.shareURL {
                TripsCodeBox(text: url.absoluteString)
                HStack(spacing: Spacing.sm) {
                    ShareLink(item: url, subject: Text(model.journey.title)) { Label("Share", systemImage: "square.and.arrow.up") }
                        .buttonStyle(.lodestar(.primary, small: true))
                    Button("Open") { web = WebPage(url: url) }.buttonStyle(.lodestar(.ghost, small: true))
                }
                Text("Turn the link off to stop it working. A new link is made if you turn it on again.")
                    .textStyle(.caption).foregroundStyle(Color.mute)
            }
            if let error = model.error { InlineError(message: error) }
        }
        .sheet(item: $web) { SafariView(url: $0.url).ignoresSafeArea() }
    }
}

/// Add or edit a note.
struct TripsNoteSheet: View {
    let model: TripDetailModel
    let note: TripNote?
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                LodestarField(label: "Title", text: $title, placeholder: "Getting around")
                TextEditor(text: $text)
                    .font(TextStyle.bodySM.font)
                    .scrollContentBackground(.hidden)
                    .padding(Spacing.sm)
                    .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.md))
                    .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairlineHover, lineWidth: Sizes.hairline))
                    .frame(minHeight: 200)
                    .accessibilityLabel("Note")
                if let error { InlineError(message: error) }
                if let note {
                    Button("Delete note", role: .destructive) {
                        Task { await model.deleteNote(note.id); dismiss() }
                    }
                    .buttonStyle(.lodestar(.destructive, small: true))
                }
            }
            .padding(Sizes.sheetPadding)
            .canvasBackground()
            .navigationTitle(note == nil ? "Add a note" : "Edit note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).disabled(busy) }
            }
        }
        .onAppear {
            title = note?.title ?? ""
            text = note?.body ?? ""
        }
    }

    private func save() {
        busy = true
        Task {
            error = await model.saveNote(title: title, body: text, editing: note?.id)
            busy = false
            if error == nil { dismiss() }
        }
    }
}

/// To book's "Mark booked": optional confirmation number and what was paid.
struct TripsMarkItemBookedSheet: View {
    let model: TripDetailModel
    let itemId: String
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var paid = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text("Mark booked").textStyle(.headingMD).foregroundStyle(Color.ink)
            if let item = model.item(itemId) {
                Text(item.title).textStyle(.bodySM).foregroundStyle(Color.bodyText)
            }
            LodestarField(label: "Confirmation number (optional)", text: $code, mono: true, autocapitalization: .characters)
            LodestarField(label: "What you paid (optional)", text: $paid, hint: "Goes into the budget as paid.", keyboard: .decimalPad)
            if let error { InlineError(message: error) }
            HStack {
                Button("Cancel") { dismiss() }.buttonStyle(.lodestar(.quiet))
                Spacer()
                Button("Mark booked", action: save).buttonStyle(.lodestar(.primary, isLoading: busy)).disabled(busy)
            }
        }
        .padding(Sizes.sheetPadding)
    }

    private func save() {
        switch TripsRequests.markBooked(confirmation: code, paid: paid) {
        case .failure(let problem): error = problem.message
        case .success(let patch):
            busy = true
            Task {
                error = await model.patchItem(itemId, patch)
                busy = false
                if error == nil { dismiss() }
            }
        }
    }
}
