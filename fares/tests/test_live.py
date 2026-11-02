"""Live tests against Google Flights. Run with CONTRAIL_LIVE=1; skipped otherwise."""

import os
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from contrail_fares.app import app

pytestmark = pytest.mark.skipif(os.environ.get("CONTRAIL_LIVE") != "1", reason="live network test")
DEPART = (date.today() + timedelta(days=40)).isoformat()
RETURN = (date.today() + timedelta(days=45)).isoformat()


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_one_way_multi_airport(client) -> None:
    res = client.post("/flights", json={"origins": ["SFO", "OAK"], "destinations": ["JFK", "EWR"], "depart": DEPART})
    assert res.status_code == 200, res.text
    items = res.json()["itineraries"]
    assert items, "no flights"
    first = items[0]
    assert first["price"] > 0 and first["tfs"]
    assert first["slices"][0]["legs"][0]["from"] in {"SFO", "OAK"}
    assert [i["price"] for i in items] == sorted(i["price"] for i in items)


def test_round_trip(client) -> None:
    res = client.post(
        "/flights", json={"origins": ["LAX"], "destinations": ["SEA"], "depart": DEPART, "return_date": RETURN, "expand": 2}
    )
    assert res.status_code == 200, res.text
    items = res.json()["itineraries"]
    assert items and len(items[0]["slices"]) == 2


def test_dates(client) -> None:
    start = date.fromisoformat(DEPART)
    res = client.post(
        "/dates",
        json={"origins": ["SFO"], "destinations": ["JFK"], "start": (start - timedelta(days=3)).isoformat(),
              "end": (start + timedelta(days=3)).isoformat()},
    )
    assert res.status_code == 200, res.text
    assert len(res.json()["days"]) >= 3


def test_booking_page(client) -> None:
    flights = client.post("/flights", json={"origins": ["SFO"], "destinations": ["JFK"], "depart": DEPART}).json()
    tfs = flights["itineraries"][0]["tfs"]
    res = client.post("/booking", json={"tfs": tfs})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["sellers"] and body["sellers"][0]["fares"]


def test_ids_differ_by_cabin(client) -> None:
    body = {"origins": ["SFO"], "destinations": ["JFK"], "depart": DEPART}
    economy = client.post("/flights", json=body).json()["itineraries"]
    business = client.post("/flights", json={**body, "cabin": "BUSINESS"}).json()["itineraries"]
    assert not {i["id"] for i in economy} & {i["id"] for i in business}
