"""Flight and date searches over fli, returning plain JSON-ready dicts."""

from __future__ import annotations

import hashlib
import logging
import warnings
from datetime import date
from typing import Any, Literal
from urllib.parse import parse_qs, urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

warnings.filterwarnings("ignore", category=FutureWarning, module="fli")

from fli.models import (  # noqa: E402 - after the warning filter on purpose
    Airport,
    BagsFilter,
    DateSearchFilters,
    FlightResult,
    FlightSearchFilters,
    FlightSegment,
    MaxStops,
    PassengerInfo,
    SeatType,
    SortBy,
    TripType,
)
from fli.search import SearchDates, SearchFlights  # noqa: E402

logger = logging.getLogger(__name__)

Cabin = Literal["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"]
Stops = Literal["ANY", "0", "1", "2"]
STOPS = {"ANY": MaxStops.ANY, "0": MaxStops.NON_STOP, "1": MaxStops.ONE_STOP_OR_FEWER, "2": MaxStops.TWO_OR_FEWER_STOPS}


class SearchError(Exception):
    """A search the caller asked for cannot be run as given."""


def clean_codes(value: list[str]) -> list[str]:
    cleaned = list(dict.fromkeys(v.strip().upper() for v in value))
    if any(len(c) != 3 or not c.isalpha() for c in cleaned):
        raise ValueError("Airport codes are three letters.")
    return cleaned


def airports(codes: list[str]) -> list[list[Any]]:
    out = []
    for code in codes:
        try:
            out.append([Airport[code], 0])
        except KeyError as exc:
            raise SearchError(f"Unknown airport code {code}.") from exc
    return out


class Passengers(BaseModel):
    adults: int = Field(1, ge=1, le=9)
    children: int = Field(0, ge=0, le=8)

    @model_validator(mode="after")
    def total(self) -> "Passengers":
        if self.adults + self.children > 9:
            raise ValueError("At most 9 passengers.")
        return self

    def to_fli(self) -> PassengerInfo:
        return PassengerInfo(adults=self.adults, children=self.children)


class FlightsRequest(BaseModel):
    origins: list[str] = Field(min_length=1, max_length=6)
    destinations: list[str] = Field(min_length=1, max_length=6)
    depart: date
    return_date: date | None = None
    cabin: Cabin = "ECONOMY"
    max_stops: Stops = "ANY"
    passengers: Passengers = Passengers()
    checked_bags: int = Field(0, ge=0, le=2)
    carry_on: bool = False
    exclude_basic: bool = False
    sort: Literal["CHEAPEST", "BEST"] = "CHEAPEST"
    expand: int = Field(5, ge=1, le=10)

    @field_validator("origins", "destinations")
    @classmethod
    def codes(cls, value: list[str]) -> list[str]:
        return clean_codes(value)

    @model_validator(mode="after")
    def dates(self) -> "FlightsRequest":
        if self.return_date and self.return_date < self.depart:
            raise ValueError("Return date is before departure.")
        if set(self.origins) & set(self.destinations):
            raise ValueError("Origin and destination overlap.")
        return self


class DatesRequest(BaseModel):
    origins: list[str] = Field(min_length=1, max_length=6)
    destinations: list[str] = Field(min_length=1, max_length=6)
    start: date
    end: date
    trip_days: int | None = Field(None, ge=1, le=60)
    cabin: Cabin = "ECONOMY"
    max_stops: Stops = "ANY"
    passengers: Passengers = Passengers()

    @field_validator("origins", "destinations")
    @classmethod
    def codes(cls, value: list[str]) -> list[str]:
        return clean_codes(value)

    @model_validator(mode="after")
    def window(self) -> "DatesRequest":
        if self.end < self.start:
            raise ValueError("End date is before start.")
        if (self.end - self.start).days > 90:
            raise ValueError("Date window is at most 90 days.")
        return self


def _code(value: Any) -> str:
    return getattr(value, "name", str(value)).lstrip("_")


def _airline(value: Any) -> dict[str, str]:
    return {"code": _code(value), "name": getattr(value, "value", _code(value))}


def _leg(leg: Any) -> dict[str, Any]:
    amenities = leg.amenities.model_dump(exclude_none=True, mode="json") if leg.amenities else None
    return {
        "from": _code(leg.departure_airport),
        "from_name": leg.departure_airport_name or getattr(leg.departure_airport, "value", None),
        "to": _code(leg.arrival_airport),
        "to_name": leg.arrival_airport_name or getattr(leg.arrival_airport, "value", None),
        "depart": leg.departure_datetime.isoformat(),
        "arrive": leg.arrival_datetime.isoformat(),
        "minutes": leg.duration,
        "airline": _airline(leg.airline),
        "operating": _airline(leg.operating_airline) if leg.operating_airline else None,
        "flight_number": leg.flight_number,
        "aircraft": leg.aircraft,
        "legroom": leg.legroom,
        "overnight": bool(leg.overnight),
        "amenities": amenities,
    }


