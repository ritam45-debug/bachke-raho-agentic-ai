"""Phase 2 AI API: conversations, agent runs and their execution log.

The model call itself happens in the user's browser with their own Anthropic key (static hosting on GitHub Pages).
This API is the system of record: it gates every run on the company's AI consent and monthly budget, prices usage
server-side from token counts, and keeps an append-only, tenant-isolated trace of what each agent did.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import AgentRun, AgentStep, AIConversation, AIMessage
from app.models.base import utcnow
from app.security.deps import TenantContext, require
from app.security.rbac import Perm
from app.services import audit
from app.services.tenant_repo import scoped

router = APIRouter(prefix="/ai", tags=["ai agents"])
_ai = require(Perm.AI_USE)

# USD per million tokens (Claude API pricing page, checked 21 Nov 2026). Haiku has a higher tier above 100K input tokens per call.
PRICES: dict[str, dict] = {
    "claude-sonnet-5-5": {"label": "Claude Sonnet 5.5", "in": 2.0, "out": 10.0},
    "claude-haiku-5-5": {"label": "Claude Haiku 5.5", "in": 0.10, "out": 0.50, "long_in": 0.50, "long_out": 2.50, "long_from": 100_000},
}
AGENTS = {"route_risk_analyst": "Route Risk Analyst", "orchestrator": "Orchestrator"}
MAX_PAYLOAD_CHARS = 20_000


def call_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    p = PRICES[model]
    long = "long_from" in p and input_tokens > p["long_from"]
    rin, rout = (p["long_in"], p["long_out"]) if long else (p["in"], p["out"])
    return (input_tokens * rin + output_tokens * rout) / 1_000_000


def _month_start() -> datetime:
    n = datetime.now(UTC)
    return n.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _spent_this_month(db: Session, ctx: TenantContext) -> float:
    q = select(func.coalesce(func.sum(AgentRun.cost_usd), 0.0)).where(
        AgentRun.company_id == ctx.company_id, AgentRun.started_at >= _month_start())
    return float(db.scalar(q) or 0.0)


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ConversationIn(_In):
    title: str = Field(min_length=1, max_length=200)


class MessageIn(_In):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=40_000)
    run_id: str | None = Field(default=None, max_length=36)


class RunIn(_In):
    conversation_id: str | None = Field(default=None, max_length=36)
    agent: str = Field(max_length=60)
    model: str = Field(max_length=60)
    autonomy_level: Literal[1, 2] = 2  # level 3 (execution) is not available until Phase 6 approvals exist


class StepIn(_In):
    seq: int = Field(ge=0, le=10_000)
    kind: Literal["route", "model_call", "tool_call", "tool_result", "final", "error", "retry", "guard"]
    name: str | None = Field(default=None, max_length=80)
    payload: dict = Field(default_factory=dict)


class CallUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input_tokens: int = Field(ge=0, le=5_000_000)
    output_tokens: int = Field(ge=0, le=1_000_000)


class FinishIn(_In):
    status: Literal["completed", "failed", "stopped"]
    calls: list[CallUsage] = Field(default_factory=list, max_length=50)
    tool_calls: int = Field(default=0, ge=0, le=500)
    error: str | None = Field(default=None, max_length=500)


def _run_out(r: AgentRun) -> dict:
    return {k: getattr(r, k) for k in ("id", "conversation_id", "agent", "model", "autonomy_level", "status", "input_tokens",
                                       "output_tokens", "cost_usd", "tool_calls", "error", "started_at", "finished_at")}


def _own_conversation(db: Session, ctx: TenantContext, cid: str) -> AIConversation:
    c = db.scalar(scoped(AIConversation, ctx).where(AIConversation.id == cid, AIConversation.user_id == ctx.user.id))
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return c


def _own_run(db: Session, ctx: TenantContext, rid: str) -> AgentRun:
    r = db.scalar(scoped(AgentRun, ctx).where(AgentRun.id == rid))
    if r is None or (r.user_id != ctx.user.id and not ctx.can(Perm.AUDIT_READ)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    return r


# ---------------- status ----------------
@router.get("/status")
def ai_status(ctx: TenantContext = Depends(_ai), db: Session = Depends(get_db)):
    spent = _spent_this_month(db, ctx)
    budget = ctx.company.ai_monthly_budget_usd
    runs = db.scalar(select(func.count()).select_from(AgentRun).where(
        AgentRun.company_id == ctx.company_id, AgentRun.started_at >= _month_start())) or 0
    return {
        "consent": ctx.company.ai_external_processing, "budget_usd": budget, "spent_month_usd": round(spent, 6),
        "remaining_usd": round(max(0.0, budget - spent), 6), "runs_month": runs,
        "models": [{"id": k, "label": v["label"], "input_per_mtok": v["in"], "output_per_mtok": v["out"]} for k, v in PRICES.items()],
        "agents": [{"id": k, "label": v} for k, v in AGENTS.items()],
    }


# ---------------- conversations ----------------
@router.get("/conversations")
def list_conversations(ctx: TenantContext = Depends(_ai), db: Session = Depends(get_db)):
    q = scoped(AIConversation, ctx).where(AIConversation.user_id == ctx.user.id).order_by(AIConversation.updated_at.desc()).limit(100)
    return [{"id": c.id, "title": c.title, "created_at": c.created_at, "updated_at": c.updated_at} for c in db.scalars(q)]


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
def create_conversation(data: ConversationIn, ctx: TenantContext = Depends(_ai), db: Session = Depends(get_db)):
    c = AIConversation(company_id=ctx.company_id, user_id=ctx.user.id, title=data.title)
    db.add(c)
    db.commit()
    return {"id": c.id, "title": c.title, "created_at": c.created_at, "updated_at": c.updated_at}


@router.get("/conversations/{cid}")
def get_conversation(cid: str, ctx: TenantContext = Depends(_ai), db: Session = Depends(get_db)):
    c = _own_conversation(db, ctx, cid)
    msgs = db.scalars(scoped(AIMessage, ctx).where(AIMessage.conversation_id == c.id).order_by(AIMessage.created_at))
    return {"id": c.id, "title": c.title, "created_at": c.created_at,
            "messages": [{"id": m.id, "role": m.role, "content": m.content, "run_id": m.run_id, "created_at": m.created_at} for m in msgs]}


@router.delete("/conversations/{cid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(cid: str, request: Request, ctx: TenantContext = Depends(_ai), db: Session = Depends(get_db)):
    c = _own_conversation(db, ctx, cid)
    db.delete(c)
    audit.record(db, action="ai.conversation_deleted", company_id=ctx.company_id, actor_user_id=ctx.user.id,
                 entity_type="ai_conversation", entity_id=cid, request=request)
    db.commit()


@router.post("/conversations/{cid}/messages", status_code=status.HTTP_201_CREATED)
def add_message(cid: str, data: MessageIn, ctx: TenantContext = Depends(_ai), db: Session = Depends(get_db)):
    c = _own_conversation(db, ctx, cid)
    if data.run_id:
        _own_run(db, ctx, data.run_id)
    m = AIMessage(company_id=ctx.company_id, conversation_id=c.id, role=data.role, content=data.content, run_id=data.run_id)
    c.updated_at = utcnow()
    db.add(m)
    db.commit()
    return {"id": m.id, "role": m.role, "content": m.content, "run_id": m.run_id, "created_at": m.created_at}


# ---------------- runs ----------------
@router.post("/runs", status_code=status.HTTP_201_CREATED)
def start_run(data: RunIn, request: Request, ctx: TenantContext = Depends(_ai), db: Session = Depends(get_db)):
    if data.model not in PRICES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unsupported model. Use one of: {', '.join(PRICES)}")
    if data.agent not in AGENTS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown agent. Use one of: {', '.join(AGENTS)}")
    if not ctx.company.ai_external_processing:
        audit.record(db, action="ai.run_blocked", company_id=ctx.company_id, actor_user_id=ctx.user.id, outcome="denied",
                     request=request, details={"reason": "consent_off"})
        db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, "AI is switched off for this company. An administrator can enable "
                                                       "'Allow external AI processing' in Company Settings.")
    spent = _spent_this_month(db, ctx)
    if spent >= ctx.company.ai_monthly_budget_usd:
        audit.record(db, action="ai.run_blocked", company_id=ctx.company_id, actor_user_id=ctx.user.id, outcome="denied",
                     request=request, details={"reason": "budget", "spent_usd": round(spent, 4)})
        db.commit()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"This month's AI budget (${ctx.company.ai_monthly_budget_usd:.2f}) "
                                                               "has been reached. An administrator can raise it in Company Settings.")
    if data.conversation_id:
        _own_conversation(db, ctx, data.conversation_id)
    r = AgentRun(company_id=ctx.company_id, conversation_id=data.conversation_id, user_id=ctx.user.id, agent=data.agent,
                 model=data.model, autonomy_level=data.autonomy_level)
    db.add(r)
    db.flush()
    audit.record(db, action="ai.run_started", company_id=ctx.company_id, actor_user_id=ctx.user.id, actor_type="agent",
                 entity_type="agent_run", entity_id=r.id, request=request, details={"agent": r.agent, "model": r.model})
    db.commit()
    return {**_run_out(r), "remaining_usd": round(ctx.company.ai_monthly_budget_usd - spent, 6)}


@router.post("/runs/{rid}/steps", status_code=status.HTTP_201_CREATED)
def add_step(rid: str, data: StepIn, ctx: TenantContext = Depends(_ai), db: Session = Depends(get_db)):
    r = _own_run(db, ctx, rid)
    if r.user_id != ctx.user.id or r.status != "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "Steps can only be added to your own running run")
    payload = data.payload
    raw = json.dumps(payload, default=str)
    if len(raw) > MAX_PAYLOAD_CHARS:  # keep the log bounded; mark truncation explicitly
        payload = {"truncated": True, "preview": raw[:MAX_PAYLOAD_CHARS]}
    if db.scalar(scoped(AgentStep, ctx).where(AgentStep.run_id == r.id, AgentStep.seq == data.seq)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Step {data.seq} already recorded")
    s = AgentStep(company_id=ctx.company_id, run_id=r.id, seq=data.seq, kind=data.kind, name=data.name, payload=payload)
    db.add(s)
    db.commit()
    return {"id": s.id, "seq": s.seq}


@router.post("/runs/{rid}/finish")
def finish_run(rid: str, data: FinishIn, request: Request, ctx: TenantContext = Depends(_ai), db: Session = Depends(get_db)):
    r = _own_run(db, ctx, rid)
    if r.user_id != ctx.user.id or r.status != "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only your own running run can be finished")
    r.status = data.status
    r.input_tokens = sum(c.input_tokens for c in data.calls)
    r.output_tokens = sum(c.output_tokens for c in data.calls)
    r.cost_usd = round(sum(call_cost(r.model, c.input_tokens, c.output_tokens) for c in data.calls), 6)  # priced here, not by the client
    r.tool_calls = data.tool_calls
    r.error = data.error
    r.finished_at = utcnow()
    audit.record(db, action="ai.run_finished", company_id=ctx.company_id, actor_user_id=ctx.user.id, actor_type="agent",
                 entity_type="agent_run", entity_id=r.id, request=request,
                 outcome="success" if data.status == "completed" else "failure",
                 details={"agent": r.agent, "model": r.model, "status": r.status, "input_tokens": r.input_tokens,
                          "output_tokens": r.output_tokens, "cost_usd": r.cost_usd, "tool_calls": r.tool_calls})
    db.commit()
    return _run_out(r)


@router.get("/runs")
def list_runs(limit: int = Query(default=50, ge=1, le=200), ctx: TenantContext = Depends(_ai), db: Session = Depends(get_db)):
    q = scoped(AgentRun, ctx)
    if not ctx.can(Perm.AUDIT_READ):
        q = q.where(AgentRun.user_id == ctx.user.id)
    return [_run_out(r) for r in db.scalars(q.order_by(AgentRun.started_at.desc()).limit(limit))]


@router.get("/runs/{rid}")
def get_run(rid: str, ctx: TenantContext = Depends(_ai), db: Session = Depends(get_db)):
    r = _own_run(db, ctx, rid)
    steps = db.scalars(scoped(AgentStep, ctx).where(AgentStep.run_id == r.id).order_by(AgentStep.seq))
    return {**_run_out(r), "steps": [{"seq": s.seq, "kind": s.kind, "name": s.name, "payload": s.payload, "created_at": s.created_at} for s in steps]}

