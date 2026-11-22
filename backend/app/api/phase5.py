"""Phase 5 API: compliance register, consumer feedback, organisational memory.
Phase 6 API: approval requests (human-in-the-loop for high-impact actions) and notifications."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, HttpUrl
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import User
from app.models.base import utcnow
from app.models.phase5 import (
    APPROVAL_ACTIONS,
    COMPLIANCE_STATUSES,
    MEMORY_KINDS,
    ApprovalRequest,
    ComplianceRequirement,
    FeedbackResponse,
    FeedbackSurvey,
    MemoryEntry,
    Notification,
)
from app.security.deps import TenantContext, get_tenant, require
from app.security.rbac import Perm, has_perm
from app.services import audit
from app.services.tenant_repo import get_owned, scoped

router = APIRouter(tags=["compliance, feedback, memory, approvals"])
DUE_SOON_DAYS = 90


def _any(ctx: TenantContext, *perms: Perm) -> None:
    if not any(ctx.can(p) for p in perms):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Missing permission: {' or '.join(p.value for p in perms)}")


def _row(o, cols) -> dict:
    return {c: getattr(o, c) for c in cols}


def _log(db, ctx, request, action, entity_type=None, entity_id=None, **details):
    audit.record(db, action=action, company_id=ctx.company_id, actor_user_id=ctx.user.id, entity_type=entity_type,
                 entity_id=entity_id, request=request, details=details or None)


# ======================= compliance =======================
class ComplianceIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=240)
    jurisdiction: str = Field(min_length=2, max_length=120)
    category: str = Field(min_length=2, max_length=80)
    regulator: str | None = Field(default=None, max_length=160)
    source_url: HttpUrl
    effective_date: date | None = None
    review_date: date | None = None
    status: Literal[COMPLIANCE_STATUSES] = "not_assessed"  # type: ignore[valid-type]
    owner_user_id: str | None = None
    applies_to: str | None = Field(default=None, max_length=240)
    obligation: str | None = Field(default=None, max_length=8000)
    interpretation: str | None = Field(default=None, max_length=8000)
    evidence: str | None = Field(default=None, max_length=8000)


COMP_COLS = ("id", "title", "jurisdiction", "category", "regulator", "source_url", "effective_date", "review_date", "status",
             "owner_user_id", "applies_to", "obligation", "interpretation", "evidence", "created_at", "updated_at")


def compliance_flags(c: ComplianceRequirement, today: date | None = None) -> list[str]:
    """Rule-based attention flags. These are reminders for a human reviewer, not legal conclusions."""
    today = today or date.today()
    if c.status == "not_applicable":
        return []
    f = []
    if c.status == "gap":
        f.append("Gap recorded")
    if c.status == "not_assessed":
        f.append("Not yet assessed")
    if c.owner_user_id is None:
        f.append("No owner")
    if c.review_date and c.review_date < today:
        f.append("Review overdue")
    if c.effective_date and today <= c.effective_date <= today + timedelta(days=DUE_SOON_DAYS) and c.status != "compliant":
        f.append(f"Takes effect within {DUE_SOON_DAYS} days")
    if c.status == "compliant" and not c.evidence:
        f.append("Compliant but no evidence noted")
    return f


def _comp_out(c: ComplianceRequirement) -> dict:
    return {**_row(c, COMP_COLS), "flags": compliance_flags(c)}


def _check_owner(db: Session, ctx: TenantContext, owner: str | None) -> None:
    if owner and not db.scalar(scoped(User, ctx).where(User.id == owner)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Owner must be a user in your company")


@router.get("/compliance")
def list_compliance(ctx: TenantContext = Depends(require(Perm.OPS_READ)), db: Session = Depends(get_db)):
    rows = db.scalars(scoped(ComplianceRequirement, ctx).order_by(ComplianceRequirement.jurisdiction, ComplianceRequirement.title))
    return [_comp_out(c) for c in rows]


@router.post("/compliance", status_code=status.HTTP_201_CREATED)
def create_compliance(data: ComplianceIn, request: Request, ctx: TenantContext = Depends(require(Perm.COMPLIANCE_WRITE)), db: Session = Depends(get_db)):
    _check_owner(db, ctx, data.owner_user_id)
    c = ComplianceRequirement(company_id=ctx.company_id, created_by=ctx.user.id, **{**data.model_dump(), "source_url": str(data.source_url)})
    db.add(c)
    db.flush()
    _log(db, ctx, request, "compliance.created", "compliance_requirement", c.id, title=c.title)
    db.commit()
    return _comp_out(c)


@router.put("/compliance/{cid}")
def update_compliance(cid: str, data: ComplianceIn, request: Request,
                      ctx: TenantContext = Depends(require(Perm.COMPLIANCE_WRITE)), db: Session = Depends(get_db)):
    c = get_owned(db, ComplianceRequirement, cid, ctx)
    _check_owner(db, ctx, data.owner_user_id)
    before = c.status
    for k, v in {**data.model_dump(), "source_url": str(data.source_url)}.items():
        setattr(c, k, v)
    c.updated_at = utcnow()
    _log(db, ctx, request, "compliance.updated", "compliance_requirement", c.id, status_from=before, status_to=c.status)
    db.commit()
    return _comp_out(c)


@router.delete("/compliance/{cid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_compliance(cid: str, request: Request, ctx: TenantContext = Depends(require(Perm.COMPLIANCE_WRITE)), db: Session = Depends(get_db)):
    c = get_owned(db, ComplianceRequirement, cid, ctx)
    db.delete(c)
    _log(db, ctx, request, "compliance.deleted", "compliance_requirement", cid, title=c.title)
    db.commit()


# ======================= consumer feedback =======================
class SurveyIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=200)
    question: str = Field(default="How likely are you to recommend us to a friend or colleague?", min_length=5, max_length=300)
    consent_text: str = Field(min_length=20, max_length=4000)
    is_open: bool = True


class ResponseIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    score: int = Field(ge=0, le=10)
    comment: str | None = Field(default=None, max_length=4000)
    channel: str | None = Field(default=None, max_length=60)
    product_sku: str | None = Field(default=None, max_length=60)
    region: str | None = Field(default=None, max_length=120)
    consent: bool


class ResponsesBulk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[ResponseIn] = Field(min_length=1, max_length=5000)


SURVEY_COLS = ("id", "title", "question", "consent_text", "is_open", "created_at")
RESP_COLS = ("id", "survey_id", "score", "comment", "channel", "product_sku", "region", "received_at")


@router.get("/feedback/surveys")
def list_surveys(ctx: TenantContext = Depends(require(Perm.OPS_READ)), db: Session = Depends(get_db)):
    out = []
    for s in db.scalars(scoped(FeedbackSurvey, ctx).order_by(FeedbackSurvey.created_at.desc())):
        n = db.query(FeedbackResponse).filter(FeedbackResponse.company_id == ctx.company_id, FeedbackResponse.survey_id == s.id).count()
        out.append({**_row(s, SURVEY_COLS), "responses": n})
    return out


@router.post("/feedback/surveys", status_code=status.HTTP_201_CREATED)
def create_survey(data: SurveyIn, request: Request, ctx: TenantContext = Depends(require(Perm.FEEDBACK_WRITE)), db: Session = Depends(get_db)):
    s = FeedbackSurvey(company_id=ctx.company_id, created_by=ctx.user.id, **data.model_dump())
    db.add(s)
    db.flush()
    _log(db, ctx, request, "survey.created", "feedback_survey", s.id, title=s.title)
    db.commit()
    return {**_row(s, SURVEY_COLS), "responses": 0}


@router.patch("/feedback/surveys/{sid}")
def toggle_survey(sid: str, request: Request, is_open: bool = Query(...),
                  ctx: TenantContext = Depends(require(Perm.FEEDBACK_WRITE)),
                  db: Session = Depends(get_db)):
    s = get_owned(db, FeedbackSurvey, sid, ctx)
    s.is_open = is_open
    _log(db, ctx, request, "survey.opened" if is_open else "survey.closed", "feedback_survey", s.id)
    db.commit()
    return _row(s, SURVEY_COLS)


@router.delete("/feedback/surveys/{sid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_survey(sid: str, request: Request, ctx: TenantContext = Depends(require(Perm.FEEDBACK_WRITE)), db: Session = Depends(get_db)):
    s = get_owned(db, FeedbackSurvey, sid, ctx)
    db.query(FeedbackResponse).filter(FeedbackResponse.company_id == ctx.company_id, FeedbackResponse.survey_id == sid).delete()
    db.delete(s)
    _log(db, ctx, request, "survey.deleted", "feedback_survey", sid)
    db.commit()


@router.get("/feedback/surveys/{sid}/responses")
def list_responses(sid: str, ctx: TenantContext = Depends(require(Perm.OPS_READ)), db: Session = Depends(get_db)):
    get_owned(db, FeedbackSurvey, sid, ctx)
    q = scoped(FeedbackResponse, ctx).where(FeedbackResponse.survey_id == sid).order_by(FeedbackResponse.received_at.desc())
    return [_row(r, RESP_COLS) for r in db.scalars(q)]


@router.post("/feedback/surveys/{sid}/responses")
def add_responses(sid: str, data: ResponsesBulk, request: Request, ctx: TenantContext = Depends(require(Perm.FEEDBACK_WRITE)),
                  db: Session = Depends(get_db)):
    """Record responses collected with the survey's consent notice. Rows without consent are rejected, never stored."""
    s = get_owned(db, FeedbackSurvey, sid, ctx)
    if not s.is_open:
        raise HTTPException(status.HTTP_409_CONFLICT, "This survey is closed")
    bad = [i for i, r in enumerate(data.rows, 1) if not r.consent]
    if bad:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            f"Row(s) {', '.join(map(str, bad[:20]))}: consent is not true. Responses without consent cannot be stored.")
    for r in data.rows:
        db.add(FeedbackResponse(company_id=ctx.company_id, survey_id=sid, **r.model_dump()))
    _log(db, ctx, request, "feedback.recorded", "feedback_survey", sid, count=len(data.rows))
    db.commit()
    return {"created": len(data.rows)}


