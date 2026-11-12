import SwiftUI

/// The Flights tab's card (`flight-card.tsx`): the airline's colours across the top, both airports
/// with their times large, a route line the plane moves along in the air, what's happening now,
/// and the facts row (confirmation, travelers, when to be at the airport, baggage).
struct TripsFlightCard: View {
    let item: TripItem
    let view: TripsFlightView
    let travelers: Int?
    let checkedAt: EpochMillis?
    let liveOn: Bool
    let open: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            HStack(alignment: .top, spacing: Spacing.md) {
                TripsFlightEnd(end: view.from, arriving: false)
                TripsFlightEnd(end: view.to, arriving: true)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.xl)
            TripsFlightTrack(progress: view.progress, label: TripsFlightText.trackLabel(view))
                .padding(.horizontal, Spacing.lg)
                .padding(.top, Spacing.lg)
            statusLine
            facts.padding(.top, Spacing.lg)
            footer
        }
        .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
    }

    private var header: some View {
        let brand = TripsAirlineBrand.of(view.airline)
        return Button(action: open) {
            HStack(spacing: Spacing.md) {
                if let code = view.airline {
                    LogoView(path: API.Logos.airlinePath(code: code), name: view.airlineName, size: 34)
                } else {
                    Image(systemName: "airplane").frame(width: 34, height: 34).background(Color.white.opacity(0.15), in: RoundedRectangle(cornerRadius: Radius.md))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(view.airlineName) · \(view.label)")
                        .font(.geist(.sansSemibold, size: 15, relativeTo: .callout))
                        .strikethrough(view.isCancelled)
                        .opacity(view.isCancelled ? 0.7 : 1)
                        .lineLimit(1)
                    Text([DateText.short(view.from.date), view.aircraft].compactMap { $0 }.joined(separator: " · "))
                        .font(.geist(.mono, size: 12, relativeTo: .caption))
                        .opacity(0.8)
                        .lineLimit(1)
                }
                Spacer(minLength: Spacing.sm)
                TripsFlightStatusBadge(view: view, onBrand: true)
            }
            .foregroundStyle(Color.white)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md + 2)
            .frame(maxWidth: .infinity, minHeight: 60)
            .background(Color.livery(brand.bg))
            .overlay(alignment: .bottom) { stripe(brand) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(view.airlineName) \(view.label), \(view.status)")
        .accessibilityHint("Opens the flight's details")
    }

    private func stripe(_ brand: TripsAirlineBrand) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(brand.stripe.enumerated()), id: \.offset) { _, hex in Rectangle().fill(Color.livery(hex)) }
        }
        .frame(height: 3)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var statusLine: some View {
        if let line = TripsFlightText.liveLine(view) {
            toneBar(line, tone: view.tone)
        } else if liveOn && !view.live && !view.isCancelled {
            toneBar("Live status, gate and delays show up within 30 days of the flight.", tone: .idle)
        }
    }

    private func toneBar(_ text: String, tone: TripsFlightView.Tone) -> some View {
        Text(text)
            .textStyle(.bodySM)
            .foregroundStyle(tone == .idle ? Color.mute : tone.color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.md - 2)
            .background(tone == .idle ? Color.elevated : tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: Radius.md))
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.lg)
    }

    private var facts: some View {
        VStack(spacing: 0) {
            Hairline()
            HStack(alignment: .top, spacing: 0) {
                factCell("Confirmation") {
                    if let code = item.confirmation { TripsCopyCode(code: code) } else { Text("—") }
                }
                factCell("Travelers") { Text((item.details.guests ?? travelers).map(String.init) ?? "—") }
            }
            Hairline()
            HStack(alignment: .top, spacing: 0) {
                factCell("Be at \(view.from.code ?? "the airport") by") { Text(view.from.beThere.map(ClockText.time12) ?? "—") }
                factCell("Baggage") { Text(view.to.baggage.map { "Carousel \($0)" } ?? "—") }
            }
        }
    }

    private func factCell<V: View>(_ label: String, @ViewBuilder value: @escaping () -> V) -> some View {
        TripsFact(label: label, value: value)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
    }

    @ViewBuilder private var footer: some View {
        let shift = TripsFlightText.shiftLine(view)
        if shift != nil || checkedAt != nil {
            Hairline()
            VStack(alignment: .leading, spacing: Spacing.xs) {
                if let shift { Text(shift) }
                if let checkedAt { Text("Live from AeroDataBox · checked \(checkedAt.asDate.formatted(date: .omitted, time: .shortened))") }
            }
            .textStyle(.caption)
            .foregroundStyle(Color.mute)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
        }
    }
}

/// One airport on the card: label, big code, local time with zone, the struck-through old time,
/// the city and the terminal and gate.
struct TripsFlightEnd: View {
    let end: TripsFlightView.End
    let arriving: Bool

    var body: some View {
        let align: HorizontalAlignment = arriving ? .trailing : .leading
        VStack(alignment: align, spacing: Spacing.xs) {
            Text(arriving ? "Arrive" : "Depart").font(.geist(.mono, size: 12, relativeTo: .caption)).foregroundStyle(Color.mute)
            Text(end.code ?? "—").font(.geist(.monoMedium, size: 32, relativeTo: .largeTitle)).foregroundStyle(Color.ink)
                .lineLimit(1).minimumScaleFactor(0.6)
                .padding(.top, Spacing.xs)
            time
            Text(end.was.map(ClockText.time12) ?? " ")
                .font(.geist(.mono, size: 12, relativeTo: .caption)).strikethrough(end.was != nil).foregroundStyle(Color.mute)
                .accessibilityLabel(end.was.map { "was \(ClockText.time12($0))" } ?? "")
            Text(end.city ?? end.name ?? " ").textStyle(.bodySM).foregroundStyle(Color.bodyText).lineLimit(1)
            Text(TripsFlightText.gateLine(end) ?? "Gate posted on travel day")
                .font(.geist(.mono, size: 12, relativeTo: .caption)).foregroundStyle(Color.mute)
                .multilineTextAlignment(arriving ? .trailing : .leading)
        }
        .frame(maxWidth: .infinity, alignment: arriving ? .trailing : .leading)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var time: some View {
        if let t = end.time {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
                Text(ClockText.time12(t)).font(.geist(.monoMedium, size: 20, relativeTo: .title3)).monospacedDigit().foregroundStyle(Color.ink)
                if let zone = end.zone { Text(zone).font(.geist(.mono, size: 12, relativeTo: .caption)).foregroundStyle(Color.mute) }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        } else {
            Text("Time not saved").textStyle(.bodySM).foregroundStyle(Color.mute)
        }
    }
}
