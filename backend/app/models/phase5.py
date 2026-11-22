"""Phase 5: compliance register, consumer feedback (consented), organisational memory.
Phase 6: approval requests and in-app notifications."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base
from app.models.base import TenantMixin, new_id, utcnow

COMPLIANCE_STATUSES = ("not_assessed", "compliant", "in_progress", "gap", "not_applicable")
MEMORY_KINDS = ("lesson", "decision", "incident", "playbook", "note")
APPROVAL_ACTIONS = ("expedite_shipment", "switch_supplier", "reroute", "safety_stock_change", "spend", "other")
APPROVAL_STATUSES = ("pending", "approved", "rejected", "cancelled")


def _in(col: str, vals: tuple[str, ...]) -> str:
    return f"{col} IN ({','.join(repr(v) for v in vals)})"


class ComplianceRequirement(TenantMixin, Base):
    __tablename__ = "compliance_requirements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    jurisdiction: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    regulator: Mapped[str | None] = mapped_column(String(160))
    source_url: Mapped[str] = mapped_column(String(500), nullable=False)
    effective_date: Mapped[date | None] = mapped_column(Date)
    review_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="not_assessed", nullable=False)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    applies_to: Mapped[str | None] = mapped_column(String(240))
    obligation: Mapped[str | None] = mapped_column(Text)       # what the source says (fact, quoted or paraphrased)
    interpretation: Mapped[str | None] = mapped_column(Text)   # what the company thinks it means for them
    evidence: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (CheckConstraint(_in("status", COMPLIANCE_STATUSES), name="ck_comp_status"),)


class FeedbackSurvey(TenantMixin, Base):
    __tablename__ = "feedback_surveys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    question: Mapped[str] = mapped_column(String(300), nullable=False)
    consent_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_open: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class FeedbackResponse(TenantMixin, Base):
    __tablename__ = "feedback_responses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    survey_id: Mapped[str] = mapped_column(String(36), ForeignKey("feedback_surveys.id", ondelete="CASCADE"), nullable=False, index=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text)
    channel: Mapped[str | None] = mapped_column(String(60))
    product_sku: Mapped[str | None] = mapped_column(String(60))
    region: Mapped[str | None] = mapped_column(String(120))
    consent: Mapped[bool] = mapped_column(Boolean, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (CheckConstraint("score >= 0 AND score <= 10", name="ck_fb_score"),
                      CheckConstraint("consent", name="ck_fb_consent"))


class MemoryEntry(TenantMixin, Base):
    __tablename__ = "memory_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    related: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (CheckConstraint(_in("kind", MEMORY_KINDS), name="ck_mem_kind"),)


class ApprovalRequest(TenantMixin, Base):
    __tablename__ = "approval_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    action_type: Mapped[str] = mapped_column(String(30), nullable=False)
    details: Mapped[str] = mapped_column(Text, nullable=False)
    justification: Mapped[str | None] = mapped_column(Text)
    estimated_cost: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str | None] = mapped_column(String(40))       # e.g. route_risk, ai_agent, manual
    source_ref: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    requested_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    decided_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[str | None] = mapped_column(Text)
    outcome_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (CheckConstraint(_in("status", APPROVAL_STATUSES), name="ck_appr_status"),
                      CheckConstraint(_in("action_type", APPROVAL_ACTIONS), name="ck_appr_action"),
                      CheckConstraint("decided_by IS NULL OR decided_by <> requested_by", name="ck_appr_no_self"))


class Notification(TenantMixin, Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(200))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
