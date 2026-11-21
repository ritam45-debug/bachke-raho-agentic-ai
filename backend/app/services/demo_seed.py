"""Seeds the SIMULATED Aureon Electronics demo workspace from sample_data/aureon/*.csv (idempotent)."""
from __future__ import annotations

import csv
import logging
import os
import secrets
from datetime import timedelta
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import Company, CompanyProfile, Disruption, InventoryItem, Location, Product, Shipment, Supplier, User
from app.models.base import Role, utcnow
from app.security.passwords import hash_password
from app.services import audit

log = logging.getLogger("bachke.seed")

DEMO_SLUG = "aureon-electronics-demo"
DEMO_USER_EMAIL = "demo.analyst@aureon-demo.invalid"
DEMO_ADMIN_EMAIL = "demo.admin@aureon-demo.invalid"
SIM = "simulated"


def _data_dir() -> Path:
    env = os.getenv("SAMPLE_DATA_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[3] / "sample_data" / "aureon"


def _rows(name: str) -> list[dict]:
    with open(_data_dir() / name, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _f(v: str) -> float | None:
    return float(v) if v not in ("", None) else None


def seed_demo(db: Session) -> Company:
    existing = db.scalar(select(Company).where(Company.slug == DEMO_SLUG))
    if existing:
        return existing

    if db.bind is not None and db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT set_config('app.bypass_rls', 'on', true)"))  # trusted server-side seed only
    now = utcnow()
    day = lambda off: now + timedelta(days=float(off))  # noqa: E731

    c = Company(name="Aureon Electronics Pvt. Ltd. (Demo)", slug=DEMO_SLUG, industry="Electronics manufacturing",
                company_size="1001-5000", headquarters="Pune, India", country="India", is_demo=True,
                registration_number="SIMULATED-U00000MH2015PTC000000")
    db.add(c)
    db.flush()
    db.add(CompanyProfile(
        company_id=c.id, currency="INR", website=None,
        description="SIMULATED demo company. Consumer and industrial electronics maker with three plants, "
                    "three warehouses and a distribution centre in India, sourcing components from Asia, Europe and Mexico.",
        product_categories=["Energy devices", "Portable power", "Audio", "Smart home", "EV infrastructure"],
        admin_contact_name="Demo Administrator", admin_contact_email=DEMO_ADMIN_EMAIL))

    locs = {}
    for r in _rows("locations.csv"):
        loc = Location(company_id=c.id, name=r["name"], kind=r["kind"], city=r["city"], country=r["country"],
                       latitude=_f(r["latitude"]), longitude=_f(r["longitude"]),
                       capacity_units=int(r["capacity_units"]) if r["capacity_units"] else None)
        db.add(loc)
        locs[r["name"]] = loc
    sups = {}
    for r in _rows("suppliers.csv"):
        s = Supplier(company_id=c.id, code=r["code"], name=r["name"], category=r["category"], country=r["country"],
                     city=r["city"], on_time_delivery_rate=_f(r["on_time_delivery_rate"]),
                     quality_score=_f(r["quality_score"]), avg_lead_time_days=_f(r["avg_lead_time_days"]),
                     annual_spend=_f(r["annual_spend"]), data_source=SIM)
        db.add(s)
        sups[r["code"]] = s
    db.flush()
    prods = {}
    for r in _rows("products.csv"):
        p = Product(company_id=c.id, sku=r["sku"], name=r["name"], kind=r["kind"], category=r["category"], unit=r["unit"],
                    unit_cost=float(r["unit_cost"]), unit_price=_f(r["unit_price"]),
                    primary_supplier_id=sups[r["primary_supplier_code"]].id if r["primary_supplier_code"] else None,
                    data_source=SIM)
        db.add(p)
        prods[r["sku"]] = p
    db.flush()
    for r in _rows("inventory.csv"):
        db.add(InventoryItem(company_id=c.id, product_id=prods[r["sku"]].id, location_id=locs[r["location"]].id,
                             quantity_on_hand=float(r["quantity_on_hand"]), reorder_point=float(r["reorder_point"]),
                             safety_stock=float(r["safety_stock"]), avg_daily_demand=float(r["avg_daily_demand"]),
                             lead_time_days=float(r["lead_time_days"]), last_movement_at=day(r["last_movement_offset_days"]),
                             data_source=SIM))
    for r in _rows("shipments.csv"):
        db.add(Shipment(company_id=c.id, reference=r["reference"], direction=r["direction"],
                        supplier_id=sups[r["supplier_code"]].id if r["supplier_code"] else None,
                        product_id=prods[r["sku"]].id, quantity=float(r["quantity"]), value=float(r["value"]),
                        origin=r["origin"], origin_country=r["origin_country"], destination=r["destination"],
                        mode=r["mode"], carrier=r["carrier"], status=r["status"],
                        departed_at=day(r["departed_offset_days"]) if float(r["departed_offset_days"]) <= 0 else None,
                        original_eta=day(r["original_eta_offset_days"]), current_eta=day(r["current_eta_offset_days"]),
                        delivered_at=day(r["current_eta_offset_days"]) if r["status"] == "delivered" else None,
                        data_source=SIM))
    for r in _rows("disruptions.csv"):
        db.add(Disruption(company_id=c.id, title=r["title"], category=r["category"], severity=int(r["severity"]),
                          status=r["status"], verification="simulated",
                          affected_countries=[x for x in r["affected_countries"].split(";") if x],
                          affected_supplier_ids=[sups[x].id for x in r["affected_supplier_codes"].split(";") if x],
                          summary=r["summary"], source_name="Simulation engine (demo data)",
                          detected_at=day(r["detected_offset_days"]),
                          resolved_at=day(r["resolved_offset_days"]) if r["resolved_offset_days"] else None))

    # Demo users get random, never-disclosed passwords; the demo analyst is reached only via POST /auth/demo.
    for email, name, role in [(DEMO_USER_EMAIL, "Demo Analyst", Role.ANALYST.value),
                              (DEMO_ADMIN_EMAIL, "Demo Administrator", Role.COMPANY_ADMIN.value)]:
        db.add(User(company_id=c.id, email=email, full_name=name, role=role, job_title="Simulated user",
                    password_hash=hash_password(secrets.token_urlsafe(24) + "!1a")))
    audit.record(db, action="demo.seeded", company_id=c.id, actor_type="system", entity_type="company", entity_id=c.id)
    db.commit()
    log.info("Seeded simulated demo workspace %s", c.slug)
    return c
