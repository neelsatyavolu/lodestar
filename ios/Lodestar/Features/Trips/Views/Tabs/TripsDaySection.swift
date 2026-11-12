import SwiftUI

/// One day of the itinerary (`day-section.tsx`): the stay you wake up in, the stops in order with
/// the drive between each (never across a flight), a flight as one card with its airport stops
/// folded in, the hotel you check into or head back to, and the AI's ideas apart.
struct TripsDaySection: View {
    let model: TripDetailModel
    let day: LocalDate
    let index: Int
    let present: (TripsTripSheet) -> Void

    @State private var folded = false

    private var items: [TripItem] { model.trip.items }

    var body: some View {
        let colors = TripsPlan.dayColorIndex(items)
        let color = Color.dayColor(colors[day] ?? index)
        let plan = TripsDayPlan(items: items, date: day)
        VStack(alignment: .leading, spacing: Spacing.sm) {
            header(color: color, plan: plan)
            if !folded {
                content(plan: plan, pins: TripsPlan.pinNumbers(items), color: color)
            }
        }
        .padding(.vertical, Spacing.sm)
        .task(id: legSignature) { await model.loadLegs(for: day) }
    }

    private var legSignature: String {
        TripsPlan.dayStops(items, date: day).map { "\($0.id)@\($0.details.lat ?? 0),\($0.details.lng ?? 0)" }.joined(separator: "|")
    }

    private func header(color: Color, plan: TripsDayPlan) -> some View {
        let summary = TripsPlan.daySummary(start: model.journey.startDate, end: model.journey.endDate, items: items, date: day)
        let driving = plan.driveSeconds(model.legs[day]?.legs ?? [])
        return Button {
            withAnimation(Motion.fast) { folded.toggle() }
            model.activeDay = day
        } label: {
            HStack(alignment: .top, spacing: Spacing.md) {
                Circle().fill(color).frame(width: 10, height: 10).padding(.top, 7).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(DateText.long(day)).textStyle(.headingSM).foregroundStyle(Color.ink)
                    Text("Day \(index + 1)" + (summary.isEmpty ? (folded ? " · Nothing planned" : "") : " · \(summary)"))
                        .textStyle(.caption).foregroundStyle(Color.mute).lineLimit(2).multilineTextAlignment(.leading)
                    if driving > 0 {
                        Label("\(TripsText.driveTotal(seconds: driving)) driving", systemImage: "car")
                            .font(.geist(.mono, size: 12, relativeTo: .caption)).monospacedDigit().foregroundStyle(Color.mute)
                            .padding(.top, 2)
                    }
                }
                Spacer(minLength: Spacing.sm)
                Image(systemName: folded ? "chevron.down" : "chevron.up").font(.system(size: 13)).foregroundStyle(Color.ash).padding(.top, 6)
            }
            .frame(minHeight: Sizes.button)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(folded ? "Shows the day" : "Hides the day")
    }

    @ViewBuilder private func content(plan: TripsDayPlan, pins: [String: Int], color: Color) -> some View {
        ForEach(plan.morning) { stay in
            stayRow(stay)
            if let leg = plan.legAfterMorning(stay) { legRow(leg) }
        }
        ForEach(Array(plan.firm.enumerated()), id: \.element.id) { k, item in
            if item.kind == .flight, let group = plan.groups[item.id] {
                TripsFlightSegment(model: model, group: group, view: TripsFlightView(group: group, status: model.flightStatus(item.id)),
                                   pins: pins, dayColor: color, present: present)
                if let leg = plan.legAfterFlight(group) { legRow(leg) }
            } else if item.kind == .note {
                noteCard(item, inLeg: plan.noteInLeg(at: k))
            } else {
                TripsStopCard(model: model, item: item, pin: pins[item.id], present: present)
                if let leg = plan.legAfter(item) { legRow(leg) }
            }
        }
        ForEach(plan.evening) { stayRow($0) }
        if let night = plan.night { stayRow(night) }
        if !plan.ideas.isEmpty {
            Text("Ideas for this day").textStyle(.label).foregroundStyle(Color.charcoal).padding(.top, Spacing.sm)
            ForEach(plan.ideas) { TripsStopCard(model: model, item: $0, pin: nil, present: present) }
        }
        if model.journey.canEdit {
            let empty = plan.firm.isEmpty && plan.ideas.isEmpty
            Button { present(.addPlace(day)) } label: {
                Label(empty ? "Nothing planned yet. Add a place" : "Add a place", systemImage: "plus")
            }
            .buttonStyle(.lodestar(.quiet, small: true))
            .frame(minHeight: Sizes.button)
        }
    }

