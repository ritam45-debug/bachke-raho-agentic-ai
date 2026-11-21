from __future__ import annotations

import csv
import io
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import AuditLog, Company, User
from app.schemas import AuditOut
from app.security.deps import AuthContext, TenantContext, require, require_platform_admin
from app.security.rbac import Perm
from app.services import audit

router = APIRouter(tags=["audit & admin"])


def _audit_query(ctx: TenantContext, action: str | None):
    q = select(AuditLog).where(AuditLog.company_id == ctx.company_id)
    if action:
        q = q.where(AuditLog.action.startswith(action))
    return q.order_by(AuditLog.created_at.desc())


@router.get("/audit-logs", response_model=list[AuditOut])
def audit_logs(action: str | None = Query(default=None, max_length=80), limit: int = Query(default=100, ge=1, le=500),
               offset: int = Query(default=0, ge=0),
               ctx: TenantContext = Depends(require(Perm.AUDIT_READ)), db: Session = Depends(get_db)):
    return db.scalars(_audit_query(ctx, action).limit(limit).offset(offset)).all()


@router.get("/audit-logs/export")
def export_audit(request: Request, action: str | None = Query(default=None, max_length=80),
                 ctx: TenantContext = Depends(require(Perm.AUDIT_READ)), db: Session = Depends(get_db)):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["created_at", "action", "outcome", "actor_type", "actor_user_id", "entity_type", "entity_id", "ip_address", "details"])
    for a in db.scalars(_audit_query(ctx, action).limit(10000)):
        w.writerow([a.created_at.isoformat(), a.action, a.outcome, a.actor_type, a.actor_user_id or "",
                    a.entity_type or "", a.entity_id or "", a.ip_address or "", json.dumps(a.details or {})])
    audit.record(db, action="audit.exported", company_id=ctx.company_id, actor_user_id=ctx.user.id, request=request)
    db.commit()
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="audit-log.csv"'})


# ---- platform administration (super-admin): tenant metadata only, never tenant operational data ----
@router.get("/admin/companies")
def admin_companies(_: AuthContext = Depends(require_platform_admin), db: Session = Depends(get_db)):
    counts = dict(db.execute(select(User.company_id, func.count()).group_by(User.company_id)).all())
    return [{"id": c.id, "name": c.name, "slug": c.slug, "industry": c.industry, "status": c.status,
             "is_demo": c.is_demo, "users": counts.get(c.id, 0), "created_at": c.created_at}
            for c in db.scalars(select(Company).order_by(Company.created_at))]


@router.post("/admin/companies/{company_id}/status")
def admin_set_status(company_id: str, request: Request, new_status: str = Query(pattern="^(active|suspended)$"),
                     auth: AuthContext = Depends(require_platform_admin), db: Session = Depends(get_db)):
    c = db.get(Company, company_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")
    c.status = new_status
    audit.record(db, action=f"platform.company_{new_status}", company_id=c.id, actor_user_id=auth.user.id,
                 entity_type="company", entity_id=c.id, request=request)
    db.commit()
    return {"id": c.id, "status": c.status}
