import SwiftUI

/// Checklist (`ChecklistTab` in `checklist-tab.tsx`). Packing items live on their own tab.
struct TripChecklistTab: View {
    let model: TripDetailModel

    @State private var section = "Before you go"

    var body: some View {
        let tasks = model.trip.tasks.filter { !$0.isPacking }
        let done = tasks.filter(\.done).count
        let sections = Self.sections(tasks)
        VStack(alignment: .leading, spacing: Spacing.lg) {
            SectionHeader(title: "Checklist", detail: tasks.isEmpty ? nil : "\(done) of \(tasks.count) done")
            if !tasks.isEmpty {
                ProgressView(value: Double(done), total: Double(tasks.count))
                    .tint(Color.accent)
                    .accessibilityLabel("\(done) of \(tasks.count) done")
            }
            if tasks.isEmpty {
                EmptyStateView(title: "Nothing on the checklist",
                               message: "Documents, reservations to make, things to sort before you leave. Your AI can write one for this trip, or start your own below.")
                if model.journey.canEdit {
                    Button(PlanPart.checklist.draftAction) { Task { await model.draft(.checklist) } }
                        .buttonStyle(.lodestar(.ghost, small: true, isLoading: model.drafter.running == .checklist))
                        .disabled(model.drafter.isBusy)
                }
            }
            ForEach(sections, id: \.self) { name in
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(name).textStyle(.label).foregroundStyle(Color.charcoal)
                    ForEach(tasks.filter { $0.section == name }) { TripTaskRow(model: model, task: $0) }
                }
            }
            if model.journey.canEdit {
                TripTaskAddForm(model: model, label: "Add to the checklist", placeholder: "Book airport parking", section: section) {
                    Menu {
                        ForEach(Array(Set(sections + ["Before you go", "Bookings"])).sorted(), id: \.self) { name in
                            Button(name) { section = name }
                        }
                    } label: {
                        Label(section, systemImage: "folder")
                    }
                    .buttonStyle(.lodestar(.ghost, small: true))
                }
            }
        }
    }

    /// Sections in first-appearance order.
    nonisolated static func sections(_ tasks: [TripTask]) -> [String] {
        var out: [String] = []
        for t in tasks where !out.contains(t.section) { out.append(t.section) }
        return out
    }
}

/// Packing (`PackingTab` in `checklist-tab.tsx`): the checklist's "Packing" section.
struct TripPackingTab: View {
    let model: TripDetailModel

    var body: some View {
        let items = model.trip.tasks.filter(\.isPacking)
        let packed = items.filter(\.done).count
        VStack(alignment: .leading, spacing: Spacing.lg) {
            SectionHeader(title: "Packing", detail: items.isEmpty ? nil : "\(packed) of \(items.count) packed")
            if items.isEmpty {
                EmptyStateView(title: "Nothing to pack yet",
                               message: "Add what to bring below, or ask your AI to fill in the packing list for this trip.")
            } else {
                ProgressView(value: Double(packed), total: Double(items.count))
                    .tint(Color.accent)
                    .accessibilityLabel("\(packed) of \(items.count) packed")
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    ForEach(items) { TripTaskRow(model: model, task: $0) }
                }
            }
            if model.journey.canEdit {
                TripTaskAddForm(model: model, label: "Add to the packing list", placeholder: "Phone charger", section: TripTask.packingSection) { EmptyView() }
            }
        }
    }
}

/// A checklist or packing row: tick, title, due date, delete.
private struct TripTaskRow: View {
    let model: TripDetailModel
    let task: TripTask

    var body: some View {
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
}

/// The add field under a list, with an optional control (the section menu) beside Add.
private struct TripTaskAddForm<Accessory: View>: View {
    let model: TripDetailModel
    let label: String
    let placeholder: String
    let section: String
    @ViewBuilder let accessory: () -> Accessory

    @State private var title = ""
    @State private var error: String?
    @State private var adding = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            LodestarField(label: label, text: $title, placeholder: placeholder, submitLabel: .done, onSubmit: add)
            HStack(spacing: Spacing.sm) {
                accessory()
                Spacer()
                Button("Add", action: add)
                    .buttonStyle(.lodestar(.ghost, small: true, isLoading: adding))
                    .disabled(adding || title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let error { InlineError(message: error) }
        }
    }

    private func add() {
        guard !adding, !title.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        adding = true
        Task {
            error = await model.addTask(title: title, section: section)
            if error == nil { title = "" }
            adding = false
        }
    }
}
