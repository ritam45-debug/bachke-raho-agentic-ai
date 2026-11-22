"""ORM models. Every tenant-owned table carries a NOT NULL company_id (TenantMixin)."""
from app.models.ai import AgentRun, AgentStep, AIConversation, AIMessage
from app.models.base import Role, TenantMixin, new_id, utcnow
from app.models.phase4 import BomLine, FinanceSettings, FinancialScenario, VendorWeightProfile
from app.models.routes import Route, RouteRiskCheck
from app.models.supply_chain import Disruption, InventoryItem, Product, Shipment, Supplier
from app.models.tenancy import AuditLog, Company, CompanyProfile, Location, User, UserSession

__all__ = [
    "Role", "TenantMixin", "new_id", "utcnow",
    "Company", "CompanyProfile", "Location", "User", "UserSession", "AuditLog",
    "Supplier", "Product", "InventoryItem", "Shipment", "Disruption", "Route", "RouteRiskCheck", "AIConversation", "AIMessage", "AgentRun", "AgentStep",
    "VendorWeightProfile", "FinanceSettings", "FinancialScenario", "BomLine",
]

# Tables protected by PostgreSQL Row-Level Security (see migrations).
TENANT_TABLES = [
    "company_profiles", "locations", "suppliers", "products",
    "inventory_items", "shipments", "disruptions", "routes", "route_risk_checks", "ai_conversations", "ai_messages", "agent_runs", "agent_steps",
    "vendor_weight_profiles", "finance_settings", "financial_scenarios", "bom_lines",
]