@router.delete("/feedback/responses/{rid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_response(rid: str, request: Request, ctx: TenantContext = Depends(require(Perm.FEEDBACK_WRITE)), db: Session = Depends(get_db)):
    """Erasure on request (e.g. a respondent withdraws consent)."""
    r = get_owned(db, FeedbackResponse, rid, ctx)
    db.delete(r)
    _log(db, ctx, request, "feedback.deleted", "feedback_response", rid)
    db.commit()


# ======================= organisational memory =======================
class MemoryIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=3, max_length=20000)
    kind: Literal[MEMORY_KINDS]  # type: ignore[valid-type]
    tags: list[str] = Field(default_factory=list, max_length=20)
    related: str | None = Field(default=None, max_length=200)


MEM_COLS = ("id", "title", "body", "kind", "tags", "related", "created_by", "created_at")


@router.get("/memory")
def list_memory(q: str | None = Query(default=None, max_length=200), kind: str | None = None, tag: str | None = None,
                ctx: TenantContext = Depends(require(Perm.OPS_READ)), db: Session = Depends(get_db)):
    stmt = scoped(MemoryEntry, ctx).order_by(MemoryEntry.created_at.desc())
    if kind:
        stmt = stmt.where(MemoryEntry.kind == kind)
    rows = list(db.scalars(stmt))
    if q:
        words = [w.lower() for w in q.split() if w]
        rows = [m for m in rows if all(w in f"{m.title} {m.body} {' '.join(m.tags or [])} {m.related or ''}".lower() for w in words)]
    if tag:
        rows = [m for m in rows if tag.lower() in [t.lower() for t in (m.tags or [])]]
    return [_row(m, MEM_COLS) for m in rows[:500]]


