import Foundation
import Testing
@testable import Lodestar

@MainActor
@Suite("Stays search model")
struct StaysSearchModelTests {
    typealias F = StaysFeatureFixtures

    private func makeModel(_ service: StubStaysService) -> StaysSearchModel {
        StaysSearchModel(service: service, today: { F.today })
    }

    private func readyModel(_ service: StubStaysService) -> StaysSearchModel {
        let model = makeModel(service)
        model.update { $0.with(city: " Lisbon ").with(checkin: date("2026-11-26")) }
        return model
    }

    @Test func submitDoesNothingUntilTheFormIsReady() {
        let service = StubStaysService()
        let model = makeModel(service)
        #expect(!model.canSearch)
        #expect(model.submit() == nil)
        #expect(service.searches.isEmpty)
    }

    @Test func searchShowsHotelsThenFlexSavings() async throws {
        let service = StubStaysService()
        let model = readyModel(service)
        await model.submit()?.value
        let results = try #require(model.results)
        #expect(results.hotels.count == 2)
        #expect(results.query == F.query)
        #expect(!model.isSearching)
        #expect(service.searches == [F.query])
        await model.flexTask?.value
        #expect(service.flexes == [F.query])
        #expect(model.flexSavings.count == 1)
        #expect(model.flex.map(StaysCopy.flexStatus) == "1 stay cost less a night earlier or later.")
    }

    @Test func apiErrorShowsTheServerSentence() async {
        let service = StubStaysService()
        service.onSearch = { _ in throw APIError.server(status: 429, message: "Too many requests. Wait a minute and try again.") }
        let model = readyModel(service)
        await model.submit()?.value
        #expect(model.searchError == "Too many requests. Wait a minute and try again.")
        #expect(model.results == nil)
        #expect(model.canSearch)
    }

    @Test func otherErrorsShowTheFallback() async {
        let service = StubStaysService()
        service.onSearch = { _ in throw StaysTestError() }
        let model = readyModel(service)
        await model.submit()?.value
        #expect(model.searchError == "The hotel search failed. Try again.")
    }

    @Test func flexFailureSaysSoWithoutTouchingResults() async {
        let service = StubStaysService()
        service.onFlex = { _ in throw APIError.offline }
        let model = readyModel(service)
        await model.submit()?.value
        await model.flexTask?.value
        #expect(model.flex == .failed)
        #expect(model.results?.hotels.count == 2)
    }

    @Test func pricesLoadOncePerResultSet() async throws {
        let service = StubStaysService()
        let model = readyModel(service)
        await model.submit()?.value
        let hotel = try #require(model.results?.hotels.first)
        await model.loadPrices(for: hotel)?.value
        #expect(model.loadPrices(for: hotel) == nil)
        #expect(service.priceRequests == [F.query.prices(for: hotel.key)])
        #expect(model.priceState(for: hotel).value?.offers.count == 3)
    }

    @Test func failedPricesShowTheMessageAndRetry() async throws {
        let service = StubStaysService()
        service.onPrices = { _ in throw StaysTestError() }
        let model = readyModel(service)
        await model.submit()?.value
        let hotel = try #require(model.results?.hotels.first)
        await model.loadPrices(for: hotel)?.value
        #expect(model.priceState(for: hotel).errorMessage == "Couldn't read this hotel's prices.")
        #expect(model.loadPrices(for: hotel) != nil)
        service.onPrices = { _ in try F.prices() }
        await model.loadPrices(for: hotel, force: true)?.value
        #expect(model.priceState(for: hotel).value != nil)
    }

    @Test func aNewResultSetClearsPrices() async throws {
        let service = StubStaysService()
        let model = readyModel(service)
        await model.submit()?.value
        let firstID = try #require(model.results?.id)
        let hotel = try #require(model.results?.hotels.first)
        await model.loadPrices(for: hotel)?.value
        await model.submit()?.value
        #expect(model.results?.id != firstID)
        #expect(model.priceState(for: hotel).isLoading == false)
        #expect(model.priceState(for: hotel).value == nil)
    }

    @Test func shiftRefillsTheFormAndSearchesThoseDates() async throws {
        let service = StubStaysService()
        let model = readyModel(service)
        await model.submit()?.value
        await model.flexTask?.value
        let saving = try #require(model.flexSavings.values.first)
        await model.shift(to: saving)?.value
        #expect(model.form.checkin == date("2026-11-25"))
        #expect(model.form.checkout == date("2026-11-28"))
        #expect(service.searches.last?.checkin == date("2026-11-25"))
        #expect(service.searches.last?.city == "Lisbon")
    }

    @Test func aCancelledSearchShowsNoError() async {
        let service = StubStaysService()
        service.onSearch = { _ in
            try await Task.sleep(for: .seconds(30))
            return try F.search()
        }
        let model = readyModel(service)
        let running = model.submit()
        #expect(model.isSearching)
        #expect(!model.canSearch)
        running?.cancel()
        await running?.value
        #expect(model.results == nil)
        #expect(model.searchError == nil)
        #expect(!model.isSearching)
    }
}
