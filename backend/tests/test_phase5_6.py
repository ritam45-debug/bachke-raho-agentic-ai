"""Phase 5 (compliance, consented feedback, memory) and Phase 6 (approvals, notifications)."""
from datetime import date, timedelta

from tests.conftest import API, STRONG_PW, auth, register

COMP = {"title": "Extended Producer Responsibility for plastic packaging", "jurisdiction": "India", "category": "Environment",
        "regulator": "CPCB", "source_url": "https://cpcb.nic.in/", "status": "not_assessed"}


def _user(client, h, role, email):
    r = client.post(f"{API}/users", headers=h, json={"email": email, "full_name": role.replace("_", " ").title(), "role": role,
                                                     "temporary_password": STRONG_PW})
    tok = auth(client.post(f"{API}/auth/login", json={"email": email, "password": STRONG_PW}).json())
    return tok, r.json()["id"]


def test_compliance_flags_permissions_isolation(client):
    t, _ = register(client)
    h = auth(t)
    soon = (date.today() + timedelta(days=30)).isoformat()
    c = client.post(f"{API}/compliance", headers=h, json={**COMP, "effective_date": soon}).json()
    assert "Not yet assessed" in c["flags"] and "No owner" in c["flags"] and any("Takes effect" in f for f in c["flags"])
    assert client.post(f"{API}/compliance", headers=h, json={**COMP, "source_url": "not a url"}).status_code == 422
    me = client.get(f"{API}/auth/me", headers=h).json()["id"]
    past = (date.today() - timedelta(days=1)).isoformat()
    u = client.put(f"{API}/compliance/{c['id']}", headers=h, json={**COMP, "status": "compliant", "owner_user_id": me, "review_date": past}).json()
    assert u["flags"] == ["Review overdue", "Compliant but no evidence noted"]
    ha, _ = _user(client, h, "analyst", "an@c5.example.com")
    assert client.get(f"{API}/compliance", headers=ha).status_code == 200
    assert client.post(f"{API}/compliance", headers=ha, json=COMP).status_code == 403
    other, _ = register(client)
    ho = auth(other)
    assert client.get(f"{API}/compliance", headers=ho).json() == []
    assert client.put(f"{API}/compliance/{c['id']}", headers=ho, json=COMP).status_code == 404
    foreign = client.get(f"{API}/auth/me", headers=ho).json()["id"]
    assert client.put(f"{API}/compliance/{c['id']}", headers=h, json={**COMP, "owner_user_id": foreign}).status_code == 422
    assert client.delete(f"{API}/compliance/{c['id']}", headers=h).status_code == 204


def test_feedback_requires_consent(client):
    t, _ = register(client)
    h = auth(t)
    s = client.post(f"{API}/feedback/surveys", headers=h, json={"title": "Q4 delivery survey",
                    "consent_text": "I agree that my answers may be stored and analysed to improve service."}).json()
    rows = [{"score": 10, "comment": "Fast delivery", "consent": True}, {"score": 3, "comment": "Damaged box", "consent": False}]
    r = client.post(f"{API}/feedback/surveys/{s['id']}/responses", headers=h, json={"rows": rows})
    assert r.status_code == 422 and "Row(s) 2" in r.text
    assert client.get(f"{API}/feedback/surveys/{s['id']}/responses", headers=h).json() == []   # all-or-nothing
    rows[1]["consent"] = True
    assert client.post(f"{API}/feedback/surveys/{s['id']}/responses", headers=h, json={"rows": rows}).json() == {"created": 2}
    assert client.post(f"{API}/feedback/surveys/{s['id']}/responses", headers=h, json={"rows": [{"score": 11, "consent": True}]}).status_code == 422
    listed = client.get(f"{API}/feedback/surveys/{s['id']}/responses", headers=h).json()
    assert len(listed) == 2 and "consent" not in listed[0]
    assert client.get(f"{API}/feedback/surveys", headers=h).json()[0]["responses"] == 2
    client.patch(f"{API}/feedback/surveys/{s['id']}?is_open=false", headers=h)
    assert client.post(f"{API}/feedback/surveys/{s['id']}/responses", headers=h, json={"rows": rows}).status_code == 409
    assert client.delete(f"{API}/feedback/responses/{listed[0]['id']}", headers=h).status_code == 204
    ha, _ = _user(client, h, "analyst", "an@fb5.example.com")
    assert client.post(f"{API}/feedback/surveys", headers=ha, json={"title": "x survey", "consent_text": "x" * 25}).status_code == 403
    other, _ = register(client)
    assert client.get(f"{API}/feedback/surveys/{s['id']}/responses", headers=auth(other)).status_code == 404


