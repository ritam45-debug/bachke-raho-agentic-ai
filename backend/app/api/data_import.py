"""Phase 3: bulk import (CSV → JSON from the UI) and deletion of suppliers, products, inventory and shipments.

Every import is all-or-nothing: rows are validated first, then upserted by their natural key (supplier code,
product SKU, product+location, shipment reference). Imported rows are marked data_source='upload'.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import InventoryItem, Location, Product, Shipment, Supplier
from app.security.deps import TenantContext, get_tenant
from app.security.rbac import Perm
from app.services import audit
from app.services.tenant_repo import get_owned, scoped

router = APIRouter(tags=["data import"])
MAX_ROWS = 2000


class _Row(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


def _pct01(v):
    """Accept 0.93, 93 or '93%' for rates; store 0..1."""
    if v in (None, ""):
        return None
    f = float(str(v).rstrip("%"))
    return f / 100 if f > 1 else f


class SupplierRow(_Row):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=2, max_length=200)
    category: str = Field(min_length=1, max_length=120)
    country: str = Field(min_length=2, max_length=80)
    city: str | None = Field(default=None, max_length=120)
    on_time_delivery_rate: float | None = Field(default=None, ge=0, le=1)
    quality_score: float | None = Field(default=None, ge=0, le=100)
    avg_lead_time_days: float | None = Field(default=None, ge=0, le=730)
    annual_spend: float | None = Field(default=None, ge=0)
    financial_stability_score: float | None = Field(default=None, ge=0, le=100)
    risk_exposure_score: float | None = Field(default=None, ge=0, le=100)
    capacity_units_per_month: float | None = Field(default=None, ge=0)
    moq_units: float | None = Field(default=None, ge=0)
    _otd = field_validator("on_time_delivery_rate", mode="before")(lambda v: _pct01(v))


class ProductRow(_Row):
    sku: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=2, max_length=200)
    kind: Literal["raw_material", "component", "finished_good"]
    category: str = Field(min_length=1, max_length=120)
    unit: str = Field(default="unit", max_length=20)
    unit_cost: float = Field(ge=0)
    unit_price: float | None = Field(default=None, ge=0)
    conversion_cost: float | None = Field(default=None, ge=0)
    primary_supplier_code: str | None = Field(default=None, max_length=40)


class InventoryRow(_Row):
    sku: str = Field(min_length=1, max_length=60)
    location: str = Field(min_length=1, max_length=160)
    quantity_on_hand: float = Field(ge=0)
    avg_daily_demand: float = Field(ge=0)
    lead_time_days: float | None = Field(default=None, ge=0, le=730)
    safety_stock: float | None = Field(default=None, ge=0)
    reorder_point: float | None = Field(default=None, ge=0)


class ShipmentRow(_Row):
    reference: str = Field(min_length=1, max_length=60)
    direction: Literal["inbound", "outbound"]
    supplier_code: str | None = Field(default=None, max_length=40)
    sku: str | None = Field(default=None, max_length=60)
    quantity: float = Field(ge=0)
    value: float = Field(ge=0)
    freight_cost: float | None = Field(default=None, ge=0)
    origin: str = Field(min_length=1, max_length=160)
    origin_country: str = Field(min_length=2, max_length=80)
    destination: str = Field(min_length=1, max_length=160)
    mode: Literal["sea", "air", "road", "rail"]
    carrier: str | None = Field(default=None, max_length=120)
    status: Literal["planned", "in_transit", "delayed", "delivered", "cancelled"]
    departed_at: datetime | None = None
    original_eta: datetime | None = None
    current_eta: datetime | None = None
    delivered_at: datetime | None = None

    @field_validator("departed_at", "original_eta", "current_eta", "delivered_at", mode="before")
    @classmethod
    def _blank(cls, v):
        return None if v in ("", None) else v


class BulkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[dict] = Field(min_length=1, max_length=MAX_ROWS)


def _need_any(ctx: TenantContext, *perms: Perm) -> None:
    if not any(ctx.can(p) for p in perms):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Missing permission: {' or '.join(p.value for p in perms)}")


def _parse(model: type[_Row], rows: list[dict]) -> list:
    out, errors = [], []
    for i, r in enumerate(rows, start=1):
        try:
            out.append(model.model_validate(r))
        except ValidationError as e:
            first = e.errors()[0]
            errors.append(f"Row {i}: {'.'.join(str(x) for x in first['loc'])} – {first['msg']}")
        if len(errors) >= 10:
            break
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "; ".join(errors))
    return out


def _done(db: Session, ctx: TenantContext, request: Request, entity: str, created: int, updated: int) -> dict:
    audit.record(db, action=f"{entity}.imported", company_id=ctx.company_id, actor_user_id=ctx.user.id, entity_type=entity,
                 request=request, details={"created": created, "updated": updated})
    db.commit()
    return {"created": created, "updated": updated}


@router.post("/suppliers/bulk")
def import_suppliers(data: BulkIn, request: Request, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    _need_any(ctx, Perm.OPS_WRITE, Perm.PROCUREMENT_WRITE)
    rows = _parse(SupplierRow, data.rows)
    existing = {s.code: s for s in db.scalars(scoped(Supplier, ctx))}
    created = updated = 0
    for r in rows:
        vals = r.model_dump()
        if r.code in existing:
            for k, v in vals.items():
                if v is not None:
                    setattr(existing[r.code], k, v)
            existing[r.code].data_source = "upload"
            updated += 1
        else:
            existing[r.code] = Supplier(company_id=ctx.company_id, data_source="upload", **vals)
            db.add(existing[r.code])
            created += 1
    return _done(db, ctx, request, "supplier", created, updated)


@router.post("/products/bulk")
def import_products(data: BulkIn, request: Request, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    _need_any(ctx, Perm.OPS_WRITE, Perm.PROCUREMENT_WRITE)
    rows = _parse(ProductRow, data.rows)
    sup = {s.code: s.id for s in db.scalars(scoped(Supplier, ctx))}
    missing = sorted({r.primary_supplier_code for r in rows if r.primary_supplier_code and r.primary_supplier_code not in sup})
    if missing:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown supplier code(s): {', '.join(missing[:10])}. Import suppliers first.")
    existing = {p.sku: p for p in db.scalars(scoped(Product, ctx))}
    created = updated = 0
    for r in rows:
        vals = r.model_dump(exclude={"primary_supplier_code"})
        vals["primary_supplier_id"] = sup.get(r.primary_supplier_code) if r.primary_supplier_code else None
        if r.sku in existing:
            for k, v in vals.items():
                if v is not None:
                    setattr(existing[r.sku], k, v)
            existing[r.sku].data_source = "upload"
            updated += 1
        else:
            existing[r.sku] = Product(company_id=ctx.company_id, data_source="upload", **vals)
            db.add(existing[r.sku])
            created += 1
    return _done(db, ctx, request, "product", created, updated)


@router.post("/inventory/bulk")
def import_inventory(data: BulkIn, request: Request, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    _need_any(ctx, Perm.OPS_WRITE)
    rows = _parse(InventoryRow, data.rows)
    prods = {p.sku: p for p in db.scalars(scoped(Product, ctx))}
    locs = {loc.name.lower(): loc for loc in db.scalars(scoped(Location, ctx))}
    sups = {s.id: s for s in db.scalars(scoped(Supplier, ctx))}
    bad = [f"Row {i}: unknown SKU '{r.sku}'" for i, r in enumerate(rows, 1) if r.sku not in prods][:5]
    bad += [f"Row {i}: unknown location '{r.location}'" for i, r in enumerate(rows, 1) if r.location.lower() not in locs][:5]
    if bad:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "; ".join(bad) + ". Import products and add locations first.")
    existing = {(i.product_id, i.location_id): i for i in db.scalars(scoped(InventoryItem, ctx))}
    created = updated = 0
    for r in rows:
        p, loc = prods[r.sku], locs[r.location.lower()]
        sup = sups.get(p.primary_supplier_id) if p.primary_supplier_id else None
        lead = r.lead_time_days if r.lead_time_days is not None else (sup.avg_lead_time_days if sup and sup.avg_lead_time_days else 0)
        ss = r.safety_stock if r.safety_stock is not None else 0.0
        rop = r.reorder_point if r.reorder_point is not None else r.avg_daily_demand * lead + ss  # ROP = d·L + SS
        vals = {"quantity_on_hand": r.quantity_on_hand, "avg_daily_demand": r.avg_daily_demand, "lead_time_days": lead,
                "safety_stock": ss, "reorder_point": rop, "data_source": "upload"}
        key = (p.id, loc.id)
        if key in existing:
            for k, v in vals.items():
                setattr(existing[key], k, v)
            updated += 1
        else:
            existing[key] = InventoryItem(company_id=ctx.company_id, product_id=p.id, location_id=loc.id, **vals)
            db.add(existing[key])
            created += 1
    return _done(db, ctx, request, "inventory", created, updated)


@router.post("/shipments/bulk")
def import_shipments(data: BulkIn, request: Request, ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    _need_any(ctx, Perm.OPS_WRITE)
    rows = _parse(ShipmentRow, data.rows)
    sup = {s.code: s.id for s in db.scalars(scoped(Supplier, ctx))}
    prods = {p.sku: p.id for p in db.scalars(scoped(Product, ctx))}
    bad = [f"Row {i}: unknown supplier '{r.supplier_code}'" for i, r in enumerate(rows, 1) if r.supplier_code and r.supplier_code not in sup][:5]
    bad += [f"Row {i}: unknown SKU '{r.sku}'" for i, r in enumerate(rows, 1) if r.sku and r.sku not in prods][:5]
    if bad:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "; ".join(bad))
    existing = {s.reference: s for s in db.scalars(scoped(Shipment, ctx))}
    created = updated = 0
    for r in rows:
        vals = r.model_dump(exclude={"supplier_code", "sku"})
        vals["supplier_id"] = sup.get(r.supplier_code) if r.supplier_code else None
        vals["product_id"] = prods.get(r.sku) if r.sku else None
        vals["current_eta"] = vals["current_eta"] or vals["original_eta"]
        if r.reference in existing:
            for k, v in vals.items():
                setattr(existing[r.reference], k, v)
            existing[r.reference].data_source = "upload"
            updated += 1
        else:
            existing[r.reference] = Shipment(company_id=ctx.company_id, data_source="upload", **vals)
            db.add(existing[r.reference])
            created += 1
    return _done(db, ctx, request, "shipment", created, updated)


_DELETE = {"suppliers": (Supplier, (Perm.OPS_WRITE, Perm.PROCUREMENT_WRITE)), "products": (Product, (Perm.OPS_WRITE, Perm.PROCUREMENT_WRITE)),
           "inventory": (InventoryItem, (Perm.OPS_WRITE,)), "shipments": (Shipment, (Perm.OPS_WRITE,))}


@router.delete("/{entity}/{obj_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_row(entity: Literal["suppliers", "products", "inventory", "shipments"], obj_id: str, request: Request,
               ctx: TenantContext = Depends(get_tenant), db: Session = Depends(get_db)):
    model, perms = _DELETE[entity]
    _need_any(ctx, *perms)
    obj = get_owned(db, model, obj_id, ctx)
    db.delete(obj)
    audit.record(db, action=f"{entity}.deleted", company_id=ctx.company_id, actor_user_id=ctx.user.id, entity_type=entity,
                 entity_id=obj_id, request=request)
    db.commit()
