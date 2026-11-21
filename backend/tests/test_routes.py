from app.api.routes_api import band_for
from tests.conftest import API, STRONG_PW, auth, register
from tests.test_tenant_isolation import ROUTE

SRC = [{"name": "Open-Meteo forecast", "url": "https://api.open-meteo.com/v1/forecast", "status": "ok", "fetched_at": "2026-11-21T10:00:00Z"}]


def _check(score_parts):
    factors = [{"name": f"f{i}", "points": p, "detail": f"factor {i}", "source": "test"} for i, p in enumerate(score_parts)]
    return {"score": min(100, sum(score_parts)), "band": "low", "factors": factors, "sources": SRC, "rules_version": "1.0"}


def test_bands():
    assert [band_for(s) for s in (0, 24, 25, 49, 50, 74, 75, 100)] == ["low", "low", "moderate", "moderate", "elevated", "elevated", "high", "high"]


def test_route_from_saved_location_and_free_point(client):
    t, _ = register(client)
    h = auth(t)
    plant = next(x for x in client.get(f"{API}/company", headers=h).json()["locations"] if x["kind"] == "manufacturing")
    r = client.post(f"{API}/routes", headers=h, json={"name": "Plant → Singapore", "mode": "sea", "origin_location_id": plant["id"],
                                                      "destination_label": "Singapore", "destination_lat": 1.26, "destination_lon": 103.84})
    assert r.status_code == 201
    body = r.json()
    assert body["origin_label"] == plant["name"] and body["origin_lat"] == 12.97 and body["latest_check"] is None


def test_route_validation(client):
    t, _ = register(client)
    h = auth(t)
    hq = next(x for x in client.get(f"{API}/company", headers=h).json()["locations"] if x["kind"] == "headquarters")
    assert client.post(f"{API}/routes", headers=h, json={**ROUTE, "mode": "teleport"}).status_code == 422
    assert client.post(f"{API}/routes", headers=h, json={**ROUTE, "origin_lat": 123}).status_code == 422
    no_dest = {k: v for k, v in ROUTE.items() if not k.startswith("destination")}
    assert client.post(f"{API}/routes", headers=h, json=no_dest).status_code == 422
    # HQ was registered without coordinates, so it cannot anchor a route yet
    r = client.post(f"{API}/routes", headers=h, json={**ROUTE, "origin_location_id": hq["id"]})
    assert r.status_code == 422 and "no map coordinates" in r.json()["detail"]


def test_risk_check_integrity_band_and_history(client):
    t, _ = register(client)
    h = auth(t)
    rid = client.post(f"{API}/routes", headers=h, json=ROUTE).json()["id"]
    bad = {**_check([30, 25]), "score": 90}
    assert client.post(f"{API}/routes/{rid}/risk-checks", headers=h, json=bad).status_code == 422
    r = client.post(f"{API}/routes/{rid}/risk-checks", headers=h, json=_check([30, 25]))
    assert r.status_code == 201 and r.json()["band"] == "elevated"  # derived server-side, client band ignored
    client.post(f"{API}/routes/{rid}/risk-checks", headers=h, json=_check([60, 60]))  # capped at 100
    hist = client.get(f"{API}/routes/{rid}/risk-checks", headers=h).json()
    assert [c["score"] for c in hist] == [100, 55]
    routes = client.get(f"{API}/routes", headers=h).json()
    assert routes[0]["latest_check"]["score"] == 100
    k = client.get(f"{API}/dashboard/overview", headers=h).json()
    assert k["kpis"]["routes_elevated_or_high"] == 1 and k["route_risks"][0]["band"] == "high"
    assert "route.risk_checked" in client.get(f"{API}/audit-logs/export", headers=h).text


def test_bulk_imports_are_all_or_nothing(client):
    t, _ = register(client)
    h = auth(t)
    locs = [{"name": f"WH {i}", "kind": "warehouse", "city": "Pune", "country": "India", "latitude": 18.5, "longitude": 73.8} for i in range(3)]
    assert client.post(f"{API}/company/locations/bulk", headers=h, json={"locations": locs}).status_code == 201
    assert client.post(f"{API}/company/locations/bulk", headers=h,
                       json={"locations": [*locs, {"name": "Bad", "kind": "moon_base"}]}).status_code == 422
    assert len(client.get(f"{API}/company", headers=h).json()["locations"]) == 5  # HQ + plant + 3
    rows = [ROUTE, {**ROUTE, "name": "Broken", "destination_lat": None}]
    r = client.post(f"{API}/routes/bulk", headers=h, json={"routes": rows})
    assert r.status_code == 422 and r.json()["detail"].startswith("Row 2")
    assert client.get(f"{API}/routes", headers=h).json() == []
    assert len(client.post(f"{API}/routes/bulk", headers=h, json={"routes": [ROUTE, ROUTE]}).json()) == 2


def test_read_only_can_view_and_check_but_not_edit_routes(client):
    t, _ = register(client)
    h = auth(t)
    rid = client.post(f"{API}/routes", headers=h, json=ROUTE).json()["id"]
    client.post(f"{API}/users", headers=h, json={"email": "viewer@routes.example.com", "full_name": "Viewer",
                                                 "role": "read_only", "temporary_password": STRONG_PW})
    ro = auth(client.post(f"{API}/auth/login", json={"email": "viewer@routes.example.com", "password": STRONG_PW}).json())
    assert client.get(f"{API}/routes", headers=ro).status_code == 200
    assert client.post(f"{API}/routes/{rid}/risk-checks", headers=ro, json=_check([10])).status_code == 201
    assert client.post(f"{API}/routes", headers=ro, json=ROUTE).status_code == 403
    assert client.delete(f"{API}/routes/{rid}", headers=ro).status_code == 403
