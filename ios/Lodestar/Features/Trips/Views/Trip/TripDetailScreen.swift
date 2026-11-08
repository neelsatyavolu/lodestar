import SwiftUI

/// Sheets the trip page opens.
enum TripsTripSheet: Identifiable, Hashable {
    case edit
    case share
    case addItem(TripsAddItemForm.Choice, LocalDate)
    case addPlace(LocalDate)
    case place(String)
    case map
    case note(String?)
    case markBooked(String)
    case web(URL)

    var id: String {
        switch self {
        case .edit: "edit"
        case .share: "share"
        case .addItem(let c, let d): "add-\(c.rawValue)-\(d.string)"
        case .addPlace(let d): "place-add-\(d.string)"
        case .place(let id): "place-\(id)"
        case .map: "map"
        case .note(let id): "note-\(id ?? "new")"
        case .markBooked(let id): "booked-\(id)"
        case .web(let url): "web-\(url.absoluteString)"
        }
    }
}

/// The trip page (`journey-detail.tsx`): cover, tabs, and the sheets they open.
struct TripDetailScreen: View {
    @State private var model: TripDetailModel
    @State private var sheet: TripsTripSheet?
    @State private var confirmDelete = false
    @Environment(\.dismiss) private var dismiss
    private let route: TripsRoute

    init(app: AppState, journey: JourneyWithItems, route: TripsRoute, onChange: @escaping (TripDetail?) -> Void) {
        let model = TripDetailModel(app: app, journey: journey, openTab: route.tab)
        model.onChange = onChange
        _model = State(initialValue: model)
        self.route = route
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                TripCoverView(model: model, present: present, delete: { confirmDelete = true })
                TripTabBar(model: model)
                if let line = model.drafter.runningLine { LoadingStateView(message: line) }
                if model.drafter.isFullDraft || model.drafter.parts.count == 5 { TripsDraftProgress(runner: model.drafter) { part in Task { await model.draft(part) } } }
                TripsMessages(error: model.error ?? model.loadError, notice: model.notice)
                tabContent
            }
            .padding(Spacing.gutter)
            .padding(.bottom, Spacing.xxl)
        }
        .canvasBackground()
        .navigationTitle(model.journey.title)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.reload() }
        .task {
            await model.load()
            if let wishes = route.draftWishes, model.drafter.parts.isEmpty {
                await model.draftEverything(wishes: wishes)
            }
        }
        .sheet(item: $sheet) { which in
            TripSheetContent(model: model, sheet: which, present: present)
                .presentationBackground(Color.card)
        }
        .confirmationDialog("Delete \(model.journey.title)?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete trip", role: .destructive) {
                Task { if await model.delete() { dismiss() } }
            }
        } message: {
            Text("Everything in it goes too: the itinerary, checklist, notes and budget.")
        }
        .onChange(of: model.isDeleted) { _, gone in if gone && model.loadError != nil { dismiss() } }
    }

    private func present(_ next: TripsTripSheet) {
        sheet = next
    }

    @ViewBuilder private var tabContent: some View {
        switch model.tab {
        case .overview: TripOverviewTab(model: model, present: present)
        case .itinerary: TripItineraryTab(model: model, present: present)
        case .book: TripToBookTab(model: model, present: present)
        case .bookings: TripBookingsTab(model: model, present: present)
        case .budget: TripBudgetTab(model: model)
        case .checklist: TripChecklistTab(model: model)
        }
    }
}

/// The tab strip with the web's badges.
struct TripTabBar: View {
    let model: TripDetailModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                ForEach(TripsTab.allCases) { tab in
                    Chip(title: title(tab), isOn: model.tab == tab) {
                        withAnimation(Motion.fast) { model.tab = tab }
                    }
                }
            }
        }
        .scrollClipDisabled()
    }

    private func title(_ tab: TripsTab) -> String {
        switch tab {
        case .book:
            let n = model.toBook.count
            return n > 0 ? "\(tab.label) \(n)" : tab.label
        case .checklist:
            let tasks = model.trip.tasks
            return tasks.isEmpty ? tab.label : "\(tab.label) \(tasks.filter(\.done).count)/\(tasks.count)"
        default:
            return tab.label
        }
    }
}

/// Five segments for the full draft: done = accent, running = pulsing, failed = red with retry.
struct TripsDraftProgress: View {
    let runner: TripsDraftRunner
    let retry: (PlanPart) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            segments
            let failed = PlanPart.draftOrder.filter { runner.parts[$0] == .failed }
            if !runner.isBusy && !failed.isEmpty {
                FlowLayout(spacing: Spacing.sm) {
                    ForEach(failed, id: \.self) { part in
                        Button("Retry \(part.draftLabel.lowercased())") { retry(part) }.buttonStyle(.lodestar(.ghost, small: true))
                    }
                }
            }
        }
    }

    private var segments: some View {
        HStack(spacing: Spacing.xs) {
            ForEach(PlanPart.draftOrder, id: \.self) { part in
                let state = runner.parts[part] ?? .waiting
                Capsule()
                    .fill(color(state))
                    .frame(height: 4)
                    .opacity(state == .running ? 0.6 : 1)
                    .animation(state == .running ? .easeInOut(duration: 0.8).repeatForever() : nil, value: state)
                    .accessibilityLabel("\(part.draftLabel): \(label(state))")
            }
        }
    }

    private func color(_ s: TripsDraftRunner.PartState) -> Color {
        switch s {
        case .done: .accent
        case .running: .accent
        case .failed: .danger
        case .waiting: .stone
        }
    }

    private func label(_ s: TripsDraftRunner.PartState) -> String {
        switch s {
        case .done: "done"
        case .running: "running"
        case .failed: "failed"
        case .waiting: "waiting"
        }
    }
}