@router.post("/memory", status_code=status.HTTP_201_CREATED)
def create_memory(data: MemoryIn, request: Request, ctx: TenantContext = Depends(require(Perm.MEMORY_WRITE)), db: Session = Depends(get_db)):
    tags = sorted({t.strip().lower()[:40] for t in data.tags if t.strip()})
    m = MemoryEntry(company_id=ctx.company_id, created_by=ctx.user.id, **{**data.model_dump(), "tags": tags})
    db.add(m)
    db.flush()
    _log(db, ctx, request, "memory.created", "memory_entry", m.id, title=m.title, kind=m.kind)
    db.commit()
    return _row(m, MEM_COLS)


@router.delete("/memory/{mid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory(mid: str, request: Request, ctx: TenantContext = Depends(require(Perm.MEMORY_WRITE)), db: Session = Depends(get_db)):
    m = get_owned(db, MemoryEntry, mid, ctx)
    if m.created_by != ctx.user.id and not ctx.can(Perm.COMPANY_UPDATE):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the author or a company admin can delete this entry")
    db.delete(m)
    _log(db, ctx, request, "memory.deleted", "memory_entry", mid, title=m.title)
    db.commit()


@router.get("/memory/export")
def export_memory(request: Request, ctx: TenantContext = Depends(require(Perm.COMPANY_UPDATE)), db: Session = Depends(get_db)):
    rows = [_row(m, MEM_COLS) for m in db.scalars(scoped(MemoryEntry, ctx).order_by(MemoryEntry.created_at))]
    _log(db, ctx, request, "memory.exported", count=len(rows))
    db.commit()
    return {"company_id": ctx.company_id, "exported_at": utcnow(), "entries": rows}


# ======================= approvals & notifications (Phase 6) =======================
class ApprovalIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=200)
    action_type: Literal[APPROVAL_ACTIONS]  # type: ignore[valid-type]
    details: str = Field(min_length=5, max_length=8000)
    justification: str | None = Field(default=None, max_length=8000)
    estimated_cost: float | None = Field(default=None, ge=0)
    source: Literal["manual", "route_risk", "ai_agent", "vendor_scoring", "finance"] = "manual"
    source_ref: str | None = Field(default=None, max_length=200)


class DecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    decision: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=4000)


class OutcomeIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    outcome: str = Field(min_length=3, max_length=8000)


APPR_COLS = ("id", "title", "action_type", "details", "justification", "estimated_cost", "source", "source_ref", "status",
             "requested_by", "decided_by", "decided_at", "decision_note", "outcome", "outcome_at", "created_at")


def _appr_out(a: ApprovalRequest, names: dict[str, str]) -> dict:
    return {**_row(a, APPR_COLS), "requested_by_name": names.get(a.requested_by or ""), "decided_by_name": names.get(a.decided_by or "")}


def _names(db: Session, ctx: TenantContext) -> dict[str, str]:
    return {u.id: u.full_name for u in db.scalars(scoped(User, ctx))}


def notify(db: Session, company_id: str, user_ids, title: str, body: str | None = None, link: str | None = None) -> None:
    for u in set(user_ids):
        db.add(Notification(company_id=company_id, user_id=u, title=title, body=body, link=link))


@router.get("/approvals")
def list_approvals(status_filter: str | None = Query(default=None, alias="status"), ctx: TenantContext = Depends(require(Perm.OPS_READ)),
                   db: Session = Depends(get_db)):
    stmt = scoped(ApprovalRequest, ctx).order_by(ApprovalRequest.created_at.desc())
    if status_filter:
        stmt = stmt.where(ApprovalRequest.status == status_filter)
    names = _names(db, ctx)
    return [_appr_out(a, names) for a in db.scalars(stmt.limit(500))]


