"""Role-based access control. Permissions are code-defined so they are versioned, reviewed and tested."""
from __future__ import annotations

from enum import Enum

from app.models.base import Role


class Perm(str, Enum):
    COMPANY_READ = "company:read"
    COMPANY_UPDATE = "company:update"
    USERS_READ = "users:read"
    USERS_MANAGE = "users:manage"
    OPS_READ = "ops:read"                  # inventory, shipments, suppliers, disruptions
    OPS_WRITE = "ops:write"
    PROCUREMENT_WRITE = "procurement:write"
    FINANCE_READ = "finance:read"
    AUDIT_READ = "audit:read"
    APPROVE_HIGH_IMPACT = "approvals:high_impact"  # Phase 6
    AI_USE = "ai:use"                      # chat with agents (Phase 2)
    PLATFORM_ADMIN = "platform:admin"


_ALL_TENANT = {p for p in Perm if p is not Perm.PLATFORM_ADMIN}

ROLE_PERMISSIONS: dict[Role, set[Perm]] = {
    Role.SUPER_ADMIN: {Perm.PLATFORM_ADMIN},
    Role.COMPANY_ADMIN: _ALL_TENANT,
    Role.SUPPLY_CHAIN_MANAGER: {Perm.COMPANY_READ, Perm.USERS_READ, Perm.OPS_READ, Perm.OPS_WRITE,
                                Perm.FINANCE_READ, Perm.APPROVE_HIGH_IMPACT, Perm.AI_USE},
    Role.PROCUREMENT_MANAGER: {Perm.COMPANY_READ, Perm.USERS_READ, Perm.OPS_READ, Perm.PROCUREMENT_WRITE,
                               Perm.FINANCE_READ, Perm.APPROVE_HIGH_IMPACT, Perm.AI_USE},
    Role.FINANCE_MANAGER: {Perm.COMPANY_READ, Perm.USERS_READ, Perm.OPS_READ, Perm.FINANCE_READ,
                           Perm.APPROVE_HIGH_IMPACT, Perm.AI_USE},
    Role.ANALYST: {Perm.COMPANY_READ, Perm.OPS_READ, Perm.FINANCE_READ, Perm.AI_USE},
    Role.READ_ONLY: {Perm.COMPANY_READ, Perm.OPS_READ},
}


def permissions_for(role: str) -> set[Perm]:
    try:
        return ROLE_PERMISSIONS[Role(role)]
    except ValueError:
        return set()


def has_perm(role: str, perm: Perm) -> bool:
    return perm in permissions_for(role)


# Roles a company admin may assign. super_admin is never assignable through tenant APIs.
ASSIGNABLE_ROLES = [r.value for r in Role if r is not Role.SUPER_ADMIN]
