"""Phase 2 system of record: consent and budget gates, server-side pricing, tenant isolation, permissions, trace."""
import pytest

from app.api.ai import call_cost
from tests.conftest import API, STRONG_PW, auth, register

MODEL = "claude-sonnet-5-5"


def _enable(client, h, budget=None):
    body = {"ai_external_processing": True}
    if budget is not None:
        body["ai_monthly_budget_usd"] = budget
    assert client.patch(f"{API}/company", headers=h, json=body).status_code == 200


def _run(client, h, **kw):
    return client.post(f"{API}/ai/runs", headers=h, json={"agent": "route_risk_analyst", "model": MODEL, **kw})


def test_pricing_matches_published_rates():
    assert call_cost("claude-sonnet-5-5", 1_000_000, 0) == pytest.approx(2.0)
    assert call_cost("claude-sonnet-5-5", 0, 1_000_000) == pytest.approx(10.0)
    assert call_cost("claude-haiku-5-5", 100_000, 1_000) == pytest.approx(0.0105)        # ≤100K tier
    assert call_cost("claude-haiku-5-5", 100_001, 0) == pytest.approx(0.0500005)          # >100K tier applies


def test_runs_blocked_until_consent(client):
    t, _ = register(client)
    h = auth(t)
    st = client.get(f"{API}/ai/status", headers=h).json()
    assert st["consent"] is False and st["budget_usd"] == 10.0
    r = _run(client, h)
    assert r.status_code == 403 and "switched off" in r.json()["detail"]
    assert "ai.run_blocked" in client.get(f"{API}/audit-logs/export", headers=h).text
    _enable(client, h)
    assert _run(client, h).status_code == 201


def test_full_run_lifecycle_and_server_side_cost(client):
    t, _ = register(client)
    h = auth(t)
    _enable(client, h)
    conv = client.post(f"{API}/ai/conversations", headers=h, json={"title": "Monsoon exposure"}).json()
    client.post(f"{API}/ai/conversations/{conv['id']}/messages", headers=h, json={"role": "user", "content": "Which route is riskiest?"})
    run = _run(client, h, conversation_id=conv["id"]).json()
    for i, (kind, name) in enumerate([("route", "route_risk_analyst"), ("model_call", None), ("tool_call", "list_routes"),
                                       ("tool_result", "list_routes"), ("model_call", None), ("final", None)]):
        assert client.post(f"{API}/ai/runs/{run['id']}/steps", headers=h, json={"seq": i, "kind": kind, "name": name, "payload": {"i": i}}).status_code == 201
    assert client.post(f"{API}/ai/runs/{run['id']}/steps", headers=h, json={"seq": 0, "kind": "final"}).status_code == 409  # seq is unique
    fin = client.post(f"{API}/ai/runs/{run['id']}/finish", headers=h, json={
        "status": "completed", "tool_calls": 1, "calls": [{"input_tokens": 3000, "output_tokens": 200}, {"input_tokens": 4000, "output_tokens": 600}]}).json()
    assert fin["input_tokens"] == 7000 and fin["output_tokens"] == 800
    assert fin["cost_usd"] == pytest.approx((7000 * 2 + 800 * 10) / 1e6)
    assert client.post(f"{API}/ai/runs/{run['id']}/steps", headers=h, json={"seq": 9, "kind": "final"}).status_code == 409  # closed
    client.post(f"{API}/ai/conversations/{conv['id']}/messages", headers=h, json={"role": "assistant", "content": "Answer", "run_id": run["id"]})
    trace = client.get(f"{API}/ai/runs/{run['id']}", headers=h).json()
    assert [s["kind"] for s in trace["steps"]] == ["route", "model_call", "tool_call", "tool_result", "model_call", "final"]
    msgs = client.get(f"{API}/ai/conversations/{conv['id']}", headers=h).json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"] and msgs[1]["run_id"] == run["id"]
    st = client.get(f"{API}/ai/status", headers=h).json()
    assert st["runs_month"] == 1 and st["spent_month_usd"] == pytest.approx(fin["cost_usd"])


