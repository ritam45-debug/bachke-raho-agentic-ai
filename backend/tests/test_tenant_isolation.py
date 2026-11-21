"""The most important guarantee: one company can never see or change another company's data."""
from tests.conftest import API, auth, register

ROUTE = {"name": "Chennai → Singapore", "mode": "sea", "origin_label": "Chennai Port", "origin_lat": 13.10,
         "origin_lon": 80.30, "destination_label": "Singapore", "destination_lat": 1.26, "destination_lon": 103.84}


def test_new_company_starts_empty(client):
    tokens, _ = register(client)
    h = auth(tokens)
    for path in ("suppliers", "products", "inventory", "shipments", "disruptions", "routes"):
        r = client.get(f"{API}/{path}", headers=h)
        assert r.status_code == 200 and r.json() == [], path
    k = client.get(f"{API}/dashboard/overview", headers=h).json()["kpis"]
    assert k["routes"] == 0 and k["locations"] == 2 and k["locations_mapped"] == 1  # HQ (no coords) + plant


def test_routes_are_invisible_across_tenants(client):
    a, _ = register(client)
    b, _ = register(client)
    rid = client.post(f"{API}/routes", headers=auth(a), json=ROUTE).json()["id"]
    assert client.get(f"{API}/routes", headers=auth(b)).json() == []
    assert client.delete(f"{API}/routes/{rid}", headers=auth(b)).status_code == 404
    assert client.get(f"{API}/routes/{rid}/risk-checks", headers=auth(b)).status_code == 404
    check = {"score": 0, "band": "low", "factors": [], "rules_version": "1.0",
             "sources": [{"name": "x", "url": "https://x", "status": "ok", "fetched_at": "now"}]}
    assert client.post(f"{API}/routes/{rid}/risk-checks", headers=auth(b), json=check).status_code == 404


def test_route_cannot_use_another_tenants_location(client):
    a, _ = register(client)
    b, _ = register(client)
    b_loc = client.get(f"{API}/company", headers=auth(b)).json()["locations"]
    b_plant = next(x for x in b_loc if x["kind"] == "manufacturing")["id"]
    body = {**ROUTE, "origin_location_id": b_plant}
    assert client.post(f"{API}/routes", headers=auth(a), json=body).status_code == 404


def test_company_profile_is_own_only(client):
    a, _ = register(client, name="Alpha Ltd")
    b, _ = register(client, name="Beta Ltd")
    assert client.get(f"{API}/company", headers=auth(a)).json()["name"] == "Alpha Ltd"
    assert client.get(f"{API}/company", headers=auth(b)).json()["name"] == "Beta Ltd"


def test_users_cannot_be_listed_or_modified_across_tenants(client):
    a, _ = register(client)
    b, _ = register(client)
    a_users = client.get(f"{API}/users", headers=auth(a)).json()
    b_users = client.get(f"{API}/users", headers=auth(b)).json()
    assert {u["id"] for u in a_users}.isdisjoint({u["id"] for u in b_users})
    r = client.patch(f"{API}/users/{b_users[0]['id']}", headers=auth(a), json={"is_active": False})
    assert r.status_code == 404


def test_location_changes_across_tenants_are_404(client):
    a, _ = register(client)
    b, _ = register(client)
    b_loc = client.get(f"{API}/company", headers=auth(b)).json()["locations"][0]["id"]
    assert client.delete(f"{API}/company/locations/{b_loc}", headers=auth(a)).status_code == 404
    assert client.patch(f"{API}/company/locations/{b_loc}", headers=auth(a),
                        json={"name": "Hijack", "kind": "warehouse"}).status_code == 404


def test_audit_logs_are_tenant_scoped(client):
    a, _ = register(client)
    b, _ = register(client)
    a_logs = client.get(f"{API}/audit-logs", headers=auth(a)).json()
    b_logs = client.get(f"{API}/audit-logs", headers=auth(b)).json()
    assert a_logs and b_logs
    assert {x["id"] for x in a_logs}.isdisjoint({x["id"] for x in b_logs})
