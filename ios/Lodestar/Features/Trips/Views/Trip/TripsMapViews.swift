import MapKit
import SwiftUI

/// Pinned items as map annotations: day colours, numbered per day.
struct TripsMap: View {
    let model: TripDetailModel
    /// nil = every day.
    let day: LocalDate?
    var interactive = true
    let select: (String) -> Void

    var body: some View {
        let items = model.trip.items
        let colors = TripsPlan.dayColorIndex(items)
        let pins = TripsPlan.pinNumbers(items)
        let shown = items.filter { item in
            item.details.isPinned && item.status != .cancelled && (day == nil || item.startDate == day)
        }
        Map(initialPosition: .automatic, interactionModes: interactive ? .all : []) {
            ForEach(shown) { item in
                if let lat = item.details.lat, let lng = item.details.lng {
                    Annotation(item.title, coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng)) {
                        Button { select(item.id) } label: {
                            Text(pins[item.id].map(String.init) ?? "")
                                .font(TextStyle.caption.font)
                                .foregroundStyle(Color.accentOn)
                                .frame(width: 24, height: 24)
                                .background(Color.dayColor(colors[item.startDate] ?? 0), in: Circle())
                                .overlay(Circle().strokeBorder(Color.canvas, lineWidth: 1.5))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.title)
                    }
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .id(day?.string ?? "all")
    }
}

/// A small, non-interactive map on Overview; tap opens the full map.
struct TripsMapCard: View {
    let model: TripDetailModel
    let day: LocalDate?
    let open: () -> Void

    var body: some View {
        TripsMap(model: model, day: day, interactive: false) { _ in open() }
            .frame(height: 180)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
            .contentShape(Rectangle())
            .onTapGesture(perform: open)
            .accessibilityElement()
            .accessibilityLabel("Map of the trip")
            .accessibilityAddTraits(.isButton)
    }
}

/// Full-screen map with a day filter; tapping a pin opens its place panel.
struct TripsMapSheet: View {
    let model: TripDetailModel
    let select: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var day: LocalDate?

    var body: some View {
        NavigationStack {
            TripsMap(model: model, day: day) { id in
                dismiss()
                select(id)
            }
            .ignoresSafeArea(edges: .bottom)
            .safeAreaInset(edge: .top) { dayChips }
            .navigationTitle("Map")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .onAppear { day = model.tab == .itinerary ? model.activeDay : nil }
    }

    private var dayChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                Chip(title: "All days", isOn: day == nil) { day = nil }
                ForEach(model.days, id: \.self) { d in
                    Chip(title: DateText.monthDay(d), isOn: day == d) { day = d }
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.vertical, Spacing.sm)
        }
        .background(Color.canvas)
    }
}
