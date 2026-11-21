# Security model (Phase 1)

| Control | Implementation | Tested |
|---|---|---|
| Password storage | bcrypt, cost 12; policy ≥12 chars with letter, digit and symbol | ✅ |
| Login enumeration | Same error for unknown email / wrong password / locked; dummy hash equalises timing | ✅ |
| Brute force | Lock for 15 min after 5 failures (per account); 30 auth POSTs/min per IP | ✅ (account) |
| Access tokens | HS256 JWT, 30 min, issuer-checked, `typ=access`; role and tenant re-read from DB on every request | ✅ |
| Refresh tokens | Opaque random value, stored as SHA-256, rotated on each use; **re-use of a rotated token revokes all sessions** | ✅ |
| Session revocation | Logout, role change or deactivation revokes server-side sessions immediately | ✅ |
| Tenant isolation (app) | Session-derived `company_id`; request schemas reject unknown fields; cross-tenant IDs → 404 | ✅ |
| Tenant isolation (DB) | Postgres RLS + FORCE, API runs as non-owner role, tenant pinned per transaction | ✅ (Postgres) |
| RBAC | 7 roles, code-defined permission matrix; `super_admin` not assignable via tenant APIs and cannot read tenant ops data | ✅ |
| Last-admin protection | Cannot demote/deactivate the only active company admin | ✅ |
| Audit | Append-only (DB trigger), secrets redacted from details, CSV export is itself audited | ✅ |
| Live risk checks | Server rejects any check whose score ≠ capped sum of its factors; band derived server-side; every check audited | ✅ |
| Secrets | Only from env; production refuses to boot without a ≥32-char `JWT_SECRET` or with SQLite | — |
| Headers | nosniff, frame DENY, no-referrer, no-store; HSTS in production; `/docs` disabled in production | ✅ |
| External AI | Per-tenant consent flag, off by default (enforced by gateway from Phase 2) | flag ✅ |

## Known gaps (scheduled)

- MFA (TOTP) and SSO: Phase 7 (`mfa_enabled` column already exists).
- Refresh token is in `sessionStorage`; move to an httpOnly, SameSite=strict cookie and add a Content-Security-Policy in Phase 7.
- Rate limiter is in-process; use Redis when running more than one API instance.
- Encryption at rest is provided by the managed database (verify it is enabled at deployment); field-level encryption for contract documents is planned for Phase 5.
- File-upload hardening (type sniffing, size limits, malware scan, sandboxed parsing) arrives with uploads in Phase 3.
- Audit trigger blocks DELETE, so data-retention purges and tenant deletion will run through a privileged maintenance role (Phase 5).
