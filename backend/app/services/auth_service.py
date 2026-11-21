from __future__ import annotations

import re
import unicodedata
from datetime import UTC, timedelta

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database.session import set_tenant_guc
from app.models import Company, CompanyProfile, Location, User, UserSession
from app.models.base import Role, utcnow
from app.schemas import CompanyRegistration, TokenPair
from app.security.passwords import DUMMY_HASH, hash_password, verify_password
from app.security.tokens import create_access_token, hash_refresh_token, new_refresh_token
from app.services import audit

_BAD_LOGIN = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:60] or "company"


def _unique_slug(db: Session, name: str) -> str:
    base, n = slugify(name), 1
    slug = base
    while db.scalar(select(Company.id).where(Company.slug == slug)):
        n += 1
        slug = f"{base}-{n}"
    return slug


def issue_session(db: Session, user: User, request: Request | None) -> TokenPair:
    s = get_settings()
    raw, digest = new_refresh_token()
    sess = UserSession(
        user_id=user.id, refresh_token_hash=digest,
        expires_at=utcnow() + timedelta(days=s.refresh_token_days),
        ip_address=audit.client_ip(request),
        user_agent=(request.headers.get("user-agent", "")[:300] if request else None),
    )
    db.add(sess)
    db.flush()
    access, ttl = create_access_token(user_id=user.id, company_id=user.company_id, role=user.role, session_id=sess.id)
    return TokenPair(access_token=access, refresh_token=raw, expires_in=ttl)


def register_company(db: Session, data: CompanyRegistration, request: Request | None) -> TokenPair:
    email = data.admin_email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")

    company = Company(
        name=data.company_name, slug=_unique_slug(db, data.company_name), industry=data.industry,
        company_size=data.company_size, headquarters=data.headquarters, country=data.country,
        registration_number=data.registration_number,
        ai_external_processing=get_settings().ai_external_processing_default,
    )
    db.add(company)
    db.flush()
    set_tenant_guc(db, company.id)  # RLS WITH CHECK on Postgres
    db.add(CompanyProfile(
        company_id=company.id, product_categories=data.product_categories,
        admin_contact_name=data.admin_full_name, admin_contact_email=email, admin_contact_phone=data.admin_phone,
    ))
    db.add(Location(company_id=company.id, name=f"{data.company_name} HQ", kind="headquarters",
                    city=data.headquarters, country=data.country))
    for loc in data.locations:
        db.add(Location(company_id=company.id, **loc.model_dump()))
    admin = User(
        company_id=company.id, email=email, full_name=data.admin_full_name, job_title=data.admin_job_title,
        password_hash=hash_password(data.password), role=Role.COMPANY_ADMIN.value,
    )
    db.add(admin)
    db.flush()
    audit.record(db, action="company.registered", company_id=company.id, actor_user_id=admin.id,
                 entity_type="company", entity_id=company.id, request=request,
                 details={"name": company.name, "locations": len(data.locations) + 1})
    tokens = issue_session(db, admin, request)
    admin.last_login_at = utcnow()
    db.commit()
    return tokens


def login(db: Session, email: str, password: str, request: Request | None) -> TokenPair:
    s = get_settings()
    email = email.lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        verify_password(password, DUMMY_HASH)  # equalise timing
        raise _BAD_LOGIN

    now = utcnow()
    locked = user.locked_until and _aware(user.locked_until) > now
    if locked or not user.is_active:
        audit.record(db, action="auth.login", company_id=user.company_id, actor_user_id=user.id,
                     outcome="denied", request=request, details={"reason": "locked" if locked else "inactive"})
        db.commit()
        raise _BAD_LOGIN

    if not verify_password(password, user.password_hash):
        user.failed_login_attempts += 1
        details = {"attempt": user.failed_login_attempts}
        if user.failed_login_attempts >= s.max_failed_logins:
            user.locked_until = now + timedelta(minutes=s.lockout_minutes)
            user.failed_login_attempts = 0
            details["locked_minutes"] = s.lockout_minutes
        audit.record(db, action="auth.login", company_id=user.company_id, actor_user_id=user.id,
                     outcome="failure", request=request, details=details)
        db.commit()
        raise _BAD_LOGIN

    if user.company_id:
        company = db.get(Company, user.company_id)
        if company is None or company.status != "active":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Company workspace is not active")

    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    tokens = issue_session(db, user, request)
    audit.record(db, action="auth.login", company_id=user.company_id, actor_user_id=user.id, request=request)
    db.commit()
    return tokens


def refresh(db: Session, raw: str, request: Request | None) -> TokenPair:
    sess = db.scalar(select(UserSession).where(UserSession.refresh_token_hash == hash_refresh_token(raw)))
    now = utcnow()
    if sess is None or _aware(sess.expires_at) <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    user = db.get(User, sess.user_id)
    if sess.revoked_at is not None:
        # Re-use of a rotated token signals theft: revoke every session for this user.
        for other in db.scalars(select(UserSession).where(UserSession.user_id == sess.user_id, UserSession.revoked_at.is_(None))):
            other.revoked_at = now
        audit.record(db, action="auth.refresh_reuse_detected", company_id=user.company_id if user else None,
                     actor_user_id=sess.user_id, outcome="denied", request=request)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    sess.revoked_at = now  # rotate
    tokens = issue_session(db, user, request)
    db.commit()
    return tokens


def logout(db: Session, session_id: str, user: User, request: Request | None) -> None:
    sess = db.get(UserSession, session_id)
    if sess and sess.revoked_at is None:
        sess.revoked_at = utcnow()
    audit.record(db, action="auth.logout", company_id=user.company_id, actor_user_id=user.id, request=request)
    db.commit()


def _aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
