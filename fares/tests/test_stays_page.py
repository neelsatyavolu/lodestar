import base64
import json
from datetime import date
from pathlib import Path

import pytest

from lodestar_fares.stays_page import parse_card, parse_offer, parse_offers, parse_search, prices_url, search_url, stays_ts

FIXTURES = Path(__file__).parent / "fixtures"
CHECKIN, CHECKOUT = date(2026, 12, 10), date(2026, 12, 13)


def load(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text())


def decode(ts: str) -> bytes:
    return base64.urlsafe_b64decode(ts + "=" * (-len(ts) % 4))


def test_ts_carries_dates_nights_and_one_entry_per_adult() -> None:
    raw = decode(stays_ts(CHECKIN, CHECKOUT, adults=2))
    # {1: 2026, 2: 12, 3: 10} and {1: 2026, 2: 12, 3: 13}, then 3 nights.
    assert bytes.fromhex("0a0708ea0f100c180a 120708ea0f100c180d 1803".replace(" ", "")) in raw
    assert raw.count(bytes.fromhex("0a020803")) == 2
    assert decode(stays_ts(CHECKIN, CHECKOUT, adults=4)).count(bytes.fromhex("0a020803")) == 4
    assert b"USD" in raw


@pytest.mark.parametrize(("checkout", "adults"), [(CHECKIN, 2), (date(2027, 1, 20), 2), (CHECKOUT, 0), (CHECKOUT, 9)])
def test_ts_rejects_bad_stays(checkout: date, adults: int) -> None:
    with pytest.raises(ValueError):
        stays_ts(CHECKIN, checkout, adults)


def test_urls_only_point_at_google_hotels() -> None:
    assert search_url("Lisbon", CHECKIN, CHECKOUT, 2).startswith("https://www.google.com/travel/search?q=hotels%20in%20Lisbon&")
    assert prices_url("ChkIn4CU6sjxgJ1YGg0vZy8xMWY0XzdqenhqEAE", CHECKIN, CHECKOUT, 2).startswith("https://www.google.com/travel/hotels/entity/ChkIn4CU6sjxgJ1YGg0vZy8xMWY0XzdqenhqEAE/prices?")
    with pytest.raises(ValueError):
        prices_url("../../evil", CHECKIN, CHECKOUT, 2)


def test_search_reads_every_card() -> None:
    hotels = parse_search(load("stays_lisbon_search")["cards"])
    assert len(hotels) == 18
    patio = next(h for h in hotels if h.name == "Patio São Vicente Guest Houses")
    assert patio.key == "ChkIn4CU6sjxgJ1YGg0vZy8xMWY0XzdqenhqEAE"
    assert patio.price == 94
    assert patio.deal_pct == 41
    assert (patio.rating, patio.reviews, patio.stars) == (4.9, 353, 4)
    assert patio.amenities[:2] == ["Free Wi-Fi", "Air conditioning"]
    assert patio.image and patio.image.startswith("https://")


def test_card_names_with_colons_keep_their_amenities() -> None:
    card = {
        "href": "/entity/ChgI7cP88f_t59dPGgwvZy8xMm05MjNtYmsQAQ/prices",
        "labels": ["Prices starting from $138, The Terrace: Penthouse"],
        "text": "Amenities for The Terrace: Penthouse: Apartment, Sleeps 4,",
    }
    hotel = parse_card(card)
    assert hotel is not None
    assert hotel.amenities == ["Apartment", "Sleeps 4"]


def test_cards_without_a_price_are_skipped() -> None:
    assert parse_card({"href": "/entity/ChgI7cP88f_t59dPGgwvZy8xMm05MjNtYmsQAQ/prices", "labels": ["Some Hotel"], "text": ""}) is None


def test_guesthouse_offers_cheapest_first_with_free_cancellation() -> None:
    offers = parse_offers(load("stays_guesthouse_prices")["rows"], CHECKIN)
    assert [o.seller for o in offers[:2]] == ["Hotels.com", "Expedia.com"]
    first = offers[0]
    assert (first.nightly_base, first.nightly, first.total) == (94, 109, 326)
    assert first.free_cancel_until is None
    assert not first.official
    assert first.url and first.url.startswith("https://www.google.com/travel/lodging/clk?")
    booking = next(o for o in offers if o.seller == "Booking.com")
    assert (booking.total, booking.free_cancel_until) == (365, "2026-12-04")
    # Featured sellers appear twice on the page; each offer is kept once.
    assert len({(o.seller, o.total) for o in offers}) == len(offers)


def test_official_site_is_marked() -> None:
    offers = parse_offers(load("stays_marriott_prices")["rows"], CHECKIN)
    official = [o for o in offers if o.official]
    assert len(official) == 1
    assert (official[0].seller, official[0].nightly, official[0].total) == ("Lisbon Marriott Hotel", 214, 643)
    assert offers[0].seller == "Super.com"


def test_cancellation_date_rolls_back_a_year_when_needed() -> None:
    text = "Booking.comFree cancellation until Dec 28, · 2 guests, · $50$50$60$180Visit site"
    offer = parse_offer(text, None, date(2027, 1, 3))
    assert offer is not None
    assert offer.free_cancel_until == "2026-12-28"
    assert offer.url is None
