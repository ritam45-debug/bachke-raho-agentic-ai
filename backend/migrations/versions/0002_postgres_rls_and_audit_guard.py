"""PostgreSQL Row-Level Security for tenant tables + append-only audit log.

The API sets `app.current_company_id` per transaction (app/database/session.py::set_tenant_guc).
Tenant tables then only expose rows for that company, even if an application query forgot its filter.
FORCE ROW LEVEL SECURITY makes the policy apply to the table owner too, so run the API as a
non-superuser role (superusers and BYPASSRLS roles skip RLS).

No-op on SQLite (local dev/tests), where isolation is enforced by the application layer only.

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

TENANT_TABLES = ["company_profiles", "locations", "suppliers", "products", "inventory_items", "shipments", "disruptions"]
# The seed/system path runs with app.bypass_rls = 'on' (set only by trusted server-side jobs, never per request).
POLICY = (
    "company_id::text = current_setting('app.current_company_id', true) "
    "OR current_setting('app.bypass_rls', true) = 'on'"
)


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for t in TENANT_TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY tenant_isolation ON {t} USING ({POLICY}) WITH CHECK ({POLICY})")
    op.execute("""
        CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
    """)


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP TRIGGER IF EXISTS audit_logs_no_update_delete ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS audit_logs_append_only()")
    for t in TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {t}")
        op.execute(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
