import SwiftUI

/// A stop on a day (`stop-card.tsx`): pin, title, status, details, photo and actions.
struct TripsStopCard: View {
    let model: TripDetailModel
    let item: TripItem
    let pin: Int?
    let present: (TripsTripSheet) -> Void

    @State private var confirmRemove = false

    var body: some View {
        let colors = TripsPlan.dayColorIndex(model.trip.items)
        HStack(alignment: .top, spacing: Spacing.md) {
            pinBadge(color: Color.dayColor(colors[item.startDate] ?? 0))
            VStack(alignment: .leading, spacing: Spacing.xs) {
                titleRow
                let sub = TripsText.stopSubtitle(item)
                if !sub.isEmpty { Text(sub).textStyle(.caption).foregroundStyle(Color.mute).lineLimit(2) }
                if let text = item.details.note ?? item.details.why {
                    Text(text).textStyle(.bodySM).foregroundStyle(Color.bodyText).lineLimit(3)
                }
                chips
                if item.status == .suggested { ideaButtons }
            }
            Spacer(minLength: 0)
            photo
        }
        .padding(Spacing.md)
        .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
        .opacity(item.status == .cancelled ? 0.6 : 1)
        .contentShape(Rectangle())
        .onTapGesture { present(.place(item.id)) }
        .contextMenu { TripsItemMenu(model: model, item: item, present: present, confirmRemove: $confirmRemove) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: "Open") { present(.place(item.id)) }
        .confirmationDialog("Remove \(item.title)?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) { Task { await model.removeItem(item.id) } }
        }
        .task(id: item.details.placeId) { await model.places.load(item.details.placeId) }
    }

    @ViewBuilder private func pinBadge(color: Color) -> some View {
        if let pin {
            Text("\(pin)")
                .textStyle(.caption)
                .foregroundStyle(Color.accentOn)
                .frame(width: 24, height: 24)
                .background(color, in: Circle())
                .accessibilityLabel("Stop \(pin)")
        } else {
            Image(systemName: icon).foregroundStyle(Color.ash).frame(width: 24, height: 24)
        }
    }

    private var icon: String {
        switch item.kind {
        case .flight: "airplane"
        case .stay: "bed.double"
        case .dining: "fork.knife"
        case .transport: "car"
        case .activity: "ticket"
        case .note, .unknown: "note.text"
        }
    }

    private var titleRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
            Text(item.title)
                .textStyle(.bodyMD)
                .foregroundStyle(item.status == .cancelled ? Color.ash : Color.ink)
                .strikethrough(item.status == .cancelled)
                .multilineTextAlignment(.leading)
            TripsStatusPill(item: item)
            if model.busyItems.contains(item.id) { Spinner() }
        }
    }

    @ViewBuilder private var chips: some View {
        let time = TripsText.timeRange(item)
        let route = TripsText.route(item)
        if time != nil || route != nil {
            HStack(spacing: Spacing.sm) {
                if let time { Pill(text: time).fixedSize() }
                if let route { Text(route).textStyle(.code).foregroundStyle(Color.mute) }
            }
        }
    }

    private var ideaButtons: some View {
        HStack(spacing: Spacing.sm) {
            Button("Keep") { Task { await model.patchItem(item.id, TripsRequests.status(.planned)) } }
                .buttonStyle(.lodestar(.ghost, small: true))
            Button("Dismiss") { Task { await model.removeItem(item.id) } }
                .buttonStyle(.lodestar(.quiet, small: true))
        }
        .disabled(model.busyItems.contains(item.id))
    }

    @ViewBuilder private var photo: some View {
        if let name = model.places.state(for: item.details.placeId).value?.photos.first {
            RemoteImage(source: API.Places.photoPath(name: name, width: 320))
                .frame(width: 64, height: 64)
        }
    }
}

/// The stop's actions, shared by the card's context menu and the place panel.
struct TripsItemMenu: View {
    let model: TripDetailModel
    let item: TripItem
    let present: (TripsTripSheet) -> Void
    @Binding var confirmRemove: Bool

    var body: some View {
        if item.status == .planned {
            if item.details.reserve == true {
                Button("Doesn't need booking") { patch(TripsRequests.doesNotNeedBooking) }
            } else {
                Button("Needs booking") { patch(TripsRequests.needsBooking) }
            }
            Button("Mark booked") { present(.markBooked(item.id)) }
        }
        if item.status == .suggested {
            Button("Keep") { patch(TripsRequests.status(.planned)) }
        }
        if item.status == .booked {
            Button("Mark cancelled") { patch(TripsRequests.status(.cancelled)) }
        }
        Button(item.status == .suggested ? "Dismiss" : "Remove", role: .destructive) {
            if item.status == .suggested {
                Task { await model.removeItem(item.id) }
            } else {
                confirmRemove = true
            }
        }
    }

    private func patch(_ p: ItemPatch) {
        Task { await model.patchItem(item.id, p) }
    }
}
