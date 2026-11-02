import json
from pathlib import Path

import pytest

from contrail_fares.booking_page import parse_booking_page, policy_from_features
from contrail_fares.browser import booking_url

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> tuple[list[str], str]:
    data = json.loads((FIXTURES / f"{name}.json").read_text())
    return data["labels"], data["text"]


def test_airline_direct_with_fare_tiers() -> None:
    page = parse_booking_page(*load("sfo_jfk_airline"))
    assert len(page.sellers) == 1
    seller = page.sellers[0]
    assert seller.name == "American"
    assert seller.is_airline
    names = [f.name for f in seller.fares]
    assert names[0] == "Basic Economy"
    basic = seller.fares[0]
    assert basic.price == 174
    assert basic.policy.changes == "none"
    assert basic.policy.carry_on is True
    assert basic.policy.checked_bag_fee == 55
    assert basic.policy.seat_selection == "fee"


def test_ota_sellers_are_not_marked_airline() -> None:
    page = parse_booking_page(*load("sfo_lhr_ota"))
    by_name = {s.name: s for s in page.sellers}
    assert by_name["ITA"].is_airline
    assert not by_name["Booking.com"].is_airline
    assert not by_name["FlightHub"].is_airline
    assert by_name["FlightHub"].fares[0].name is None
    assert by_name["FlightHub"].lowest == 409
    assert len(by_name["ITA"].fares) == 3


def test_sellers_sorted_by_lowest_price_in_dict() -> None:
    data = parse_booking_page(*load("sfo_lhr_ota")).to_dict()
    prices = [s["lowest"] for s in data["sellers"]]
    assert prices == sorted(prices)


def test_price_insight() -> None:
    insight = parse_booking_page(*load("sfo_lhr_ota")).insight
    assert insight.level == "typical"
    assert insight.typical_low == 370
    assert insight.typical_high == 930
    assert "London" in (insight.summary or "")


def test_insight_low_with_savings() -> None:
    insight = parse_booking_page(*load("sfo_jfk_airline")).insight
    assert insight.level in {"low", "typical", "high"}


def test_duplicate_labels_collapse() -> None:
    label = "Continue to book with Expedia for 200 US dollars"
    page = parse_booking_page([label, label], "Book with Expedia\n$200\nContinue")
    assert len(page.sellers) == 1
    assert len(page.sellers[0].fares) == 1


def test_airline_suffix_marks_airline_and_merges() -> None:
    labels = [
        "Continue to book with Delta airline for 300 US dollars",
        "Continue to book with Delta, Main Cabin for 320 US dollars",
        "Continue to book with Expedia for 305 US dollars",
    ]
    page = parse_booking_page(labels, "")
    by_name = {s.name: s for s in page.sellers}
    assert set(by_name) == {"Delta", "Expedia"}
    assert by_name["Delta"].is_airline
    assert len(by_name["Delta"].fares) == 2
    assert not by_name["Expedia"].is_airline


def test_unrelated_labels_ignored() -> None:
    page = parse_booking_page(["Learn more about booking options", "Share"], "")
    assert page.sellers == []


@pytest.mark.parametrize(
    "features,expected",
    [
        (["1 free carry-on", "1st checked bag free", "Full refunds"], {"checked_bag_fee": 0, "refunds": "full"}),
        (["No carry-on", "No checked bags"], {"carry_on": False, "checked_bag_included": False}),
        (["Ticket changes for a fee", "Free seat selection"], {"changes": "fee", "seat_selection": "free"}),
        (["2 free checked bags"], {"checked_bag_included": True}),
    ],
)
def test_policy_summary(features: list[str], expected: dict) -> None:
    policy = policy_from_features(features)
    for key, value in expected.items():
        assert getattr(policy, key) == value


def test_booking_url_rejects_non_tokens() -> None:
    with pytest.raises(ValueError):
        booking_url("https://evil.example/")
    with pytest.raises(ValueError):
        booking_url("short")
    assert booking_url("CBwQAho_EgoyMDI2LTEy").startswith("https://www.google.com/travel/flights/booking?tfs=")


def test_identical_reads_share_one_page_load() -> None:
    import asyncio

    from contrail_fares.booking_page import BookingPage, PriceInsight
    from contrail_fares.browser import BookingBrowser

    calls = 0

    async def fake_load(self: BookingBrowser, tfs: str) -> BookingPage:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return BookingPage(sellers=[], insight=PriceInsight())

    async def run() -> None:
        b = BookingBrowser()
        b._load = fake_load.__get__(b)  # type: ignore[method-assign]
        await asyncio.gather(b.read("CBwQAho_EgoyMDI2LTEy"), b.read("CBwQAho_EgoyMDI2LTEy"))

    asyncio.run(run())
    assert calls == 1


def test_booking_url_rejects_trailing_newline() -> None:
    with pytest.raises(ValueError):
        booking_url("CBwQAho_EgoyMDI2LTEy\n")
