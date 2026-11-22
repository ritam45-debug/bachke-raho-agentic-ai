"""Database-level isolation (PostgreSQL only): RLS hides other tenants' rows even from an unfiltered query."""
import pytest
from sqlalchemy import text

from app.database.session import SessionLocal, engine, set_tenant_guc
from tests.conftest import API, auth, register
from tests.test_tenant_isolation import ROUTE

pytestmark = pytest.mark.skipif(engine.dialect.name != "postgresql", reason="RLS exists only on PostgreSQL")


def test_unfiltered_query_only_sees_own_tenant(client):
    a, _ = register(client)
    b, _ = register(client)
    a_cid = client.get(f"{API}/auth/me", headers=auth(a)).json()["company_id"]
    b_cid = client.get(f"{API}/auth/me", headers=auth(b)).json()["company_id"]
    for _ in range(3):
        client.post(f"{API}/routes", headers=auth(a), json=ROUTE)

    with SessionLocal() as db:
        # Deliberately "buggy" query: no company_id filter at all.
        assert db.execute(text("SELECT count(*) FROM routes")).scalar() == 0  # no tenant pinned
        set_tenant_guc(db, b_cid)
        assert db.execute(text("SELECT count(*) FROM routes")).scalar() == 0
        db.commit()  # new transaction: tenant must be re-applied automatically
        set_tenant_guc(db, a_cid)
        assert db.execute(text("SELECT count(*) FROM routes")).scalar() == 3


def test_cannot_insert_row_for_another_tenant(client):
    a, _ = register(client)
    b, _ = register(client)
    a_cid = client.get(f"{API}/auth/me", headers=auth(a)).json()["company_id"]
    b_cid = client.get(f"{API}/auth/me", headers=auth(b)).json()["company_id"]
    with SessionLocal() as db:
        set_tenant_guc(db, a_cid)
        with pytest.raises(Exception, match="row-level security"):
            db.execute(text(
                "INSERT INTO suppliers (id, company_id, code, name, category, country, is_active, data_source) "
                "VALUES ('00000000-0000-0000-0000-000000000001', :b, 'X', 'X', 'X', 'X', true, 'manual')"), {"b": b_cid})
            db.flush()


def test_audit_log_is_append_only(client):
    register(client)
    with SessionLocal() as db, pytest.raises(Exception, match="append-only"):
        db.execute(text("UPDATE audit_logs SET action = 'tampered'"))


def test_ai_tables_are_rls_protected(client):
    a, _ = register(client)
    b, _ = register(client)
    ha = auth(a)
    client.patch(f"{API}/company", headers=ha, json={"ai_external_processing": True})
    conv = client.post(f"{API}/ai/conversations", headers=ha, json={"title": "t"}).json()
    run = client.post(f"{API}/ai/runs", headers=ha, json={"agent": "route_risk_analyst", "model": "claude-sonnet-5-5", "conversation_id": conv["id"]}).json()
    client.post(f"{API}/ai/runs/{run['id']}/steps", headers=ha, json={"seq": 0, "kind": "final"})
    b_cid = client.get(f"{API}/auth/me", headers=auth(b)).json()["company_id"]
    with SessionLocal() as db:
        set_tenant_guc(db, b_cid)
        for t in ("ai_conversations", "ai_messages", "agent_runs", "agent_steps"):
            assert db.execute(text(f"SELECT count(*) FROM {t}")).scalar() == 0, t


def test_phase4_tables_are_rls_protected(client):
    a, _ = register(client)
    b, _ = register(client)
    ha = auth(a)
    client.put(f"{API}/vendor-scoring/weights", headers=ha, json={"cost": 40, "quality": 20, "reliability": 20, "lead_time": 10, "financial": 5, "risk": 5})
    client.put(f"{API}/finance/settings", headers=ha, json={"carrying_cost_pct": 18})
    client.post(f"{API}/finance/scenarios", headers=ha, json={"name": "s1", "kind": "holding_cost"})
    b_cid = client.get(f"{API}/auth/me", headers=auth(b)).json()["company_id"]
    with SessionLocal() as db:
        set_tenant_guc(db, b_cid)
        for t in ("vendor_weight_profiles", "finance_settings", "financial_scenarios", "bom_lines"):
            assert db.execute(text(f"SELECT count(*) FROM {t}")).scalar() == 0, t
