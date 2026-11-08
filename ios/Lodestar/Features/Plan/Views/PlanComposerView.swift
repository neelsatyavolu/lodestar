import SwiftUI

/// The message box with the provider switch, model picker and the send button.
struct PlanComposerView: View {
    @Bindable var model: PlanModel
    let inputs: PlanInputs
    let onConnect: () -> Void

    @FocusState private var focused: Bool

    var body: some View {
        let provider = PlanLogic.provider(picked: model.pickedProvider, status: inputs.status)
        VStack(alignment: .leading, spacing: Spacing.md) {
            TextField(model.hasStarted ? "Reply" : "Describe your trip", text: $model.prompt,
                      prompt: Text(placeholder).foregroundStyle(Color.stone), axis: .vertical)
                .lineLimit(model.hasStarted ? 2...6 : 3...8)
                .textStyle(.bodyLG)
                .foregroundStyle(Color.ink)
                .focused($focused)
                .submitLabel(.send)
                .onChange(of: model.prompt) { _, text in
                    if text.count > PlanLogic.maxPrompt { model.prompt = String(text.prefix(PlanLogic.maxPrompt)) }
                }
                .onSubmit(send)
                .padding(.horizontal, Spacing.lg)
                .padding(.top, Spacing.lg)
            controls(provider: provider)
                .padding(.horizontal, Spacing.md)
                .padding(.bottom, Spacing.md)
        }
        .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg)
            .strokeBorder(focused ? Color.accent : Color.hairlineStrong, lineWidth: Sizes.hairline))
    }

    private var placeholder: String {
        model.hasStarted ? "Reply, or change the trip." : "Describe the trip. Where, roughly when, and what matters to you."
    }

    private func controls(provider: AIProvider?) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            // Side by side when they fit; stacked when a long model name or large text would squeeze them.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.sm) { pickers(provider: provider) }
                VStack(alignment: .leading, spacing: Spacing.sm) { pickers(provider: provider) }
            }
            if PlanLogic.context(inputs.flightForm) != nil, !model.hasStarted {
                Text("Uses your search form as a starting point").textStyle(.caption).foregroundStyle(Color.ash)
            }
            HStack(spacing: Spacing.sm) {
                Spacer()
                if model.hasStarted {
                    Button("New trip") { model.newTrip() }.buttonStyle(.lodestar(.ghost))
                }
                if provider != nil {
                    Button(action: send) {
                        if model.isRunning {
                            Text(model.hasStarted ? "Send" : "Plan trip")
                        } else {
                            Label(model.hasStarted ? "Send" : "Plan trip", systemImage: "arrow.up")
                        }
                    }
                    .buttonStyle(.lodestar(.primary, isLoading: model.isRunning))
                    .disabled(!model.canSend(inputs))
                } else {
                    Button("Connect ChatGPT or Grok", action: onConnect).buttonStyle(.lodestar(.primary))
                }
            }
        }
    }

    @ViewBuilder private func pickers(provider: AIProvider?) -> some View {
        if inputs.status.connected.codex && inputs.status.connected.grok, let provider {
            SearchSegmented(options: [(AIProvider.codex, "ChatGPT"), (.grok, "Grok")], selection: Binding(
                get: { provider }, set: { model.pickedProvider = $0; model.modelID = nil }))
        }
        if let provider, !inputs.status.models(for: provider).isEmpty {
            SearchMenuPicker(
                title: "Model",
                options: [(String?.none, "Default model")] + inputs.status.models(for: provider).map { (Optional($0.id), $0.label) },
                selection: $model.modelID
            )
        }
    }

    private func send() {
        guard model.canSend(inputs) else { return }
        focused = false
        model.run(model.prompt, inputs: inputs)
    }
}
