import SwiftUI

/// Sheets the Trips home can open.
enum TripsHomeSheet: String, Identifiable {
    case newTrip, email, flint, wanderlog
    var id: String { rawValue }
}

/// Trips home (`components/journeys/journeys.tsx`).
struct TripsHomeView: View {
    static let heroParagraph = "Plan any trip day by day, with what to book, a checklist and a budget. Forward a confirmation or connect Flint and bookings file themselves."

    let model: TripsListModel
    let open: (TripsRoute) -> Void

    @State private var sheet: TripsHomeSheet?
    @State private var showPast = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    HeroTitle(line1: "Trips", paragraph: Self.heroParagraph)
                    actions
                    TripsMessages(error: model.error, notice: model.notice)
                    content
                }
                .padding(Spacing.gutter)
                .padding(.bottom, Spacing.xxl)
            }
            .task(id: model.app.focusedSavedTripID) { await focusSavedTrip(proxy) }
        }
        .canvasBackground()
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await model.load() }
        .task { await model.load() }
        .sheet(item: $sheet) { which in
            sheetView(which).presentationBackground(Color.card)
        }
    }

    /// "Set alerts" after a save in Search or Plan: reload so the new watch is listed, then scroll to it.
    private func focusSavedTrip(_ proxy: ScrollViewProxy) async {
        guard let id = model.app.focusedSavedTripID else { return }
        await model.fares.load()
        guard !Task.isCancelled else { return }
        model.app.focusedSavedTripID = nil
        guard model.fares.trips.contains(where: { $0.id == id }) else { return }
        withAnimation(Motion.fast) { proxy.scrollTo(id, anchor: .top) }
    }

    private var actions: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                Button("Plan a trip") { sheet = .newTrip }.buttonStyle(.lodestar(.primary, small: true))
                Button("Add by email") { sheet = .email }.buttonStyle(.lodestar(.ghost, small: true))
                Button("Connect Flint") { sheet = .flint }.buttonStyle(.lodestar(.ghost, small: true))
                Button("Wanderlog") { sheet = .wanderlog }.buttonStyle(.lodestar(.ghost, small: true))
            }
        }
        .scrollClipDisabled()
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .idle, .loading:
            SkeletonList(count: 3, height: 120)
        case .failed(let message):
            ErrorStateView(message: message) { Task { await model.load() } }
        case .loaded(let list):
            loaded(list)
        }
    }

    @ViewBuilder private func loaded(_ list: JourneyList) -> some View {
        if !list.mail.isEmpty {
            TripsMailCard(model: model, mail: list.mail)
        }
        if !list.unfiled.isEmpty {
            TripsUnfiledSection(model: model, items: list.unfiled, journeys: list.journeys.filter { $0.journey.isOwned })
        }
        if list.journeys.isEmpty {
            TripsStartCards { sheet = $0 }
        }
        let upcoming = model.upcoming()
        if !upcoming.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(title: "Upcoming")
                ForEach(upcoming) { journey in
                    Button { open(TripsRoute(id: journey.id)) } label: { TripsJourneyCard(journey: journey) }
                        .buttonStyle(.plain)
                }
            }
        }
        FareWatchSection(model: model.fares)
        pastSection
    }

    @ViewBuilder private var pastSection: some View {
        let past = model.past()
        if !past.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Button {
                    withAnimation(Motion.fast) { showPast.toggle() }
                } label: {
                    HStack {
                        Text("Past trips (\(past.count))").textStyle(.headingSM).foregroundStyle(Color.ink)
                        Spacer()
                        Image(systemName: showPast ? "chevron.up" : "chevron.down").foregroundStyle(Color.ash)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isHeader)
                if showPast {
                    VStack(spacing: 0) {
                        ForEach(past) { journey in
                            Button { open(TripsRoute(id: journey.id)) } label: { pastRow(journey) }.buttonStyle(.plain)
                            if journey.id != past.last?.id { Hairline() }
                        }
                    }
                    .card(padding: 0)
                }
            }
        }
    }

    private func pastRow(_ journey: JourneyWithItems) -> some View {
        HStack {
            Text(journey.journey.title).textStyle(.bodySM).foregroundStyle(Color.ink).lineLimit(1)
            Spacer()
            Text(DateText.tripRange(journey.journey.startDate, journey.journey.endDate))
                .textStyle(.caption).foregroundStyle(Color.ash)
                .layoutPriority(1)
        }
        .padding(.horizontal, Spacing.lg)
        .frame(minHeight: Sizes.button)
        .contentShape(Rectangle())
    }

    @ViewBuilder private func sheetView(_ which: TripsHomeSheet) -> some View {
        switch which {
        case .newTrip:
            TripFormSheet(mode: .create(model.app.aiStatus.defaultProvider?.displayName)) { form in
                let id = try await model.create(form)
                open(TripsRoute(id: id, tab: form.wantsDraft && model.app.aiStatus.anyConnected ? .itinerary : .overview,
                                draftWishes: form.wantsDraft && model.app.aiStatus.anyConnected ? form.wishes : nil))
            }
        case .email: TripsForwardingSheet(app: model.app)
        case .flint: TripsFlintSheet(app: model.app)
        case .wanderlog:
            TripsWanderlogSheet(app: model.app) { imported in
                model.notice = "Imported \(plural(imported, "trip")) from Wanderlog."
                Task { await model.load() }
            }
        }
    }
}
