import SwiftUI

/// The web's small segmented switch ("Round trip | One way", "Best | Cheapest | Fastest").
struct SearchSegmented<Value: Hashable>: View {
    let options: [(value: Value, label: String)]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.value) { option in
                let isOn = option.value == selection
                Button { selection = option.value } label: {
                    Text(option.label)
                        .textStyle(.chip)
                        .foregroundStyle(isOn ? Color.ink : Color.mute)
                        .padding(.horizontal, Spacing.md)
                        .frame(minHeight: 36)
                        .background(isOn ? Color.elevated : Color.clear, in: RoundedRectangle(cornerRadius: Radius.sm))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isOn ? .isSelected : [])
            }
        }
        .padding(2)
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
    }
}

/// A compact select, like the web's `<select>` chips (travellers, cabin, stops, bags).
struct SearchMenuPicker<Value: Hashable>: View {
    let title: String
    let options: [(value: Value, label: String)]
    @Binding var selection: Value

    var body: some View {
        Menu {
            Picker(title, selection: $selection) {
                ForEach(options, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
        } label: {
            HStack(spacing: Spacing.xs + 2) {
                Text(currentLabel).textStyle(.chip).foregroundStyle(Color.ink)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Color.ash)
            }
            .padding(.horizontal, Spacing.md)
            .frame(minHeight: 36)
            .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
        }
        .accessibilityLabel(title)
        .accessibilityValue(currentLabel)
    }

    private var currentLabel: String {
        options.first { $0.value == selection }?.label ?? title
    }
}

/// "Save trip and get alerts" / "Sign in to save this trip" / "Saved. We'll email you…".
struct TripSaveControl: View {
    let state: TripSaveState
    let isSignedIn: Bool
    var title = "Save trip and get alerts"
    let onSave: () -> Void
    let onSignIn: () -> Void
    let onOpen: (String) -> Void

    var body: some View {
        if let id = state.savedID {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.ink)
                Text("Saved. We'll email you if the price drops.").textStyle(.chip).foregroundStyle(Color.mute)
                Button("Set alerts") { onOpen(id) }.buttonStyle(.lodestar(.link))
            }
        } else if !isSignedIn {
            Button(action: onSignIn) {
                Label("Sign in to save this trip", systemImage: "bookmark")
            }
            .buttonStyle(.lodestar(.outline, small: true))
        } else {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Button(action: onSave) {
                    Label(state.isSaving ? "Saving…" : title, systemImage: "bookmark")
                }
                .buttonStyle(.lodestar(.outline, small: true, isLoading: state.isSaving))
                .disabled(state.isSaving)
                if let error = state.error { InlineError(message: error) }
            }
        }
    }
}
