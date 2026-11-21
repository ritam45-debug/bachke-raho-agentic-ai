from app.analytics.inventory_metrics import days_of_cover, reorder_point, safety_stock, stock_status
from app.security.rbac import ASSIGNABLE_ROLES, Perm, has_perm
from tests.conftest import API, STRONG_PW, auth, register


def _login(client, email):
    return client.post(f"{API}/auth/login", json={"email": email, "password": STRONG_PW}).json()


def test_role_matrix():
    assert has_perm("company_admin", Perm.USERS_MANAGE)
    assert not has_perm("analyst", Perm.USERS_MANAGE)
    assert not has_perm("read_only", Perm.FINANCE_READ)
    assert not has_perm("super_admin", Perm.OPS_READ)  # platform admins cannot read tenant ops data
    assert "super_admin" not in ASSIGNABLE_ROLES


def test_admin_creates_user_and_permissions_apply(client):
    admin, _ = register(client)
    h = auth(admin)
    r = client.post(f"{API}/users", headers=h, json={
        "email": "ro@viewer.example.com", "full_name": "Read Only", "role": "read_only", "temporary_password": STRONG_PW})
    assert r.status_code == 201
    ro = _login(client, "ro@viewer.example.com")
    hr = auth(ro)
    assert client.get(f"{API}/dashboard/overview", headers=hr).status_code == 200
    assert client.get(f"{API}/users", headers=hr).status_code == 403
    assert client.get(f"{API}/audit-logs", headers=hr).status_code == 403
    assert client.patch(f"{API}/company", headers=hr, json={"name": "Nope"}).status_code == 403


def test_cannot_assign_super_admin(client):
    admin, _ = register(client)
    r = client.post(f"{API}/users", headers=auth(admin), json={
        "email": "evil@x.example.com", "full_name": "Evil", "role": "super_admin", "temporary_password": STRONG_PW})
    assert r.status_code == 422


def test_last_admin_protected_and_role_change_revokes_sessions(client):
    admin, _ = register(client)
    h = auth(admin)
    me = client.get(f"{API}/auth/me", headers=h).json()
    assert client.patch(f"{API}/users/{me['id']}", headers=h, json={"role": "analyst"}).status_code == 409
    client.post(f"{API}/users", headers=h, json={
        "email": "pm@x2.example.com", "full_name": "Proc Manager", "role": "procurement_manager", "temporary_password": STRONG_PW})
    pm = _login(client, "pm@x2.example.com")
    pm_id = client.get(f"{API}/auth/me", headers=auth(pm)).json()["id"]
    assert client.patch(f"{API}/users/{pm_id}", headers=h, json={"role": "read_only"}).status_code == 200
    assert client.get(f"{API}/auth/me", headers=auth(pm)).status_code == 401  # must log in again


def test_deactivated_user_cannot_login(client):
    admin, _ = register(client)
    h = auth(admin)
    uid = client.post(f"{API}/users", headers=h, json={
        "email": "gone@x3.example.com", "full_name": "Gone", "role": "analyst", "temporary_password": STRONG_PW}).json()["id"]
    client.patch(f"{API}/users/{uid}", headers=h, json={"is_active": False})
    assert client.post(f"{API}/auth/login", json={"email": "gone@x3.example.com", "password": STRONG_PW}).status_code == 401


def test_company_update_and_audit_export(client):
    admin, _ = register(client)
    h = auth(admin)
    r = client.patch(f"{API}/company", headers=h, json={"description": "We make sensors", "currency": "USD",
                                                         "ai_external_processing": True})
    assert r.status_code == 200 and r.json()["currency"] == "USD" and r.json()["ai_external_processing"] is True
    assert client.patch(f"{API}/company", headers=h, json={"currency": "usd"}).status_code == 422
    csv_text = client.get(f"{API}/audit-logs/export", headers=h).text
    assert "company.registered" in csv_text and "company.updated" in csv_text
    assert STRONG_PW not in csv_text


def test_inventory_formulas():
    assert days_of_cover(100, 10) == 10
    assert days_of_cover(100, 0) is None
    assert reorder_point(10, 7, 20) == 90
    assert round(safety_stock(1.65, 10, 9), 2) == 49.5
    assert stock_status(0, 90, 20, 10, 7) == "stockout"
    assert stock_status(15, 90, 20, 10, 7) == "critical"
    assert stock_status(85, 90, 20, 10, 7) == "reorder"
    assert stock_status(200, 90, 20, 10, 7) == "healthy"
    assert stock_status(5000, 90, 20, 10, 7) == "excess"
