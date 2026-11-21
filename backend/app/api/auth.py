from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import Company
from app.schemas import CompanyRegistration, LoginRequest, MeOut, RefreshRequest, TokenPair
from app.security.deps import AuthContext, get_auth
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register-company", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
def register_company(data: CompanyRegistration, request: Request, db: Session = Depends(get_db)):
    """Create a new, isolated company workspace and its first Company Administrator."""
    return auth_service.register_company(db, data, request)


@router.post("/login", response_model=TokenPair)
def login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    return auth_service.login(db, data.email, data.password, request)


@router.post("/refresh", response_model=TokenPair)
def refresh(data: RefreshRequest, request: Request, db: Session = Depends(get_db)):
    return auth_service.refresh(db, data.refresh_token, request)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    auth_service.logout(db, auth.session_id, auth.user, request)


@router.get("/me", response_model=MeOut)
def me(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    company = db.get(Company, auth.company_id) if auth.company_id else None
    u = auth.user
    return MeOut(
        id=u.id, email=u.email, full_name=u.full_name, job_title=u.job_title, role=u.role,
        permissions=auth.permissions, company_id=u.company_id,
        company_name=company.name if company else None, is_demo=bool(company and company.is_demo),
    )
