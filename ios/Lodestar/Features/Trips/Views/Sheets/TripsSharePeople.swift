import SwiftUI

/// People the trip is shared with by email (`share-people.tsx`). Editors see and change
/// everything, confirmations and prices included; viewers see the plan without them.
/// Only the owner opens the share sheet, so only the owner sees this.
struct TripsSharePeople: View {
    let app: AppState
    let journeyId: String

    @State private var members: [TripMember]?
    @State private var email = ""
    @State private var canEdit = true
    @State private var busy = false
    @State private var error: String?
    @State private var sent: String?

    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Invite by email").textStyle(.label).foregroundStyle(Color.ink)
            LodestarField(label: "", text: $email, placeholder: "name@example.com", contentType: .emailAddress,
                          keyboard: .emailAddress, autocapitalization: .never, submitLabel: .send, onSubmit: invite)
                .onChange(of: email) { sent = nil }
            Toggle(isOn: $canEdit) { Text("Can edit").textStyle(.bodySM) }
                .tint(Color.accent)
            Text(canEdit ? "They see and change everything, confirmation numbers and prices included."
                         : "They see the plan. Confirmation numbers, prices and the budget stay private.")
                .textStyle(.caption).foregroundStyle(Color.mute)
            Button(action: invite) { Label("Invite", systemImage: "person.badge.plus") }
                .buttonStyle(.lodestar(.primary, small: true, isLoading: busy))
                .disabled(busy || trimmedEmail.isEmpty)
            if let sent {
                Text("Invite sent to \(sent). The link works once and lasts 14 days.")
                    .textStyle(.caption).foregroundStyle(Color.ok)
            }
            if let members, !members.isEmpty {
                VStack(spacing: 0) {
                    ForEach(members) { member in
                        row(member)
                        if member.id != members.last?.id { Divider() }
                    }
                }
            }
            if let error { InlineError(message: error) }
        }
        .task(id: journeyId) { await load() }
    }

    private func row(_ m: TripMember) -> some View {
        HStack(spacing: Spacing.sm) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(m.name ?? m.email).textStyle(.bodySM).foregroundStyle(Color.ink).lineLimit(1)
                let detail = [m.name == nil ? nil : m.email, m.joined ? nil : "Invited, hasn't joined yet"].compactMap { $0 }
                if !detail.isEmpty {
                    Text(detail.joined(separator: " · ")).textStyle(.caption).foregroundStyle(Color.mute).lineLimit(1)
                }
            }
            Spacer(minLength: Spacing.sm)
            Menu {
                Button("Can edit") { change(m, edit: true) }
                Button("View only") { change(m, edit: false) }
            } label: {
                Text(m.canEdit ? "Can edit" : "View only")
            }
            .buttonStyle(.lodestar(.ghost, small: true))
            .disabled(busy)
            .accessibilityLabel("What \(m.email) can do")
            IconButton(systemName: "trash", accessibilityLabel: "Remove \(m.email)") { remove(m) }
                .disabled(busy)
        }
        .padding(.vertical, Spacing.xs)
    }

    private func load() async {
        do {
            members = try await app.api.send(API.Journeys.members(journeyId)).members
        } catch {
            if let message = app.handle(error) { self.error = message.isEmpty ? "Couldn't load who it's shared with." : message }
        }
    }

    private func invite() {
        let address = trimmedEmail
        guard !busy, !address.isEmpty else { return }
        let edit = canEdit
        run("Couldn't send the invite.") {
            let member = try await app.api.send(API.Journeys.invite(journeyId, InviteRequest(email: address, canEdit: edit))).member
            members = (members ?? []).filter { $0.id != member.id } + [member]
            sent = member.email
            email = ""
        }
    }

    private func change(_ m: TripMember, edit: Bool) {
        guard m.canEdit != edit else { return }
        run("Couldn't change that.") {
            _ = try await app.api.send(API.Journeys.updateMember(journeyId, memberId: m.id, canEdit: edit))
            members = members?.map { $0.id == m.id ? $0.with(canEdit: edit) : $0 }
        }
    }

    private func remove(_ m: TripMember) {
        run("Couldn't remove them.") {
            _ = try await app.api.send(API.Journeys.removeMember(journeyId, memberId: m.id))
            members = members?.filter { $0.id != m.id }
        }
    }

    private func run(_ fallback: String, _ work: @escaping @MainActor () async throws -> Void) {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await work()
            } catch {
                if let message = app.handle(error) { self.error = message.isEmpty ? fallback : message }
            }
        }
    }
}
