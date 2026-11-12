import SwiftUI

/// A labelled text input: card fill, field-contrast hairline, a 2 pt accent outline when focused (no ring glow).
struct LodestarField: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var hint: String?
    var error: String?
    var mono = false
    var secure = false
    var contentType: UITextContentType?
    var keyboard: UIKeyboardType = .default
    var autocapitalization: TextInputAutocapitalization = .sentences
    var submitLabel: SubmitLabel = .done
    var onSubmit: () -> Void = {}

    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs + 2) {
            if !label.isEmpty {
                Text(label).textStyle(.label).foregroundStyle(Color.charcoal)
            }
            input
                .font(mono ? TextStyle.code.font : TextStyle.bodySM.font)
                .foregroundStyle(Color.ink)
                .tint(Color.accent)
                .textContentType(contentType)
                .keyboardType(keyboard)
                .textInputAutocapitalization(autocapitalization)
                .autocorrectionDisabled(mono || secure || keyboard == .emailAddress)
                .submitLabel(submitLabel)
                .onSubmit(onSubmit)
                .focused($focused)
                .padding(.horizontal, 14)
                .frame(minHeight: Sizes.input)
                .background(Color.card, in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.md)
                        .strokeBorder(borderColor, lineWidth: Sizes.hairline)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.md + 2)
                        .stroke(focused ? Color.accent : Color.clear, lineWidth: 2)
                        .padding(-4)
                )
                .animation(Motion.fast, value: focused)
            if let error {
                InlineError(message: error)
            } else if let hint {
                Text(hint).textStyle(.hint).foregroundStyle(Color.ash)
            }
        }
    }

    @ViewBuilder private var input: some View {
        let prompt = Text(placeholder).foregroundStyle(Color.mute)
        if secure {
            SecureField(label, text: $text, prompt: prompt)
        } else {
            TextField(label, text: $text, prompt: prompt)
        }
    }

    private var borderColor: Color {
        if error != nil { return .danger }
        return focused ? .accent : .hairlineHover
    }
}