def test_memory_search_delete_export(client):
    t, _ = register(client)
    h = auth(t)
    m = client.post(f"{API}/memory", headers=h, json={"title": "Chennai port congestion Dec 2025", "kind": "incident",
                    "body": "Vessel waits rose to 6 days; switching 30% to Kattupalli cut delays.", "tags": ["Port", "chennai", "port"]}).json()
    assert m["tags"] == ["chennai", "port"]
    client.post(f"{API}/memory", headers=h, json={"title": "Dual-source resin", "kind": "decision", "body": "Approved second resin supplier."})
    assert [x["id"] for x in client.get(f"{API}/memory?q=kattupalli delays", headers=h).json()] == [m["id"]]
    assert len(client.get(f"{API}/memory?tag=PORT", headers=h).json()) == 1
    assert len(client.get(f"{API}/memory?kind=decision", headers=h).json()) == 1
    ha, _ = _user(client, h, "analyst", "an@m5.example.com")
    mine = client.post(f"{API}/memory", headers=ha, json={"title": "Analyst note", "kind": "note", "body": "Seasonal dip."}).json()
    assert client.delete(f"{API}/memory/{m['id']}", headers=ha).status_code == 403        # not the author
    assert client.delete(f"{API}/memory/{mine['id']}", headers=ha).status_code == 204
    assert client.get(f"{API}/memory/export", headers=ha).status_code == 403
    ex = client.get(f"{API}/memory/export", headers=h).json()
    assert len(ex["entries"]) == 2
    hro, _ = _user(client, h, "read_only", "ro@m5.example.com")
    assert client.post(f"{API}/memory", headers=hro, json={"title": "x y z", "kind": "note", "body": "abc"}).status_code == 403
    other, _ = register(client)
    assert client.get(f"{API}/memory", headers=auth(other)).json() == []
    assert client.delete(f"{API}/memory/{m['id']}", headers=h).status_code == 204


def test_approvals_no_self_approval_and_notifications(client):
    t, _ = register(client)
    h = auth(t)
    hs, _ = _user(client, h, "supply_chain_manager", "scm@a6.example.com")
    hf, _ = _user(client, h, "finance_manager", "fm@a6.example.com")
    ha, _ = _user(client, h, "analyst", "an@a6.example.com")
    body = {"title": "Air-freight PO-1001", "action_type": "expedite_shipment", "details": "Move 2t from sea to air.",
            "estimated_cost": 180000, "source": "route_risk", "source_ref": "Kochi → Colombo"}
    assert client.post(f"{API}/approvals", headers=ha, json=body).status_code == 403   # analysts cannot request
    a = client.post(f"{API}/approvals", headers=hs, json=body).json()
    assert a["status"] == "pending" and a["requested_by_name"] == "Supply Chain Manager"
    # admin and finance manager are notified; requester is not
    assert client.get(f"{API}/notifications", headers=hf).json()["unread"] == 1
    assert client.get(f"{API}/notifications", headers=h).json()["unread"] == 1
    assert client.get(f"{API}/notifications", headers=hs).json()["unread"] == 0
    assert client.post(f"{API}/approvals/{a['id']}/decision", headers=hs, json={"decision": "approved"}).status_code == 403  # self
    assert client.post(f"{API}/approvals/{a['id']}/decision", headers=ha, json={"decision": "approved"}).status_code == 403  # no perm
    assert client.post(f"{API}/approvals/{a['id']}/outcome", headers=hs, json={"outcome": "too early"}).status_code == 409
    assert client.post(f"{API}/approvals/{a['id']}/decision", headers=hf, json={"decision": "rejected"}).status_code == 422  # reason needed
    d = client.post(f"{API}/approvals/{a['id']}/decision", headers=hf, json={"decision": "approved", "note": "Within budget"}).json()
    assert d["status"] == "approved" and d["decided_by_name"] == "Finance Manager"
    assert client.post(f"{API}/approvals/{a['id']}/decision", headers=h, json={"decision": "rejected", "note": "x"}).status_code == 409
    n = client.get(f"{API}/notifications", headers=hs).json()
    assert n["unread"] == 1 and n["items"][0]["title"].startswith("Approved")
    client.post(f"{API}/notifications/{n['items'][0]['id']}/read", headers=hs)
    assert client.get(f"{API}/notifications", headers=hs).json()["unread"] == 0
    assert client.post(f"{API}/notifications/{n['items'][0]['id']}/read", headers=hf).status_code == 404   # not theirs
    o = client.post(f"{API}/approvals/{a['id']}/outcome", headers=hs, json={"outcome": "Arrived on time; avoided line stop."}).json()
    assert o["outcome"].startswith("Arrived")
    b = client.post(f"{API}/approvals", headers=hs, json={**body, "title": "Second"}).json()
    assert client.post(f"{API}/approvals/{b['id']}/cancel", headers=hf).status_code == 403
    assert client.post(f"{API}/approvals/{b['id']}/cancel", headers=hs).json()["status"] == "cancelled"
    logs = client.get(f"{API}/audit-logs?action=approval", headers=h).json()
    assert {x["action"] for x in logs} >= {"approval.requested", "approval.approved", "approval.outcome_recorded", "approval.cancelled"}
    other, _ = register(client)
    assert client.get(f"{API}/approvals", headers=auth(other)).json() == []
    assert client.post(f"{API}/approvals/{a['id']}/cancel", headers=auth(other)).status_code == 404
