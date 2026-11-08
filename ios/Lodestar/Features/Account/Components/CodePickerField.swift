import SwiftUI

/// Chips for several airport or airline codes with type-ahead suggestions (web `AirportField`).
/// The suggestion list sits in the flow so the sheet's scroll view never clips it.
struct CodePickerField: View {
    let label: String
    let placeholder: String
    let codes: [String]
    let max: Int
    let onChange: ([String]) -> Void
    @State private var model: CodePickerModel
    @FocusState private var focused: Bool

    init(label: String, placeholder: String, kind: CodePickerKind, codes: [String], max: Int,
         api: APIClient, onChange: @escaping ([String]) -> Void) {
        self.label = label
        self.placeholder = placeholder
        self.codes = codes
        self.max = max
        self.onChange = onChange
        _model = State(initialValue: CodePickerModel(kind: kind, fetch: Self.fetcher(api)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs + 2) {
            Text(label).textStyle(.hint).foregroundStyle(Color.ash)
            box
            if focused, !model.suggestions.isEmpty { suggestionList }
        }
        .onDisappear { model.cancel() }
    }

    private var box: some View {
        FlowLayout(spacing: Spacing.xs + 2) {
            ForEach(codes, id: \.self) { code in codeChip(code) }
            TextField(label, text: Binding(get: { model.text }, set: { model.setText($0) }),
                      prompt: Text(prompt).foregroundStyle(Color.stone))
                .font(TextStyle.bodySM.font)
                .foregroundStyle(Color.ink)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .focused($focused)
                .disabled(codes.count >= max)
                .frame(minWidth: 96)
                .frame(minHeight: 32)
                .onSubmit {
                    if let next = model.submit(to: codes, max: max) { onChange(next) }
                }
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs + 2)
        .frame(maxWidth: .infinity, minHeight: Sizes.input, alignment: .leading)
        .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md)
            .strokeBorder(focused ? Color.accent : Color.hairlineStrong, lineWidth: Sizes.hairline))
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
    }

    private var prompt: String {
        if codes.isEmpty { return placeholder }
        guard codes.count < max else { return "" }
        return model.kind == .airport ? "Add airport" : "Add airline"
    }

    private func codeChip(_ code: String) -> some View {
        HStack(spacing: Spacing.xs) {
            Text(code).textStyle(.code).foregroundStyle(Color.ink)
            Button {
                onChange(codes.filter { $0 != code })
            } label: {
                Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)).foregroundStyle(Color.ash)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(code)")
        }
        .padding(.leading, Spacing.sm)
        .frame(minHeight: 32)
        .background(Color.elevated, in: RoundedRectangle(cornerRadius: Radius.xs))
    }

    private var suggestionList: some View {
        VStack(spacing: 0) {
            ForEach(model.suggestions) { suggestion in
                Button {
                    onChange(model.adding(suggestion.code, to: codes, max: max))
                } label: {
                    HStack(spacing: Spacing.md) {
                        Text(suggestion.code).textStyle(.code).foregroundStyle(Color.ink).frame(width: 40, alignment: .leading)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(suggestion.label).textStyle(.bodySM).foregroundStyle(Color.ink).lineLimit(1)
                            Text(suggestion.detail).textStyle(.caption).foregroundStyle(Color.ash).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(Spacing.xs)
        .background(Color.elevated, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Color.hairlineStrong, lineWidth: Sizes.hairline))
    }

    private static func fetcher(_ api: APIClient) -> CodePickerModel.Fetch {
        { kind, query in
            switch kind {
            case .airport: try await api.send(API.Flights.airports(query: query)).map(CodeSuggestion.init)
            case .airline: try await api.send(API.Flights.airlines(query: query)).map(CodeSuggestion.init)
            }
        }
    }
}

/// A code list on a draft (home airports, preferred or avoided airlines).
struct DraftCodePicker: View {
    let draft: PreferencesDraft
    let field: CodeField
    let label: String
    @Environment(AppState.self) private var app

    var body: some View {
        CodePickerField(label: label, placeholder: field.kind == .airport ? "City or airport" : "Airline name or code",
                        kind: field.kind, codes: draft.value[keyPath: field.keyPath], max: field.max,
                        api: app.api) { draft.setCodes(field, $0) }
    }
}
