from __future__ import annotations

from collections import Counter, defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.analytics.inventory_metrics import stock_status
from app.database.session import get_db
from app.models import CompanyProfile, Disruption, InventoryItem, Location, Product, Route, RouteRiskCheck, Shipment, Supplier
from app.security.deps import TenantContext, require
from app.security.rbac import Perm
from app.services.tenant_repo import scoped

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# Rule-based thresholds (documented in documentation/ARCHITECTURE.md §8). Not probabilities.
LOW_OTD = 0.85
LOW_QUALITY = 80.0


@router.get("/overview")
def overview(ctx: TenantContext = Depends(require(Perm.OPS_READ)), db: Session = Depends(get_db)):
    prods = {p.id: p for p in db.scalars(scoped(Product, ctx))}
    locs = {loc.id: loc for loc in db.scalars(scoped(Location, ctx))}
    inv = list(db.scalars(scoped(InventoryItem, ctx)))
    ships = list(db.scalars(scoped(Shipment, ctx)))
    sups = list(db.scalars(scoped(Supplier, ctx)))
    disr = list(db.scalars(scoped(Disruption, ctx)))

    status_counts: Counter = Counter()
    value_by_loc: dict[str, float] = defaultdict(float)
    total_value = 0.0
    for i in inv:
        p = prods.get(i.product_id)
        v = i.quantity_on_hand * (p.unit_cost if p else 0)
        total_value += v
        value_by_loc[locs[i.location_id].name if i.location_id in locs else "Unknown"] += v
        status_counts[stock_status(i.quantity_on_hand, i.reorder_point, i.safety_stock, i.avg_daily_demand, i.lead_time_days)] += 1

    ship_status = Counter(s.status for s in ships)
    open_ships = [s for s in ships if s.status in ("planned", "in_transit", "delayed")]
    delayed_value = sum(s.value for s in ships if s.status == "delayed")
    active_disr = [d for d in disr if d.status != "resolved"]
    flagged = [s for s in sups if (s.on_time_delivery_rate or 1) < LOW_OTD or (s.quality_score or 100) < LOW_QUALITY]
    has_sim = any(x.data_source == "simulated" for x in [*inv, *ships, *sups])
    routes = list(db.scalars(scoped(Route, ctx)))
    latest: dict[str, RouteRiskCheck] = {}
    for c in db.scalars(scoped(RouteRiskCheck, ctx).order_by(RouteRiskCheck.checked_at)):
        latest[c.route_id] = c
    loc_list = list(locs.values())

    return {
        "data_mode": "simulated" if has_sim else "company_data",
        "currency": (db.scalar(scoped(CompanyProfile, ctx)).currency if db.scalar(scoped(CompanyProfile, ctx)) else "INR"),
        "kpis": {
            "inventory_value": round(total_value, 2),
            "sku_locations": len(inv),
            "at_risk_stock_positions": status_counts["stockout"] + status_counts["critical"],
            "reorder_needed": status_counts["reorder"],
            "open_shipments": len(open_ships),
            "delayed_shipments": ship_status["delayed"],
            "delayed_shipment_value": round(delayed_value, 2),
            "active_disruptions": len(active_disr),
            "max_active_severity": max((d.severity for d in active_disr), default=0),
            "suppliers": len(sups),
            "flagged_suppliers": len(flagged),
            "locations": len(loc_list),
            "locations_mapped": sum(1 for x in loc_list if x.latitude is not None and x.longitude is not None),
            "routes": len(routes),
            "routes_checked": sum(1 for r in routes if r.id in latest),
            "routes_elevated_or_high": sum(1 for r in routes if r.id in latest and latest[r.id].score >= 50),
            "max_route_score": max((latest[r.id].score for r in routes if r.id in latest), default=0),
            "last_route_check_at": max((latest[r.id].checked_at for r in routes if r.id in latest), default=None),
        },
        "route_risks": sorted([
            {"id": r.id, "name": r.name, "mode": r.mode, "score": latest[r.id].score, "band": latest[r.id].band,
             "checked_at": latest[r.id].checked_at,
             "top_factor": max(latest[r.id].factors, key=lambda f: f.get("points", 0))["detail"] if latest[r.id].factors else None}
            for r in routes if r.id in latest], key=lambda x: -x["score"])[:8],
        "charts": {
            "inventory_status": [{"status": k, "count": status_counts.get(k, 0)}
                                 for k in ["stockout", "critical", "reorder", "healthy", "excess"]],
            "inventory_value_by_location": sorted(
                [{"location": k, "value": round(v, 2)} for k, v in value_by_loc.items()], key=lambda r: -r["value"]),
            "shipment_status": [{"status": k, "count": ship_status.get(k, 0)}
                                for k in ["planned", "in_transit", "delayed", "delivered", "cancelled"]],
            "supplier_performance": sorted([
                {"supplier": s.name, "country": s.country,
                 "on_time_pct": round((s.on_time_delivery_rate or 0) * 100, 1), "quality": s.quality_score}
                for s in sups], key=lambda r: r["on_time_pct"]),
        },
        "active_disruptions": [
            {"id": d.id, "title": d.title, "severity": d.severity, "verification": d.verification,
             "category": d.category, "affected_countries": d.affected_countries}
            for d in sorted(active_disr, key=lambda d: -d.severity)],
        "rules": {"flagged_supplier": f"on-time delivery < {int(LOW_OTD*100)}% or quality < {LOW_QUALITY:.0f}",
                  "severity_note": "Severity is a rule-based 0–100 score, not a statistical probability."},
    }