    /// "7 min · 2.8 mi" with a car (a walker under a kilometre), on the dashed route line.
    private func legRow(_ pair: (from: TripItem, to: TripItem)) -> some View {
        let leg = model.leg(from: pair.from.id, to: pair.to.id, on: day)?.leg
        return HStack(spacing: Spacing.sm) {
            dashedLine.frame(width: 24, height: 28)
            Image(systemName: leg.map { $0.meters < 1000 } == true ? "figure.walk" : "car")
                .font(.system(size: 13)).foregroundStyle(Color.ash)
            if let leg {
                Text(DurationText.leg(seconds: leg.seconds, meters: leg.meters))
                    .font(.geist(.mono, size: 12, relativeTo: .caption)).monospacedDigit().foregroundStyle(Color.mute)
            }
            if let url = Self.directionsURL(from: pair.from, to: pair.to) {
                Button { present(.web(url)) } label: { Label("Directions", systemImage: "arrow.up.right") }
                    .buttonStyle(.lodestar(.quiet, small: true))
                    .frame(minHeight: Sizes.button)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
    }

    private var dashedLine: some View {
        Path { p in p.move(to: CGPoint(x: 12, y: 0)); p.addLine(to: CGPoint(x: 12, y: 28)) }
            .stroke(Color.hairlineHover, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            .accessibilityHidden(true)
    }

    private func stayRow(_ stay: TripItem) -> some View {
        Button { present(.place(stay.id)) } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: "bed.double").foregroundStyle(Color.charcoal).frame(width: 24)
                Text(stay.title).textStyle(.bodySM).foregroundStyle(Color.bodyText).lineLimit(1)
                Spacer(minLength: Spacing.sm)
                if let line = TripsText.stayLine(stay, on: day) {
                    Text(line).textStyle(.caption).foregroundStyle(Color.mute)
                }
            }
            .padding(.horizontal, Spacing.xs)
            .frame(minHeight: Sizes.button)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func noteCard(_ item: TripItem, inLeg: Bool) -> some View {
        let card = Button { present(.place(item.id)) } label: {
            HStack(alignment: .top, spacing: Spacing.md) {
                Image(systemName: "note.text").foregroundStyle(Color.ash).frame(width: 20)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(item.title).textStyle(.bodySM).foregroundStyle(Color.ink).multilineTextAlignment(.leading)
                    if let note = item.details.note { Text(note).textStyle(.caption).foregroundStyle(Color.mute).multilineTextAlignment(.leading) }
                }
                Spacer(minLength: 0)
            }
            .padding(Spacing.md)
            .background(Color.elevated, in: RoundedRectangle(cornerRadius: Radius.lg))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        if inLeg {
            // Between two stops: the drive's dashed line keeps going past the note to the next stop.
            HStack(alignment: .top, spacing: Spacing.sm) {
                Path { p in p.move(to: CGPoint(x: 12, y: 0)); p.addLine(to: CGPoint(x: 12, y: 4000)) }
                    .stroke(Color.hairlineHover, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .frame(width: 24)
                    .clipped()
                    .accessibilityHidden(true)
                card
            }
            .fixedSize(horizontal: false, vertical: true)
        } else {
            card
        }
    }

    /// Google Maps directions between two pinned stops.
    nonisolated static func directionsURL(from: TripItem, to: TripItem) -> URL? {
        guard let a = from.details.lat, let b = from.details.lng, let c = to.details.lat, let d = to.details.lng else { return nil }
        var components = URLComponents(string: "https://www.google.com/maps/dir/")
        components?.queryItems = [
            URLQueryItem(name: "api", value: "1"),
            URLQueryItem(name: "origin", value: "\(a),\(b)"),
            URLQueryItem(name: "destination", value: "\(c),\(d)"),
        ]
        return components?.url
    }
}
