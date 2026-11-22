"""Phase 4 API: vendor-scoring weights, finance settings and saved scenarios, bills of materials."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import BomLine, FinanceSettings, FinancialScenario, Product, VendorWeightProfile
from app.models.base import utcnow
from app.models.phase4 import DEFAULT_FINANCE, DEFAULT_WEIGHTS
from app.security.deps import TenantContext, get_tenant, require
from app.security.rbac import Perm
from app.services import audit
from app.services.tenant_repo import get_owned, scoped

router = APIRouter(tags=["vendors, finance & lifecycle"])


def _any(ctx: TenantContext, *perms: Perm) -> None:
    if not any(ctx.can(p) for p in perms):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Missing permission: {' or '.join(p.value for p in perms)}")


# ---------------- vendor-scoring weights ----------------
class Weights(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cost: float = Field(ge=0, le=100)
    quality: float = Field(ge=0, le=100)
    reliability: float = Field(ge=0, le=100)
    lead_time: float = Field(ge=0, le=100)
    financial: float = Field(ge=0, le=100)
    risk: float = Field(ge=0, le=100)

    @model_validator(mode="after")
    def _sum(self):
        total = sum(self.model_dump().values())
        if abs(total - 100) > 0.001:
            raise ValueError(f"Weights must total 100% (currently {total:g}%)")
        return self


@router.get("/vendor-scoring/weights")
def get_weights(ctx: TenantContext = Depends(require(Perm.OPS_READ)), db: Session = Depends(get_db)):
    p = db.scalar(scoped(VendorWeightProfile, ctx))
    return {"weights": p.weights if p else DEFAULT_WEIGHTS, "is_default": p is None, "defaults": DEFAULT_WEIGHTS,
            "updated_at": p.updated_at if p else None}


@router.put("/vendor-scoring/weights")
def put_weights(data: Weights, request: Request, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    _any(ctx, Perm.COMPANY_UPDATE, Perm.PROCUREMENT_WRITE)
    p = db.scalar(scoped(VendorWeightProfile, ctx))
    if p is None:
        p = VendorWeightProfile(company_id=ctx.company_id, weights={})
        db.add(p)
    p.weights, p.updated_by, p.updated_at = data.model_dump(), ctx.user.id, utcnow()
    audit.record(db, action="vendor_weights.updated", company_id=ctx.company_id, actor_user_id=ctx.user.id, request=request, details=data.model_dump())
    db.commit()
    return {"weights": p.weights, "is_default": False, "defaults": DEFAULT_WEIGHTS, "updated_at": p.updated_at}


# ---------------- finance settings & scenarios ----------------
class FinanceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    carrying_cost_pct: float = Field(ge=0, le=100)
    revenue_per_day: float | None = Field(default=None, ge=0)
    gross_margin_pct: float | None = Field(default=None, ge=-100, le=100)
    downtime_cost_per_day: float | None = Field(default=None, ge=0)


@router.get("/finance/settings")
def get_finance(ctx: TenantContext = Depends(require(Perm.FINANCE_READ)), db: Session = Depends(get_db)):
    f = db.scalar(scoped(FinanceSettings, ctx))
    return {"settings": {**DEFAULT_FINANCE, **(f.settings if f else {})}, "is_default": f is None}


@router.put("/finance/settings")
def put_finance(data: FinanceIn, request: Request, ctx: TenantContext = Depends(require(Perm.FINANCE_WRITE)), db: Session = Depends(get_db)):
    f = db.scalar(scoped(FinanceSettings, ctx))
    if f is None:
        f = FinanceSettings(company_id=ctx.company_id, settings={})
        db.add(f)
    f.settings, f.updated_by, f.updated_at = data.model_dump(), ctx.user.id, utcnow()
    audit.record(db, action="finance_settings.updated", company_id=ctx.company_id, actor_user_id=ctx.user.id, request=request, details=data.model_dump())
    db.commit()
    return {"settings": f.settings, "is_default": False}


class ScenarioIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=160)
    kind: Literal["disruption_impact", "mitigation_roi", "holding_cost", "vendor_scoring"]
    inputs: dict = Field(default_factory=dict)
    results: dict = Field(default_factory=dict)
    notes: str | None = Field(default=None, max_length=4000)


def _scen(s: FinancialScenario) -> dict:
    return {k: getattr(s, k) for k in ("id", "name", "kind", "inputs", "results", "notes", "created_by", "created_at")}


@router.get("/finance/scenarios")
def list_scenarios(ctx: TenantContext = Depends(require(Perm.FINANCE_READ)), db: Session = Depends(get_db)):
    return [_scen(s) for s in db.scalars(scoped(FinancialScenario, ctx).order_by(FinancialScenario.created_at.desc()).limit(200))]


@router.post("/finance/scenarios", status_code=status.HTTP_201_CREATED)
def save_scenario(data: ScenarioIn, request: Request, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    # vendor-scoring snapshots may be saved by procurement; financial scenarios need finance:write
    _any(ctx, Perm.FINANCE_WRITE, *( (Perm.PROCUREMENT_WRITE,) if data.kind == "vendor_scoring" else ()))
    s = FinancialScenario(company_id=ctx.company_id, created_by=ctx.user.id, **data.model_dump())
    db.add(s)
    db.flush()
    audit.record(db, action="scenario.saved", company_id=ctx.company_id, actor_user_id=ctx.user.id, entity_type="financial_scenario",
                 entity_id=s.id, request=request, details={"name": s.name, "kind": s.kind})
    db.commit()
    return _scen(s)


@router.delete("/finance/scenarios/{sid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scenario(sid: str, request: Request, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    _any(ctx, Perm.FINANCE_WRITE, Perm.PROCUREMENT_WRITE)
    s = get_owned(db, FinancialScenario, sid, ctx)
    db.delete(s)
    audit.record(db, action="scenario.deleted", company_id=ctx.company_id, actor_user_id=ctx.user.id, entity_type="financial_scenario",
                 entity_id=sid, request=request)
    db.commit()


# ---------------- bills of materials ----------------
class BomIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    parent_sku: str = Field(min_length=1, max_length=60)
    component_sku: str = Field(min_length=1, max_length=60)
    quantity_per_unit: float = Field(gt=0, le=1_000_000)


class BomBulk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[BomIn] = Field(min_length=1, max_length=2000)


def _bom_out(b: BomLine, prods: dict) -> dict:
    p, c = prods.get(b.parent_product_id), prods.get(b.component_product_id)
    return {"id": b.id, "parent_product_id": b.parent_product_id, "parent_sku": p.sku if p else None,
            "component_product_id": b.component_product_id, "component_sku": c.sku if c else None,
            "component_name": c.name if c else None, "quantity_per_unit": b.quantity_per_unit}


@router.get("/bom")
def list_bom(ctx: TenantContext = Depends(require(Perm.OPS_READ)), db: Session = Depends(get_db)):
    prods = {p.id: p for p in db.scalars(scoped(Product, ctx))}
    return [_bom_out(b, prods) for b in db.scalars(scoped(BomLine, ctx))]


@router.post("/bom/bulk")
def import_bom(data: BomBulk, request: Request, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    """Add or update BOM lines (by parent + component). All rows are validated before anything is saved."""
    _any(ctx, Perm.OPS_WRITE, Perm.PROCUREMENT_WRITE)
    prods = {p.sku: p for p in db.scalars(scoped(Product, ctx))}
    errors = []
    for i, r in enumerate(data.rows, 1):
        p, c = prods.get(r.parent_sku), prods.get(r.component_sku)
        if p is None or c is None:
            errors.append(f"Row {i}: unknown SKU '{r.parent_sku if p is None else r.component_sku}'")
        elif p.kind != "finished_good":
            errors.append(f"Row {i}: parent '{p.sku}' must be a finished_good")
        elif c.kind == "finished_good":
            errors.append(f"Row {i}: component '{c.sku}' must be a raw_material or component")
        elif p.id == c.id:
            errors.append(f"Row {i}: a product cannot contain itself")
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "; ".join(errors[:10]))
    existing = {(b.parent_product_id, b.component_product_id): b for b in db.scalars(scoped(BomLine, ctx))}
    created = updated = 0
    for r in data.rows:
        key = (prods[r.parent_sku].id, prods[r.component_sku].id)
        if key in existing:
            existing[key].quantity_per_unit = r.quantity_per_unit
            updated += 1
        else:
            existing[key] = BomLine(company_id=ctx.company_id, parent_product_id=key[0], component_product_id=key[1], quantity_per_unit=r.quantity_per_unit)
            db.add(existing[key])
            created += 1
    audit.record(db, action="bom.imported", company_id=ctx.company_id, actor_user_id=ctx.user.id, entity_type="bom", request=request,
                 details={"created": created, "updated": updated})
    db.commit()
    return {"created": created, "updated": updated}


@router.delete("/bom/{bid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bom(bid: str, request: Request, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    _any(ctx, Perm.OPS_WRITE, Perm.PROCUREMENT_WRITE)
    b = get_owned(db, BomLine, bid, ctx)
    db.delete(b)
    audit.record(db, action="bom.deleted", company_id=ctx.company_id, actor_user_id=ctx.user.id, entity_type="bom", entity_id=bid, request=request)
    db.commit()

