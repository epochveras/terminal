# Epochveras backend regression tests: health, auth, market proxy, workspace, drawings, alarms, push
import os
import time
import uuid
import pytest
import requests

def _base():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        for line in open("/app/frontend/.env"):
            if line.startswith("REACT_APP_BACKEND_URL="):
                v = line.split("=", 1)[1].strip()
    return v.rstrip("/")

BASE_URL = _base()
ADMIN = {"email": "admin@epochveras.com", "password": "Epoch2026!"}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login failed {r.status_code}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def test_user(s):
    email = f"TEST_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": "secret123"}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email.lower(), "token": d["token"], "user": d["user"]}


def H(t):
    return {"Authorization": f"Bearer {t}"}


# health
def test_health(s):
    r = s.get(f"{BASE_URL}/api/health", timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] is True and d["prices"] > 100


# auth
class TestAuth:
    def test_admin_login(self, s):
        r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["email"] == ADMIN["email"] and d["user"]["role"] == "admin"

    def test_me(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/auth/me", headers=H(admin_token))
        assert r.status_code == 200 and r.json()["email"] == ADMIN["email"]

    def test_me_no_token(self, s):
        assert requests.get(f"{BASE_URL}/api/auth/me").status_code == 401

    def test_invalid_login(self, test_user):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": test_user["email"], "password": "wrongpw1"})
        assert r.status_code == 401

    def test_duplicate_register(self, test_user):
        r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": test_user["email"], "password": "secret123"})
        assert r.status_code == 400

    def test_register_short_pw(self):
        r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": f"TEST_{uuid.uuid4().hex[:6]}@x.com", "password": "123"})
        assert r.status_code == 422

    def test_new_user_login(self, test_user):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": test_user["email"], "password": "secret123"})
        assert r.status_code == 200 and r.json()["user"]["role"] == "user"


# market proxy
class TestMarket:
    def test_symbols(self, s):
        r = s.get(f"{BASE_URL}/api/market/symbols", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert len(d) > 300
        types = {x["type"] for x in d}
        assert "COIN" in types and "COMMODITY" in types
        btc = next(x for x in d if x["symbol"] == "BTCUSDT")
        assert btc["tick"] and btc["fundingHours"] in (1, 4, 8)
        assert any(x["symbol"] == "XAUUSDT" for x in d)

    def test_tickers(self, s):
        r = s.get(f"{BASE_URL}/api/market/tickers", timeout=30)
        assert r.status_code == 200
        btc = next(x for x in r.json() if x["s"] == "BTCUSDT")
        assert float(btc["c"]) > 0 and btc["r"] is not None

    def test_klines(self, s):
        r = s.get(f"{BASE_URL}/api/market/klines", params={"symbol": "BTCUSDT", "interval": "15m", "limit": 10}, timeout=30)
        assert r.status_code == 200 and len(r.json()) == 10

    def test_klines_bad_interval(self, s):
        r = s.get(f"{BASE_URL}/api/market/klines", params={"symbol": "BTCUSDT", "interval": "7x", "limit": 10}, timeout=30)
        assert r.status_code in (400, 502)

    def test_futures(self, s):
        r = s.get(f"{BASE_URL}/api/market/futures", params={"symbol": "BTCUSDT", "period": "5m"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["premium"] and "lastFundingRate" in d["premium"]
        for k in ("global", "topAccount", "topPosition"):
            assert isinstance(d[k], list) and len(d[k]) > 0, k


# workspace & drawings (per user)
class TestWorkspaceDrawings:
    def test_workspace_roundtrip(self, test_user):
        t = test_user["token"]
        body = {"settings": {"symbol": "ETHUSDT", "tf": "1h"}, "favorites": [{"id": "fav", "name": "Favoriler", "symbols": ["ETHUSDT"]}]}
        assert requests.put(f"{BASE_URL}/api/workspace", json=body, headers=H(t)).status_code == 200
        d = requests.get(f"{BASE_URL}/api/workspace", headers=H(t)).json()
        assert d["settings"]["tf"] == "1h" and d["favorites"][0]["symbols"] == ["ETHUSDT"]

    def test_drawings_roundtrip_and_isolation(self, test_user, admin_token):
        t = test_user["token"]
        dr = [{"id": "TEST_d1", "type": "trendline", "p1": {"t": 1, "p": 1}, "p2": {"t": 2, "p": 2}}]
        assert requests.put(f"{BASE_URL}/api/drawings/btcusdt", json={"drawings": dr}, headers=H(t)).status_code == 200
        d = requests.get(f"{BASE_URL}/api/drawings/BTCUSDT", headers=H(t)).json()
        assert d["drawings"][0]["id"] == "TEST_d1"
        a = requests.get(f"{BASE_URL}/api/drawings/BTCUSDT", headers=H(admin_token)).json()
        assert all(x.get("id") != "TEST_d1" for x in a["drawings"])
        requests.put(f"{BASE_URL}/api/drawings/BTCUSDT", json={"drawings": []}, headers=H(t))

    def test_workspace_unauth(self):
        assert requests.get(f"{BASE_URL}/api/workspace").status_code == 401


# alarms
class TestAlarms:
    def test_alarm_flow(self, test_user):
        t = test_user["token"]
        tick = next(x for x in requests.get(f"{BASE_URL}/api/market/tickers").json() if x["s"] == "BTCUSDT")
        cur = float(tick["c"])
        up = requests.post(f"{BASE_URL}/api/alarms", json={"symbol": "BTCUSDT", "price": cur * 3}, headers=H(t))
        dn = requests.post(f"{BASE_URL}/api/alarms", json={"symbol": "btcusdt", "price": cur * 0.3}, headers=H(t))
        assert up.status_code == 200 and dn.status_code == 200
        up, dn = up.json(), dn.json()
        assert up["direction"] == "above" and dn["direction"] == "below" and dn["symbol"] == "BTCUSDT"
        assert "_id" not in up
        # immediate-trigger alarm: price just below current with direction forced 'above' via created price?
        # create one at current*0.999 -> direction below, won't trigger. create at cur*1.0 exactly -> above, may trigger
        time.sleep(5)
        lst = requests.get(f"{BASE_URL}/api/alarms", headers=H(t)).json()
        ids = {a["id"]: a for a in lst}
        assert ids[up["id"]]["active"] and ids[dn["id"]]["active"]
        # clear inactive only -> active stay
        r = requests.delete(f"{BASE_URL}/api/alarms", headers=H(t))
        assert r.status_code == 200
        lst = requests.get(f"{BASE_URL}/api/alarms", headers=H(t)).json()
        assert {up["id"], dn["id"]} <= {a["id"] for a in lst}
        for a in (up, dn):
            assert requests.delete(f"{BASE_URL}/api/alarms/{a['id']}", headers=H(t)).status_code == 200
        lst = requests.get(f"{BASE_URL}/api/alarms", headers=H(t)).json()
        assert not ({up["id"], dn["id"]} & {a["id"] for a in lst})

    def test_alarm_trigger(self, test_user):
        """Alarm at a price the market already crossed relative to a fake created price can't be forced
        (server uses LAST_PRICES). Use price == ~current: direction 'above' if price>=cur, triggers on any uptick."""
        t = test_user["token"]
        cur = float(next(x for x in requests.get(f"{BASE_URL}/api/market/tickers").json() if x["s"] == "BTCUSDT")["c"])
        a = requests.post(f"{BASE_URL}/api/alarms", json={"symbol": "BTCUSDT", "price": cur}, headers=H(t)).json()
        b = requests.post(f"{BASE_URL}/api/alarms", json={"symbol": "BTCUSDT", "price": cur - 0.1}, headers=H(t)).json()
        trig = False
        for _ in range(20):
            time.sleep(3)
            lst = {x["id"]: x for x in requests.get(f"{BASE_URL}/api/alarms", headers=H(t)).json()}
            if not lst[a["id"]]["active"] or not lst[b["id"]]["active"]:
                trig = True
                x = lst[a["id"]] if not lst[a["id"]]["active"] else lst[b["id"]]
                assert x["triggered_at"] and x["trigger_price"]
                break
        r = requests.delete(f"{BASE_URL}/api/alarms", headers=H(t)).json()
        for x in (a, b):
            requests.delete(f"{BASE_URL}/api/alarms/{x['id']}", headers=H(t))
        if not trig:
            pytest.skip("market did not move across alarm in 60s")
        assert r["deleted"] >= 1

    def test_alarm_unauth(self):
        assert requests.post(f"{BASE_URL}/api/alarms", json={"symbol": "BTCUSDT", "price": 1}).status_code == 401


# push
class TestPush:
    def test_public_key(self):
        r = requests.get(f"{BASE_URL}/api/push/public-key")
        assert r.status_code == 200 and len(r.json()["publicKey"]) > 40

    def test_push_test_no_sub(self, test_user):
        r = requests.post(f"{BASE_URL}/api/push/test", headers=H(test_user["token"]))
        assert r.status_code == 200 and r.json()["sent"] == 0

    def test_subscribe_invalid(self, test_user):
        r = requests.post(f"{BASE_URL}/api/push/subscribe", json={"endpoint": "http://x", "keys": {}}, headers=H(test_user["token"]))
        assert r.status_code == 400
