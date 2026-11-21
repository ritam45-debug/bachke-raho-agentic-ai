"""Pydantic request/response schemas. Request schemas never accept company_id — it comes from the session."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.security.passwords import password_problems
from app.security.rbac import ASSIGNABLE_ROLES

CompanySize = Literal["1-50", "51-200", "201-1000", "1001-5000", "5000+"]
LocationKind = Literal["headquarters", "manufacturing", "warehouse", "distribution"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _check_pw(v: str) -> str:
    problems = password_problems(v)
    if problems:
        raise ValueError("Password " + "; ".join(problems))
    return v


# ---------- auth ----------
class LocationIn(_Strict):
    name: str = Field(min_length=2, max_length=160)
    kind: LocationKind
    city: str | None = Field(default=None, max_length=120)
    country: str | None = Field(default=None, max_length=80)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class LocationBulk(_Strict):
    locations: list[LocationIn] = Field(min_length=1, max_length=500)


class CompanyRegistration(_Strict):
    company_name: str = Field(min_length=2, max_length=200)
    industry: str = Field(min_length=2, max_length=120)
    company_size: CompanySize
    headquarters: str = Field(min_length=2, max_length=200)
    country: str | None = Field(default=None, max_length=80)
    registration_number: str | None = Field(default=None, max_length=80)
    product_categories: list[str] = Field(default_factory=list, max_length=50)
    locations: list[LocationIn] = Field(default_factory=list, max_length=200)
    admin_full_name: str = Field(min_length=2, max_length=160)
    admin_email: EmailStr
    admin_job_title: str | None = Field(default=None, max_length=120)
    admin_phone: str | None = Field(default=None, max_length=40)
    password: str
    accept_terms: bool

    _pw = field_validator("password")(_check_pw)

    @field_validator("accept_terms")
    @classmethod
    def _terms(cls, v: bool) -> bool:
        if not v:
            raise ValueError("Terms and data-processing notice must be accepted")
        return v

    @field_validator("product_categories")
    @classmethod
    def _cats(cls, v: list[str]) -> list[str]:
        return [c.strip()[:80] for c in v if c.strip()]


class LoginRequest(_Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class RefreshRequest(_Strict):
    refresh_token: str = Field(min_length=20, max_length=200)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class MeOut(BaseModel):
    id: str
    email: str
    full_name: str
    job_title: str | None
    role: str
    permissions: list[str]
    company_id: str | None
    company_name: str | None
    is_demo: bool


# ---------- company ----------
class LocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    kind: str
    city: str | None
    country: str | None
    latitude: float | None
    longitude: float | None


class CompanyOut(BaseModel):
    id: str
    name: str
    slug: str
    industry: str
    company_size: str
    headquarters: str
    country: str | None
    registration_number: str | None
    status: str
    is_demo: bool
    ai_external_processing: bool
    data_retention_days: int
    created_at: datetime
    description: str | None
    product_categories: list[str]
    admin_contact_name: str | None
    admin_contact_email: str | None
    admin_contact_phone: str | None
    website: str | None
    currency: str
    locations: list[LocationOut]


class CompanyUpdate(_Strict):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    industry: str | None = Field(default=None, min_length=2, max_length=120)
    company_size: CompanySize | None = None
    headquarters: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    product_categories: list[str] | None = Field(default=None, max_length=50)
    website: str | None = Field(default=None, max_length=200)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    ai_external_processing: bool | None = None
    data_retention_days: int | None = Field(default=None, ge=30, le=3650)

    @field_validator("currency")
    @classmethod
    def _cur(cls, v: str | None) -> str | None:
        if v is not None and not re.fullmatch(r"[A-Z]{3}", v):
            raise ValueError("Currency must be an ISO 4217 code, e.g. INR")
        return v


# ---------- users ----------
class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    full_name: str
    job_title: str | None
    role: str
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime


class UserCreate(_Strict):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    job_title: str | None = Field(default=None, max_length=120)
    role: str
    temporary_password: str

    _pw = field_validator("temporary_password")(_check_pw)

    @field_validator("role")
    @classmethod
    def _role(cls, v: str) -> str:
        if v not in ASSIGNABLE_ROLES:
            raise ValueError(f"Role must be one of {ASSIGNABLE_ROLES}")
        return v


class UserUpdate(_Strict):
    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    job_title: str | None = Field(default=None, max_length=120)
    role: str | None = None
    is_active: bool | None = None

    @field_validator("role")
    @classmethod
    def _role(cls, v: str | None) -> str | None:
        if v is not None and v not in ASSIGNABLE_ROLES:
            raise ValueError(f"Role must be one of {ASSIGNABLE_ROLES}")
        return v


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    actor_user_id: str | None
    actor_type: str
    action: str
    entity_type: str | None
    entity_id: str | None
    outcome: str
    ip_address: str | None
    details: dict
    created_at: datetime


# ---------- routes & live risk ----------
RouteMode = Literal["sea", "air", "road", "rail"]
RiskBand = Literal["low", "moderate", "elevated", "high"]


class RouteIn(_Strict):
    name: str = Field(min_length=2, max_length=160)
    mode: RouteMode
    origin_location_id: str | None = Field(default=None, max_length=36)
    origin_label: str | None = Field(default=None, min_length=2, max_length=200)
    origin_lat: float | None = Field(default=None, ge=-90, le=90)
    origin_lon: float | None = Field(default=None, ge=-180, le=180)
    destination_location_id: str | None = Field(default=None, max_length=36)
    destination_label: str | None = Field(default=None, min_length=2, max_length=200)
    destination_lat: float | None = Field(default=None, ge=-90, le=90)
    destination_lon: float | None = Field(default=None, ge=-180, le=180)
    notes: str | None = Field(default=None, max_length=2000)


class RouteBulk(_Strict):
    routes: list[RouteIn] = Field(min_length=1, max_length=500)


class RiskFactor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(max_length=120)
    points: int = Field(ge=0, le=100)
    detail: str = Field(max_length=500)
    source: str = Field(max_length=120)
    observed_at: str | None = Field(default=None, max_length=40)


class RiskSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(max_length=120)
    url: str = Field(max_length=300)
    status: Literal["ok", "failed", "skipped"]
    fetched_at: str = Field(max_length=40)


class RiskCheckIn(_Strict):
    score: int = Field(ge=0, le=100)
    band: RiskBand
    factors: list[RiskFactor] = Field(default_factory=list, max_length=100)
    sources: list[RiskSource] = Field(min_length=1, max_length=20)
    forecast_days: int = Field(default=3, ge=1, le=16)
    rules_version: str = Field(max_length=20)


class RiskCheckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    route_id: str
    score: int
    band: str
    factors: list
    sources: list
    forecast_days: int
    rules_version: str
    checked_at: datetime


class RouteOut(BaseModel):
    id: str
    name: str
    mode: str
    origin_location_id: str | None
    origin_label: str
    origin_lat: float
    origin_lon: float
    destination_location_id: str | None
    destination_label: str
    destination_lat: float
    destination_lon: float
    notes: str | None
    created_at: datetime
    latest_check: RiskCheckOut | None = None
