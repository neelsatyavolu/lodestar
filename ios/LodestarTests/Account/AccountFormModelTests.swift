import Foundation
import Testing
@testable import Lodestar

/// Records what the form asked the session layer to do.
@MainActor
final class AccountActionsSpy {
    var calls: [String] = []
    var failure: (any Error)?
    var forgotMessage = "If an account exists for that address, a reset link is on its way."

    var actions: AccountActions {
        AccountActions(
            signIn: { email, password in try self.record("signIn \(email) \(password)") },
            register: { email, password in try self.record("register \(email) \(password)") },
            forgot: { email in
                try self.record("forgot \(email)")
                return self.forgotMessage
            },
            reset: { token, password in try self.record("reset \(token) \(password)") },
            report: { $0.isCancellation ? nil : $0.userMessage }
        )
    }

    private func record(_ call: String) throws {
        calls.append(call)
        if let failure { throw failure }
    }
}

@MainActor
@Suite("Account form: sign in, register, forgot, reset")
struct AccountFormModelTests {
    @Test func signInNeedsEmailAndPassword() async {
        let spy = AccountActionsSpy()
        let model = AccountFormModel(mode: .signIn)
        model.email = "  "
        let outcome = await model.submit(spy.actions)
        #expect(outcome == nil)
        #expect(model.error == "Enter your email and password.")
        #expect(spy.calls.isEmpty)
    }

    @Test func signInSendsTrimmedEmailAndClearsPassword() async {
        let spy = AccountActionsSpy()
        let model = AccountFormModel(mode: .signIn)
        model.email = "  ada@example.com "
        model.password = "secret"
        let outcome = await model.submit(spy.actions)
        #expect(outcome == .signedIn)
        #expect(spy.calls == ["signIn ada@example.com secret"])
        #expect(model.password.isEmpty)
        #expect(model.error == nil)
    }

    @Test func registerValidatesEmailAndPasswordLength() async {
        let spy = AccountActionsSpy()
        let model = AccountFormModel(mode: .register)
        model.email = "ada@example"
        model.password = "longenough"
        #expect(model.validationMessage == "Enter a valid email and a password of at least 8 characters.")
        model.email = "ada@example.com"
        model.password = "short"
        #expect(model.validationMessage == "Enter a valid email and a password of at least 8 characters.")
        model.password = "12345678"
        #expect(model.validationMessage == nil)
        #expect(await model.submit(spy.actions) == .registered)
        #expect(spy.calls == ["register ada@example.com 12345678"])
    }

    @Test func serverErrorIsShownAsWritten() async {
        let spy = AccountActionsSpy()
        spy.failure = APIError.server(status: 401, message: "That email and password don't match an account.")
        let model = AccountFormModel(mode: .signIn)
        model.email = "ada@example.com"
        model.password = "wrong"
        #expect(await model.submit(spy.actions) == nil)
        #expect(model.error == "That email and password don't match an account.")
        #expect(model.password == "wrong")
        #expect(!model.isBusy)
    }

    @Test func rateLimitMessageShowsAndButtonReenables() async {
        let spy = AccountActionsSpy()
        spy.failure = APIError.server(status: 429, message: "Too many attempts. Try again in 15 minutes.")
        let model = AccountFormModel(mode: .forgot)
        model.email = "ada@example.com"
        #expect(await model.submit(spy.actions) == nil)
        #expect(model.error == "Too many attempts. Try again in 15 minutes.")
        #expect(model.primaryTitle == "Email me a reset link")
    }

    @Test func cancellationShowsNothing() async {
        let spy = AccountActionsSpy()
        spy.failure = CancellationError()
        let model = AccountFormModel(mode: .signIn)
        model.email = "ada@example.com"
        model.password = "x"
        #expect(await model.submit(spy.actions) == nil)
        #expect(model.error == nil)
    }

    @Test func forgotShowsTheNeutralNotice() async {
        let spy = AccountActionsSpy()
        let model = AccountFormModel(mode: .forgot, email: "ada@example.com")
        #expect(await model.submit(spy.actions) == .noticeShown)
        #expect(model.notice == "If an account exists for that address, a reset link is on its way.")
        #expect(model.error == nil)
    }

    @Test func switchingModesClearsErrorAndNotice() async {
        let spy = AccountActionsSpy()
        let model = AccountFormModel(mode: .forgot, email: "ada@example.com")
        _ = await model.submit(spy.actions)
        model.switchTo(.signIn)
        #expect(model.notice == nil)
        #expect(model.title == "Sign in")
        model.switchTo(.register)
        _ = await model.submit(spy.actions)
        #expect(model.error != nil)
        model.switchTo(.forgot)
        #expect(model.error == nil)
        #expect(model.title == "Reset your password")
    }

    @Test func resetTakesTheTokenFromAPastedLink() async {
        let spy = AccountActionsSpy()
        let token = "abcDEF_123-xyzabcDEF_123-xyzabcDEF_123-xyz"
        let model = AccountFormModel(mode: .reset, resetLink: " https://lodestar.xanom.co/reset?token=\(token)\n")
        model.password = "newpassword"
        #expect(model.resetToken == token)
        #expect(await model.submit(spy.actions) == .resetDone)
        #expect(spy.calls == ["reset \(token) newpassword"])
        #expect(model.resetDone)
        #expect(model.password.isEmpty)
    }

    @Test func resetWithoutATokenSaysTheLinkIsMissingItsCode() async {
        let spy = AccountActionsSpy()
        let model = AccountFormModel(mode: .reset, resetLink: "https://lodestar.xanom.co/reset")
        model.password = "newpassword"
        #expect(await model.submit(spy.actions) == nil)
        #expect(model.error == "This link is missing its code. Open the link from the email again.")
        model.resetLink = "https://lodestar.xanom.co/reset?token=abc"
        model.password = "short"
        #expect(model.validationMessage == "Choose a password of at least 8 characters.")
    }

    @Test func expiredResetLinkShowsTheServerSentence() async {
        let spy = AccountActionsSpy()
        spy.failure = APIError.server(status: 400, message: "This reset link is no longer valid. Request a new one.")
        let model = AccountFormModel(mode: .reset, resetLink: "abc")
        model.password = "newpassword"
        _ = await model.submit(spy.actions)
        #expect(model.error == "This reset link is no longer valid. Request a new one.")
        #expect(!model.resetDone)
    }

    @Test func buttonTitlesFollowTheMode() {
        #expect(AccountFormModel(mode: .signIn).primaryTitle == "Sign in")
        #expect(AccountFormModel(mode: .register).primaryTitle == "Create account")
        #expect(AccountFormModel(mode: .forgot).primaryTitle == "Email me a reset link")
        #expect(AccountFormModel(mode: .reset).primaryTitle == "Set new password")
        #expect(AccountFormModel(mode: .register).title == "Create an account")
    }

    @Test(arguments: [
        ("ada@example.com", true), ("a@b.co", true), ("ada@example", false), ("@example.com", false),
        ("ada example@x.com", false), ("ada@@example.com", false), ("ada@example..com", false), ("", false),
    ])
    func emailCheck(_ email: String, _ valid: Bool) {
        #expect(AccountFormModel.isEmail(email) == valid)
    }

    @Test func passwordLengthBounds() {
        #expect(!AccountFormModel.isNewPassword("1234567"))
        #expect(AccountFormModel.isNewPassword("12345678"))
        #expect(AccountFormModel.isNewPassword(String(repeating: "a", count: 200)))
        #expect(!AccountFormModel.isNewPassword(String(repeating: "a", count: 201)))
    }
}
