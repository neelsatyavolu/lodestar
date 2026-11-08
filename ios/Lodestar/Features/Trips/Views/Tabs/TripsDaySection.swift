import SwiftUI

/// One day of the itinerary (`day-section.tsx`).
struct TripsDaySection: View {
    let model: TripDetailModel
    let day: LocalDate
    let index: Int
    let present: (TripsTripSheet) -> Void

    @State private var folded = false

    private var items: [TripItem] { model.trip.items }

    var body: some View {
        let colors = TripsPlan.dayColorIndex(items)
        let pins = TripsPlan.pinNumbers(items)
        VStack(alignment: .leading, spacing: Spacing.md) {
            header(color: Color.dayColor(colors[day] ?? index))
            if !folded {
                content(pins: pins)
            }
        }
        .padding(.vertical, Spacing.sm)
        .task(id: legSignature) { await model.loadLegs(for: day) }
    }

    private var legSignature: String {
        TripsPlan.dayStops(items, date: day).map { "\($0.id)@\($0.details.lat ?? 0),\($0.details.lng ?? 0)" }.joined(separator: "|")
    }

    private var firm: [TripItem] {
        TripsPlan.byItinerary(items.filter { $0.startDate == day && $0.status != .suggested && $0.kind != .stay })
    }

    private func header(color: Color) -> some View {
        let summary = TripsPlan.daySummary(start: model.journey.startDate, end: model.journey.endDate, items: items, date: day)
        let driving = model.legs[day]?.legs.compactMap(\.leg).map(\.seconds).reduce(0, +) ?? 0
        return Button {
            withAnimation(Motion.fast) { folded.toggle() }
            model.activeDay = day
        } label: {
            HStack(alignment: .top, spacing: Spacing.md) {
                Circle().fill(color).frame(width: 10, height: 10).padding(.top, 6).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(DateText.long(day)).textStyle(.headingSM).foregroundStyle(Color.ink)
                    Text("Day \(index + 1)" + (summary.isEmpty ? (folded ? " · Nothing planned" : "") : " · \(summary)"))
                        .textStyle(.caption).foregroundStyle(Color.mute).lineLimit(2).multilineTextAlignment(.leading)
                }
                Spacer(minLength: Spacing.sm)
                if driving > 0 {
                    Label(TripsText.driveTotal(seconds: driving), systemImage: "car").textStyle(.caption).foregroundStyle(Color.ash)
                }
                Image(systemName: folded ? "chevron.down" : "chevron.up").foregroundStyle(Color.ash).padding(.top, 4)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(folded ? "Shows the day" : "Hides the day")
    }

    @ViewBuilder private func content(pins: [String: Int]) -> some View {
        let waking = items.filter { $0.kind == .stay && $0.isLive && $0.startDate < day && ($0.endDate ?? $0.startDate) >= day }
        let checkIns = items.filter { $0.kind == .stay && $0.isLive && $0.startDate == day }
        let ideas = TripsPlan.byItinerary(items.filter { $0.startDate == day && $0.status == .suggested && $0.kind != .stay })
        let firm = self.firm

        ForEach(waking) { stay in
            stayRow(stay, line: stay.endDate == day ? "Check out" + (stay.endTime.map { " \(ClockText.time12($0))" } ?? "") : "Staying at")
        }
        ForEach(Array(firm.enumerated()), id: \.element.id) { offset, item in
            if let previous = previousStop(before: offset, in: firm), item.details.isPinned, isStop(item) {
                legRow(from: previous, to: item)
            }
            if item.kind == .note {
                noteCard(item)
            } else {
                TripsStopCard(model: model, item: item, pin: pins[item.id], present: present)
            }
        }
        ForEach(checkIns) { stay in
            stayRow(stay, line: "Check in" + (stay.startTime.map { " \(ClockText.time12($0))" } ?? ""))
        }
        if !ideas.isEmpty {
            Text("Ideas for this day").textStyle(.label).foregroundStyle(Color.charcoal)
            ForEach(ideas) { TripsStopCard(model: model, item: $0, pin: nil, present: present) }
        }
        Button(firm.isEmpty && checkIns.isEmpty && waking.isEmpty ? "Nothing planned yet. Add a place" : "Add a place") {
            present(.addPlace(day))
        }
        .buttonStyle(.lodestar(.ghost, small: true))
    }

    private func isStop(_ item: TripItem) -> Bool {
        item.isLive && item.kind != .flight && item.kind != .note && item.details.isPinned
    }

    private func previousStop(before offset: Int, in list: [TripItem]) -> TripItem? {
        list[..<offset].last(where: isStop)
    }

    @ViewBuilder private func legRow(from: TripItem, to: TripItem) -> some View {
        if let found = model.leg(from: from.id, to: to.id, on: day), let leg = found.leg {
            HStack(spacing: Spacing.sm) {
                Image(systemName: leg.meters < 1000 ? "figure.walk" : "car").foregroundStyle(Color.ash)
                Text(DurationText.leg(seconds: leg.seconds, meters: leg.meters)).textStyle(.caption).foregroundStyle(Color.mute)
                Spacer()
                if let url = Self.directionsURL(from: from, to: to) {
                    Button("Directions") { present(.web(url)) }.buttonStyle(.lodestar(.link))
                }
            }
            .padding(.leading, Spacing.xl)
        }
    }

    private func stayRow(_ stay: TripItem, line: String) -> some View {
        Button { present(.place(stay.id)) } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: "bed.double").foregroundStyle(Color.ash).frame(width: 20)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(stay.title).textStyle(.bodySM).foregroundStyle(Color.ink)
                    Text(line).textStyle(.caption).foregroundStyle(Color.mute)
                }
                Spacer()
                TripsStatusPill(item: stay)
            }
            .padding(Spacing.md)
            .background(Color.elevated, in: RoundedRectangle(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
    }

    private func noteCard(_ item: TripItem) -> some View {
        Button { present(.place(item.id)) } label: {
            HStack(alignment: .top, spacing: Spacing.md) {
                Image(systemName: "note.text").foregroundStyle(Color.ash).frame(width: 20)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(item.title).textStyle(.bodySM).foregroundStyle(Color.ink).multilineTextAlignment(.leading)
                    if let note = item.details.note { Text(note).textStyle(.caption).foregroundStyle(Color.mute) }
                }
                Spacer()
            }
            .padding(Spacing.md)
            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairline, lineWidth: Sizes.hairline))
        }
        .buttonStyle(.plain)
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