def test_budget_gate(client):
    t, _ = register(client)
    h = auth(t)
    _enable(client, h, budget=0.01)
    run = _run(client, h).json()
    client.post(f"{API}/ai/runs/{run['id']}/finish", headers=h, json={"status": "completed", "calls": [{"input_tokens": 5000, "output_tokens": 1000}]})
    r = _run(client, h)  # recorded spend $0.02 ≥ $0.01 budget
    assert r.status_code == 429 and "budget" in r.json()["detail"]
    _enable(client, h, budget=5)
    assert _run(client, h).status_code == 201


def test_validation(client):
    t, _ = register(client)
    h = auth(t)
    _enable(client, h)
    assert client.post(f"{API}/ai/runs", headers=h, json={"agent": "route_risk_analyst", "model": "gpt-x"}).status_code == 422
    assert client.post(f"{API}/ai/runs", headers=h, json={"agent": "hacker", "model": MODEL}).status_code == 422
    assert client.post(f"{API}/ai/runs", headers=h, json={"agent": "route_risk_analyst", "model": MODEL, "autonomy_level": 3}).status_code == 422
    run = _run(client, h).json()
    big = {"seq": 0, "kind": "tool_result", "payload": {"blob": "x" * 50_000}}
    client.post(f"{API}/ai/runs/{run['id']}/steps", headers=h, json=big)
    assert client.get(f"{API}/ai/runs/{run['id']}", headers=h).json()["steps"][0]["payload"]["truncated"] is True


def test_tenant_and_user_isolation(client):
    a, _ = register(client)
    b, _ = register(client)
    ha, hb = auth(a), auth(b)
    _enable(client, ha)
    _enable(client, hb)
    conv = client.post(f"{API}/ai/conversations", headers=ha, json={"title": "secret"}).json()
    run = _run(client, ha, conversation_id=conv["id"]).json()
    assert client.get(f"{API}/ai/conversations/{conv['id']}", headers=hb).status_code == 404
    assert client.get(f"{API}/ai/runs/{run['id']}", headers=hb).status_code == 404
    assert client.post(f"{API}/ai/runs/{run['id']}/steps", headers=hb, json={"seq": 0, "kind": "final"}).status_code == 404
    assert client.post(f"{API}/ai/runs/{run['id']}/finish", headers=hb, json={"status": "completed"}).status_code == 404
    assert _run(client, hb, conversation_id=conv["id"]).status_code == 404
    assert client.get(f"{API}/ai/conversations", headers=hb).json() == []
    # a colleague in the same company cannot read someone else's conversation
    client.post(f"{API}/users", headers=ha, json={"email": "colleague@ai.example.com", "full_name": "Colleague",
                                                  "role": "analyst", "temporary_password": STRONG_PW})
    hc = auth(client.post(f"{API}/auth/login", json={"email": "colleague@ai.example.com", "password": STRONG_PW}).json())
    assert client.get(f"{API}/ai/conversations/{conv['id']}", headers=hc).status_code == 404
    assert client.get(f"{API}/ai/runs/{run['id']}", headers=hc).status_code == 404
    # the admin (audit:read) can review any run in their own company
    assert client.get(f"{API}/ai/runs/{run['id']}", headers=ha).status_code == 200


def test_read_only_role_cannot_use_ai(client):
    t, _ = register(client)
    h = auth(t)
    _enable(client, h)
    client.post(f"{API}/users", headers=h, json={"email": "ro@ai.example.com", "full_name": "Viewer", "role": "read_only", "temporary_password": STRONG_PW})
    ro = auth(client.post(f"{API}/auth/login", json={"email": "ro@ai.example.com", "password": STRONG_PW}).json())
    assert client.get(f"{API}/ai/status", headers=ro).status_code == 403
    assert _run(client, ro).status_code == 403
