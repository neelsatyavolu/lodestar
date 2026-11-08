import SwiftUI

/// The trip's cover: destination photo, title, dates, travellers, type, countdown and actions.
struct TripCoverView: View {
    let model: TripDetailModel
    let present: (TripsTripSheet) -> Void
    let delete: () -> Void

    @State private var photo: String?

    var body: some View {
        let j = model.journey
        VStack(alignment: .leading, spacing: Spacing.md) {
            if let photo {
                RemoteImage(source: API.Places.photoPath(name: photo, width: 800), cornerRadius: Radius.lg)
                    .frame(height: 180)
                    .frame(maxWidth: .infinity)
            }
            Text(j.title).textStyle(.display).foregroundStyle(Color.ink)
                .accessibilityAddTraits(.isHeader)
            Text(facts(j)).textStyle(.bodySM).foregroundStyle(Color.mute)
            if let countdown = TripsText.countdown(start: j.startDate, end: j.endDate, today: .today()) {
                Text(countdown).textStyle(.caption).foregroundStyle(Color.accent)
            }
            HStack(spacing: Spacing.sm) {
                Button("Edit") { present(.edit) }.buttonStyle(.lodestar(.ghost, small: true))
                Button {
                    present(.share)
                } label: {
                    Label(j.shareToken == nil ? "Share" : "Shared", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.lodestar(j.shareToken == nil ? .ghost : .accent, small: true))
                Spacer()
                Button(action: delete) { Label("Delete", systemImage: "trash") }
                    .buttonStyle(.lodestar(.quiet, small: true))
                    .accessibilityLabel("Delete \(j.title)")
            }
        }
        .task(id: j.destination) {
            guard let destination = j.destination else { photo = nil; return }
            photo = await model.places.coverPhoto(for: destination)
        }
    }

    private func facts(_ j: Journey) -> String {
        [
            DateText.tripRange(j.startDate, j.endDate),
            TripsText.travellers(j.travelers),
            j.tripType.flatMap { $0 == .unknown ? nil : $0.label },
        ].compactMap { $0 }.joined(separator: " · ")
    }
}
