import os
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ.update({
    "ENVIRONMENT": "test",
    "DATABASE_URL": os.getenv("TEST_DATABASE_URL", f"sqlite:///{Path(_tmp) / 'test.db'}"),
    "JWT_SECRET": "test-secret-" + "x" * 40,
})

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

API = "/api/v1"
STRONG_PW = "Str0ng!Passw0rd"


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


_counter = {"n": 0}


def register(client, name=None, email=None, **extra):
    _counter["n"] += 1
    n = _counter["n"]
    body = {
        "company_name": name or f"Test Co {n}", "industry": "Electronics", "company_size": "51-200",
        "headquarters": "Chennai, India", "country": "India", "product_categories": ["Sensors"],
        "locations": [{"name": f"Plant {n}", "kind": "manufacturing", "city": "Chennai", "country": "India",
                       "latitude": 12.97, "longitude": 79.95}],
        "admin_full_name": "Admin Person", "admin_email": email or f"admin{n}@co{n}.example.com",
        "password": STRONG_PW, "accept_terms": True, **extra,
    }
    r = client.post(f"{API}/auth/register-company", json=body)
    assert r.status_code == 201, r.text
    return r.json(), body


def auth(tokens):
    return {"Authorization": f"Bearer {tokens['access_token']}"}
