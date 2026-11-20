# Workspace persistence (watchlist tab/sort + ts) regression tests
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@epochveras.com", "password": "Epoch2026!"})
    if r.status_code != 200:
        pytest.skip("login failed")
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    orig = s.get(f"{BASE_URL}/api/workspace").json()
    yield s
    s.put(f"{BASE_URL}/api/workspace", json={"settings": orig["settings"], "favorites": orig["favorites"], "ts": orig["ts"]})


def test_workspace_requires_auth():
    assert requests.get(f"{BASE_URL}/api/workspace").status_code == 401


def test_workspace_put_get_ts_and_watchlist(client):
    orig = client.get(f"{BASE_URL}/api/workspace").json()
    assert "ts" in orig and isinstance(orig["ts"], (int, float))
    s = dict(orig["settings"]); s["watchlist"] = {"tab": "crypto", "sort": {"k": "P", "d": 1}}
    r = client.put(f"{BASE_URL}/api/workspace", json={"settings": s, "favorites": orig["favorites"], "ts": 1234567890123, "evil": 1})
    assert r.status_code == 200 and r.json()["ok"] is True
    d = client.get(f"{BASE_URL}/api/workspace").json()
    assert d["settings"]["watchlist"] == {"tab": "crypto", "sort": {"k": "P", "d": 1}}
    assert d["ts"] == 1234567890123
    assert "evil" not in d
