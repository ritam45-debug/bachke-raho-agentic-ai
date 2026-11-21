from __future__ import annotations

import re

import bcrypt

_MIN_LEN = 12


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode())
    except ValueError:
        return False


# Used to equalise timing when the email does not exist (prevents user enumeration by timing).
DUMMY_HASH = hash_password("timing-equaliser-not-a-real-password")


def password_problems(password: str) -> list[str]:
    problems = []
    if len(password) < _MIN_LEN:
        problems.append(f"must be at least {_MIN_LEN} characters")
    if len(password.encode("utf-8")) > 72:
        problems.append("must be at most 72 bytes")
    if not re.search(r"[A-Za-z]", password):
        problems.append("must contain a letter")
    if not re.search(r"\d", password):
        problems.append("must contain a digit")
    if not re.search(r"[^A-Za-z0-9]", password):
        problems.append("must contain a symbol")
    return problems
