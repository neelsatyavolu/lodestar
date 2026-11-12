import SwiftUI

/// Forwarded mail waiting for the AI or that failed.
struct TripsMailCard: View {
    let model: TripsListModel
    let mail: [MailSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            headline
            ForEach(mail) { m in
                HStack(alignment: .top, spacing: Spacing.sm) {
                    line(m).frame(maxWidth: .infinity, alignment: .leading)
                    IconButton(systemName: "xmark", accessibilityLabel: "Forget this email") {
                        Task { await model.deleteMail(m.id) }
                    }
                    .frame(width: 32, height: 32)
                }
            }
        }
        .card()
    }

    @ViewBuilder private var headline: some View {
        let waiting = model.waitingMail.count
        if model.readingCount > 0 {
            LoadingStateView(message: "Reading \(plural(model.readingCount, "email")) with your AI…")
        } else if waiting > 0, model.app.aiStatus.anyConnected {
            HStack(spacing: Spacing.sm) {
                Text("\(plural(waiting, "email")) \(waiting == 1 ? "is" : "are") waiting to be read.")
                    .textStyle(.bodySM).foregroundStyle(Color.bodyText)
                Button("Read now") { Task { await model.readMailIfNeeded() } }.buttonStyle(.lodestar(.link))
            }
        } else if waiting > 0 {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Text("\(plural(waiting, "email")) \(waiting == 1 ? "has" : "have") no booking details built in. Connect ChatGPT or Grok to read them.")
                    .textStyle(.bodySM).foregroundStyle(Color.bodyText)
            }
            Button("Connect ChatGPT or Grok") { model.app.present(.connectAI) }.buttonStyle(.lodestar(.ghost, small: true))
        }
    }

    private func line(_ m: MailSummary) -> some View {
        let subject = m.subject.isEmpty ? "(no subject)" : m.subject
        let failed = m.state == .failed ? Text(" · \(m.error ?? "Couldn't be read")").foregroundStyle(Color.danger) : Text("")
        return Text("\(subject) · \(m.sender)\(failed)").foregroundStyle(Color.bodyText).textStyle(.caption).lineLimit(2)
    }
}

/// "Needs a trip": items that didn't clearly belong to one trip.
struct TripsUnfiledSection: View {
    let model: TripsListModel
    let items: [TripItem]
    let journeys: [JourneyWithItems]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionHeader(title: "Needs a trip", detail: "These didn't clearly belong to one trip. Choose where they go.")
            VStack(spacing: 0) {
                ForEach(items) { item in
                    row(item)
                    if item.id != items.last?.id { Hairline() }
                }
            }
            .card(padding: 0)
        }
    }

    private func row(_ item: TripItem) -> some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(item.title).textStyle(.bodySM).foregroundStyle(Color.ink).lineLimit(1)
                Text(TripsText.bookingWhen(item)).textStyle(.caption).foregroundStyle(Color.ash)
            }
            Spacer()
            Menu {
                ForEach(journeys) { j in
                    Button(j.journey.title) { Task { await model.move(itemId: item.id, to: j.id) } }
                }
            } label: {
                if model.movingItemIds.contains(item.id) { Spinner() } else { Text("Move to…") }
            }
            .buttonStyle(.lodestar(.ghost, small: true))
            .fixedSize()
            .disabled(journeys.isEmpty || model.movingItemIds.contains(item.id))
        }
        .padding(Spacing.lg)
    }
}

/// The three ways in when there are no trips yet.
struct TripsStartCards: View {
    let open: (TripsHomeSheet) -> Void

    var body: some View {
        VStack(spacing: Spacing.md) {
            card("Forward a confirmation", "Send any flight, hotel or restaurant email to your private address.", "Get the address", .email)
            card("Connect Flint", "New travel mail files itself, and the last year's comes in when you connect.", "Connect", .flint)
            card("Bring Wanderlog trips", "Import past and upcoming trips with their flights, hotels and plans.", "Import", .wanderlog)
        }
    }

    private func card(_ title: String, _ text: String, _ action: String, _ sheet: TripsHomeSheet) -> some View {
        EmptyStateView(title: title, message: text, actionTitle: action) { open(sheet) }
    }
}

/// An upcoming trip on the home list.
struct TripsJourneyCard: View {
    let journey: JourneyWithItems

    var body: some View {
        let j = journey.journey
        let today = LocalDate.today()
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text(j.title).textStyle(.headingSM).foregroundStyle(Color.ink).multilineTextAlignment(.leading)
                Spacer()
                if let countdown = TripsText.countdown(start: j.startDate, end: j.endDate, today: today) {
                    Text(countdown).textStyle(.caption).foregroundStyle(Color.accent)
                        .layoutPriority(1)
                }
            }
            Text([DateText.tripRange(j.startDate, j.endDate), TripsText.travellers(j.travelers)].compactMap { $0 }.joined(separator: " · "))
                .textStyle(.bodySM).foregroundStyle(Color.mute)
            if let access = j.access { Text(access.line).textStyle(.caption).foregroundStyle(Color.mute) }
            Text(TripsText.tally(journey.items)).textStyle(.caption).foregroundStyle(Color.bodyText)
            toBookLine(today: today)
            nextLine(today: today)
        }
        .card()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder private func toBookLine(today: LocalDate) -> some View {
        let list = TripsPlan.toBook(journey.items)
        if let first = list.first {
            let deadline = TripsText.deadline(first.details.bookBy, today: today)
            HStack(spacing: Spacing.sm) {
                if let tone = deadline?.tone { StatusDot(tone: tone == .danger ? .danger : .warn) }
                Text("\(list.count) to book" + (first.details.bookBy.map { " · next by \(DateText.monthDay($0))" } ?? ""))
                    .textStyle(.caption).foregroundStyle(Color.mute)
            }
        }
    }

    @ViewBuilder private func nextLine(today: LocalDate) -> some View {
        let next = TripsPlan.byWhen(journey.items.filter { $0.isLive && $0.startDate >= today && $0.kind != .note }).first
        if let next {
            Text("Next: \(next.title)" + (next.startTime.map { " at \(ClockText.time12($0))" } ?? ""))
                .textStyle(.caption).foregroundStyle(Color.mute).lineLimit(1)
        }
    }
}
