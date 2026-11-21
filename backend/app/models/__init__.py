"""ORM models. Every tenant-owned table carries a NOT NULL company_id (TenantMixin)."""
from app.models.base import Role, TenantMixin, new_id, utcnow
from app.models.routes import Route, RouteRiskCheck
from app.models.supply_chain import Disruption, InventoryItem, Product, Shipment, Supplier
from app.models.tenancy import AuditLog, Company, CompanyProfile, Location, User, UserSession

__all__ = [
    "Role", "TenantMixin", "new_id", "utcnow",
    "Company", "CompanyProfile", "Location", "User", "UserSession", "AuditLog",
    "Supplier", "Product", "InventoryItem", "Shipment", "Disruption", "Route", "RouteRiskCheck",
]

# Tables protected by PostgreSQL Row-Level Security (see migrations).
TENANT_TABLES = [
    "company_profiles", "locations", "suppliers", "products",
    "inventory_items", "shipments", "disruptions", "routes", "route_risk_checks",
]
