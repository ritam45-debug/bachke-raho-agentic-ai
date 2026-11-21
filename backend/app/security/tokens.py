"""Short-lived JWT access tokens + opaque, server-tracked, rotating refresh tokens."""
from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

import jwt

from app.core.config import get_settings
from app.models.base import new_id, utcnow


def create_access_token(*, user_id: str, company_id: str | None, role: str, session_id: str) -> tuple[str, int]:
    s = get_settings()
    now = utcnow()
    exp = now + timedelta(minutes=s.access_token_minutes)
    payload = {
        "sub": user_id, "cid": company_id, "role": role, "sid": session_id,
        "typ": "access", "iat": now, "exp": exp, "jti": new_id(), "iss": "bachke-raho",
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm), s.access_token_minutes * 60


def decode_access_token(token: str) -> dict:
    s = get_settings()
    payload = jwt.decode(
        token, s.jwt_secret, algorithms=[s.jwt_algorithm], issuer="bachke-raho",
        options={"require": ["exp", "sub", "sid", "typ"]},
    )
    if payload.get("typ") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return payload


def new_refresh_token() -> tuple[str, str]:
    """Returns (raw token for the client, sha256 hash to store)."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
