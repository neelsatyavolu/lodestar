import SwiftUI

/// A flight in the itinerary (`flight-segment.tsx`): one card for leaving, flying and landing, in
/// place of separate "SFO Terminal 1" and "Land at PHX" stops. The folded stops keep their pins and
/// open from their rows; the flight opens from its header.
struct TripsFlightSegment: View {
    let model: TripDetailModel
    let group: TripsFlightGroup
    let view: TripsFlightView
    let pins: [String: Int]
    let dayColor: Color
    let present: (TripsTripSheet) -> Void

    @State private var confirmRemove = false
    @Environment(\.dynamicTypeSize) private var typeSize

    private var flight: TripItem { group.flight }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Hairline()
            VStack(alignment: .leading, spacing: 0) {
                endRow(view.from, stop: group.departure, departing: true)
                airRow
                endRow(view.to, stop: group.arrival, departing: false)
            }
            .padding(.horizontal, Spacing.md)
            .padding(.top, Spacing.lg)
            .padding(.bottom, Spacing.md)
            if let code = flight.confirmation {
                Hairline()
                HStack(spacing: Spacing.xs) {
                    Text("Conf.").foregroundStyle(Color.mute)
                    TripsCopyCode(code: code).font(.geist(.monoMedium, size: 12, relativeTo: .caption)).foregroundStyle(Color.ink)
                }
                .textStyle(.caption)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.xs)
            }
        }
        .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
        .confirmationDialog("Remove \(flight.title)?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) { Task { await model.removeItem(flight.id) } }
        } message: {
            Text("The airport stops around it stay in the itinerary.")
        }
    }

    private var header: some View {
        HStack(spacing: Spacing.md) {
            if let code = view.airline {
                LogoView(path: API.Logos.airlinePath(code: code), name: view.airlineName, size: 28)
            } else {
                node(nil)
            }
            VStack(alignment: .leading, spacing: 2) {
                title
                let sub = TripsFlightText.segmentSubtitle(view, guests: flight.details.guests)
                if !sub.isEmpty {
                    Text(sub).font(.geist(.mono, size: 12, relativeTo: .caption)).monospacedDigit().foregroundStyle(Color.mute)
                        .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                }
                // At accessibility sizes the badge drops under the title so the name keeps its width.
                if typeSize.isAccessibilitySize { TripsFlightStatusBadge(view: view).padding(.top, Spacing.xs) }
            }
            .layoutPriority(1)
            Spacer(minLength: Spacing.xs)
            if !typeSize.isAccessibilitySize { TripsFlightStatusBadge(view: view) }
            if model.journey.canEdit { menu }
        }
        .padding(.leading, Spacing.md)
        .padding(.trailing, Spacing.xs)
        .padding(.vertical, Spacing.md)
        .contentShape(Rectangle())
        .onTapGesture { present(.place(flight.id)) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: "Open") { present(.place(flight.id)) }
    }

    private var title: some View {
        let cancelled = flight.status == .cancelled
        let route = view.from.code.flatMap { f in view.to.code.map { " · \(f) → \($0)" } } ?? ""
        return (Text("\(view.airlineName) \(view.label)").font(.geist(.sansSemibold, size: 15, relativeTo: .callout))
            + Text(route).font(.geist(.sans, size: 15, relativeTo: .callout)).foregroundStyle(Color.bodyText))
            .foregroundStyle(cancelled ? Color.ash : Color.ink)
            .strikethrough(cancelled)
            .lineLimit(typeSize.isAccessibilitySize ? 4 : 2)
    }

    private var menu: some View {
        Menu {
            Button("Flight details") { present(.place(flight.id)) }
            if flight.status == .planned { Button("Mark booked") { present(.markBooked(flight.id)) } }
            if flight.status == .booked {
                Button("Mark cancelled") { Task { await model.patchItem(flight.id, TripsRequests.status(.cancelled)) } }
            }
            Button("Remove", role: .destructive) { confirmRemove = true }
        } label: {
            Image(systemName: "ellipsis").font(.system(size: 14, weight: .medium)).foregroundStyle(Color.charcoal)
                .frame(width: Sizes.button, height: Sizes.button).contentShape(Rectangle())
        }
        .accessibilityLabel("Actions for \(flight.title)")
    }

    /// The stop's map number in its day colour, or a plane when the airport isn't pinned.
    private func node(_ stop: TripItem?) -> some View {
        let pin = stop.flatMap { pins[$0.id] }
        return ZStack {
            Circle().fill(pin == nil ? Color.accent : dayColor)
            if let pin {
                Text("\(pin)").font(.geist(.monoMedium, size: 12, relativeTo: .caption)).foregroundStyle(Color.accentOn)
            } else {
                Image(systemName: "airplane").font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.accentOn)
            }
        }
        .frame(width: 28, height: 28)
        .accessibilityHidden(true)
    }

    private func dashes(minHeight: CGFloat = 8) -> some View {
        Rectangle().fill(.clear).frame(width: 2).frame(minHeight: minHeight, maxHeight: .infinity)
            .overlay(Path { p in p.move(to: CGPoint(x: 1, y: 0)); p.addLine(to: CGPoint(x: 1, y: 2000)) }
                .stroke(Color.hairlineHover, style: StrokeStyle(lineWidth: 2, dash: [4, 4])))
            .clipped()
            .accessibilityHidden(true)
    }

    private func endRow(_ e: TripsFlightView.End, stop: TripItem?, departing: Bool) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(spacing: Spacing.xs + 2) {
                node(stop)
                if departing { dashes() }
            }
            .frame(width: 28)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                clock(e)
                airport(e, stop: stop, departing: departing)
            }
            .padding(.bottom, departing ? Spacing.sm : 0)
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var airRow: some View {
        HStack(alignment: .center, spacing: Spacing.md) {
            dashes(minHeight: 36).frame(width: 28)
            Label(TripsFlightText.airLine(view), systemImage: "airplane")
                .font(.geist(.mono, size: 12, relativeTo: .caption)).monospacedDigit().foregroundStyle(Color.mute)
                .padding(.vertical, Spacing.md)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func clock(_ e: TripsFlightView.End) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.xs + 2) {
            if let t = e.time {
                Text(ClockText.time12(t)).font(.geist(.monoMedium, size: 20, relativeTo: .title3)).monospacedDigit().foregroundStyle(Color.ink)
                if let zone = e.zone { Text(zone).font(.geist(.mono, size: 12, relativeTo: .caption)).foregroundStyle(Color.mute) }
                if let was = e.was {
                    Text(ClockText.time12(was)).font(.geist(.mono, size: 12, relativeTo: .caption)).strikethrough().foregroundStyle(Color.mute)
                }
            } else {
                Text("Time not saved").textStyle(.bodySM).foregroundStyle(Color.mute)
            }
        }
        .frame(minHeight: 28)
    }

    @ViewBuilder private func airport(_ e: TripsFlightView.End, stop: TripItem?, departing: Bool) -> some View {
        let sub = [TripsFlightText.gateLine(e) ?? (departing ? "Gate posted on travel day" : nil), departing ? nil : e.note]
            .compactMap { $0 }.joined(separator: " · ")
        let body = VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                Text(e.code ?? "—").font(.geist(.monoMedium, size: 13, relativeTo: .footnote)).foregroundStyle(Color.ink)
                    .padding(.horizontal, 6).padding(.vertical, 3)
                    .background(Color.elevated, in: RoundedRectangle(cornerRadius: Radius.xs))
                if let name = e.name { Text(name).textStyle(.bodySM).fontWeight(.medium).foregroundStyle(Color.ink).lineLimit(1) }
            }
            if !sub.isEmpty { Text(sub).textStyle(.caption).foregroundStyle(Color.mute).multilineTextAlignment(.leading) }
            if departing, let at = e.beThere {
                Label("Be there by \(ClockText.time12(at))", systemImage: "clock")
                    .textStyle(.caption).foregroundStyle(Color.warn)
            }
        }
        if let stop {
            Button { present(.place(stop.id)) } label: { body.contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .accessibilityHint("Opens \(stop.title)")
        } else {
            body
        }
    }
}
