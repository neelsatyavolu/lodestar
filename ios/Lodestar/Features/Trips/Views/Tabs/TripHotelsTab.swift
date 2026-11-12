import SwiftUI

/// Hotels (`hotels-tab.tsx`): every stay with its photo, check-in and check-out with the nights
/// between, and the confirmation, phone and directions in one place.
struct TripHotelsTab: View {
    let model: TripDetailModel
    let present: (TripsTripSheet) -> Void

    var body: some View {
        let stays = TripsHotels.stays(model.trip.items)
        let day = model.activeDay ?? model.journey.startDate ?? .today()
        VStack(alignment: .leading, spacing: Spacing.lg) {
            HStack(alignment: .bottom) {
                SectionHeader(title: "Hotels", detail: stays.isEmpty ? nil : "Every stay on the trip, with check-in times and how to reach the front desk.")
                if model.journey.canEdit && !stays.isEmpty {
                    Button { present(.addItem(.stay, day)) } label: { Label("Add stay", systemImage: "plus") }
                        .buttonStyle(.lodestar(.ghost, small: true))
                }
            }
            if stays.isEmpty {
                EmptyStateView(title: "No hotels yet",
                               message: "Forward a booking confirmation to your Lodestar address, or add a stay by hand. For ideas with live prices, use Find hotels on the Itinerary tab.",
                               actionTitle: model.journey.canEdit ? "Add stay" : nil) { present(.addItem(.stay, day)) }
            }
            ForEach(stays) { stay in
                TripsHotelCard(model: model, stay: stay, present: present)
            }
            if !stays.isEmpty, let gaps = TripsHotels.gapLine(start: model.journey.startDate, end: model.journey.endDate, items: model.trip.items) {
                Text(gaps)
                    .textStyle(.bodySM).foregroundStyle(Color.mute)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Spacing.lg).padding(.vertical, Spacing.md)
                    .overlay(RoundedRectangle(cornerRadius: Radius.lg)
                        .strokeBorder(Color.hairlineStrong, style: StrokeStyle(lineWidth: Sizes.hairline, dash: [4, 3])))
            }
        }
    }
}

/// One stay: Google photo, rating, name in Newsreader, address and description, the check-in and
/// check-out band, the facts row and the contact links.
struct TripsHotelCard: View {
    let model: TripDetailModel
    let stay: TripItem
    let present: (TripsTripSheet) -> Void

