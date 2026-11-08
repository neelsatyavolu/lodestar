import SwiftUI
import UIKit

/// "Copy" that turns into "Copied" for a moment.
struct TripsCopyButton: View {
    let text: String
    var label = "Copy"
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = text
            copied = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                copied = false
            }
        } label: {
            Label(copied ? "Copied" : label, systemImage: copied ? "checkmark" : "doc.on.doc")
        }
        .buttonStyle(.lodestar(.ghost, small: true))
        .sensoryFeedback(.success, trigger: copied) { _, new in new }
    }
}

/// The address/code box: mono text in a deep well with a copy button.
struct TripsCodeBox: View {
    let text: String

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Text(text)
                .textStyle(.code)
                .foregroundStyle(Color.ink)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            TripsCopyButton(text: text)
        }
        .padding(Spacing.md)
        .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
    }
}

/// A square checkbox in the accent color.
struct TripsCheckbox: View {
    let isOn: Bool
    let label: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isOn ? "checkmark.square.fill" : "square")
                .font(.system(size: 18))
                .foregroundStyle(isOn ? Color.accent : Color.ash)
                .frame(width: 32, height: 32)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(isOn ? "Done" : "Not done")
        .accessibilityAddTraits(.isToggle)
    }
}

extension TripsText.StatusPill.Dot {
    var tone: StatusDot.Tone {
        switch self {
        case .ok: .ok
        case .warn: .warn
        case .danger: .danger
        case .accent: .accent
        }
    }
}

extension TripsText.Tone {
    var color: Color { self == .danger ? .danger : .warn }
}

/// A trip item's status pill, if it has one.
struct TripsStatusPill: View {
    let item: TripItem

    var body: some View {
        if let pill = TripsText.statusPill(item, today: .today()) {
            Pill(text: pill.text, style: item.status == .suggested ? .accent : .neutral, dot: pill.dot.tone)
                .fixedSize()
        }
    }
}

/// A heading row with an optional trailing control, used inside tabs.
struct TripsSectionHead<Trailing: View>: View {
    let title: String
    var detail: String?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            SectionHeader(title: title, detail: detail)
            trailing()
        }
    }
}

extension TripsSectionHead where Trailing == EmptyView {
    init(title: String, detail: String? = nil) {
        self.init(title: title, detail: detail) { EmptyView() }
    }
}

/// Error and notice lines with a dismiss.
struct TripsMessages: View {
    let error: String?
    let notice: String?

    var body: some View {
        if let error { InlineError(message: error) }
        if let notice { InlineNotice(message: notice) }
    }
}

// MARK: - DatePicker

extension Binding where Value == LocalDate {
    var asDate: Binding<Date> {
        Binding<Date>(get: { wrappedValue.pickerDate }, set: { wrappedValue = LocalDate(localDayOf: $0) })
    }
}

/// An optional day with a "Set"/"Clear" control around a compact DatePicker.
struct TripsOptionalDateField: View {
    let label: String
    @Binding var date: LocalDate?
    var placeholder = "Not set"
    var range: ClosedRange<Date>?
    var fallback: LocalDate = .today()

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Text(label).textStyle(.bodySM).foregroundStyle(Color.bodyText)
            Spacer(minLength: Spacing.sm)
            if let current = date {
                picker(for: current)
                Button("Clear") { date = nil }
                    .buttonStyle(.lodestar(.quiet, small: true))
                    .accessibilityLabel("Clear \(label)")
            } else {
                Button(placeholder) { date = fallback }.buttonStyle(.lodestar(.ghost, small: true))
            }
        }
    }

    @ViewBuilder private func picker(for current: LocalDate) -> some View {
        let binding = Binding<Date>(get: { current.pickerDate }, set: { date = LocalDate(localDayOf: $0) })
        if let range {
            DatePicker(label, selection: binding, in: range, displayedComponents: .date).labelsHidden()
        } else {
            DatePicker(label, selection: binding, displayedComponents: .date).labelsHidden()
        }
    }
}

/// "HH:MM" <-> Date for time pickers.
enum TripsClock {
    static func date(from hhmm: String?) -> Date {
        let parts = (hhmm ?? "12:00").split(separator: ":").compactMap { Int($0) }
        let h = parts.first ?? 12
        let m = parts.count > 1 ? parts[1] : 0
        return Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: .now) ?? .now
    }

    static func hhmm(from date: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}
