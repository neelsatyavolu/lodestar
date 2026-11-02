"""HTTP API for the Contrail web app. Bind it to localhost or put it behind a token."""

from __future__ import annotations

import hmac
import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .browser import BookingBrowser, BookingPageError, booking_url
from .search import DatesRequest, FlightsRequest, SearchError, search_dates, search_flights

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("contrail.fares")
browser = BookingBrowser()


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await browser.close()


app = FastAPI(title="Contrail fares", lifespan=lifespan, docs_url=None, redoc_url=None)


def require_token(x_fares_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("FARES_TOKEN")
    if expected and not hmac.compare_digest(expected, x_fares_token or ""):
        raise HTTPException(status_code=401, detail="Missing or wrong fares token.")


def _upstream(exc: Exception, what: str) -> HTTPException:
    logger.warning("%s failed: %s: %s", what, type(exc).__name__, exc)
    return HTTPException(status_code=502, detail=f"Google Flights did not answer the {what}. Try again in a moment.")


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