    private var place: PlaceDetails? { model.places.state(for: stay.details.placeId).value }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            photo
            VStack(alignment: .leading, spacing: Spacing.lg) {
                about
                stayBand
                facts
                links
            }
            .padding(Spacing.lg)
        }
        .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
        .task(id: stay.details.placeId) { await model.places.load(stay.details.placeId) }
    }

    @ViewBuilder private var photo: some View {
        if let name = place?.photos.first {
            RemoteImage(source: API.Places.photoPath(name: name, width: 800), cornerRadius: 0)
                .frame(height: 168)
                .frame(maxWidth: .infinity)
                .clipped()
                .onTapGesture { present(.place(stay.id)) }
                .accessibilityHidden(true)
        } else {
            Image(systemName: "bed.double").font(.system(size: 26)).foregroundStyle(Color.stone)
                .frame(maxWidth: .infinity, minHeight: 96)
                .background(Color.elevated)
                .accessibilityHidden(true)
        }
    }

    private var about: some View {
        let cancelled = stay.status == .cancelled
        let address = place?.address ?? stay.details.address ?? stay.place
        return VStack(alignment: .leading, spacing: Spacing.xs + 2) {
            HStack(spacing: Spacing.sm) {
                rating
                TripsStatusPill(item: stay)
            }
            Button { present(.place(stay.id)) } label: {
                Text(stay.title).textStyle(.headline)
                    .foregroundStyle(cancelled ? Color.ash : Color.ink).strikethrough(cancelled)
                    .multilineTextAlignment(.leading)
            }
            .buttonStyle(.plain)
            if let address { Text(address).textStyle(.bodySM).foregroundStyle(Color.mute) }
            if let summary = place?.summary ?? stay.details.note {
                Text(summary).textStyle(.bodySM).foregroundStyle(Color.bodyText).padding(.top, Spacing.xs)
            }
        }
    }

    @ViewBuilder private var rating: some View {
        if let value = place?.rating ?? stay.details.rating {
            HStack(spacing: Spacing.xs) {
                Image(systemName: "star.fill").font(.system(size: 11)).foregroundStyle(Color.warn)
                Text(String(format: "%.1f", value)).foregroundStyle(Color.bodyText)
                if let count = place?.ratingCount { Text("(\(count.formatted()))").foregroundStyle(Color.mute) }
                if let level = place?.priceLevel { Text("· \(level)").foregroundStyle(Color.mute) }
            }
            .font(.geist(.mono, size: 12, relativeTo: .caption)).monospacedDigit()
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Rated \(String(format: "%.1f", value))")
        }
    }

    private var stayBand: some View {
        let nights = TripsHotels.nights(stay)
        return HStack(alignment: .center, spacing: Spacing.md) {
            bandEnd("Check-in", day: stay.startDate, time: stay.startTime.map { "from \(ClockText.time12($0))" }, trailing: false)
            VStack(spacing: 0) {
                Text(nights.map(String.init) ?? "—").font(.geist(.monoMedium, size: 18, relativeTo: .title3)).foregroundStyle(Color.ink)
                Text(nights == 1 ? "night" : "nights").font(.geist(.mono, size: 12, relativeTo: .caption)).foregroundStyle(Color.mute)
            }
            .accessibilityElement(children: .combine)
            bandEnd("Check-out", day: stay.endDate, time: stay.endTime.map { "by \(ClockText.time12($0))" }, trailing: true)
        }
        .padding(.horizontal, Spacing.md + 2)
        .padding(.vertical, Spacing.md)
        .background(Color.elevated, in: RoundedRectangle(cornerRadius: Radius.md))
    }

    private func bandEnd(_ label: String, day: LocalDate?, time: String?, trailing: Bool) -> some View {
        VStack(alignment: trailing ? .trailing : .leading, spacing: Spacing.xs) {
            Text(label).font(.geist(.mono, size: 12, relativeTo: .caption)).foregroundStyle(Color.mute)
            Text(day.map(DateText.short) ?? "—").font(.geist(.monoMedium, size: 15, relativeTo: .callout)).foregroundStyle(Color.ink)
                .lineLimit(1).minimumScaleFactor(0.8)
            Text(time ?? " ").font(.geist(.mono, size: 12, relativeTo: .caption)).foregroundStyle(Color.mute)
        }
        .frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
        .accessibilityElement(children: .combine)
    }

    private var facts: some View {
        let price = stay.details.price ?? stay.details.estimate
        return HStack(alignment: .top, spacing: Spacing.md) {
            TripsFact(label: "Confirmation") {
                if let code = stay.confirmation { TripsCopyCode(code: code) } else { Text("—") }
            }
            TripsFact(label: "Guests") { Text(stay.details.guests.map(String.init) ?? "—") }
            TripsFact(label: stay.details.price != nil ? "Total" : "Estimate") {
                Text(price.map { Money.amount($0, currency: stay.details.currencyCode) } ?? "—")
            }
        }
    }

    @ViewBuilder private var links: some View {
        let address = place?.address ?? stay.details.address ?? stay.place
        let maps = TripsHotels.directionsURL(title: stay.title, address: address)
        let phone = place?.phone ?? stay.details.phone
        let site = (place?.website ?? stay.details.url).flatMap(URL.init(string:))
        if maps != nil || phone != nil || site != nil {
            FlowLayout(spacing: Spacing.lg) {
                if let maps { Button { present(.web(maps)) } label: { Label("Directions", systemImage: "arrow.up.right") } }
                if let phone, let tel = TripsHotels.phoneURL(phone) { Link(phone, destination: tel).monospacedDigit() }
                if let site {
                    Button { present(.web(site)) } label: { Label(place?.website != nil ? "Website" : "Booking", systemImage: "arrow.up.right") }
                }
            }
            .buttonStyle(.lodestar(.link))
            .textStyle(.bodySM)
            .tint(Color.accent)
            .frame(minHeight: Sizes.button)
        }
    }
}
