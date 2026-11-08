import SwiftUI

/// One itinerary in full: every leg and layover, then "Who sells this" with the seller check.
/// Opening it starts the seller check when none exists. `accessory` hosts Save to Trips.
struct ItineraryDetailView<Accessory: View>: View {
    let itinerary: Itinerary
    let checks: FlightSellerChecks
    let trustedOnly: Bool
    @ViewBuilder var accessory: () -> Accessory

    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                summary
                ForEach(Array(itinerary.slices.enumerated()), id: \.offset) { index, slice in
                    FlightSliceDetail(slice: slice, label: FlightText.longLabel(index: index, of: itinerary))
                }
                Hairline()
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text("Who sells this").textStyle(.caption).foregroundStyle(Color.ash)
                    sellers
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.vertical, Spacing.xl)
        }
        .canvasBackground()
        .navigationTitle(FlightText.tripKind(itinerary).capitalized)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { checks.checkIfNeeded(itinerary) }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .firstTextBaseline) {
                Text(Money.usd(FlightResults.displayPrice(itinerary, state: checks.state(for: itinerary.id), trustedOnly: trustedOnly)))
                    .textStyle(.headingMD).monospacedDigit().foregroundStyle(Color.ink)
                Text(FlightText.tripKind(itinerary)).textStyle(.caption).foregroundStyle(Color.ash)
                Spacer()
            }
            Text("Lodestar never sells tickets. Book opens this exact itinerary on Google Flights, where you continue to the seller.")
                .textStyle(.caption).foregroundStyle(Color.ash)
            HStack(spacing: Spacing.sm) {
                Button { open(itinerary.bookingURL) } label: {
                    Label("Book", systemImage: "arrow.up.right")
                }
                .buttonStyle(.lodestar(.primary, small: true))
                accessory()
            }
        }
    }

    @ViewBuilder private var sellers: some View {
        switch checks.state(for: itinerary.id) {
        case nil:
            if itinerary.tfs == nil {
                Text("Google didn't give a booking token for this fare, so its sellers can't be checked.")
                    .textStyle(.bodySM).foregroundStyle(Color.mute)
                Button("Open on Google Flights") { open(itinerary.bookingURL) }.buttonStyle(.lodestar(.link))
            } else {
                Button("Check sellers") { checks.check(itinerary) }.buttonStyle(.lodestar(.ghost, small: true))
            }
        case .loading:
            VStack(alignment: .leading, spacing: Spacing.sm) {
                ForEach(0..<3, id: \.self) { _ in Skeleton(height: 48, radius: Radius.md) }
                Text(SellerCopy.loading).textStyle(.caption).foregroundStyle(Color.ash)
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(message).textStyle(.bodySM).foregroundStyle(Color.mute)
                HStack(spacing: Spacing.sm) {
                    Button("Try again") { checks.check(itinerary) }.buttonStyle(.lodestar(.ghost, small: true))
                    Button("Open on Google Flights") { open(itinerary.bookingURL) }.buttonStyle(.lodestar(.link))
                }
            }
        case .done(let check):
            SellersPanelView(check: check, trustedOnly: trustedOnly)
        }
    }

    private func open(_ string: String) {
        if let url = URL(string: string) { openURL(url) }
    }
}

extension ItineraryDetailView where Accessory == EmptyView {
    init(itinerary: Itinerary, checks: FlightSellerChecks, trustedOnly: Bool) {
        self.init(itinerary: itinerary, checks: checks, trustedOnly: trustedOnly) { EmptyView() }
    }
}

/// "Outbound · Thu, Nov 26 · 5h 30m · 312 kg CO₂", then legs with layovers between them.
struct FlightSliceDetail: View {
    let slice: FlightSlice
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Text(FlightText.sliceHeader(slice, label: label))
                if let co2 = FlightText.co2(slice) {
                    Label(co2, systemImage: "leaf").labelStyle(.titleAndIcon).fixedSize()
                }
            }
            .textStyle(.caption).foregroundStyle(Color.ash)
            ForEach(Array(slice.legs.enumerated()), id: \.offset) { index, leg in
                FlightLegDetail(leg: leg)
                if index < slice.layovers.count { layover(slice.layovers[index]) }
            }
            if slice.selfTransfer {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    StatusDot(tone: .warn)
                    Text(SellerCopy.selfTransfer).textStyle(.caption).foregroundStyle(Color.bodyText)
                }
            }
        }
    }

    private func layover(_ l: Layover) -> some View {
        HStack(spacing: Spacing.sm) {
            if l.needsCaution { StatusDot(tone: .warn) }
            Text(FlightText.layover(l)).textStyle(.caption)
                .foregroundStyle(l.needsCaution ? Color.bodyText : Color.mute)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: Radius.md)
            .strokeBorder(l.needsCaution ? Color.warn.opacity(0.4) : Color.hairline, lineWidth: Sizes.hairline))
        .padding(.leading, 32)
        .accessibilityElement(children: .combine)
    }
}

struct FlightLegDetail: View {
    let leg: FlightLeg

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            LogoView(airline: leg.airline, size: 20)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                endpoint(time: leg.depart, name: leg.fromName ?? leg.from, code: leg.from)
                Text(FlightText.legLine(leg)).textStyle(.caption).foregroundStyle(Color.ash)
                endpoint(time: leg.arrive, name: leg.toName ?? leg.to, code: leg.to)
                amenities
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func endpoint(time: String, name: String, code: String) -> some View {
        let place = Text("\(ClockText.flightClock(time)) \(name) ").foregroundStyle(Color.ink)
        let codeText = Text("(\(code))").font(TextStyle.codeSmall.font).foregroundStyle(Color.ash)
        return Text("\(place)\(codeText)")
            .textStyle(.chip)
    }

    @ViewBuilder private var amenities: some View {
        let wifi = leg.amenities?.wifi == true
        let power = leg.amenities?.hasPower == true
        if wifi || power {
            HStack(spacing: Spacing.md) {
                if wifi { Label("Wi-Fi", systemImage: "wifi") }
                if power { Label("Power", systemImage: "powerplug") }
            }
            .textStyle(.caption).foregroundStyle(Color.ash)
        }
    }
}
