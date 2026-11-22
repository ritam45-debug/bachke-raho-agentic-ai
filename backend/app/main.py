"""BAchke Raho Agnetic AI — API entrypoint.  Predict. Prevent. Protect."""
from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import ai, audit_admin, auth, company, dashboard, operations, routes_api, users
from app.core.config import get_settings
from app.database.session import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.database_url.startswith("sqlite"):
        init_db()  # PostgreSQL deployments use `alembic upgrade head` instead
    yield


app = FastAPI(
    title=settings.app_name, version="0.1.0-phase1", lifespan=lifespan,
    description="Enterprise supply-chain intelligence platform. Phase 1: tenancy, auth, RBAC, audit, dashboard data.",
    docs_url=None if settings.is_production else "/docs", redoc_url=None,
)
app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"],
)

# --- simple per-IP rate limit on auth endpoints (swap for Redis-backed limiter when horizontally scaled) ---
_AUTH_WINDOW, _AUTH_MAX = 60.0, 30
_hits: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    if request.url.path.startswith(f"{settings.api_prefix}/auth/") and request.method == "POST" \
            and settings.environment != "test":
        ip = request.client.host if request.client else "?"
        q, now = _hits[ip], time.monotonic()
        while q and now - q[0] > _AUTH_WINDOW:
            q.popleft()
        if len(q) >= _AUTH_MAX:
            return JSONResponse({"detail": "Too many requests, slow down."}, status_code=429)
        q.append(now)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "app": settings.app_name, "phase": 1,
            "ai_enabled": bool(settings.anthropic_api_key), "environment": settings.environment}


for r in (auth.router, company.router, users.router, dashboard.router, operations.router, routes_api.router, ai.router, audit_admin.router):
    app.include_router(r, prefix=settings.api_prefix)
