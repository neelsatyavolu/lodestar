"""HTTP API for the Lodestar web app. Bind it to localhost or put it behind a token."""

from __future__ import annotations

import hmac
import logging
import os
from contextlib import asynccontextmanager
from datetime import date

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, model_validator

from .browser import BookingBrowser, BookingPageError, booking_url
from .search import DatesRequest, FlightsRequest, SearchError, search_dates, search_flights
from .stays_browser import StaysBrowser, StaysPageError
from .stays_page import KEY_PATTERN, MAX_ADULTS, MAX_NIGHTS, prices_url, search_url

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("lodestar.fares")
browser = BookingBrowser()
stays = StaysBrowser(browser.chromium)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await browser.close()


app = FastAPI(title="Lodestar fares", lifespan=lifespan, docs_url=None, redoc_url=None)


def require_token(x_fares_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("FARES_TOKEN")
    if expected and not hmac.compare_digest(expected, x_fares_token or ""):
        raise HTTPException(status_code=401, detail="Missing or wrong fares token.")


def _upstream(exc: Exception, what: str, source: str = "Google Flights") -> HTTPException:
    logger.warning("%s failed: %s: %s", what, type(exc).__name__, exc)
    return HTTPException(status_code=502, detail=f"{source} did not answer the {what}. Try again in a moment.")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/flights", dependencies=[Depends(require_token)])
def flights(request: FlightsRequest) -> dict:
    try:
        return search_flights(request)
    except SearchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - fli raises many transport types
        raise _upstream(exc, "flight search") from exc


@app.post("/dates", dependencies=[Depends(require_token)])
def dates(request: DatesRequest) -> dict:
    try:
        return search_dates(request)
    except SearchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise _upstream(exc, "date search") from exc


class BookingRequest(BaseModel):
    tfs: str = Field(min_length=16, max_length=2048)


@app.post("/booking", dependencies=[Depends(require_token)])
async def booking(request: BookingRequest) -> dict:
    try:
        url = booking_url(request.tfs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        page = await browser.read(request.tfs)
    except BookingPageError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise _upstream(exc, "booking page") from exc
    return {**page.to_dict(), "booking_url": url}


class StayRequest(BaseModel):
    checkin: date
    checkout: date
    adults: int = Field(default=2, ge=1, le=MAX_ADULTS)

    @model_validator(mode="after")
    def _nights(self) -> StayRequest:
        nights = (self.checkout - self.checkin).days
        if not 1 <= nights <= MAX_NIGHTS:
            raise ValueError(f"A stay is 1 to {MAX_NIGHTS} nights.")
        return self


class StaysSearchRequest(StayRequest):
    # A place name, as typed: letters, spaces and light punctuation only.
    city: str = Field(min_length=2, max_length=80, pattern=r"^[\w\s,.'’()-]+$")


class StaysPricesRequest(StayRequest):
    key: str = Field(pattern=KEY_PATTERN.pattern)


@app.post("/stays/search", dependencies=[Depends(require_token)])
async def stays_search(request: StaysSearchRequest) -> dict:
    try:
        hotels = await stays.search(request.city.strip(), request.checkin, request.checkout, request.adults)
    except StaysPageError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise _upstream(exc, "hotel search", "Google Hotels") from exc
    return {"hotels": [h.to_dict() for h in hotels], "url": search_url(request.city.strip(), request.checkin, request.checkout, request.adults)}


@app.post("/stays/prices", dependencies=[Depends(require_token)])
async def stays_prices(request: StaysPricesRequest) -> dict:
    try:
        offers = await stays.offers(request.key, request.checkin, request.checkout, request.adults)
    except StaysPageError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise _upstream(exc, "hotel prices", "Google Hotels") from exc
    return {"offers": [o.to_dict() for o in offers], "url": prices_url(request.key, request.checkin, request.checkout, request.adults)}
