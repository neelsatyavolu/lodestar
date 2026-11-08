import SwiftUI

/// The saved shortlist, read-only, with "Book" to say which fare was bought.
struct FareWatchShortlist: View {
    let model: FareWatchListModel
    let trip: SavedTrip
    let canBook: Bool
    let onBook: (FareBooking) -> Void

    @State private var checking: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Hairline()
            switch model.snapshots[trip.id] ?? .idle {
            case .idle, .loading:
                LoadingStateView(message: "Loading the shortlist…")
            case .failed(let message):
                ErrorStateView(message: message) { Task { await model.loadSnapshot(trip.id) } }
            case .loaded(let snapshot):
                content(snapshot)
            }
        }
    }

    private func content(_ s: Snapshot) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Prices as of when you saved it. Check a fare before booking.").textStyle(.hint).foregroundStyle(Color.ash)
            Text(s.canvas.headline).textStyle(.headingSM).foregroundStyle(Color.ink)
            if !s.canvas.summary.isEmpty {
                Text(s.canvas.summary).textStyle(.bodySM).foregroundStyle(Color.bodyText)
            }
            ForEach(s.canvas.picks, id: \.ref) { pick in
                if let option = s.options[pick.ref] {
                    pickRow(pick, option.itinerary)
                }
            }
            if !s.canvas.tips.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    ForEach(s.canvas.tips, id: \.self) { Text("· \($0)").textStyle(.caption).foregroundStyle(Color.mute) }
                }
            }
        }
    }

    private func pickRow(_ pick: Pick, _ it: Itinerary) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text(pick.title).textStyle(.bodySM).foregroundStyle(Color.ink)
                Spacer()
                Text(Money.usd(it.price)).textStyle(.bodySM).monospacedDigit().foregroundStyle(Color.ink)
            }
            Text(FareWatchShortlist.summary(it)).textStyle(.code).foregroundStyle(Color.mute)
            Text(pick.why).textStyle(.caption).foregroundStyle(Color.bodyText)
            if canBook, let tfs = it.tfs {
                bookControls(it, tfs: tfs)
            }
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.md))
    }

    @ViewBuilder private func bookControls(_ it: Itinerary, tfs: String) -> some View {
        switch model.sellerChecks[tfs] ?? .idle {
        case .idle:
            Button("I booked this") { Task { await model.checkSellers(it) } }.buttonStyle(.lodestar(.ghost, small: true))
        case .loading:
            LoadingStateView(message: "Checking sellers")
        case .failed(let message):
            ErrorStateView(message: message) { Task { await model.checkSellers(it) } }
        case .loaded(let check):
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Which fare did you buy?").textStyle(.label).foregroundStyle(Color.charcoal)
                ForEach(check.sellers, id: \.name) { seller in
                    ForEach(Array(seller.fares.enumerated()), id: \.offset) { _, fare in
                        Button { onBook(FareWatchText.booking(tfs: tfs, seller: seller, fare: fare)) } label: {
                            HStack(spacing: Spacing.sm) {
                                StatusDot(tone: StatusDot.Tone(tier: seller.tier))
                                Text("\(seller.name) · \(fare.displayName)").textStyle(.caption).foregroundStyle(Color.ink)
                                Spacer()
                                Text(Money.usd(fare.price)).textStyle(.caption).monospacedDigit().foregroundStyle(Color.ink)
                            }
                            .frame(minHeight: Sizes.buttonSmall)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    /// "SFO → MAA · Dec 7, 8:15am" for each slice.
    nonisolated static func summary(_ it: Itinerary) -> String {
        it.slices.compactMap { slice -> String? in
            guard let from = slice.origin, let to = slice.destination, let depart = slice.depart else { return nil }
            let day = LocalDate(depart).map(DateText.monthDay) ?? ""
            return "\(from) → \(to) · \(day), \(ClockText.flightClock(depart))"
        }.joined(separator: "\n")
    }
}

/// "Mark as booked": confirm the seller and fare, edit what was paid.
struct FareWatchMarkBookedSheet: View {
    let booking: FareBooking
    let save: (FareBooking) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var paid = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text("Mark as booked").textStyle(.headingMD).foregroundStyle(Color.ink)
            Text("\(Text(booking.fare ?? "This fare").foregroundStyle(Color.ink)) with \(Text(booking.seller).foregroundStyle(Color.ink)). Lodestar will check this exact fare every day and email you if it drops below what you paid.")
                .textStyle(.bodySM).foregroundStyle(Color.bodyText)
            LodestarField(label: "You paid $", text: $paid, keyboard: .decimalPad)
            Text(FareWatchText.creditVerdict(booking).text).textStyle(.caption).foregroundStyle(Color.mute)
            if let error { InlineError(message: error) }
            HStack {
                Button("Cancel") { dismiss() }.buttonStyle(.lodestar(.quiet))
                Spacer()
                Button(busy ? "Saving…" : "Watch this fare", action: submit)
                    .buttonStyle(.lodestar(.primary, isLoading: busy))
                    .disabled(busy)
            }
            Spacer(minLength: 0)
        }
        .padding(Sizes.sheetPadding)
        .onAppear { paid = String(format: booking.paid == booking.paid.rounded() ? "%.0f" : "%.2f", booking.paid) }
    }

    private func submit() {
        switch FareWatchText.booking(booking, paidText: paid) {
        case .failure(let problem): error = problem.message
        case .success(let next):
            busy = true
            Task {
                error = await save(next)
                busy = false
                if error == nil { dismiss() }
            }
        }
    }
}
