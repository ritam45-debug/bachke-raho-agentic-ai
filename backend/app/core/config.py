"""Environment-based configuration. Secrets come only from the environment / .env — never from source."""
from __future__ import annotations

import logging
import secrets
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger("bachke.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "BAchke Raho Agnetic AI"
    environment: str = "development"  # development | test | production
    api_prefix: str = "/api/v1"

    # Database: SQLite for local dev/tests, Supabase/managed PostgreSQL in production.
    database_url: str = "sqlite:///./bachke_dev.db"

    # Auth
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 7
    max_failed_logins: int = 5
    lockout_minutes: int = 15

    # CORS — comma-separated list of allowed frontend origins
    cors_origins: str = "http://localhost:5173"

    # AI (Phase 2). Left empty in Phase 1; AI features stay disabled until set.
    anthropic_api_key: str = ""
    # Tenants must opt in before any of their data is sent to an external AI provider.
    ai_external_processing_default: bool = False

    seed_demo_on_startup: bool = True

    @field_validator("environment")
    @classmethod
    def _env(cls, v: str) -> str:
        v = v.lower()
        if v not in {"development", "test", "production"}:
            raise ValueError("ENVIRONMENT must be development, test or production")
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if not s.jwt_secret:
        if s.is_production:
            raise RuntimeError("JWT_SECRET must be set in production.")
        s.jwt_secret = secrets.token_urlsafe(48)
        log.warning("JWT_SECRET not set — using an ephemeral dev secret (tokens reset on restart).")
    elif s.is_production and len(s.jwt_secret) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 characters in production.")
    if s.is_production and s.database_url.startswith("sqlite"):
        raise RuntimeError("SQLite is not allowed in production; set DATABASE_URL to PostgreSQL.")
    return s
