"""Phase 4: vendor-scoring weights, finance settings and saved scenarios, bills of materials."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, Float, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base
from app.models.base import TenantMixin, new_id, utcnow

DEFAULT_WEIGHTS = {"cost": 25, "quality": 20, "reliability": 20, "lead_time": 15, "financial": 10, "risk": 10}
DEFAULT_FINANCE = {"carrying_cost_pct": 20.0, "revenue_per_day": None, "gross_margin_pct": None, "downtime_cost_per_day": None}


class VendorWeightProfile(TenantMixin, Base):
    __tablename__ = "vendor_weight_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    weights: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (Index("uq_vwp_company", "company_id", unique=True),)


class FinanceSettings(TenantMixin, Base):
    __tablename__ = "finance_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    settings: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (Index("uq_fin_company", "company_id", unique=True),)


class FinancialScenario(TenantMixin, Base):
    """A saved calculation: its inputs (assumptions) and results, so decisions can be traced later."""

    __tablename__ = "financial_scenarios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    inputs: Mapped[dict] = mapped_column(JSON, default=dict)
    results: Mapped[dict] = mapped_column(JSON, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (CheckConstraint("kind IN ('disruption_impact','mitigation_roi','holding_cost','vendor_scoring')", name="ck_scen_kind"),)


class BomLine(TenantMixin, Base):
    __tablename__ = "bom_lines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    parent_product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    component_product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    quantity_per_unit: Mapped[float] = mapped_column(Float, nullable=False)

    __table_args__ = (
        UniqueConstraint("parent_product_id", "component_product_id", name="uq_bom_pair"),
        CheckConstraint("quantity_per_unit > 0", name="ck_bom_qty"),
        CheckConstraint("parent_product_id <> component_product_id", name="ck_bom_self"),
    )
