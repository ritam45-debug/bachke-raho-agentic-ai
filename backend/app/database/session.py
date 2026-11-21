"""Engine, session factory and request-scoped session dependency."""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    if url.startswith("sqlite"):
        eng = create_engine(url, connect_args={"check_same_thread": False})

        @event.listens_for(eng, "connect")
        def _fk_on(dbapi_conn, _):  # enforce FK constraints in SQLite
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

        return eng
    return create_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=20)


engine = _make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def set_tenant_guc(db: Session, company_id: str) -> None:
    """On PostgreSQL, pin the session to a tenant so Row-Level Security policies apply.

    This is a second, database-enforced layer under the application-level company_id filters.
    The value is transaction-local, so it is re-applied at the start of every transaction (see below).
    """
    db.info["tenant_company_id"] = company_id
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT set_config('app.current_company_id', :cid, true)"), {"cid": company_id})


@event.listens_for(Session, "after_begin")
def _reapply_tenant(session: Session, _transaction, connection) -> None:
    cid = session.info.get("tenant_company_id")
    if cid and connection.dialect.name == "postgresql":
        connection.execute(text("SELECT set_config('app.current_company_id', :cid, true)"), {"cid": cid})


def init_db() -> None:
    """Create tables for local dev/tests. Production uses Alembic migrations instead."""
    from app import models  # noqa: F401  (register models)

    Base.metadata.create_all(bind=engine)
