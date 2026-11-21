from __future__ import annotations

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog

_REDACT = {"password", "temporary_password", "refresh_token", "access_token", "secret", "api_key"}


def _clean(details: dict | None) -> dict:
    if not details:
        return {}
    return {k: ("[redacted]" if k.lower() in _REDACT else v) for k, v in details.items()}


def client_ip(request: Request | None) -> str | None:
    if request is None or request.client is None:
        return None
    return request.client.host


def record(
    db: Session, *, action: str, company_id: str | None, actor_user_id: str | None = None,
    actor_type: str = "user", entity_type: str | None = None, entity_id: str | None = None,
    outcome: str = "success", request: Request | None = None, details: dict | None = None,
) -> AuditLog:
    entry = AuditLog(
        company_id=company_id, actor_user_id=actor_user_id, actor_type=actor_type, action=action,
        entity_type=entity_type, entity_id=entity_id, outcome=outcome,
        ip_address=client_ip(request), details=_clean(details),
    )
    db.add(entry)
    return entry
