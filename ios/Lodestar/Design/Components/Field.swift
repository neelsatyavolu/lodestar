import SwiftUI

/// A labelled text input: deep fill, strong hairline, accent border with a ring when focused.
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
                .background(Color.deep, in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.md)
                        .strokeBorder(borderColor, lineWidth: Sizes.hairline)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.md + 3)
                        .stroke(focused ? Color.ring : Color.clear, lineWidth: 3)
                        .padding(-3)
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
        let prompt = Text(placeholder).foregroundStyle(Color.stone)
        if secure {
            SecureField(label, text: $text, prompt: prompt)
        } else {
            TextField(label, text: $text, prompt: prompt)
        }
    }

    private var borderColor: Color {
        if error != nil { return .danger }
        return focused ? .accent : .hairlineStrong
    }
}