def _slice(result: FlightResult) -> dict[str, Any]:
    return {
        "minutes": result.duration,
        "stops": result.stops,
        "legs": [_leg(leg) for leg in result.legs],
        "layovers": [
            {
                "airport": _code(lay.airport) if getattr(lay, "airport", None) else None,
                "city": getattr(lay, "city", None),
                "minutes": lay.duration,
                "overnight": bool(getattr(lay, "overnight", False)),
                "change_of_airport": bool(getattr(lay, "change_of_airport", False)),
            }
            for lay in (result.layovers or [])
        ],
        "self_transfer": bool(result.self_transfer),
        "co2_kg": round(result.co2_emissions_g / 1000) if result.co2_emissions_g else None,
        "co2_delta_pct": result.co2_emissions_delta_pct,
    }


def _tfs(url: str) -> str | None:
    values = parse_qs(urlparse(url).query).get("tfs")
    return values[0] if values else None


def itinerary(client: SearchFlights, flight: Any, request: FlightsRequest) -> dict[str, Any] | None:
    results: list[FlightResult] = list(flight) if isinstance(flight, tuple) else [flight]
    price = results[-1].price if len(results) > 1 else results[0].price
    if price is None:
        return None
    url = client.build_flight_booking_url(
        flight,
        currency="USD",
        language="en",
        country="US",
        seat_type=SeatType[request.cabin],
        passenger_info=request.passengers.to_fli(),
    )
    slices = [_slice(r) for r in results]
    # The tfs token encodes flights, dates, cabin and passengers, so the id changes
    # whenever any of those do and a seller check is never reused for another fare.
    tfs = _tfs(url)
    key = tfs or "|".join(f"{leg['airline']['code']}{leg['flight_number']}@{leg['depart']}" for s in slices for leg in s["legs"])
    return {
        "id": hashlib.sha1(key.encode()).hexdigest()[:12],
        "price": price,
        "currency": results[0].currency or "USD",
        "slices": slices,
        "booking_url": url,
        "tfs": tfs,
    }


def search_flights(request: FlightsRequest) -> dict[str, Any]:
    round_trip = request.return_date is not None
    segments = [
        FlightSegment(
            departure_airport=airports(request.origins),
            arrival_airport=airports(request.destinations),
            travel_date=request.depart.isoformat(),
        )
    ]
    if request.return_date is not None:
        segments.append(
            FlightSegment(
                departure_airport=airports(request.destinations),
                arrival_airport=airports(request.origins),
                travel_date=request.return_date.isoformat(),
            )
        )
    bags = BagsFilter(checked_bags=request.checked_bags, carry_on=request.carry_on) if (
        request.checked_bags or request.carry_on
    ) else None
    filters = FlightSearchFilters(
        trip_type=TripType.ROUND_TRIP if round_trip else TripType.ONE_WAY,
        passenger_info=request.passengers.to_fli(),
        flight_segments=segments,
        seat_type=SeatType[request.cabin],
        stops=STOPS[request.max_stops],
        sort_by=SortBy[request.sort],
        exclude_basic_economy=request.exclude_basic,
        bags=bags,
    )
    client = SearchFlights()
    raw = client.search(filters, top_n=request.expand, currency="USD", language="en", country="US") or []
    seen: set[str] = set()
    out = []
    for flight in raw:
        item = itinerary(client, flight, request)
        if item and item["id"] not in seen:
            seen.add(item["id"])
            out.append(item)
    out.sort(key=lambda i: i["price"])
    return {"itineraries": out, "round_trip": round_trip}


def search_dates(request: DatesRequest) -> dict[str, Any]:
    round_trip = request.trip_days is not None
    depart = request.start
    segments = [
        FlightSegment(
            departure_airport=airports(request.origins),
            arrival_airport=airports(request.destinations),
            travel_date=depart.isoformat(),
        )
    ]
    if request.trip_days is not None:
        back = date.fromordinal(depart.toordinal() + request.trip_days)
        segments.append(
            FlightSegment(
                departure_airport=airports(request.destinations),
                arrival_airport=airports(request.origins),
                travel_date=back.isoformat(),
            )
        )
    filters = DateSearchFilters(
        trip_type=TripType.ROUND_TRIP if round_trip else TripType.ONE_WAY,
        passenger_info=request.passengers.to_fli(),
        flight_segments=segments,
        seat_type=SeatType[request.cabin],
        stops=STOPS[request.max_stops],
        from_date=request.start.isoformat(),
        to_date=request.end.isoformat(),
        duration=request.trip_days,
    )
    raw = SearchDates().search(filters, currency="USD", language="en", country="US") or []
    days = []
    for item in raw:
        dates = item.date if isinstance(item.date, tuple) else (item.date,)
        if item.price is None:
            continue
        days.append(
            {
                "depart": dates[0].date().isoformat(),
                "return": dates[1].date().isoformat() if len(dates) > 1 else None,
                "price": item.price,
            }
        )
    days.sort(key=lambda d: d["depart"])
    return {"days": days, "round_trip": round_trip}
