import SwiftUI

/// Checklist (`checklist-tab.tsx`).
struct TripChecklistTab: View {
    let model: TripDetailModel

    @State private var title = ""
    @State private var section = "Before you go"
    @State private var error: String?
    @State private var adding = false

    var body: some View {
        let tasks = model.trip.tasks
        let done = tasks.filter(\.done).count
        VStack(alignment: .leading, spacing: Spacing.lg) {
            SectionHeader(title: "Checklist", detail: tasks.isEmpty ? nil : "\(done) of \(tasks.count) done")
            if !tasks.isEmpty {
                ProgressView(value: Double(done), total: Double(tasks.count))
                    .tint(Color.accent)
                    .accessibilityLabel("\(done) of \(tasks.count) done")
            }
            if tasks.isEmpty {
                EmptyStateView(title: "Nothing on the checklist",
                               message: "Documents, reservations to make, what to pack. Your AI can write one for this trip, or start your own below.")
                if model.journey.canEdit {
                    Button(PlanPart.checklist.draftAction) { Task { await model.draft(.checklist) } }
                        .buttonStyle(.lodestar(.ghost, small: true, isLoading: model.drafter.running == .checklist))
                        .disabled(model.drafter.isBusy)
                }
            }
            ForEach(Self.sections(tasks), id: \.self) { name in
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(name).textStyle(.label).foregroundStyle(Color.charcoal)
                    ForEach(tasks.filter { $0.section == name }) { row($0) }
                }
            }
            if model.journey.canEdit { addForm(sections: Self.sections(tasks)) }
        }
    }

    private func row(_ task: TripTask) -> some View {
        HStack(spacing: Spacing.sm) {
            TripsCheckbox(isOn: task.done, label: task.title) { Task { await model.setDone(task, !task.done) } }
                .disabled(!model.journey.canEdit)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(task.title)
                    .textStyle(.bodySM)
                    .foregroundStyle(task.done ? Color.ash : Color.ink)
                    .strikethrough(task.done)
                if !task.done, let due = task.due {
                    let deadline = TripsText.deadline(due, today: .today())
                    Text("by \(DateText.monthDay(due))").textStyle(.caption).foregroundStyle(deadline?.tone?.color ?? Color.mute)
                }
            }
            Spacer()
            if model.journey.canEdit {
                IconButton(systemName: "trash", accessibilityLabel: "Delete \(task.title)") { Task { await model.deleteTask(task.id) } }
            }
        }
    }

    private func addForm(sections: [String]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            LodestarField(label: "Add to the checklist", text: $title, placeholder: "Book airport parking", submitLabel: .done, onSubmit: add)
            HStack(spacing: Spacing.sm) {
                Menu {
                    ForEach(Array(Set(sections + ["Before you go", "Packing"])).sorted(), id: \.self) { name in
                        Button(name) { section = name }
                    }
                } label: {
                    Label(section, systemImage: "folder")
                }
                .buttonStyle(.lodestar(.ghost, small: true))
                Spacer()
                Button("Add", action: add).buttonStyle(.lodestar(.ghost, small: true, isLoading: adding)).disabled(adding)
            }
            if let error { InlineError(message: error) }
        }
    }

    private func add() {
        adding = true
        Task {
            error = await model.addTask(title: title, section: section)
            if error == nil { title = "" }
            adding = false
        }
    }

    /// Sections in first-appearance order.
    nonisolated static func sections(_ tasks: [TripTask]) -> [String] {
        var out: [String] = []
        for t in tasks where !out.contains(t.section) { out.append(t.section) }
        return out
    }
}
