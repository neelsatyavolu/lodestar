import SwiftUI

/// A sheet frame shared by the connector sheets: title bar with Done, scrolling body.
struct TripsSheetFrame<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg, content: content)
                    .padding(Sizes.sheetPadding)
            }
            .canvasBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

/// "Add trips by email": the private forwarding address.
struct TripsForwardingSheet: View {
    @State private var model: TripsConnectorsModel
    @State private var confirmRotate = false

    init(app: AppState) {
        _model = State(initialValue: TripsConnectorsModel(app: app))
    }

    var body: some View {
        TripsSheetFrame(title: "Add trips by email") {
            Text("Forward any flight, hotel, restaurant or tour confirmation to your private address. Lodestar files it in the right trip, or starts one. A table you already planned, say dinner at Penca on the 21st, becomes that booking instead of a second stop.")
                .textStyle(.bodySM).foregroundStyle(Color.bodyText)
            switch model.state {
            case .idle, .loading: Spinner()
            case .failed(let message): ErrorStateView(message: message) { Task { await model.load() } }
            case .loaded(let state):
                if let address = state.address {
                    TripsCodeBox(text: address)
                } else {
                    Text("Forwarding isn't set up on this server yet.").textStyle(.bodySM).foregroundStyle(Color.mute)
                }
            }
            Text("Confirmations with booking details built in, and Resy, OpenTable and Yelp tables, are filed at once. Others are read by your ChatGPT or Grok the next time you open Trips. The address is private: anyone who has it can add to your trips.")
                .textStyle(.caption).foregroundStyle(Color.mute)
            if let error = model.error { InlineError(message: error) }
            if model.state.value?.address != nil {
                Button("Make a new address") { confirmRotate = true }
                    .buttonStyle(.lodestar(.quiet, small: true, isLoading: model.isBusy))
                    .disabled(model.isBusy)
            }
        }
        .task { await model.load() }
        .confirmationDialog("Make a new address?", isPresented: $confirmRotate, titleVisibility: .visible) {
            Button("Make new address", role: .destructive) { Task { await model.rotateAddress() } }
        } message: {
            Text("Mail sent to the old one will stop reaching Trips.")
        }
    }
}

/// "Connect Flint": pairing code and the connected Macs.
struct TripsFlintSheet: View {
    @State private var model: TripsConnectorsModel

    init(app: AppState) {
        _model = State(initialValue: TripsConnectorsModel(app: app))
    }

    var body: some View {
        TripsSheetFrame(title: "Connect Flint") {
            Text("Flint sends your travel confirmations here as they arrive, and the last year's when you connect. Only mail from travel companies, or mail with booking details built in, leaves your Mac. Flint shows you how many messages match before anything is sent.")
                .textStyle(.bodySM).foregroundStyle(Color.bodyText)
            step(1, "In Flint, open Settings › Connected apps › Add app and paste:")
            TripsCodeBox(text: model.app.api.baseURL.absoluteString)
            step(2, "When Flint asks for a code, type this one. It works once, for 10 minutes.")
            if let code = model.code {
                TripsCodeBox(text: code.code)
            } else {
                Button("Get a code") { Task { await model.getCode() } }
                    .buttonStyle(.lodestar(.primary, isLoading: model.isBusy))
                    .disabled(model.isBusy)
            }
            if let error = model.error { InlineError(message: error) }
            if let message = model.state.errorMessage { InlineError(message: message) }
            connected
        }
        .task { await model.load() }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
            Text("\(n).").textStyle(.code).foregroundStyle(Color.ash)
            Text(text).textStyle(.bodySM).foregroundStyle(Color.bodyText)
        }
    }

    @ViewBuilder private var connected: some View {
        if let links = model.state.value?.flint, !links.isEmpty {
            Hairline()
            Text("Connected").textStyle(.label).foregroundStyle(Color.ink)
            ForEach(links) { link in
                HStack {
                    Text(TripsConnectorsModel.linkLine(link)).textStyle(.bodySM).foregroundStyle(Color.bodyText)
                    Spacer()
                    Button("Disconnect") { Task { await model.disconnect(link.id) } }.buttonStyle(.lodestar(.quiet, small: true))
                }
            }
        }
    }
}

/// "Import from Wanderlog".
struct TripsWanderlogSheet: View {
    let onImported: (Int) -> Void
    @State private var model: TripsWanderlogModel
    @Environment(\.dismiss) private var dismiss

    init(app: AppState, onImported: @escaping (Int) -> Void) {
        self.onImported = onImported
        _model = State(initialValue: TripsWanderlogModel(app: app))
    }

    var body: some View {
        @Bindable var model = model
        TripsSheetFrame(title: "Import from Wanderlog") {
            if let trips = model.trips {
                picker(trips)
            } else {
                Text("Wanderlog doesn't let other apps sign in for you, so Lodestar borrows your signed-in session once to read your trips. It isn't saved.")
                    .textStyle(.bodySM).foregroundStyle(Color.bodyText)
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("1. Open wanderlog.com in a desktop browser and sign in.")
                    Text("2. Open developer tools (⌥⌘I on a Mac), then Application › Cookies › wanderlog.com.")
                    Text("3. Copy the value of connect.sid and paste it below.")
                }
                .textStyle(.caption).foregroundStyle(Color.mute)
                LodestarField(label: "Wanderlog session", text: $model.session, placeholder: "s%3A…", mono: true,
                              autocapitalization: .never)
                    .autocorrectionDisabled()
                Button("Find my trips") { Task { await model.list() } }
                    .buttonStyle(.lodestar(.primary, fullWidth: true, isLoading: model.isBusy))
                    .disabled(!model.canList)
            }
            if let error = model.error { InlineError(message: error) }
        }
    }

    @ViewBuilder private func picker(_ trips: [WanderlogTrip]) -> some View {
        if trips.isEmpty {
            Text("That Wanderlog account has no trips.").textStyle(.bodySM).foregroundStyle(Color.bodyText)
        } else {
            Text("Flights, hotels and places you put on a day come across. Lists and notes stay in Wanderlog. Importing again updates the same trips.")
                .textStyle(.caption).foregroundStyle(Color.mute)
            VStack(spacing: 0) {
                ForEach(trips) { trip in
                    HStack(spacing: Spacing.sm) {
                        TripsCheckbox(isOn: model.picked.contains(trip.key), label: trip.title) { model.toggle(trip.key) }
                        Text(trip.title).textStyle(.bodySM).foregroundStyle(Color.ink).lineLimit(1)
                        Spacer()
                        Text(DateText.tripRange(trip.startDate, trip.endDate)).textStyle(.hint).foregroundStyle(Color.ash)
                            .layoutPriority(1)
                    }
                    .padding(.horizontal, Spacing.sm)
                    .contentShape(Rectangle())
                    .onTapGesture { model.toggle(trip.key) }
                    if trip.key != trips.last?.key { Hairline() }
                }
            }
            .card(padding: 0)
            Button(model.importTitle) {
                Task {
                    if let n = await model.importPicked() {
                        onImported(n)
                        dismiss()
                    }
                }
            }
            .buttonStyle(.lodestar(.primary, fullWidth: true, isLoading: model.isBusy))
            .disabled(!model.canImport)
        }
    }
}
