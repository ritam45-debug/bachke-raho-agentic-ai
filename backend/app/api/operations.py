"""Read APIs for the operational data the dashboard shows. Imports and deletes live in data_import.py."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.analytics.inventory_metrics import days_of_cover, stock_status
from app.database.session import get_db
from app.models import Disruption, InventoryItem, Location, Product, Shipment, Supplier
from app.security.deps import TenantContext, require
from app.security.rbac import Perm
from app.services.tenant_repo import scoped

router = APIRouter(tags=["operations"])
_ops = require(Perm.OPS_READ)


@router.get("/suppliers")
def suppliers(ctx: TenantContext = Depends(_ops), db: Session = Depends(get_db)):
    rows = db.scalars(scoped(Supplier, ctx).order_by(Supplier.name)).all()
    return [{
        "id": s.id, "code": s.code, "name": s.name, "category": s.category, "country": s.country, "city": s.city,
        "on_time_delivery_rate": s.on_time_delivery_rate, "quality_score": s.quality_score,
        "avg_lead_time_days": s.avg_lead_time_days, "annual_spend": s.annual_spend,
        "financial_stability_score": s.financial_stability_score, "risk_exposure_score": s.risk_exposure_score,
        "capacity_units_per_month": s.capacity_units_per_month, "moq_units": s.moq_units,
        "is_active": s.is_active, "data_source": s.data_source,
    } for s in rows]


@router.get("/products")
def products(ctx: TenantContext = Depends(_ops), db: Session = Depends(get_db)):
    sup = {s.id: s.name for s in db.scalars(scoped(Supplier, ctx))}
    return [{
        "id": p.id, "sku": p.sku, "name": p.name, "kind": p.kind, "category": p.category, "unit": p.unit,
        "unit_cost": p.unit_cost, "unit_price": p.unit_price, "conversion_cost": p.conversion_cost,
        "primary_supplier_id": p.primary_supplier_id,
        "primary_supplier": sup.get(p.primary_supplier_id), "data_source": p.data_source,
    } for p in db.scalars(scoped(Product, ctx).order_by(Product.kind, Product.sku))]


@router.get("/inventory")
def inventory(status: str | None = Query(default=None), ctx: TenantContext = Depends(_ops), db: Session = Depends(get_db)):
    prods = {p.id: p for p in db.scalars(scoped(Product, ctx))}
    locs = {loc.id: loc for loc in db.scalars(scoped(Location, ctx))}
    out = []
    for i in db.scalars(scoped(InventoryItem, ctx)):
        p, loc = prods.get(i.product_id), locs.get(i.location_id)
        st = stock_status(i.quantity_on_hand, i.reorder_point, i.safety_stock, i.avg_daily_demand, i.lead_time_days)
        if status and st != status:
            continue
        cover = days_of_cover(i.quantity_on_hand, i.avg_daily_demand)
        out.append({
            "id": i.id, "sku": p.sku if p else None, "product": p.name if p else None, "kind": p.kind if p else None,
            "location": loc.name if loc else None, "quantity_on_hand": i.quantity_on_hand,
            "reorder_point": i.reorder_point, "safety_stock": i.safety_stock, "avg_daily_demand": i.avg_daily_demand,
            "lead_time_days": i.lead_time_days, "days_of_cover": round(cover, 1) if cover is not None else None,
            "stock_value": round(i.quantity_on_hand * (p.unit_cost if p else 0), 2), "status": st,
            "data_source": i.data_source,
        })
    return sorted(out, key=lambda r: (["stockout", "critical", "reorder", "healthy", "excess"].index(r["status"]), r["sku"] or ""))


@router.get("/shipments")
def shipments(status: str | None = Query(default=None), ctx: TenantContext = Depends(_ops), db: Session = Depends(get_db)):
    sup = {s.id: s.name for s in db.scalars(scoped(Supplier, ctx))}
    prods = {p.id: p.name for p in db.scalars(scoped(Product, ctx))}
    q = scoped(Shipment, ctx)
    if status:
        q = q.where(Shipment.status == status)
    out = []
    for s in db.scalars(q.order_by(Shipment.current_eta)):
        delay = None
        if s.original_eta and s.current_eta:
            delay = round((s.current_eta - s.original_eta).total_seconds() / 86400, 1)
        out.append({
            "id": s.id, "reference": s.reference, "direction": s.direction, "supplier": sup.get(s.supplier_id),
            "product": prods.get(s.product_id), "quantity": s.quantity, "value": s.value, "freight_cost": s.freight_cost, "origin": s.origin,
            "origin_country": s.origin_country, "destination": s.destination, "mode": s.mode, "carrier": s.carrier,
            "status": s.status, "departed_at": s.departed_at, "original_eta": s.original_eta,
            "current_eta": s.current_eta, "delivered_at": s.delivered_at, "delay_days": delay, "data_source": s.data_source,
        })
    return out


@router.get("/disruptions")
def disruptions(ctx: TenantContext = Depends(_ops), db: Session = Depends(get_db)):
    sup = {s.id: s.name for s in db.scalars(scoped(Supplier, ctx))}
    return [{
        "id": d.id, "title": d.title, "category": d.category, "severity": d.severity, "status": d.status,
        "verification": d.verification, "affected_countries": d.affected_countries,
        "affected_suppliers": [sup[x] for x in (d.affected_supplier_ids or []) if x in sup],
        "summary": d.summary, "source_name": d.source_name, "source_url": d.source_url,
        "detected_at": d.detected_at, "resolved_at": d.resolved_at,
    } for d in db.scalars(scoped(Disruption, ctx).order_by(Disruption.detected_at.desc()))]
