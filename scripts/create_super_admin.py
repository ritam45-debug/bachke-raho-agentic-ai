"""Create a platform super-admin (no company). Run from backend/:

    python ../scripts/create_super_admin.py ops@yourdomain.com "Ops Admin"

The password is read interactively and never echoed or logged.
"""
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select  # noqa: E402

from app.database.session import SessionLocal  # noqa: E402
from app.models import User  # noqa: E402
from app.models.base import Role  # noqa: E402
from app.security.passwords import hash_password, password_problems  # noqa: E402
from app.services import audit  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    email, name = sys.argv[1].lower(), sys.argv[2]
    pw = getpass.getpass("Password: ")
    if problems := password_problems(pw):
        sys.exit("Password " + "; ".join(problems))
    if pw != getpass.getpass("Confirm: "):
        sys.exit("Passwords do not match")
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.email == email)):
            sys.exit("A user with that email already exists")
        u = User(company_id=None, email=email, full_name=name, role=Role.SUPER_ADMIN.value, password_hash=hash_password(pw))
        db.add(u)
        db.flush()
        audit.record(db, action="platform.super_admin_created", company_id=None, actor_type="system", entity_type="user", entity_id=u.id)
        db.commit()
    print(f"Super admin {email} created.")


if __name__ == "__main__":
    main()
