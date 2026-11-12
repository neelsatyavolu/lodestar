import SwiftUI

/// The state of one async load. Keep it in a feature's @Observable model.
enum LoadState<Value: Sendable>: Sendable {
    case idle
    case loading
    case loaded(Value)
    case failed(String)

    var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    var errorMessage: String? {
        if case .failed(let message) = self { return message }
        return nil
    }
}

/// Centered title, explanation and an optional action ("No bookings yet").
struct EmptyStateView: View {
    let title: String
    var message: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(title).font(.geist(.serif, size: 20, relativeTo: .title3)).foregroundStyle(Color.bodyText)
                .accessibilityAddTraits(.isHeader)
            if let message {
                Text(message).textStyle(.bodySM).foregroundStyle(Color.mute)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(.lodestar(.ghost, small: true))
                    .padding(.top, Spacing.xs)
            }
        }
        .card(padding: Spacing.xl)
    }
}

/// An error message with "Try again". Shows the API's sentence as written.
struct ErrorStateView: View {
    let message: String
    var retryTitle = "Try again"
    var retry: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            InlineError(message: message)
            if let retry {
                Button(retryTitle, action: retry).buttonStyle(.lodestar(.ghost, small: true))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Spinner plus a line of text ("Checking sellers", "Reading every seller's price…").
struct LoadingStateView: View {
    var message: String?

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Spinner()
            if let message {
                Text(message).textStyle(.bodySM).foregroundStyle(Color.mute)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// A stack of breathing skeleton cards while the first result loads.
struct SkeletonList: View {
    var count = 4
    var height: CGFloat = 96

    var body: some View {
        VStack(spacing: Spacing.md) {
            ForEach(0..<count, id: \.self) { _ in Skeleton(height: height) }
        }
    }
}

/// Error text in the danger color (form errors, failed requests).
struct InlineError: View {
    let message: String

    var body: some View {
        Text(message)
            .textStyle(.chip)
            .foregroundStyle(Color.danger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("Error: \(message)")
    }
}

/// A neutral notice in body color ("If an account exists for that address…").
struct InlineNotice: View {
    let message: String

    var body: some View {
        Text(message)
            .textStyle(.chip)
            .foregroundStyle(Color.bodyText)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
