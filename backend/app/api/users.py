from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import User, UserSession
from app.models.base import Role, utcnow
from app.schemas import UserCreate, UserOut, UserUpdate
from app.security.deps import TenantContext, require
from app.security.passwords import hash_password
from app.security.rbac import ASSIGNABLE_ROLES, Perm
from app.services import audit

router = APIRouter(prefix="/users", tags=["users"])


def _own_user(db: Session, user_id: str, ctx: TenantContext) -> User:
    u = db.scalar(select(User).where(User.id == user_id, User.company_id == ctx.company_id))
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return u


def _admins_left(db: Session, ctx: TenantContext, excluding: str) -> int:
    return len(db.scalars(select(User.id).where(
        User.company_id == ctx.company_id, User.role == Role.COMPANY_ADMIN.value,
        User.is_active.is_(True), User.id != excluding)).all())


@router.get("/roles")
def roles(_: TenantContext = Depends(require(Perm.USERS_READ))):
    return ASSIGNABLE_ROLES


@router.get("", response_model=list[UserOut])
def list_users(ctx: TenantContext = Depends(require(Perm.USERS_READ)), db: Session = Depends(get_db)):
    return db.scalars(select(User).where(User.company_id == ctx.company_id).order_by(User.created_at)).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(data: UserCreate, request: Request,
                ctx: TenantContext = Depends(require(Perm.USERS_MANAGE)), db: Session = Depends(get_db)):
    if ctx.company and ctx.company.is_demo:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The demo workspace is read-only")
    email = data.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    u = User(company_id=ctx.company_id, email=email, full_name=data.full_name, job_title=data.job_title,
             role=data.role, password_hash=hash_password(data.temporary_password))
    db.add(u)
    db.flush()
    audit.record(db, action="user.created", company_id=ctx.company_id, actor_user_id=ctx.user.id,
                 entity_type="user", entity_id=u.id, request=request, details={"role": u.role})
    db.commit()
    return u


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: str, data: UserUpdate, request: Request,
                ctx: TenantContext = Depends(require(Perm.USERS_MANAGE)), db: Session = Depends(get_db)):
    if ctx.company and ctx.company.is_demo:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The demo workspace is read-only")
    u = _own_user(db, user_id, ctx)
    changes = data.model_dump(exclude_unset=True)
    demoting = ("role" in changes and changes["role"] != Role.COMPANY_ADMIN.value) or changes.get("is_active") is False
    if u.role == Role.COMPANY_ADMIN.value and demoting and _admins_left(db, ctx, u.id) == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "A company must keep at least one active administrator")
    for k, v in changes.items():
        setattr(u, k, v)
    if changes.get("is_active") is False or "role" in changes:
        for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id, UserSession.revoked_at.is_(None))):
            s.revoked_at = utcnow()  # force re-login so new permissions apply immediately
    audit.record(db, action="user.updated", company_id=ctx.company_id, actor_user_id=ctx.user.id,
                 entity_type="user", entity_id=u.id, request=request, details=changes)
    db.commit()
    return u
