"""Request dependencies: authentication, tenant context and permission checks."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database.session import get_db, set_tenant_guc
from app.models import Company, User, UserSession
from app.models.base import utcnow
from app.security.rbac import Perm, has_perm, permissions_for
from app.security.tokens import decode_access_token

_bearer = HTTPBearer(auto_error=False)
_UNAUTH = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})


@dataclass(frozen=True)
class AuthContext:
    user: User
    session_id: str
    role: str
    company_id: str | None

    def can(self, perm: Perm) -> bool:
        return has_perm(self.role, perm)

    @property
    def permissions(self) -> list[str]:
        return sorted(p.value for p in permissions_for(self.role))


@dataclass(frozen=True)
class TenantContext(AuthContext):
    company_id: str  # never None inside a tenant context
    company: Company | None = None


def get_auth(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> AuthContext:
    if creds is None or creds.scheme.lower() != "bearer":
        raise _UNAUTH
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise _UNAUTH from None

    user = db.get(User, payload["sub"])
    sess = db.get(UserSession, payload["sid"])
    now = utcnow()
    if (
        user is None or not user.is_active
        or sess is None or sess.user_id != user.id or sess.revoked_at is not None
        or _aware(sess.expires_at) <= now
    ):
        raise _UNAUTH
    # Role and tenant always come from the database, not from token claims.
    if user.company_id is not None:
        company = db.get(Company, user.company_id)
        if company is None or company.status != "active":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Company workspace is not active")
    request.state.user_id = user.id
    return AuthContext(user=user, session_id=sess.id, role=user.role, company_id=user.company_id)


def get_tenant(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> TenantContext:
    if auth.company_id is None:
        # Platform super-admins administer tenants but cannot read tenant operational data.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This endpoint requires a company workspace")
    set_tenant_guc(db, auth.company_id)
    return TenantContext(
        user=auth.user, session_id=auth.session_id, role=auth.role,
        company_id=auth.company_id, company=db.get(Company, auth.company_id),
    )


def require(perm: Perm):
    def _dep(ctx: TenantContext = Depends(get_tenant)) -> TenantContext:
        if not ctx.can(perm):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Missing permission: {perm.value}")
        return ctx
    return _dep


def require_platform_admin(auth: AuthContext = Depends(get_auth)) -> AuthContext:
    if not auth.can(Perm.PLATFORM_ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform administrators only")
    return auth


def _aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
