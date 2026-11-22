"""Phase 4: scoring weights (must total 100), finance settings and scenarios, bills of materials."""
from tests.conftest import API, STRONG_PW, auth, register
from tests.test_data_import import PROD, SUP


def _user(client, h, role, email):
    client.post(f"{API}/users", headers=h, json={"email": email, "full_name": role.title(), "role": role, "temporary_password": STRONG_PW})
    return auth(client.post(f"{API}/auth/login", json={"email": email, "password": STRONG_PW}).json())


def test_weights_default_validation_and_permissions(client):
    t, _ = register(client)
    h = auth(t)
    w = client.get(f"{API}/vendor-scoring/weights", headers=h).json()
    assert w["is_default"] and w["weights"] == {"cost": 25, "quality": 20, "reliability": 20, "lead_time": 15, "financial": 10, "risk": 10}
    bad = {**w["weights"], "cost": 30}
    r = client.put(f"{API}/vendor-scoring/weights", headers=h, json=bad)
    assert r.status_code == 422 and "total 100%" in r.text
    good = {"cost": 40, "quality": 20, "reliability": 20, "lead_time": 10, "financial": 5, "risk": 5}
    assert client.put(f"{API}/vendor-scoring/weights", headers=h, json=good).json()["weights"]["cost"] == 40
    assert client.get(f"{API}/vendor-scoring/weights", headers=h).json()["is_default"] is False
    ha = _user(client, h, "analyst", "an@w.example.com")
    assert client.put(f"{API}/vendor-scoring/weights", headers=ha, json=good).status_code == 403
    hp = _user(client, h, "procurement_manager", "pm@w.example.com")
    assert client.put(f"{API}/vendor-scoring/weights", headers=hp, json=good).status_code == 200
    other, _ = register(client)
    assert client.get(f"{API}/vendor-scoring/weights", headers=auth(other)).json()["is_default"] is True


def test_finance_settings_and_scenarios(client):
    t, _ = register(client)
    h = auth(t)
    assert client.get(f"{API}/finance/settings", headers=h).json()["settings"]["carrying_cost_pct"] == 20.0
    s = {"carrying_cost_pct": 18, "revenue_per_day": 2500000, "gross_margin_pct": 32, "downtime_cost_per_day": 400000}
    assert client.put(f"{API}/finance/settings", headers=h, json=s).json()["settings"] == s
    sc = client.post(f"{API}/finance/scenarios", headers=h, json={"name": "Port closure 10 days", "kind": "disruption_impact",
                                                                    "inputs": {"days": 10}, "results": {"total": 12000000}}).json()
    assert client.get(f"{API}/finance/scenarios", headers=h).json()[0]["id"] == sc["id"]
    ha = _user(client, h, "analyst", "an@f.example.com")
    assert client.get(f"{API}/finance/settings", headers=ha).status_code == 200
    assert client.put(f"{API}/finance/settings", headers=ha, json=s).status_code == 403
    assert client.post(f"{API}/finance/scenarios", headers=ha, json={"name": "x y", "kind": "mitigation_roi"}).status_code == 403
    hf = _user(client, h, "finance_manager", "fm@f.example.com")
    assert client.post(f"{API}/finance/scenarios", headers=hf, json={"name": "ROI test", "kind": "mitigation_roi"}).status_code == 201
    hro = _user(client, h, "read_only", "ro@f.example.com")
    assert client.get(f"{API}/finance/scenarios", headers=hro).status_code == 403   # read-only has no finance:read
    other, _ = register(client)
    assert client.get(f"{API}/finance/scenarios", headers=auth(other)).json() == []
    assert client.delete(f"{API}/finance/scenarios/{sc['id']}", headers=auth(other)).status_code == 404
    assert client.delete(f"{API}/finance/scenarios/{sc['id']}", headers=h).status_code == 204


def test_bom_rules_upsert_and_isolation(client):
    t, _ = register(client)
    h = auth(t)
    client.post(f"{API}/suppliers/bulk", headers=h, json={"rows": SUP})
    hinge = {"sku": "CP-HINGE", "name": "Hinge", "kind": "component", "category": "Hardware", "unit_cost": 15}
    client.post(f"{API}/products/bulk", headers=h, json={"rows": PROD + [hinge]})
    rows = [{"parent_sku": "FG-1", "component_sku": "RM-1", "quantity_per_unit": 4.5},
            {"parent_sku": "FG-1", "component_sku": "CP-HINGE", "quantity_per_unit": 4}]
    assert client.post(f"{API}/bom/bulk", headers=h, json={"rows": rows}).json() == {"created": 2, "updated": 0}
    assert client.post(f"{API}/bom/bulk", headers=h, json={"rows": [{**rows[0], "quantity_per_unit": 5}]}).json() == {"created": 0, "updated": 1}
    bom = client.get(f"{API}/bom", headers=h).json()
    assert {b["component_sku"]: b["quantity_per_unit"] for b in bom} == {"RM-1": 5, "CP-HINGE": 4}
    for bad, msg in [({"parent_sku": "RM-1", "component_sku": "CP-HINGE", "quantity_per_unit": 1}, "must be a finished_good"),
                     ({"parent_sku": "FG-1", "component_sku": "FG-1", "quantity_per_unit": 1}, "raw_material or component"),
                     ({"parent_sku": "FG-1", "component_sku": "NOPE", "quantity_per_unit": 1}, "unknown SKU")]:
        r = client.post(f"{API}/bom/bulk", headers=h, json={"rows": [bad]})
        assert r.status_code == 422 and msg in r.text, msg
    assert client.post(f"{API}/bom/bulk", headers=h, json={"rows": [{**rows[0], "quantity_per_unit": 0}]}).status_code == 422
    other, _ = register(client)
    assert client.get(f"{API}/bom", headers=auth(other)).json() == []
    assert client.delete(f"{API}/bom/{bom[0]['id']}", headers=auth(other)).status_code == 404
    assert client.delete(f"{API}/bom/{bom[0]['id']}", headers=h).status_code == 204
