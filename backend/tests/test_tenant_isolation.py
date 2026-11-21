"""The most important Phase 1 guarantee: one company can never see or change another company's data."""
from tests.conftest import API, STRONG_PW, auth, register


def _demo(client):
    return client.post(f"{API}/auth/demo").json()


def test_new_company_sees_none_of_demo_data(client):
    tokens, _ = register(client)
    h = auth(tokens)
    for path in ("suppliers", "products", "inventory", "shipments", "disruptions"):
        r = client.get(f"{API}/{path}", headers=h)
        assert r.status_code == 200 and r.json() == [], path
    k = client.get(f"{API}/dashboard/overview", headers=h).json()["kpis"]
    assert k["inventory_value"] == 0 and k["suppliers"] == 0


def test_demo_workspace_has_simulated_data(client):
    h = auth(_demo(client))
    ov = client.get(f"{API}/dashboard/overview", headers=h).json()
    assert ov["data_mode"] == "simulated"
    assert ov["kpis"]["suppliers"] == 11 and ov["kpis"]["active_disruptions"] >= 1
    assert all(s["data_source"] == "simulated" for s in client.get(f"{API}/suppliers", headers=h).json())
    assert all(d["verification"] == "simulated" for d in client.get(f"{API}/disruptions", headers=h).json())


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
    victim = b_users[0]["id"]
    r = client.patch(f"{API}/users/{victim}", headers=auth(a), json={"is_active": False})
    assert r.status_code == 404  # existence not revealed


def test_location_delete_across_tenants_is_404(client):
    a, _ = register(client)
    b, _ = register(client)
    b_loc = client.get(f"{API}/company", headers=auth(b)).json()["locations"][0]["id"]
    assert client.delete(f"{API}/company/locations/{b_loc}", headers=auth(a)).status_code == 404


def test_audit_logs_are_tenant_scoped(client):
    a, _ = register(client)
    b, _ = register(client)
    a_logs = client.get(f"{API}/audit-logs", headers=auth(a)).json()
    b_logs = client.get(f"{API}/audit-logs", headers=auth(b)).json()
    assert a_logs and b_logs
    assert {x["id"] for x in a_logs}.isdisjoint({x["id"] for x in b_logs})


def test_demo_is_read_only(client):
    h = auth(_demo(client))
    assert client.patch(f"{API}/company", headers=h, json={"name": "Hacked"}).status_code == 403
    assert client.post(f"{API}/users", headers=h, json={
        "email": "x@x.example.com", "full_name": "X Y", "role": "analyst", "temporary_password": STRONG_PW}).status_code == 403