@router.post("/approvals", status_code=status.HTTP_201_CREATED)
def request_approval(data: ApprovalIn, request: Request, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    _any(ctx, Perm.OPS_WRITE, Perm.PROCUREMENT_WRITE, Perm.FINANCE_WRITE)
    a = ApprovalRequest(company_id=ctx.company_id, requested_by=ctx.user.id, **data.model_dump())
    db.add(a)
    db.flush()
    approvers = [u.id for u in db.scalars(scoped(User, ctx).where(User.is_active.is_(True)))
                 if u.id != ctx.user.id and has_perm(u.role, Perm.APPROVE_HIGH_IMPACT)]
    notify(db, ctx.company_id, approvers, f"Approval needed: {a.title}", f"{ctx.user.full_name} requested {a.action_type.replace('_', ' ')}.", "/app/approvals")
    _log(db, ctx, request, "approval.requested", "approval_request", a.id, title=a.title, action_type=a.action_type,
         estimated_cost=a.estimated_cost, notified=len(approvers))
    db.commit()
    return _appr_out(a, _names(db, ctx))


@router.post("/approvals/{aid}/decision")
def decide(aid: str, data: DecisionIn, request: Request, ctx: TenantContext = Depends(require(Perm.APPROVE_HIGH_IMPACT)), db: Session = Depends(get_db)):
    a = get_owned(db, ApprovalRequest, aid, ctx)
    if a.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Request is already {a.status}")
    if a.requested_by == ctx.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot approve or reject your own request")
    if data.decision == "rejected" and not data.note:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Give a reason when rejecting")
    a.status, a.decided_by, a.decided_at, a.decision_note = data.decision, ctx.user.id, utcnow(), data.note
    if a.requested_by:
        notify(db, ctx.company_id, [a.requested_by], f"{data.decision.title()}: {a.title}", data.note, "/app/approvals")
    _log(db, ctx, request, f"approval.{data.decision}", "approval_request", a.id, title=a.title)
    db.commit()
    return _appr_out(a, _names(db, ctx))


@router.post("/approvals/{aid}/cancel")
def cancel(aid: str, request: Request, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    a = get_owned(db, ApprovalRequest, aid, ctx)
    if a.requested_by != ctx.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the requester can cancel")
    if a.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Request is already {a.status}")
    a.status = "cancelled"
    _log(db, ctx, request, "approval.cancelled", "approval_request", a.id)
    db.commit()
    return _appr_out(a, _names(db, ctx))


@router.post("/approvals/{aid}/outcome")
def record_outcome(aid: str, data: OutcomeIn, request: Request, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    """Outcome monitoring: what actually happened after an approved action."""
    a = get_owned(db, ApprovalRequest, aid, ctx)
    if a.status != "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, "Outcomes can only be recorded for approved requests")
    if ctx.user.id not in (a.requested_by, a.decided_by) and not ctx.can(Perm.APPROVE_HIGH_IMPACT):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the requester or an approver can record the outcome")
    a.outcome, a.outcome_at = data.outcome, utcnow()
    _log(db, ctx, request, "approval.outcome_recorded", "approval_request", a.id)
    db.commit()
    return _appr_out(a, _names(db, ctx))


NOTIF_COLS = ("id", "title", "body", "link", "read_at", "created_at")


@router.get("/notifications")
def my_notifications(ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    rows = list(db.scalars(scoped(Notification, ctx).where(Notification.user_id == ctx.user.id).order_by(Notification.created_at.desc()).limit(50)))
    return {"unread": sum(1 for n in rows if n.read_at is None), "items": [_row(n, NOTIF_COLS) for n in rows]}


@router.post("/notifications/read-all")
def read_all(ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    now = utcnow()
    for n in db.scalars(scoped(Notification, ctx).where(Notification.user_id == ctx.user.id, Notification.read_at.is_(None))):
        n.read_at = now
    db.commit()
    return {"unread": 0}


@router.post("/notifications/{nid}/read")
def read_one(nid: str, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    n = get_owned(db, Notification, nid, ctx)
    if n.user_id != ctx.user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    n.read_at = n.read_at or utcnow()
    db.commit()
    return _row(n, NOTIF_COLS)

