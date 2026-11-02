"""Read Google Hotels pages into hotels, sellers and prices.

Google Hotels takes its dates and guests from a `ts` URL parameter, a
base64url protobuf. `stays_ts` builds one from scratch: the city comes from
the `q` text, so no place id is needed.

The service loads the pages in headless Chromium and hands this module two
kinds of raw data, both kept as test fixtures:

- search results: one dict per hotel card (its prices link, aria-labels and text);
- a hotel's prices page: the text of each seller link, which carries the
  nightly base price, the nightly price with taxes and the stay total.

Everything here is pure so it can be tested against captured pages.
"""

from __future__ import annotations

import base64
import re
from dataclasses import asdict, dataclass, field
from datetime import date
from urllib.parse import quote

GOOGLE = "https://www.google.com"
KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{10,200}$")
MAX_ADULTS = 8
MAX_NIGHTS = 30

# --- the ts parameter -------------------------------------------------------


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        low, n = n & 0x7F, n >> 7
        out.append(low | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _num(field_no: int, value: int) -> bytes:
    return _varint(field_no << 3) + _varint(value)


def _msg(field_no: int, body: bytes) -> bytes:
    return _varint(field_no << 3 | 2) + _varint(len(body)) + body


def _day(field_no: int, d: date) -> bytes:
    return _msg(field_no, _num(1, d.year) + _num(2, d.month) + _num(3, d.day))


def stays_ts(checkin: date, checkout: date, adults: int = 2) -> str:
    """The `ts` value for these dates and adults, in US dollars."""
    nights = (checkout - checkin).days
    if not 1 <= nights <= MAX_NIGHTS:
        raise ValueError(f"A stay is 1 to {MAX_NIGHTS} nights.")
    if not 1 <= adults <= MAX_ADULTS:
        raise ValueError(f"Choose 1 to {MAX_ADULTS} adults.")
    # Field 2 holds one {1: 3} entry per adult.
    guests = b"".join(_msg(1, _num(1, 3)) for _ in range(adults)) + _num(2, 0)
    stay = _msg(2, _day(1, checkin) + _day(2, checkout) + _num(3, nights)) + _msg(6, _num(1, 1))
    currency = _msg(1, _msg(7, b"USD")) + _msg(3, b"")
    body = _num(1, 1) + _msg(2, guests) + _msg(3, _msg(2, stay)) + _msg(5, currency)
    return base64.urlsafe_b64encode(body).decode().rstrip("=")


def search_url(city: str, checkin: date, checkout: date, adults: int) -> str:
    return f"{GOOGLE}/travel/search?q={quote(f'hotels in {city}')}&hl=en&gl=us&curr=USD&ts={stays_ts(checkin, checkout, adults)}"


def prices_url(key: str, checkin: date, checkout: date, adults: int) -> str:
    if not KEY_PATTERN.fullmatch(key):
        raise ValueError("Invalid hotel.")
    return f"{GOOGLE}/travel/hotels/entity/{key}/prices?hl=en&gl=us&curr=USD&ts={stays_ts(checkin, checkout, adults)}"


# --- search results -----------------------------------------------------------


@dataclass(frozen=True)
class Hotel:
    key: str
    name: str
    # Google's "from" price per night for the stay, before taxes.
    price: float
    deal_pct: int | None = None
    rating: float | None = None
    reviews: int | None = None
    stars: int | None = None
    amenities: list[str] = field(default_factory=list)
    image: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


_KEY = re.compile(r"/entity/([A-Za-z0-9_-]+)")
_FROM = re.compile(r"^Prices starting from \$([\d,]+), (.+?)(?: (?:GREAT )?DEAL (\d+)% less than usual)?$")
_RATING = re.compile(r"^([\d.]+) out of 5 stars from ([\d,]+) reviews")
_STARS = re.compile(r"^(\d)-star hotel$", re.MULTILINE)
MAX_AMENITIES = 6


def _money(raw: str) -> float:
    return float(raw.replace(",", ""))


def _amenities(text: str, name: str) -> list[str]:
    prefix = f"Amenities for {name}"
    for line in text.splitlines():
        if line.startswith(prefix):
            rest = line[len(prefix) :]
            rest = rest.split(": ", 1)[1] if ": " in rest else ""
            return [a.strip() for a in rest.split(",") if a.strip()][:MAX_AMENITIES]
    return []


def parse_card(card: dict) -> Hotel | None:
    """One result card, or None when it has no key or no price (sold out, or not a hotel)."""
    key = _KEY.search(card.get("href") or "")
    labels: list[str] = [label for label in card.get("labels") or [] if label]
    priced = next((m for m in map(_FROM.match, labels) if m), None)
    if not key or not priced:
        return None
    name = priced.group(2)
    rating = next((m for m in map(_RATING.match, labels) if m), None)
    text = card.get("text") or ""
    stars = _STARS.search(text)
    image = card.get("image")
    return Hotel(
        key=key.group(1),
        name=name,
        price=_money(priced.group(1)),
        deal_pct=int(priced.group(3)) if priced.group(3) else None,
        rating=float(rating.group(1)) if rating else None,
        reviews=int(rating.group(2).replace(",", "")) if rating else None,
        stars=int(stars.group(1)) if stars else None,
        amenities=_amenities(text, name),
        image=image if image and image.startswith("https://") else None,
    )


def parse_search(cards: list[dict]) -> list[Hotel]:
    seen: set[str] = set()
    hotels: list[Hotel] = []
    for card in cards:
        hotel = parse_card(card)
        if hotel and hotel.key not in seen:
            seen.add(hotel.key)
            hotels.append(hotel)
    return hotels


# --- a hotel's sellers ----------------------------------------------------------


@dataclass(frozen=True)
class Offer:
    seller: str
    official: bool
    # Per night before taxes, per night with taxes and fees, and the whole stay with them.
    nightly_base: float
    nightly: float
    total: float
    # YYYY-MM-DD of the last day to cancel for free, or None when the rate isn't refundable.
    free_cancel_until: str | None
    url: str | None

    def to_dict(self) -> dict:
        return asdict(self)


_PRICES = re.compile(r"\$([\d,]+(?:\.\d+)?)\$([\d,]+(?:\.\d+)?)\$([\d,]+(?:\.\d+)?)\$([\d,]+(?:\.\d+)?)(?:Visit site|Get price)")
_NAME_END = re.compile(r"Free cancellation|\d+ guests?|Official Site|,\s·|Total per night|\$")
_CANCEL = re.compile(r"Free cancellation until ([A-Z][a-z]{2}) (\d{1,2})")
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _cancel_date(text: str, checkin: date) -> str | None:
    """The free-cancellation day as a date: the latest one on or before check-in."""
    m = _CANCEL.search(text)
    if not m or m.group(1) not in _MONTHS:
        return None
    month, day = _MONTHS.index(m.group(1)) + 1, int(m.group(2))
    for year in (checkin.year, checkin.year - 1):
        try:
            d = date(year, month, day)
        except ValueError:
            return None
        if d <= checkin:
            return d.isoformat()
    return None


def parse_offer(text: str, href: str | None, checkin: date) -> Offer | None:
    prices = _PRICES.search(text)
    if not prices:
        return None
    head = text[: prices.start()]
    official = "Official Site" in head
    name = head.split("\n", 1)[0] if official else _NAME_END.split(head, maxsplit=1)[0]
    name = name.strip()
    if not name:
        return None
    return Offer(
        seller=name,
        official=official,
        nightly_base=_money(prices.group(1)),
        nightly=_money(prices.group(3)),
        total=_money(prices.group(4)),
        free_cancel_until=_cancel_date(head, checkin),
        url=f"{GOOGLE}{href}" if href and href.startswith("/travel/lodging/clk") else None,
    )


def parse_offers(rows: list[dict], checkin: date) -> list[Offer]:
    """Every seller's offer, cheapest stay first. The page lists featured sellers twice."""
    seen: set[tuple[str, float, str | None]] = set()
    offers: list[Offer] = []
    for row in rows:
        offer = parse_offer(row.get("text") or "", row.get("href"), checkin)
        if offer is None:
            continue
        ident = (offer.seller.lower(), offer.total, offer.free_cancel_until)
        if ident not in seen:
            seen.add(ident)
            offers.append(offer)
    return sorted(offers, key=lambda o: (o.total, not o.official))
