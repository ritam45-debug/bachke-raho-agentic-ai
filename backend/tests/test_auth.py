from tests.conftest import API, STRONG_PW, auth, register


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_register_and_me(client):
    tokens, body = register(client, name="Acme Sensors")
    me = client.get(f"{API}/auth/me", headers=auth(tokens)).json()
    assert me["role"] == "company_admin"
    assert me["company_name"] == "Acme Sensors"
    assert "users:manage" in me["permissions"]
    assert me["is_demo"] is False


def test_register_rejects_weak_password_and_unaccepted_terms(client):
    base = {"company_name": "Weak Co", "industry": "x" * 3, "company_size": "1-50", "headquarters": "Delhi",
            "admin_full_name": "A B", "admin_email": "weak@weak.example.com", "accept_terms": True}
    assert client.post(f"{API}/auth/register-company", json={**base, "password": "short"}).status_code == 422
    assert client.post(f"{API}/auth/register-company", json={**base, "password": STRONG_PW, "accept_terms": False}).status_code == 422


def test_register_rejects_client_supplied_company_id(client):
    body = {"company_name": "Sneaky", "industry": "Retail", "company_size": "1-50", "headquarters": "Delhi",
            "admin_full_name": "A B", "admin_email": "sneaky@x.example.com", "password": STRONG_PW,
            "accept_terms": True, "company_id": "someone-elses-id"}
    assert client.post(f"{API}/auth/register-company", json=body).status_code == 422


def test_duplicate_email(client):
    register(client, email="dupe@dupe.example.com")
    r = client.post(f"{API}/auth/register-company", json={
        "company_name": "Dupe 2", "industry": "Retail", "company_size": "1-50", "headquarters": "Delhi",
        "admin_full_name": "A B", "admin_email": "DUPE@dupe.example.com", "password": STRONG_PW, "accept_terms": True})
    assert r.status_code == 409


def test_login_refresh_rotation_and_logout(client):
    _, body = register(client)
    r = client.post(f"{API}/auth/login", json={"email": body["admin_email"], "password": STRONG_PW})
    assert r.status_code == 200
    t1 = r.json()
    t2 = client.post(f"{API}/auth/refresh", json={"refresh_token": t1["refresh_token"]}).json()
    assert t2["refresh_token"] != t1["refresh_token"]
    # the rotated (old) session's access token no longer works
    assert client.get(f"{API}/auth/me", headers=auth(t1)).status_code == 401
    # re-using a rotated refresh token is treated as theft and revokes everything
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": t1["refresh_token"]}).status_code == 401
    assert client.get(f"{API}/auth/me", headers=auth(t2)).status_code == 401


def test_logout_revokes_session(client):
    tokens, _ = register(client)
    assert client.post(f"{API}/auth/logout", headers=auth(tokens)).status_code == 204
    assert client.get(f"{API}/auth/me", headers=auth(tokens)).status_code == 401


def test_wrong_password_generic_error_and_lockout(client):
    _, body = register(client)
    for _ in range(5):
        r = client.post(f"{API}/auth/login", json={"email": body["admin_email"], "password": "Wrong!Passw0rd"})
        assert r.status_code == 401 and r.json()["detail"] == "Invalid email or password"
    # now locked: even the correct password is refused
    r = client.post(f"{API}/auth/login", json={"email": body["admin_email"], "password": STRONG_PW})
    assert r.status_code == 401
    unknown = client.post(f"{API}/auth/login", json={"email": "nobody@nowhere.example.com", "password": STRONG_PW})
    assert unknown.json()["detail"] == "Invalid email or password"


def test_garbage_and_missing_tokens(client):
    assert client.get(f"{API}/auth/me").status_code == 401
    assert client.get(f"{API}/auth/me", headers={"Authorization": "Bearer not.a.jwt"}).status_code == 401


def test_security_headers(client):
    r = client.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
