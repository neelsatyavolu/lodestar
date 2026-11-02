"""Parse a Google Flights booking page into sellers, fare tiers and price insight.

Google's booking-options RPC now needs a browser-signed header, so the
service loads the public booking page in headless Chromium and reads two
things from it: the "Continue to book with ..." button labels (one per
bookable fare, authoritative for seller, fare name and price) and the page
text (fare features, which sellers are the airline itself, price insight).

Everything here is pure so it can be tested against captured pages.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

_LABEL = re.compile(
    r"^Continue to book with (?P<seller>.+?)(?:, (?P<fare>.+?))? for (?P<price>[\d,]+(?:\.\d+)?) US dollars"
)
_PRICE_LINE = re.compile(r"^\$([\d,]+(?:\.\d+)?)$")
_LEVEL = re.compile(r"\$([\d,]+) is (low|typical|high)\b")
_RANGE = re.compile(r"usually cost between \$([\d,]+)\s*[–-]\s*\$?([\d,]+)")
_UNLIKELY_DROP = re.compile(r"unlikely to drop below \$([\d,]+)")
_CHEAPER_THAN_USUAL = re.compile(r"\$([\d,]+) cheaper than usual")
_BAG_FEE = re.compile(r"1st checked bag: \$([\d,]+)")
_AIRLINE_SUFFIX = re.compile(r"\s+airline$", re.IGNORECASE)


def _money(raw: str) -> float:
    return float(raw.replace(",", ""))


@dataclass(frozen=True)
class FarePolicy:
    """What a fare includes, read from Google's feature lines."""

    carry_on: bool | None = None
    checked_bag_fee: float | None = None  # 0 means first bag free
    checked_bag_included: bool | None = None
    changes: str | None = None  # "free" | "fee" | "none"
    refunds: str | None = None  # "full" | "partial" | "none"
    seat_selection: str | None = None  # "free" | "fee" | "none"


@dataclass(frozen=True)
class Fare:
    name: str | None
    price: float
    features: list[str] = field(default_factory=list)
    policy: FarePolicy = field(default_factory=FarePolicy)


@dataclass(frozen=True)
class Seller:
    name: str
    is_airline: bool
    fares: list[Fare]

    @property
    def lowest(self) -> float:
        return min(f.price for f in self.fares)


@dataclass(frozen=True)
class PriceInsight:
    level: str | None = None  # "low" | "typical" | "high"
    typical_low: float | None = None
    typical_high: float | None = None
    unlikely_to_drop_below: float | None = None
    cheaper_than_usual_by: float | None = None
    summary: str | None = None


@dataclass(frozen=True)
class BookingPage:
    sellers: list[Seller]
    insight: PriceInsight

    def to_dict(self) -> dict:
        return {
            "sellers": [
                {**asdict(s), "lowest": s.lowest} for s in sorted(self.sellers, key=lambda s: s.lowest)
            ],
            "insight": asdict(self.insight),
        }


def policy_from_features(features: list[str]) -> FarePolicy:
    """Summarise Google's free-text fare features into a few comparable fields."""
    text = " | ".join(features).lower()
    carry_on: bool | None = None
    if "free carry-on" in text:
        carry_on = True
    elif "no carry-on" in text or "carry-on bag costs" in text or "carry-on for a fee" in text:
        carry_on = False

    bag_fee: float | None = None
    bag_included: bool | None = None
    fee = _BAG_FEE.search(" | ".join(features))
    if "1st checked bag free" in text or re.search(r"\b\d free checked bags?\b", text):
        bag_fee, bag_included = 0.0, True
    elif fee:
        bag_fee, bag_included = _money(fee.group(1)), False
    elif "no checked bags" in text:
        bag_included = False

    changes = None
    if "free change" in text:
        changes = "free"
    elif "changes for a fee" in text:
        changes = "fee"
    elif "no ticket changes" in text or "no changes" in text:
        changes = "none"

    refunds = None
    if "full refund" in text:
        refunds = "full"
    elif "partial refund" in text:
        refunds = "partial"
    elif "no refunds" in text:
        refunds = "none"

    seat = None
    if "free seat selection" in text:
        seat = "free"
    elif "seat selection for a fee" in text:
        seat = "fee"
    elif "no seat selection" in text:
        seat = "none"

    return FarePolicy(carry_on, bag_fee, bag_included, changes, refunds, seat)


def _features_for(lines: list[str], fare_name: str, price: float) -> list[str]:
    """Feature lines that follow `fare_name` / `$price` up to the next Continue."""
    for i in range(len(lines) - 1):
        if lines[i] != fare_name:
            continue
        match = _PRICE_LINE.match(lines[i + 1])
        if not match or _money(match.group(1)) != price:
            continue
        out: list[str] = []
        for line in lines[i + 2 :]:
            if line == "Continue":
                break
            out.append(line)
        return out[:20]
    return []


def _parse_insight(text: str) -> PriceInsight:
    level = _LEVEL.search(text)
    rng = _RANGE.search(text)
    drop = _UNLIKELY_DROP.search(text)
    cheaper = _CHEAPER_THAN_USUAL.search(text)
    summary = None
    if rng:
        start = text.rfind("\n", 0, rng.start()) + 1
        end = text.find("\n", rng.end())
        summary = text[start : end if end > 0 else None].strip()
    return PriceInsight(
        level=level.group(2) if level else None,
        typical_low=_money(rng.group(1)) if rng else None,
        typical_high=_money(rng.group(2)) if rng else None,
        unlikely_to_drop_below=_money(drop.group(1)) if drop else None,
        cheaper_than_usual_by=_money(cheaper.group(1)) if cheaper else None,
        summary=summary,
    )


def parse_booking_page(labels: list[str], text: str) -> BookingPage:
    """Build the structured booking page from button labels and body text."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    by_seller: dict[str, list[Fare]] = {}
    seen: set[tuple[str, str | None, float]] = set()
    airline_labelled: set[str] = set()
    for label in labels:
        match = _LABEL.match(label.strip())
        if not match:
            continue
        seller, fare_name, price = match.group("seller"), match.group("fare"), _money(match.group("price"))
        # Google sometimes labels the airline's own option "Delta airline".
        if _AIRLINE_SUFFIX.search(seller):
            seller = _AIRLINE_SUFFIX.sub("", seller)
            airline_labelled.add(seller)
        key = (seller, fare_name, price)
        if key in seen:
            continue
        seen.add(key)
        features = _features_for(lines, fare_name, price) if fare_name else []
        fare = Fare(fare_name, price, features, policy_from_features(features))
        by_seller.setdefault(seller, []).append(fare)

    sellers = [
        Seller(
            name=name,
            is_airline=name in airline_labelled or bool(re.search(rf"Book with {re.escape(name)}\s*Airline", text)),
            fares=fares,
        )
        for name, fares in by_seller.items()
    ]
    return BookingPage(sellers=sellers, insight=_parse_insight(text))
