"""Transport routes a company wants watched, and the history of live risk checks run against them."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base
from app.models.base import TenantMixin, new_id, utcnow

_LAT = "BETWEEN -90 AND 90"
_LON = "BETWEEN -180 AND 180"


class Route(TenantMixin, Base):
    __tablename__ = "routes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)  # sea | air | road | rail
    origin_location_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("locations.id", ondelete="SET NULL"))
    origin_label: Mapped[str] = mapped_column(String(200), nullable=False)
    origin_lat: Mapped[float] = mapped_column(Float, nullable=False)
    origin_lon: Mapped[float] = mapped_column(Float, nullable=False)
    destination_location_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("locations.id", ondelete="SET NULL"))
    destination_label: Mapped[str] = mapped_column(String(200), nullable=False)
    destination_lat: Mapped[float] = mapped_column(Float, nullable=False)
    destination_lon: Mapped[float] = mapped_column(Float, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint("mode IN ('sea','air','road','rail')", name="ck_route_mode"),
        CheckConstraint(f"origin_lat {_LAT} AND destination_lat {_LAT}", name="ck_route_lat"),
        CheckConstraint(f"origin_lon {_LON} AND destination_lon {_LON}", name="ck_route_lon"),
    )


class RouteRiskCheck(TenantMixin, Base):
    """One live risk check: the rule-based score plus every factor and source it was built from."""

    __tablename__ = "route_risk_checks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    route_id: Mapped[str] = mapped_column(String(36), ForeignKey("routes.id", ondelete="CASCADE"), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    band: Mapped[str] = mapped_column(String(10), nullable=False)
    factors: Mapped[list] = mapped_column(JSON, default=list)      # [{name, points, detail, source, observed_at}]
    sources: Mapped[list] = mapped_column(JSON, default=list)      # [{name, url, status, fetched_at}]
    forecast_days: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    rules_version: Mapped[str] = mapped_column(String(20), nullable=False)
    checked_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint("score BETWEEN 0 AND 100", name="ck_rrc_score"),
        CheckConstraint("band IN ('low','moderate','elevated','high')", name="ck_rrc_band"),
        Index("ix_rrc_route_time", "route_id", "checked_at"),
    )
