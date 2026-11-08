import SwiftUI

/// A From/To field: up to 4 codes as chips, with airport and metro suggestions as you type.
/// Return on exactly three letters adds that code; the chip's x removes it.
struct AirportFieldView: View {
    let label: String
    @Binding var codes: [String]
    var placeholder = "City or airport"

    @Environment(AppState.self) private var app
    @State private var text = ""
    @State private var lookup: AirportLookup?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs + 2) {
            Text(label).textStyle(.label).foregroundStyle(Color.charcoal)
            inputRow
            if focused, let suggestions = lookup?.suggestions, !suggestions.isEmpty, !text.isEmpty {
                suggestionList(suggestions)
            }
        }
        .onAppear { if lookup == nil { lookup = AirportLookup(api: app.api) } }
    }

    private var inputRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.xs + 2) {
                ForEach(codes, id: \.self) { code in chip(code) }
                if codes.count < SearchForm.maxCodesPerField {
                    TextField(label, text: $text, prompt: Text(codes.isEmpty ? placeholder : "Add").foregroundStyle(Color.stone))
                        .font(TextStyle.bodySM.font)
                        .foregroundStyle(Color.ink)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .focused($focused)
                        .frame(minWidth: 120)
                        .onChange(of: text) { _, new in lookup?.update(text: new) }
                        .onSubmit(addTyped)
                }
            }
            .padding(.horizontal, Spacing.md)
        }
        .frame(minHeight: Sizes.input)
        .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(focused ? Color.accent : Color.hairlineStrong, lineWidth: Sizes.hairline)
        )
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
    }

    private func chip(_ code: String) -> some View {
        HStack(spacing: Spacing.xs) {
            Text(code).textStyle(.code).foregroundStyle(Color.ink)
            Button {
                codes = codes.filter { $0 != code }
            } label: {
                Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)).foregroundStyle(Color.ash)
                    .frame(width: 20, height: 20)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(code)")
        }
        .padding(.leading, Spacing.sm)
        .padding(.trailing, Spacing.xxs)
        .frame(minHeight: 30)
        .background(Color.elevated, in: RoundedRectangle(cornerRadius: Radius.sm))
    }

    private func suggestionList(_ suggestions: [AirportSuggestion]) -> some View {
        VStack(spacing: 0) {
            ForEach(suggestions) { s in
                Button { add(s.code) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.label).textStyle(.bodySM).foregroundStyle(Color.ink)
                            Text(s.detail).textStyle(.caption).foregroundStyle(Color.ash).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        Text(s.code).textStyle(.code).foregroundStyle(Color.mute)
                    }
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm + 2)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if s.id != suggestions.last?.id { Hairline() }
            }
        }
        .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
    }

    private func add(_ code: String) {
        codes = AirportLookup.adding(code, to: codes)
        text = ""
        lookup?.clear()
    }

    private func addTyped() {
        if let first = lookup?.suggestions.first, lookup?.currentText == text {
            add(first.code)
        } else if let code = AirportLookup.typedCode(text) {
            add(code)
        }
    }
}
