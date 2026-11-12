import SwiftUI

/// The place panel (`place-panel.tsx`): Google details plus the trip's own controls,
/// with a "k of n" pager through the day's stops.
struct TripsPlacePanel: View {
    let model: TripDetailModel
    let present: (TripsTripSheet) -> Void
    @State private var currentId: String
    @Environment(\.dismiss) private var dismiss

    init(model: TripDetailModel, startId: String, present: @escaping (TripsTripSheet) -> Void) {
        self.model = model
        self.present = present
        _currentId = State(initialValue: startId)
    }

    /// That day's live, non-note items in itinerary order.
    private var pager: [String] {
        guard let item = model.item(currentId) else { return [currentId] }
        let ids = TripsPlan.byItinerary(model.trip.items.filter { $0.startDate == item.startDate && $0.isLive && $0.kind != .note }).map(\.id)
        return ids.contains(currentId) ? ids : [currentId]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let item = model.item(currentId) {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        TripsPlaceGooglePart(model: model, item: item, present: present)
                        Hairline()
                        if model.journey.canEdit {
                            TripsPlaceTripPart(model: model, item: item, present: present) { dismiss() }
                        } else if let note = item.details.note {
                            Text(note).textStyle(.bodySM).foregroundStyle(Color.bodyText)
                        }
                    }
                    .padding(Sizes.sheetPadding)
                    .id(item.id)
                } else {
                    EmptyStateView(title: "That item doesn't exist.").padding(Sizes.sheetPadding)
                }
            }
            .canvasBackground()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                if pager.count > 1 { ToolbarItem(placement: .principal) { pagerControl } }
            }
        }
    }

    private var pagerControl: some View {
        let ids = pager
        let k = (ids.firstIndex(of: currentId) ?? 0)
        return HStack(spacing: Spacing.sm) {
            Button { currentId = ids[max(0, k - 1)] } label: { Image(systemName: "chevron.left") }
                .disabled(k == 0).accessibilityLabel("Previous stop")
            Text("\(k + 1) of \(ids.count)").textStyle(.caption).monospacedDigit().foregroundStyle(Color.mute)
            Button { currentId = ids[min(ids.count - 1, k + 1)] } label: { Image(systemName: "chevron.right") }
                .disabled(k == ids.count - 1).accessibilityLabel("Next stop")
        }
    }
}

/// The Google part: photos, open now, hours, rating, phone, website and "Open in" links.
private struct TripsPlaceGooglePart: View {
    let model: TripDetailModel
    let item: TripItem
    let present: (TripsTripSheet) -> Void
    @State private var pinning = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(item.title).textStyle(.headingMD).foregroundStyle(Color.ink)
            if item.details.isGooglePlace {
                google
            } else if let address = item.details.address ?? item.place {
                Text(address).textStyle(.bodySM).foregroundStyle(Color.mute)
            }
            if !item.details.isPinned && item.kind != .note && item.kind != .flight { pinSearch }
            openIn
        }
        .task(id: item.details.placeId) { await model.places.load(item.details.placeId) }
    }

    @ViewBuilder private var google: some View {
        switch model.places.state(for: item.details.placeId) {
        case .idle, .loading: LoadingStateView()
        case .failed(let message): ErrorStateView(message: message) { Task { await model.places.load(item.details.placeId) } }
        case .loaded(let place): TripsPlaceAbout(place: place) { present(.web($0)) }
        }
    }

    @ViewBuilder private var pinSearch: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Not on the map yet. Pick the place to pin it.").textStyle(.bodySM).foregroundStyle(Color.mute)
            TripsPinSearch(model: model, item: item)
        }
    }

    private var openIn: some View {
        let query = [item.title, item.details.address ?? item.place ?? model.journey.destination].compactMap { $0 }.joined(separator: " ")
        let links = TripsPlaceLinks.links(query: query, mapsUrl: model.places.state(for: item.details.placeId).value?.mapsUrl ?? item.details.url)
        return VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("Open in").textStyle(.label).foregroundStyle(Color.charcoal)
            FlowLayout(spacing: Spacing.sm) {
                ForEach(links, id: \.0) { name, url in
                    Button(name) { present(.web(url)) }.buttonStyle(.lodestar(.link))
                }
            }
        }
    }
}

