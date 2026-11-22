from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import CompanyProfile, Location
from app.schemas import CompanyOut, CompanyUpdate, LocationBulk, LocationIn, LocationOut
from app.security.deps import TenantContext, require
from app.security.rbac import Perm
from app.services import audit
from app.services.tenant_repo import scoped

router = APIRouter(prefix="/company", tags=["company"])

_COMPANY_FIELDS = {"name", "industry", "company_size", "headquarters", "ai_external_processing", "ai_monthly_budget_usd", "data_retention_days"}
_PROFILE_FIELDS = {"description", "product_categories", "website", "currency"}


def _out(db: Session, ctx: TenantContext) -> CompanyOut:
    c = ctx.company
    p = db.scalar(scoped(CompanyProfile, ctx))
    locs = db.scalars(scoped(Location, ctx).order_by(Location.kind, Location.name)).all()
    return CompanyOut(
        id=c.id, name=c.name, slug=c.slug, industry=c.industry, company_size=c.company_size,
        headquarters=c.headquarters, country=c.country, registration_number=c.registration_number,
        status=c.status, is_demo=c.is_demo, ai_external_processing=c.ai_external_processing, ai_monthly_budget_usd=c.ai_monthly_budget_usd,
        data_retention_days=c.data_retention_days, created_at=c.created_at,
        description=p.description if p else None, product_categories=(p.product_categories if p else []) or [],
        admin_contact_name=p.admin_contact_name if p else None,
        admin_contact_email=p.admin_contact_email if p else None,
        admin_contact_phone=p.admin_contact_phone if p else None,
        website=p.website if p else None, currency=p.currency if p else "INR",
        locations=[LocationOut.model_validate(x) for x in locs],
    )


def _block_demo_writes(ctx: TenantContext) -> None:
    if ctx.company and ctx.company.is_demo:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The demo workspace is read-only")


@router.get("", response_model=CompanyOut)
def get_company(ctx: TenantContext = Depends(require(Perm.COMPANY_READ)), db: Session = Depends(get_db)):
    return _out(db, ctx)


@router.patch("", response_model=CompanyOut)
def update_company(data: CompanyUpdate, request: Request,
                   ctx: TenantContext = Depends(require(Perm.COMPANY_UPDATE)), db: Session = Depends(get_db)):
    _block_demo_writes(ctx)
    changes = data.model_dump(exclude_unset=True)
    profile = db.scalar(scoped(CompanyProfile, ctx))
    for k, v in changes.items():
        if k in _COMPANY_FIELDS:
            setattr(ctx.company, k, v)
        elif k in _PROFILE_FIELDS and profile is not None:
            setattr(profile, k, v)
    audit.record(db, action="company.updated", company_id=ctx.company_id, actor_user_id=ctx.user.id,
                 entity_type="company", entity_id=ctx.company_id, request=request,
                 details={"fields": sorted(changes)})
    db.commit()
    return _out(db, ctx)


@router.post("/locations", response_model=LocationOut, status_code=status.HTTP_201_CREATED)
def add_location(data: LocationIn, request: Request,
                 ctx: TenantContext = Depends(require(Perm.COMPANY_UPDATE)), db: Session = Depends(get_db)):
    _block_demo_writes(ctx)
    loc = Location(company_id=ctx.company_id, **data.model_dump())
    db.add(loc)
    db.flush()
    audit.record(db, action="location.created", company_id=ctx.company_id, actor_user_id=ctx.user.id,
                 entity_type="location", entity_id=loc.id, request=request, details={"kind": loc.kind})
    db.commit()
    return LocationOut.model_validate(loc)


@router.post("/locations/bulk", response_model=list[LocationOut], status_code=status.HTTP_201_CREATED)
def add_locations_bulk(data: LocationBulk, request: Request,
                       ctx: TenantContext = Depends(require(Perm.COMPANY_UPDATE)), db: Session = Depends(get_db)):
    """Import many locations at once (e.g. from CSV). Validated as a whole before anything is saved."""
    _block_demo_writes(ctx)
    locs = [Location(company_id=ctx.company_id, **x.model_dump()) for x in data.locations]
    db.add_all(locs)
    db.flush()
    audit.record(db, action="location.bulk_imported", company_id=ctx.company_id, actor_user_id=ctx.user.id,
                 entity_type="location", request=request, details={"count": len(locs)})
    db.commit()
    return [LocationOut.model_validate(x) for x in locs]


@router.patch("/locations/{location_id}", response_model=LocationOut)
def update_location(location_id: str, data: LocationIn, request: Request,
                    ctx: TenantContext = Depends(require(Perm.COMPANY_UPDATE)), db: Session = Depends(get_db)):
    _block_demo_writes(ctx)
    loc = db.scalar(scoped(Location, ctx).where(Location.id == location_id))
    if loc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Location not found")
    for k, v in data.model_dump().items():
        setattr(loc, k, v)
    audit.record(db, action="location.updated", company_id=ctx.company_id, actor_user_id=ctx.user.id,
                 entity_type="location", entity_id=loc.id, request=request)
    db.commit()
    return LocationOut.model_validate(loc)


@router.delete("/locations/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(location_id: str, request: Request,
                    ctx: TenantContext = Depends(require(Perm.COMPANY_UPDATE)), db: Session = Depends(get_db)):
    _block_demo_writes(ctx)
    loc = db.scalar(scoped(Location, ctx).where(Location.id == location_id))
    if loc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Location not found")
    if loc.kind == "headquarters" and len(db.scalars(scoped(Location, ctx).where(Location.kind == "headquarters")).all()) <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "A company must keep at least one headquarters")
    db.delete(loc)
    audit.record(db, action="location.deleted", company_id=ctx.company_id, actor_user_id=ctx.user.id,
                 entity_type="location", entity_id=location_id, request=request)
    db.commit()
