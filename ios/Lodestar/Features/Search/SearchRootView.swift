import SwiftUI

/// The Search tab. Keeps the type name `SearchRootView()` (RootView references it).
struct SearchRootView: View {
    @Environment(AppState.self) private var app
    @State private var model: SearchModel?

    var body: some View {
        Group {
            if let model {
                SearchScreen(model: model)
            } else {
                Color.canvas.ignoresSafeArea()
            }
        }
        .onAppear {
            guard model == nil else { return }
            let created = SearchModel(service: .live(app.api), handle: { [app] in app.handle($0) })
            created.adopt(app.preferences, fillForm: true)
            model = created
        }
    }
}

private struct SearchScreen: View {
    @Bindable var model: SearchModel
    @Environment(AppState.self) private var app
    @State private var path: [Itinerary] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.xl) {
                        if model.result == nil {
                            HeroTitle(line1: "Lower fares.", line2: "Sellers you can trust.", paragraph: SearchCopy.hero)
                                .padding(.top, Spacing.xl)
                        }
                        SearchFormView(form: $model.form, isSearching: model.isSearching, onSubmit: runSearch)
                        preferenceRow
                        if let error = model.error {
                            InlineError(message: error).card()
                        }
                        content(proxy: proxy)
                    }
                    .padding(.horizontal, Spacing.gutter)
                    .padding(.bottom, Spacing.xxxl)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .canvasBackground()
            .navigationTitle("Search")
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Itinerary.self) { it in detail(it) }
        }
        .onChange(of: model.form) { _, form in publishForm(form) }
        .onChange(of: app.preferencesRevision) { _, _ in preferencesChanged() }
        .onChange(of: model.filters.trustedOnly) { _, on in app.trustedOnly = on }
        .onChange(of: app.trustedOnly) { _, on in model.filters.trustedOnly = on }
        .onChange(of: app.pendingFlightSearch) { _, _ in runPending() }
        .onAppear {
            model.filters.trustedOnly = app.trustedOnly
            publishForm(model.form)
            runPending()
        }
    }

    // MARK: - Sections

    private var preferenceRow: some View {
        FlowLayout(spacing: Spacing.xs + 2, lineSpacing: Spacing.xs + 2) {
            ForEach(SearchPreferenceChips.chips(app.preferences), id: \.self) { Pill(text: $0) }
            Button(app.isSignedIn ? "Edit preferences" : "Set alliances and preferences") { app.present(.preferences) }
                .buttonStyle(.lodestar(.link)).textStyle(.caption)
            if !app.isSignedIn {
                Button { app.present(.register) } label: {
                    Text("\(Text("· ").foregroundStyle(Color.ash))\(Text("create an account").foregroundStyle(Color.charcoal))\(Text(" to keep them").foregroundStyle(Color.ash))")
                }
                .buttonStyle(.plain).textStyle(.caption)
            }
        }
    }

    @ViewBuilder private func content(proxy: ScrollViewProxy) -> some View {
        if model.isSearching && model.result == nil {
            SkeletonList(count: 4, height: 96)
        } else if let result = model.result {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                if !result.warnings.isEmpty {
                    Text("Some extra checks didn't finish: \(result.warnings.joined(separator: "; "))")
                        .textStyle(.caption).foregroundStyle(Color.ash)
                }
                HackCardsView(hacks: model.hacks) { hack in onHack(hack, proxy: proxy) }
                DateStripView(days: model.calendar.days, selected: model.searched?.depart ?? model.form.depart) { day in
                    model.pick(day, preferences: app.preferences)
                }
                if model.calendar == .loading {
                    Text("Checking prices three days either side…").textStyle(.caption).foregroundStyle(Color.ash)
                }
                splitPanel(result).id(SearchCopy.splitAnchor)
                if result.itineraries.isEmpty {
                    EmptyStateView(title: SearchCopy.noFlights)
                } else {
                    saveControl(focus: nil, title: "Save trip and get alerts")
                    FlightResultsView(model: model, result: result)
                }
            }
            .opacity(model.isSearching ? 0.5 : 1)
            .allowsHitTesting(!model.isSearching)
            .animation(Motion.fast, value: model.isSearching)
        }
    }

    @ViewBuilder private func splitPanel(_ result: SearchResult) -> some View {
        if model.isSplitOpen, let pair = FlightResults.splitPair(result) {
            SplitPanelView(caution: pair.hack.caution, out: pair.out, back: pair.back, checks: model.checks,
                           trustedOnly: model.filters.trustedOnly) { model.isSplitOpen = false }
        }
    }

    private func saveControl(focus: Itinerary?, title: String) -> some View {
        TripSaveControl(
            state: model.saveState(focus?.id ?? ""),
            isSignedIn: app.isSignedIn,
            title: title,
            onSave: { Task { await model.saveTrip(focus: focus, preferences: app.preferences) } },
            onSignIn: { app.present(.signIn) },
            onOpen: { app.openSavedTrip(id: $0) }
        )
    }

    private func detail(_ it: Itinerary) -> some View {
        ItineraryDetailView(itinerary: it, checks: model.checks, trustedOnly: model.filters.trustedOnly) {
            if model.result?.itineraries.contains(where: { $0.id == it.id }) == true {
                saveControl(focus: it, title: "Save to Trips")
            }
        }
    }

    // MARK: - Actions

    private func runSearch() {
        model.search(preferences: app.preferences)
    }

    private func onHack(_ hack: Hack, proxy: ScrollViewProxy) {
        switch model.perform(hack, preferences: app.preferences) {
        case .focus(let it):
            withAnimation(Motion.enter) { proxy.scrollTo(it.id, anchor: .center) }
            path.append(it)
        case .openSplit:
            withAnimation(Motion.enter) { proxy.scrollTo(SearchCopy.splitAnchor, anchor: .top) }
        case .searched, .none:
            break
        }
    }

    /// Plan reads the form as its starting point, only when it has both airports.
    private func publishForm(_ form: SearchForm) {
        let ready = !form.from.isEmpty && !form.to.isEmpty
        app.flightForm = ready ? form.query(applying: app.preferences) : nil
    }

    /// New saved preferences fill the form and re-run the current search (web `savePreferences`).
    /// Signing out resets preferences to defaults without touching the form.
    private func preferencesChanged() {
        let prefs = app.preferences
        let fill = app.isSignedIn || prefs != .default
        model.adopt(prefs, fillForm: fill)
        if fill, let searched = model.searched {
            model.search(searched.applyingPreferences(prefs), preferences: prefs)
        }
    }

    private func runPending() {
        guard let query = app.pendingFlightSearch else { return }
        app.pendingFlightSearch = nil
        path = []
        model.search(SearchForm(query: query), preferences: app.preferences)
    }
}

enum SearchCopy {
    static let hero = "Live prices from Google Flights, checked seller by seller. Every search also tries nearby airports, nearby dates and two one-way tickets, and leaves out agencies we haven't vetted."
    static let noFlights = "No flights found for these dates. Try nearby dates or other airports."
    static let splitAnchor = "search-split"
}
