"""The only sanctioned way for API code to read tenant-owned rows.

Every query is filtered by the company_id of the authenticated session. A row belonging to another
company is reported as 404 (not 403) so its existence is not revealed.
"""
from __future__ import annotations

from typing import TypeVar

from fastapi import HTTPException, status
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.security.deps import TenantContext

T = TypeVar("T")


def scoped(model: type[T], ctx: TenantContext) -> Select:
    if not hasattr(model, "company_id"):
        raise TypeError(f"{model.__name__} is not tenant-scoped")
    return select(model).where(model.company_id == ctx.company_id)


def get_owned(db: Session, model: type[T], obj_id: str, ctx: TenantContext) -> T:
    obj = db.scalar(scoped(model, ctx).where(model.id == obj_id))
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{model.__name__} not found")
    return obj


def count(db: Session, model: type[T], ctx: TenantContext, *conds) -> int:
    q = select(func.count()).select_from(model).where(model.company_id == ctx.company_id, *conds)
    return int(db.scalar(q) or 0)
