"""Core operational tables needed by the Phase 1 dashboard. Later phases extend these."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base
from app.models.base import TenantMixin, new_id, utcnow

_SRC = "data_source IN ('simulated','upload','api','manual')"


class Supplier(TenantMixin, Base):
    __tablename__ = "suppliers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(120), nullable=False)
    country: Mapped[str] = mapped_column(String(80), nullable=False)
    city: Mapped[str | None] = mapped_column(String(120))
    on_time_delivery_rate: Mapped[float | None] = mapped_column(Float)  # 0..1, historical
    quality_score: Mapped[float | None] = mapped_column(Float)          # 0..100
    avg_lead_time_days: Mapped[float | None] = mapped_column(Float)
    annual_spend: Mapped[float | None] = mapped_column(Float)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    data_source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)

    __table_args__ = (UniqueConstraint("company_id", "code", name="uq_supplier_code"), CheckConstraint(_SRC, name="ck_supplier_src"))


class Product(TenantMixin, Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    sku: Mapped[str] = mapped_column(String(60), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)  # raw_material | component | finished_good
    category: Mapped[str] = mapped_column(String(120), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), default="unit", nullable=False)
    unit_cost: Mapped[float] = mapped_column(Float, nullable=False)
    unit_price: Mapped[float | None] = mapped_column(Float)
    primary_supplier_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("suppliers.id", ondelete="SET NULL"))
    data_source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)

    __table_args__ = (
        UniqueConstraint("company_id", "sku", name="uq_product_sku"),
        CheckConstraint("kind IN ('raw_material','component','finished_good')", name="ck_product_kind"),
        CheckConstraint(_SRC, name="ck_product_src"),
    )


class InventoryItem(TenantMixin, Base):
    __tablename__ = "inventory_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    location_id: Mapped[str] = mapped_column(String(36), ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True)
    quantity_on_hand: Mapped[float] = mapped_column(Float, nullable=False)
    reorder_point: Mapped[float] = mapped_column(Float, nullable=False)
    safety_stock: Mapped[float] = mapped_column(Float, nullable=False)
    avg_daily_demand: Mapped[float] = mapped_column(Float, nullable=False)
    lead_time_days: Mapped[float] = mapped_column(Float, nullable=False)
    last_movement_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    data_source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("company_id", "product_id", "location_id", name="uq_inventory_slot"),
        CheckConstraint("quantity_on_hand >= 0", name="ck_inv_qty"),
        CheckConstraint(_SRC, name="ck_inv_src"),
    )


class Shipment(TenantMixin, Base):
    __tablename__ = "shipments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    reference: Mapped[str] = mapped_column(String(60), nullable=False)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)  # inbound | outbound
    supplier_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("suppliers.id", ondelete="SET NULL"), index=True)
    product_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("products.id", ondelete="SET NULL"), index=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    origin: Mapped[str] = mapped_column(String(160), nullable=False)
    origin_country: Mapped[str] = mapped_column(String(80), nullable=False)
    destination: Mapped[str] = mapped_column(String(160), nullable=False)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)
    carrier: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    departed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    original_eta: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_eta: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    data_source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)

    __table_args__ = (
        UniqueConstraint("company_id", "reference", name="uq_shipment_ref"),
        CheckConstraint("mode IN ('sea','air','road','rail')", name="ck_ship_mode"),
        CheckConstraint("status IN ('planned','in_transit','delayed','delivered','cancelled')", name="ck_ship_status"),
        CheckConstraint("direction IN ('inbound','outbound')", name="ck_ship_dir"),
        CheckConstraint(_SRC, name="ck_ship_src"),
    )


class Disruption(TenantMixin, Base):
    """Phase 1: company-relevant disruption records. Phase 3 splits into global_events + company impacts."""

    __tablename__ = "disruptions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    severity: Mapped[int] = mapped_column(Integer, nullable=False)  # 0..100 rule-based score, NOT a probability
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # active | monitoring | resolved
    verification: Mapped[str] = mapped_column(String(20), nullable=False)  # verified | unverified | simulated
    affected_countries: Mapped[list] = mapped_column(JSON, default=list)
    affected_supplier_ids: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[str | None] = mapped_column(Text)
    source_name: Mapped[str | None] = mapped_column(String(160))
    source_url: Mapped[str | None] = mapped_column(String(500))
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("severity BETWEEN 0 AND 100", name="ck_disr_sev"),
        CheckConstraint("status IN ('active','monitoring','resolved')", name="ck_disr_status"),
        CheckConstraint("verification IN ('verified','unverified','simulated')", name="ck_disr_verif"),
    )
