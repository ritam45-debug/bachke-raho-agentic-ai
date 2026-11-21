"""Database-level isolation (PostgreSQL only): RLS hides other tenants' rows even from an unfiltered query."""
import pytest
from sqlalchemy import text

from app.database.session import SessionLocal, engine, set_tenant_guc
from tests.conftest import API, auth, register

pytestmark = pytest.mark.skipif(engine.dialect.name != "postgresql", reason="RLS exists only on PostgreSQL")


def test_unfiltered_query_only_sees_own_tenant(client):
    demo = client.post(f"{API}/auth/demo").json()
    demo_cid = client.get(f"{API}/auth/me", headers=auth(demo)).json()["company_id"]
    other, _ = register(client)
    other_cid = client.get(f"{API}/auth/me", headers=auth(other)).json()["company_id"]

    with SessionLocal() as db:
        # Deliberately "buggy" query: no company_id filter at all.
        assert db.execute(text("SELECT count(*) FROM suppliers")).scalar() == 0  # no tenant pinned
        set_tenant_guc(db, other_cid)
        assert db.execute(text("SELECT count(*) FROM suppliers")).scalar() == 0
        db.commit()  # new transaction: tenant must be re-applied automatically
        set_tenant_guc(db, demo_cid)
        assert db.execute(text("SELECT count(*) FROM suppliers")).scalar() == 11


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
