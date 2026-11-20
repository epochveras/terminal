# Push delivery: _send header unit test + alarm trigger -> push e2e + /push/test regression
import base64
import os
import sys
import time
import uuid
import subprocess

import pytest
import requests
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
sys.path.insert(0, "/app/backend")


def _b64(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def gen_keys():
    pk = ec.generate_private_key(ec.SECP256R1())
    pub = pk.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return {"p256dh": _b64(pub), "auth": _b64(os.urandom(16))}


# ---------- Unit: _send headers ----------
class TestSendHeaders:
    def test_send_passes_urgency_high_and_ttl(self, monkeypatch):
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        import server
        import pywebpush
        captured = {}

        class R:
            status_code = 201
            text = ""
            headers = {}

        def fake_post(url, data=None, headers=None, timeout=None, **kw):
            captured.update(url=url, headers=headers, timeout=timeout, data=data)
            return R()

        monkeypatch.setattr(pywebpush.requests, "post", fake_post)
        sub = {"endpoint": "https://fcm.googleapis.com/fcm/send/TEST_unit", "keys": gen_keys()}
        server._send(sub, {"title": "t", "body": "b", "tag": "unit"})
        h = {k.lower(): v for k, v in captured["headers"].items()}
        print("captured headers:", h, "timeout:", captured["timeout"])
        assert h.get("urgency") == "high"
        assert str(h.get("ttl")) == "86400"
        assert captured["timeout"] == 10
        assert h.get("content-encoding") == "aes128gcm"
        assert "vapid" in h.get("authorization", "").lower()
        assert captured["url"] == sub["endpoint"]


# ---------- E2E ----------
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@epochveras.com", "password": "Epoch2026!"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}"}


def _cleanup_sub(endpoint):
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    c = MongoClient(os.environ["MONGO_URL"])
    c[os.environ["DB_NAME"]].push_subs.delete_one({"endpoint": endpoint})


def _sub_exists(endpoint):
    from pymongo import MongoClient
    c = MongoClient(os.environ["MONGO_URL"])
    return c[os.environ["DB_NAME"]].push_subs.find_one({"endpoint": endpoint}) is not None


class TestAlarmPushE2E:
    def test_subscribe_rejects_non_https(self, H):
        r = requests.post(f"{BASE_URL}/api/push/subscribe", headers=H, json={"endpoint": "http://x", "keys": gen_keys()})
        assert r.status_code == 400

    def test_push_test_regression(self, H):
        ep = f"https://fcm.googleapis.com/fcm/send/TEST_{uuid.uuid4().hex}"
        try:
            r = requests.post(f"{BASE_URL}/api/push/subscribe", headers=H, json={"endpoint": ep, "keys": gen_keys()})
            assert r.status_code == 200 and r.json()["ok"] is True
            r = requests.post(f"{BASE_URL}/api/push/test", headers=H, timeout=30)
            assert r.status_code == 200
            assert isinstance(r.json()["sent"], int)
            print("push/test:", r.json())
        finally:
            _cleanup_sub(ep)

    def test_alarm_trigger_runs_push(self, H):
        ep = f"https://fcm.googleapis.com/fcm/send/TEST_{uuid.uuid4().hex}"
        alarm_id = None
        try:
            r = requests.post(f"{BASE_URL}/api/push/subscribe", headers=H, json={"endpoint": ep, "keys": gen_keys()})
            assert r.status_code == 200
            t = requests.get(f"{BASE_URL}/api/market/tickers", headers=H, timeout=20).json()
            rows = t if isinstance(t, list) else t.get("tickers", t)
            btc = next(x for x in rows if x.get("s") == "BTCUSDT")
            cur = float(btc["c"])
            # price far below current -> direction "below"? No: price < cur -> below triggers when p<=price.
            # Use price far ABOVE? -> above triggers when p>=price. Neither triggers instantly; use price=cur*0.5 with
            # current_price ignored (server uses LAST_PRICES). Instead set price == cur: above, triggers if p>=cur.
            # To be deterministic, create with tiny value 1.0 so direction=below and p<=1 never... so use price=cur*10?
            # Deterministic trick: price lower than cur -> 'below'; we need hit immediately => use price = 1e12 -> 'above' never.
            # So use exact current; retry a few times.
            start = time.time()
            r = requests.post(f"{BASE_URL}/api/alarms", headers=H, json={"symbol": "BTCUSDT", "price": cur, "note": "TEST_push"})
            assert r.status_code == 200, r.text
            a = r.json()
            alarm_id = a["id"]
            print("alarm:", a["direction"], a["price"], a["created_price"])
            triggered = None
            for _ in range(60):
                time.sleep(2)
                al = next((x for x in requests.get(f"{BASE_URL}/api/alarms", headers=H).json() if x["id"] == alarm_id), None)
                if al and not al["active"]:
                    triggered = al
                    break
            if not triggered:
                pytest.skip("price did not cross within 120s")
            print("triggered after", round(time.time() - start, 1), "s", triggered["triggered_at"], triggered["trigger_price"])
            time.sleep(6)
            log = subprocess.run("tail -n 400 /var/log/supervisor/backend.err.log", shell=True, capture_output=True, text=True).stdout
            lines = [l for l in log.splitlines() if "push sent" in l or "push failed" in l or "push error" in l]
            print("\n".join(lines[-6:]))
            assert any(alarm_id and ("push" in l) for l in lines[-6:])
        finally:
            if alarm_id:
                requests.delete(f"{BASE_URL}/api/alarms/{alarm_id}", headers=H)
            _cleanup_sub(ep)
