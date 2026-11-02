"""API validation tests. These never reach Google: they fail before searching."""

from fastapi.testclient import TestClient

from contrail_fares.app import app

client = TestClient(app)


def test_health() -> None:
    assert client.get("/health").json() == {"ok": True}


def test_rejects_bad_airport_code() -> None:
    res = client.post("/flights", json={"origins": ["SF0"], "destinations": ["JFK"], "depart": "2026-12-10"})
    assert res.status_code == 422


def test_rejects_unknown_airport() -> None:
    res = client.post("/flights", json={"origins": ["QQQ"], "destinations": ["JFK"], "depart": "2026-12-10"})
    assert res.status_code == 400
    assert "QQQ" in res.json()["detail"]


def test_rejects_return_before_depart() -> None:
    res = client.post(
        "/flights",
        json={"origins": ["SFO"], "destinations": ["JFK"], "depart": "2026-12-10", "return_date": "2026-12-01"},
    )
    assert res.status_code == 422


def test_rejects_overlapping_airports() -> None:
    res = client.post("/flights", json={"origins": ["SFO"], "destinations": ["sfo"], "depart": "2026-12-10"})
    assert res.status_code == 422


def test_date_window_capped() -> None:
    res = client.post(
        "/dates", json={"origins": ["SFO"], "destinations": ["JFK"], "start": "2026-12-01", "end": "2027-06-01"}
    )
    assert res.status_code == 422


def test_booking_rejects_url_injection() -> None:
    res = client.post("/booking", json={"tfs": "x" * 10 + "/../../evil?"})
    assert res.status_code == 400


def test_token_enforced_when_set(monkeypatch) -> None:
    monkeypatch.setenv("FARES_TOKEN", "secret-token")
    res = client.post("/flights", json={"origins": ["SFO"], "destinations": ["JFK"], "depart": "2026-12-10"})
    assert res.status_code == 401
