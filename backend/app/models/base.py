from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, declared_attr, mapped_column


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


class Role(str, enum.Enum):
    SUPER_ADMIN = "super_admin"          # platform operator; no access to tenant operational data
    COMPANY_ADMIN = "company_admin"
    SUPPLY_CHAIN_MANAGER = "supply_chain_manager"
    PROCUREMENT_MANAGER = "procurement_manager"
    FINANCE_MANAGER = "finance_manager"
    ANALYST = "analyst"
    READ_ONLY = "read_only"


class DataSource(str, enum.Enum):
    SIMULATED = "simulated"   # demo / generated — never presented as real
    UPLOAD = "upload"         # supplied by the company
    API = "api"               # pulled from a connected integration
    MANUAL = "manual"


class TenantMixin:
    """Adds the tenant key. Isolation is enforced in the app (TenantContext) and, on Postgres, by RLS."""

    @declared_attr
    def company_id(cls) -> Mapped[str]:  # noqa: N805
        return mapped_column(
            String(36), ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False
        )
