import CoreGraphics
import Foundation
import Testing
@testable import Lodestar

@MainActor
@Suite("Onboarding paging and the tour")
struct OnboardingAndTourTests {
    @Test func nineSegmentsEightQuestions() {
        #expect(OnboardingModel.pageCount == 9)
        #expect(OnboardingPage.allCases.first?.title == "Where do you usually fly from?")
        #expect(OnboardingPage.allCases.last?.title == "And the rest of the day?")
    }

    @Test func questionPagesAdvanceWithoutSavingUntilTheLast() async {
        let model = OnboardingModel(preferences: .default)
        var saves = 0
        for _ in 0..<7 {
            await model.advance(save: { _ in saves += 1 }, report: { $0.userMessage })
        }
        #expect(model.step == 7)
        #expect(saves == 0)
        #expect(model.page == .doing)
        model.draft.update { $0.homeAirports = ["SFO"] }
        var sent: Preferences?
        await model.advance(save: { sent = $0; saves += 1 }, report: { $0.userMessage })
        #expect(saves == 1)
        #expect(sent?.homeAirports == ["SFO"])
        #expect(model.isAIPage)
        #expect(model.hasSaved)
        #expect(model.page == nil)
    }

    @Test func aSaveErrorStaysOnTheLastQuestion() async {
        let model = OnboardingModel(preferences: .default)
        for _ in 0..<7 { await model.advance(save: { _ in }, report: { $0.userMessage }) }
        await model.advance(save: { _ in throw APIError.offline }, report: { $0.userMessage })
        #expect(model.step == 7)
        #expect(model.draft.error == "Can't reach Lodestar. Check your connection.")
        model.back()
        #expect(model.step == 6)
        #expect(model.draft.error == nil)
    }

    @Test func backStopsAtTheFirstPage() {
        let model = OnboardingModel(preferences: .default)
        #expect(!model.canGoBack)
        model.back()
        #expect(model.step == 0)
    }

    @Test func aiPageCopy() {
        #expect(OnboardingModel.aiTitle(connected: false) == "Last step: connect your AI.")
        #expect(OnboardingModel.aiTitle(connected: true) == "Plan is ready to go.")
        #expect(OnboardingModel.aiHint(connected: true) == "Your AI account is connected. Next, a quick look at how Plan works.")
    }

    @Test func tourStepsStartOnPlanAndDropTripsWhenSignedOut() {
        let signedIn = TourStep.steps(signedIn: true)
        #expect(signedIn.map(\.title) == ["Plan", "Say the trip", "Search", "Trips", "Your account"])
        #expect(signedIn.first?.opens == .plan)
        #expect(signedIn[1].tab == nil)
        #expect(!TourStep.steps(signedIn: false).contains { $0.tab == .trips })
    }

    @Test func tourPagesAndFinishes() {
        let model = TourModel(steps: TourStep.steps(signedIn: true))
        #expect(model.counter == "1 of 5")
        #expect(model.primaryTitle == "Next")
        model.back()
        #expect(model.index == 0)
        for _ in 0..<4 { model.next() }
        #expect(model.isLast)
        #expect(model.primaryTitle == "Done")
        model.next()
        #expect(model.isFinished)
        #expect(model.step == nil)
        #expect(TourModel(steps: []).isFinished)
    }

    @Test func cardSitsAboveATabItemAndStaysOnScreen() {
        let screen = CGSize(width: 402, height: 874)
        let item = CGRect(x: 10, y: 800, width: 60, height: 50)
        let origin = TourLayout.cardOrigin(target: item, cardHeight: 150, container: screen, topInset: 62)
        #expect(origin.x == 16)
        #expect(origin.y == CGFloat(632)) // 800 - 6 pad - 12 gap - 150 card
        let right = TourLayout.cardOrigin(target: CGRect(x: 360, y: 800, width: 40, height: 50),
                                          cardHeight: 150, container: screen, topInset: 62)
        #expect(right.x == CGFloat(66)) // 402 - 320 card - 16 gutter
    }

    @Test func cardWithoutATargetSitsNearTheTop() {
        let origin = TourLayout.cardOrigin(target: nil, cardHeight: 150, container: CGSize(width: 340, height: 700), topInset: 50)
        #expect(TourLayout.cardWidth(in: CGSize(width: 340, height: 700)) == 308)
        #expect(origin == CGPoint(x: 16, y: 130))
    }

    @Test func evenFramesSplitTheBar() {
        let frames = TourLayout.evenItemFrames(in: CGRect(x: 0, y: 800, width: 400, height: 50), count: 4)
        #expect(frames.count == 4)
        #expect(frames[2] == CGRect(x: 200, y: 800, width: 100, height: 50))
        #expect(TourLayout.visibleTabs(signedIn: false) == [.search, .stays, .plan, .account])
    }

    @Test func signOutEverywhereAndDeleteModels() async {
        let everywhere = SignOutEverywhereModel()
        await everywhere.run(using: {}, report: { $0.userMessage })
        #expect(everywhere.notice == SignOutEverywhereModel.doneNotice)

        let delete = DeleteAccountModel()
        #expect(await delete.delete(using: { _ in }, report: { $0.userMessage }) == false)
        #expect(delete.error == "Enter your password to delete your account.")
        delete.password = "wrong"
        let failed = await delete.delete(using: { _ in
            throw APIError.server(status: 401, message: "That password isn't right.")
        }, report: { $0.userMessage })
        #expect(!failed)
        #expect(delete.error == "That password isn't right.")
        #expect(await delete.delete(using: { _ in }, report: { $0.userMessage }))
        #expect(delete.password.isEmpty)
    }
}

@Suite("Tour tab bar frames")
struct TourFrameTests {
    @Test func duplicateLayersCollapseToOneFramePerTab() {
        let a = CGRect(x: 25, y: 795, width: 98, height: 54)
        let b = CGRect(x: 109.67, y: 795, width: 98, height: 54)
        let frames = TourLayout.uniqueFrames([b, a, a, CGRect(x: 109.66, y: 795, width: 98, height: 54)])
        #expect(frames.count == 2)
        #expect(frames.first == a)
        #expect(abs((frames.last?.minX ?? 0) - 109.66) < 0.02)
    }
}