/// Search inside the panel that pins the item to a picked place.
private struct TripsPinSearch: View {
    let model: TripDetailModel
    let item: TripItem
    @State private var search: TripsPlaceSearchModel
    @State private var busy = false

    init(model: TripDetailModel, item: TripItem) {
        self.model = model
        self.item = item
        _search = State(initialValue: TripsPlaceSearchModel(app: model.app, near: TripsPlan.searchCenter(model.trip.items, date: item.startDate)))
    }

    var body: some View {
        TripsPlaceSearchList(search: search, busy: busy) { s in
            busy = true
            Task {
                let details = await search.details(for: s)
                if let patch = TripsRequests.pin(s, details: details) {
                    await model.patchItem(item.id, patch)
                } else {
                    model.error = "That place has no map location."
                }
                busy = false
            }
        }
        .onAppear { search.query = item.title }
    }
}

/// About: open now, hours, rating, price level, phone, website, summary, photos.
struct TripsPlaceAbout: View {
    let place: PlaceDetails
    let open: (URL) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if !place.photos.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Spacing.sm) {
                        ForEach(place.photos, id: \.self) { name in
                            RemoteImage(source: API.Places.photoPath(name: name, width: 800)).frame(width: 220, height: 150)
                        }
                    }
                }
                .scrollClipDisabled()
            }
            HStack(spacing: Spacing.md) {
                if let openNow = place.openNow { StatusLabel(text: openNow ? "Open now" : "Closed now", tone: openNow ? .ok : .danger) }
                if let rating = place.rating {
                    Text("★ \(String(format: "%.1f", rating))" + (place.ratingCount.map { " (\($0.formatted()))" } ?? ""))
                        .textStyle(.caption).foregroundStyle(Color.bodyText)
                }
                if let level = place.priceLevel { Text(level).textStyle(.code).foregroundStyle(Color.mute) }
            }
            if let category = place.category { Text(category).textStyle(.caption).foregroundStyle(Color.mute) }
            if let address = place.address { Text(address).textStyle(.bodySM).foregroundStyle(Color.bodyText).textSelection(.enabled) }
            if let summary = place.summary { Text(summary).textStyle(.bodySM).foregroundStyle(Color.bodyText) }
            if !place.hours.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    ForEach(place.hours, id: \.self) { Text($0).textStyle(.caption).foregroundStyle(Color.mute) }
                }
            }
            HStack(spacing: Spacing.sm) {
                if let phone = place.phone, let tel = URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })") {
                    Link(destination: tel) { Label(phone, systemImage: "phone") }.buttonStyle(.lodestar(.ghost, small: true))
                }
                if let site = place.website.flatMap(URL.init(string:)) {
                    Button("Website") { open(site) }.buttonStyle(.lodestar(.ghost, small: true))
                }
            }
        }
    }
}

/// Search links the panel offers.
enum TripsPlaceLinks {
    static func links(query: String, mapsUrl: String?) -> [(String, URL)] {
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let maps = mapsUrl.flatMap(URL.init(string:)) ?? URL(string: "https://www.google.com/maps/search/?api=1&query=\(q)")
        return [
            ("Google Maps", maps),
            ("Google", URL(string: "https://www.google.com/search?q=\(q)")),
            ("Yelp", URL(string: "https://www.yelp.com/search?find_desc=\(q)")),
            ("Tripadvisor", URL(string: "https://www.tripadvisor.com/Search?q=\(q)")),
        ].compactMap { name, url in url.map { (name, $0) } }
    }
}
