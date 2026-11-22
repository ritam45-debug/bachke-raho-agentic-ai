"""Phase 3 imports: validation, all-or-nothing, upsert by natural key, derived reorder point, isolation, permissions."""
from tests.conftest import API, STRONG_PW, auth, register

SUP = [{"code": "S1", "name": "Alpha Metals", "category": "Steel", "country": "India", "on_time_delivery_rate": "92%", "quality_score": 88,
        "avg_lead_time_days": 10, "financial_stability_score": 70, "risk_exposure_score": 20, "capacity_units_per_month": 5000, "moq_units": 200},
       {"code": "S2", "name": "Beta Polymers", "category": "Plastics", "country": "Vietnam", "on_time_delivery_rate": 0.8,
        "quality_score": 75, "avg_lead_time_days": 25}]
PROD = [{"sku": "RM-1", "name": "Steel sheet", "kind": "raw_material", "category": "Metals", "unit_cost": 120, "primary_supplier_code": "S1"},
        {"sku": "FG-1", "name": "Cabinet", "kind": "finished_good", "category": "Furniture", "unit_cost": 900, "unit_price": 1500, "conversion_cost": 150}]


def _setup(client):
    t, body = register(client)
    h = auth(t)
    plant = body["locations"][0]["name"]
    assert client.post(f"{API}/suppliers/bulk", headers=h, json={"rows": SUP}).json() == {"created": 2, "updated": 0}
    assert client.post(f"{API}/products/bulk", headers=h, json={"rows": PROD}).json() == {"created": 2, "updated": 0}
    return h, plant


def test_supplier_and_product_import_with_upsert(client):
    h, _ = _setup(client)
    s = {x["code"]: x for x in client.get(f"{API}/suppliers", headers=h).json()}
    assert s["S1"]["on_time_delivery_rate"] == 0.92 and s["S1"]["data_source"] == "upload" and s["S1"]["moq_units"] == 200
    # re-import updates instead of duplicating
    r = client.post(f"{API}/suppliers/bulk", headers=h, json={"rows": [{**SUP[0], "quality_score": 95}]})
    assert r.json() == {"created": 0, "updated": 1}
    assert len(client.get(f"{API}/suppliers", headers=h).json()) == 2
    p = {x["sku"]: x for x in client.get(f"{API}/products", headers=h).json()}
    assert p["RM-1"]["primary_supplier"] == "Alpha Metals" and p["FG-1"]["conversion_cost"] == 150


def test_validation_is_all_or_nothing_with_row_numbers(client):
    t, _ = register(client)
    h = auth(t)
    bad = [SUP[0], {**SUP[1], "quality_score": 150}, {"code": "S3"}]
    r = client.post(f"{API}/suppliers/bulk", headers=h, json={"rows": bad})
    assert r.status_code == 422 and "Row 2" in r.json()["detail"] and "Row 3" in r.json()["detail"]
    assert client.get(f"{API}/suppliers", headers=h).json() == []
    r = client.post(f"{API}/products/bulk", headers=h, json={"rows": [{**PROD[0], "primary_supplier_code": "NOPE"}]})
    assert r.status_code == 422 and "Unknown supplier code" in r.json()["detail"]


def test_inventory_import_derives_reorder_point_and_status(client):
    h, plant = _setup(client)
    rows = [{"sku": "RM-1", "location": plant, "quantity_on_hand": 50, "avg_daily_demand": 10, "safety_stock": 30}]
    assert client.post(f"{API}/inventory/bulk", headers=h, json={"rows": rows}).json()["created"] == 1
    inv = client.get(f"{API}/inventory", headers=h).json()[0]
    assert inv["lead_time_days"] == 10 and inv["reorder_point"] == 130  # 10/day × 10 days (supplier lead time) + 30
    assert inv["status"] == "critical"  # 5 days cover < 10 days lead time
    r = client.post(f"{API}/inventory/bulk", headers=h, json={"rows": [{**rows[0], "location": "Nowhere"}]})
    assert r.status_code == 422 and "unknown location" in r.json()["detail"]


def test_shipment_import_and_delete(client):
    h, _ = _setup(client)
    rows = [{"reference": "PO-1", "direction": "inbound", "supplier_code": "S2", "sku": "RM-1", "quantity": 100, "value": 12000, "freight_cost": 900,
             "origin": "Hai Phong", "origin_country": "Vietnam", "destination": "Chennai", "mode": "sea", "carrier": "OceanCo", "status": "delayed",
             "original_eta": "2026-11-20T00:00:00Z", "current_eta": "2026-11-26T00:00:00Z"}]
    assert client.post(f"{API}/shipments/bulk", headers=h, json={"rows": rows}).json()["created"] == 1
    s = client.get(f"{API}/shipments", headers=h).json()[0]
    assert s["freight_cost"] == 900 and s["delay_days"] == 6 and s["supplier"] == "Beta Polymers"
    assert client.delete(f"{API}/shipments/{s['id']}", headers=h).status_code == 204
    assert client.get(f"{API}/shipments", headers=h).json() == []
    assert "shipment.imported" in client.get(f"{API}/audit-logs/export", headers=h).text


def test_isolation_and_permissions(client):
    h, _ = _setup(client)
    other, _ = register(client)
    ho = auth(other)
    sid = client.get(f"{API}/suppliers", headers=h).json()[0]["id"]
    assert client.delete(f"{API}/suppliers/{sid}", headers=ho).status_code == 404
    assert client.get(f"{API}/suppliers", headers=ho).json() == []
    client.post(f"{API}/users", headers=h, json={"email": "an@imp.example.com", "full_name": "Analyst", "role": "analyst", "temporary_password": STRONG_PW})
    ha = auth(client.post(f"{API}/auth/login", json={"email": "an@imp.example.com", "password": STRONG_PW}).json())
    assert client.post(f"{API}/suppliers/bulk", headers=ha, json={"rows": SUP}).status_code == 403
    assert client.delete(f"{API}/suppliers/{sid}", headers=ha).status_code == 403
