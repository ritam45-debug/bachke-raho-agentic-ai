"""Routes on the risk map, bulk import, and the history of live risk checks."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import Location, Route, RouteRiskCheck
from app.schemas import RiskCheckIn, RiskCheckOut, RouteBulk, RouteIn, RouteOut
from app.security.deps import TenantContext, require
from app.security.rbac import Perm
from app.services import audit
from app.services.tenant_repo import get_owned, scoped

router = APIRouter(prefix="/routes", tags=["routes & live risk"])

# Score bands shared with the frontend scorer (frontend/src/lib/liveRisk.ts). Rule-based, not probabilities.
BANDS = [(75, "high"), (50, "elevated"), (25, "moderate"), (0, "low")]


def band_for(score: int) -> str:
    return next(b for floor, b in BANDS if score >= floor)


def _endpoint(db: Session, ctx: TenantContext, data: RouteIn, side: str) -> dict:
    loc_id = getattr(data, f"{side}_location_id")
    if loc_id:
        loc = db.scalar(scoped(Location, ctx).where(Location.id == loc_id))
        if loc is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"{side.title()} location not found")
        if loc.latitude is None or loc.longitude is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{side.title()} location '{loc.name}' has no map coordinates yet")
        return {f"{side}_location_id": loc.id, f"{side}_label": loc.name, f"{side}_lat": loc.latitude, f"{side}_lon": loc.longitude}
    label, lat, lon = (getattr(data, f"{side}_{k}") for k in ("label", "lat", "lon"))
    if not label or lat is None or lon is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{side.title()}: choose a saved location or give a label with latitude and longitude")
    return {f"{side}_location_id": None, f"{side}_label": label, f"{side}_lat": lat, f"{side}_lon": lon}


def _build(db: Session, ctx: TenantContext, data: RouteIn) -> Route:
    return Route(company_id=ctx.company_id, name=data.name, mode=data.mode, notes=data.notes, created_by=ctx.user.id,
                 **_endpoint(db, ctx, data, "origin"), **_endpoint(db, ctx, data, "destination"))


def _out(r: Route, latest: RouteRiskCheck | None) -> RouteOut:
    return RouteOut(**{k: getattr(r, k) for k in RouteOut.model_fields if k != "latest_check"},
                    latest_check=RiskCheckOut.model_validate(latest) if latest else None)


def _latest_by_route(db: Session, ctx: TenantContext) -> dict[str, RouteRiskCheck]:
    latest: dict[str, RouteRiskCheck] = {}
    for c in db.scalars(scoped(RouteRiskCheck, ctx).order_by(RouteRiskCheck.checked_at)):
        latest[c.route_id] = c  # ordered ascending, so the last one wins
    return latest


@router.get("", response_model=list[RouteOut])
def list_routes(ctx: TenantContext = Depends(require(Perm.OPS_READ)), db: Session = Depends(get_db)):
    latest = _latest_by_route(db, ctx)
    return [_out(r, latest.get(r.id)) for r in db.scalars(scoped(Route, ctx).order_by(Route.created_at))]


@router.post("", response_model=RouteOut, status_code=status.HTTP_201_CREATED)
def create_route(data: RouteIn, request: Request, ctx: TenantContext = Depends(require(Perm.OPS_WRITE)), db: Session = Depends(get_db)):
    r = _build(db, ctx, data)
    db.add(r)
    db.flush()
    audit.record(db, action="route.created", company_id=ctx.company_id, actor_user_id=ctx.user.id, entity_type="route",
                 entity_id=r.id, request=request, details={"name": r.name, "mode": r.mode})
    db.commit()
    return _out(r, None)


@router.post("/bulk", response_model=list[RouteOut], status_code=status.HTTP_201_CREATED)
def bulk_routes(data: RouteBulk, request: Request, ctx: TenantContext = Depends(require(Perm.OPS_WRITE)), db: Session = Depends(get_db)):
    """All-or-nothing import: if any row is invalid, nothing is saved and the row number is reported."""
    built = []
    for i, row in enumerate(data.routes, start=1):
        try:
            built.append(_build(db, ctx, row))
        except HTTPException as e:
            raise HTTPException(e.status_code, f"Row {i}: {e.detail}") from None
    db.add_all(built)
    db.flush()
    audit.record(db, action="route.bulk_imported", company_id=ctx.company_id, actor_user_id=ctx.user.id,
                 entity_type="route", request=request, details={"count": len(built)})
    db.commit()
    return [_out(r, None) for r in built]


@router.delete("/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route(route_id: str, request: Request, ctx: TenantContext = Depends(require(Perm.OPS_WRITE)), db: Session = Depends(get_db)):
    r = get_owned(db, Route, route_id, ctx)
    db.delete(r)
    audit.record(db, action="route.deleted", company_id=ctx.company_id, actor_user_id=ctx.user.id, entity_type="route",
                 entity_id=route_id, request=request, details={"name": r.name})
    db.commit()


@router.post("/{route_id}/risk-checks", response_model=RiskCheckOut, status_code=status.HTTP_201_CREATED)
def record_check(route_id: str, data: RiskCheckIn, request: Request,
                 ctx: TenantContext = Depends(require(Perm.OPS_READ)), db: Session = Depends(get_db)):
    """Store a live risk check. The score must equal the capped sum of its factors, and the band is derived here."""
    get_owned(db, Route, route_id, ctx)
    expected = min(100, sum(f.points for f in data.factors))
    if data.score != expected:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Score {data.score} does not match its factors ({expected})")
    c = RouteRiskCheck(company_id=ctx.company_id, route_id=route_id, score=data.score, band=band_for(data.score),
                       factors=[f.model_dump() for f in data.factors], sources=[s.model_dump() for s in data.sources],
                       forecast_days=data.forecast_days, rules_version=data.rules_version, checked_by=ctx.user.id)
    db.add(c)
    db.flush()
    audit.record(db, action="route.risk_checked", company_id=ctx.company_id, actor_user_id=ctx.user.id, entity_type="route",
                 entity_id=route_id, request=request,
                 details={"score": c.score, "band": c.band, "failed_sources": [s.name for s in data.sources if s.status == "failed"]})
    db.commit()
    return c


@router.get("/{route_id}/risk-checks", response_model=list[RiskCheckOut])
def route_checks(route_id: str, ctx: TenantContext = Depends(require(Perm.OPS_READ)), db: Session = Depends(get_db)):
    get_owned(db, Route, route_id, ctx)
    return db.scalars(scoped(RouteRiskCheck, ctx).where(RouteRiskCheck.route_id == route_id)
                      .order_by(RouteRiskCheck.checked_at.desc()).limit(50)).all()

