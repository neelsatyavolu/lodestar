import SwiftUI

/// "Agents": connect Claude, ChatGPT, Codex or any MCP client to Lodestar Trips (web `AgentAccess`).
/// Apps sign in with OAuth and show up here to disconnect; CLIs use a personal token, shown once.
struct AgentsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: AgentsModel
    @State private var pendingRevoke: AgentGrant?

    init(app: AppState) {
        _model = State(initialValue: AgentsModel(app: app))
    }

    var body: some View {
        AccountSheetScaffold(title: "Agents", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                Text("Let Claude, ChatGPT, Codex or any MCP client read and plan your trips: build itineraries, fill the To book list, the checklist, notes and the budget.")
                    .textStyle(.bodySM).foregroundStyle(Color.bodyText)
                switch model.state {
                case .idle, .loading: Spinner()
                case .failed(let message): ErrorStateView(message: message) { Task { await model.load() } }
                case .loaded(let state): AgentsSetupSteps(url: state.mcpUrl)
                }
                if model.state.value != nil {
                    grantSection(title: "Connected apps", symbol: "powerplug", grants: model.apps, empty: "Nothing connected yet.")
                    tokenSection
                }
                if let error = model.error { InlineError(message: error) }
            }
        }
        .task { await model.load() }
        .confirmationDialog(confirmTitle, isPresented: isConfirming, titleVisibility: .visible, presenting: pendingRevoke) { grant in
            Button(grant.kind == .oauth ? "Disconnect" : "Delete token", role: .destructive) {
                Task { await model.revoke(grant) }
            }
        } message: { grant in
            Text(grant.kind == .oauth ? "It will stop working on your trips." : "Anything using it stops working.")
        }
    }

    private var isConfirming: Binding<Bool> {
        Binding(get: { pendingRevoke != nil }, set: { if !$0 { pendingRevoke = nil } })
    }

    private var confirmTitle: String {
        guard let grant = pendingRevoke else { return "" }
        return grant.kind == .oauth ? "Disconnect \(grant.name)?" : "Delete the token “\(grant.name)”?"
    }

    @ViewBuilder private func grantSection(title: String, symbol: String, grants: [AgentGrant], empty: String?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            AgentsSectionTitle(title: title, symbol: symbol)
            if grants.isEmpty, let empty {
                Text(empty).textStyle(.caption).foregroundStyle(Color.ash).padding(.vertical, Spacing.md)
            }
            ForEach(grants) { grant in
                HStack(spacing: Spacing.md) {
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        Text(grant.name).textStyle(.bodySM).foregroundStyle(Color.ink).lineLimit(1)
                        Text(AgentsModel.grantLine(grant)).textStyle(.caption).foregroundStyle(Color.ash)
                    }
                    Spacer(minLength: 0)
                    Button(grant.kind == .oauth ? "Disconnect" : "Delete") { pendingRevoke = grant }
                        .buttonStyle(.lodestar(.quiet, small: true))
                }
                .padding(.vertical, Spacing.md)
                Hairline()
            }
        }
    }

    private var tokenSection: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: Spacing.md) {
            grantSection(title: "Personal tokens", symbol: "key", grants: model.tokens, empty: nil)
            if let token = model.freshToken {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("Copy it now. It won't be shown again.").textStyle(.bodySM).foregroundStyle(Color.ink)
                    TripsCodeBox(text: token)
                }
                .card()
            }
            LodestarField(label: "", text: $model.name, placeholder: "Name, like Codex on my laptop",
                          autocapitalization: .never, submitLabel: .done, onSubmit: { Task { await model.createToken() } })
                .autocorrectionDisabled()
                .onChange(of: model.name) { _, value in
                    if value.count > AgentsModel.maxNameLength { model.name = String(value.prefix(AgentsModel.maxNameLength)) }
                }
            Button("Make token") { Task { await model.createToken() } }
                .buttonStyle(.lodestar(.primary, fullWidth: true, isLoading: model.isBusy))
                .disabled(!model.canCreate)
        }
    }
}

/// How to point each kind of client at the MCP server.
private struct AgentsSetupSteps: View {
    let url: String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            step("Server address") { TripsCodeBox(text: url) }
            step("Claude Code") {
                TripsCodeBox(text: AgentsModel.claudeCommand(url))
                note("Then run /mcp and sign in when it asks.")
            }
            step("Claude or ChatGPT (web and desktop)") {
                note("Add a custom connector with the server address above. You'll be sent to Lodestar to sign in and allow it.")
            }
            step("Codex, scripts and other clients") {
                note("Use OAuth if the client supports it. Otherwise make a personal token below and send it as Authorization: Bearer lsp_…")
            }
        }
    }

    private func step(_ name: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(name).textStyle(.label).foregroundStyle(Color.ink)
            content()
        }
    }

    private func note(_ text: String) -> some View {
        Text(text).textStyle(.bodySM).foregroundStyle(Color.mute)
    }
}

private struct AgentsSectionTitle: View {
    let title: String
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Label {
                Text(title).textStyle(.label).foregroundStyle(Color.ink)
            } icon: {
                Image(systemName: symbol).foregroundStyle(Color.accent).accessibilityHidden(true)
            }
            Hairline()
        }
        .accessibilityAddTraits(.isHeader)
    }
}
