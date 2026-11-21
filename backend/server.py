from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import suppress
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import bcrypt
import httpx
import jwt
import websockets
from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends, Query
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from pywebpush import webpush, WebPushException
from starlette.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("epochveras")

client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]
BINANCE = os.environ['BINANCE_BASE']
BINANCE_WS = os.environ.get("BINANCE_WS", "wss://fstream.binance.com/ws/!ticker@arr")
JWT_SECRET = os.environ['JWT_SECRET']

app = FastAPI()
api = APIRouter(prefix="/api")
http: Optional[httpx.AsyncClient] = None
LAST_PRICES: Dict[str, float] = {}
PUSH_TASKS: set = set()
WS_CONNECTED: bool = False
BAN_UNTIL: float = 0.0
_ALARM_CHECK_LOCK = asyncio.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@api.get("/health")
async def health():
    return {
        "ok": True,
        "prices": len(LAST_PRICES),
        "ws_connected": WS_CONNECTED,
        "ban_remaining_sec": max(0, int(BAN_UNTIL - time.time())),
    }


# ---------------- auth ----------------
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    return bcrypt.checkpw(p.encode(), h.encode())


def make_token(uid: str, email: str) -> str:
    payload = {"sub": uid, "email": email, "type": "access", "exp": datetime.now(timezone.utc) + timedelta(days=30)}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


async def current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else request.cookies.get("access_token")
    if not token:
        raise HTTPException(401, "Oturum yok")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Oturum süresi doldu")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Geçersiz oturum")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "Kullanıcı bulunamadı")
    return user


class AuthIn(BaseModel):
    email: str
    password: str = Field(min_length=6)
    name: Optional[str] = None


def public_user(u: dict) -> dict:
    return {"id": u["id"], "email": u["email"], "name": u.get("name") or u["email"].split("@")[0], "role": u.get("role", "user")}


@api.post("/auth/register")
async def register(body: AuthIn):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Geçerli bir e-posta girin")
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Bu e-posta zaten kayıtlı")
    u = {"id": str(uuid.uuid4()), "email": email, "name": body.name or email.split("@")[0],
         "password_hash": hash_password(body.password), "role": "user", "created_at": now_iso()}
    await db.users.insert_one(u)
    return {"token": make_token(u["id"], email), "user": public_user(u)}


@api.post("/auth/login")
async def login(body: AuthIn, request: Request):
    email = body.email.strip().lower()
    fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    ident = f"{fwd or (request.client.host if request.client else 'x')}:{email}"
    att = await db.login_attempts.find_one({"identifier": ident})
    if att and att.get("count", 0) >= 5 and att.get("until", 0) > time.time():
        raise HTTPException(429, "Çok fazla deneme. 15 dakika sonra tekrar deneyin")
    u = await db.users.find_one({"email": email})
    if not u or not verify_password(body.password, u["password_hash"]):
        cnt = (att or {}).get("count", 0) + 1
        await db.login_attempts.update_one({"identifier": ident}, {"$set": {"count": cnt, "until": time.time() + 900}}, upsert=True)
        raise HTTPException(401, "E-posta veya şifre hatalı")
    await db.login_attempts.delete_one({"identifier": ident})
    return {"token": make_token(u["id"], email), "user": public_user(u)}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)


# ---------------- binance proxy ----------------
_cache: Dict[str, Any] = {}


def _record_ban_if_present(text: str):
    global BAN_UNTIL
    # Örnek: "banned until 1795323779634"
    marker = "banned until "
    idx = text.find(marker)
    if idx != -1:
        num_str = "".join(ch for ch in text[idx + len(marker):idx + len(marker) + 20] if ch.isdigit())
        if num_str:
            until_sec = int(num_str) / 1000.0
            BAN_UNTIL = max(BAN_UNTIL, until_sec + 5.0)
            return
    BAN_UNTIL = max(BAN_UNTIL, time.time() + 90.0)


async def bget(path: str, params: Optional[dict] = None, ttl: float = 5.0):
    global BAN_UNTIL
    key = path + json.dumps(params or {}, sort_keys=True)
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]

    if time.time() < BAN_UNTIL:
        if hit:
            return hit[1]
        raise HTTPException(503, f"Binance IP kısıtı aktif ({int(BAN_UNTIL - time.time())} sn kaldı)")

    r = await http.get(BINANCE + path, params=params)
    if r.status_code in (418, 429) or "-1003" in r.text:
        _record_ban_if_present(r.text)
        if hit:
            return hit[1]
        raise HTTPException(502, f"Binance hata: {r.text[:200]}")
    if r.status_code != 200:
        raise HTTPException(502, f"Binance hata: {r.text[:200]}")

    data = r.json()
    _cache[key] = (time.time() + ttl, data)
    if len(_cache) > 2000:
        for k in [k for k, v in _cache.items() if v[0] < time.time()]:
            _cache.pop(k, None)
    return data


def _tick(sym: dict) -> str:
    for f in sym.get("filters", []):
        if f["filterType"] == "PRICE_FILTER":
            return f["tickSize"]
    return "0.01"


@api.get("/market/symbols")
async def market_symbols():
    ex, finfo = await asyncio.gather(bget("/fapi/v1/exchangeInfo", ttl=600), bget("/fapi/v1/fundingInfo", ttl=600))
    hours = {f["symbol"]: f.get("fundingIntervalHours", 8) for f in finfo}
    out = []
    for s in ex["symbols"]:
        if s.get("contractType") not in ("PERPETUAL", "TRADIFI_PERPETUAL") or s.get("status") != "TRADING":
            continue
        out.append({"symbol": s["symbol"], "base": s["baseAsset"], "quote": s["quoteAsset"],
                    "type": s.get("underlyingType", "COIN"), "tick": _tick(s),
                    "fundingHours": hours.get(s["symbol"], 8)})
    return out


@api.get("/market/tickers")
async def market_tickers():
    # WebSocket fiyatları varsa önce buradan besle, yoksa cache/REST'e düş
    if LAST_PRICES:
        with suppress(Exception):
            prem = await bget("/fapi/v1/premiumIndex", ttl=15)
            pm = {p["symbol"]: p for p in prem}
            return [
                {
                    "s": sym,
                    "c": str(price),
                    "P": pm.get(sym, {}).get("priceChangePercent", "0"),
                    "q": pm.get(sym, {}).get("quoteVolume", "0"),
                    "r": pm.get(sym, {}).get("lastFundingRate"),
                    "m": pm.get(sym, {}).get("markPrice"),
                    "T": pm.get(sym, {}).get("nextFundingTime"),
                }
                for sym, price in LAST_PRICES.items()
            ]

    t24, prem = await asyncio.gather(bget("/fapi/v1/ticker/24hr", ttl=10), bget("/fapi/v1/premiumIndex", ttl=10))
    pm = {p["symbol"]: p for p in prem}
    out = []
    for t in t24:
        p = pm.get(t["symbol"], {})
        out.append({"s": t["symbol"], "c": t["lastPrice"], "P": t["priceChangePercent"], "q": t["quoteVolume"],
                    "r": p.get("lastFundingRate"), "m": p.get("markPrice"), "T": p.get("nextFundingTime")})
    return out


@api.get("/market/klines")
async def market_klines(symbol: str, interval: str, limit: int = Query(1000, ge=1, le=1500), endTime: Optional[int] = None):
    params = {"symbol": symbol.upper(), "interval": interval, "limit": limit}
    if endTime:
        params["endTime"] = endTime
    return await bget("/fapi/v1/klines", params, ttl=5.0)


@api.get("/market/futures")
async def market_futures(symbol: str, period: str = "5m"):
    s = symbol.upper()
    q = {"symbol": s, "period": period, "limit": 30}

    async def safe(path, params, ttl):
        try:
            return await bget(path, params, ttl)
        except Exception:
            return None
    prem, oi, oih, g, ta, tp = await asyncio.gather(
        safe("/fapi/v1/premiumIndex", {"symbol": s}, 10),
        safe("/fapi/v1/openInterest", {"symbol": s}, 20),
        safe("/futures/data/openInterestHist", q, 60),
        safe("/futures/data/globalLongShortAccountRatio", q, 60),
        safe("/futures/data/topLongShortAccountRatio", q, 60),
        safe("/futures/data/topLongShortPositionRatio", q, 60),
    )
    return {"premium": prem, "openInterest": oi, "oiHist": oih or [], "global": g or [], "topAccount": ta or [], "topPosition": tp or []}


# ---------------- workspace & drawings ----------------
@api.get("/workspace")
async def get_workspace(user: dict = Depends(current_user)):
    doc = await db.workspaces.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"settings": (doc or {}).get("settings", {}), "favorites": (doc or {}).get("favorites"), "ts": (doc or {}).get("ts", 0)}


@api.put("/workspace")
async def put_workspace(body: Dict[str, Any], user: dict = Depends(current_user)):
    upd = {k: v for k, v in body.items() if k in ("settings", "favorites", "ts")}
    upd["updated_at"] = now_iso()
    await db.workspaces.update_one({"user_id": user["id"]}, {"$set": upd}, upsert=True)
    return {"ok": True}


class DrawingsIn(BaseModel):
    drawings: List[Dict[str, Any]]


@api.get("/drawings/{symbol}")
async def get_drawings(symbol: str, user: dict = Depends(current_user)):
    doc = await db.drawings.find_one({"user_id": user["id"], "symbol": symbol.upper()}, {"_id": 0})
    return {"drawings": (doc or {}).get("drawings", [])}


@api.put("/drawings/{symbol}")
async def put_drawings(symbol: str, body: DrawingsIn, user: dict = Depends(current_user)):
    await db.drawings.update_one({"user_id": user["id"], "symbol": symbol.upper()},
                                 {"$set": {"drawings": body.drawings[:500], "updated_at": now_iso()}}, upsert=True)
    return {"ok": True}


# ---------------- alarms ----------------
class AlarmIn(BaseModel):
    symbol: str
    price: float
    current_price: Optional[float] = None
    note: Optional[str] = None


@api.get("/alarms")
async def list_alarms(user: dict = Depends(current_user)):
    return await db.alarms.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.post("/alarms")
async def create_alarm(body: AlarmIn, user: dict = Depends(current_user)):
    sym = body.symbol.upper()
    cur = LAST_PRICES.get(sym) or body.current_price
    if cur is None:
        raise HTTPException(400, "Güncel fiyat alınamadı")
    a = {"id": str(uuid.uuid4()), "user_id": user["id"], "symbol": sym, "price": body.price,
         "direction": "above" if body.price >= cur else "below", "created_price": cur, "note": body.note,
         "active": True, "created_at": now_iso(), "triggered_at": None, "trigger_price": None}
    await db.alarms.insert_one(a)
    a.pop("_id", None)
    return a


@api.delete("/alarms/{alarm_id}")
async def delete_alarm(alarm_id: str, user: dict = Depends(current_user)):
    await db.alarms.delete_one({"id": alarm_id, "user_id": user["id"]})
    return {"ok": True}


@api.delete("/alarms")
async def clear_triggered(user: dict = Depends(current_user)):
    r = await db.alarms.delete_many({"user_id": user["id"], "active": False})
    return {"deleted": r.deleted_count}


# ---------------- push ----------------
class SubIn(BaseModel):
    endpoint: str
    keys: Dict[str, str]


@api.get("/push/public-key")
async def push_key():
    return {"publicKey": os.environ["VAPID_PUBLIC_KEY"]}


@api.post("/push/subscribe")
async def push_subscribe(body: SubIn, user: dict = Depends(current_user)):
    if not body.endpoint.startswith("https://"):
        raise HTTPException(400, "Geçersiz push adresi")
    await db.push_subs.update_one({"endpoint": body.endpoint},
                                  {"$set": {"user_id": user["id"], "endpoint": body.endpoint, "keys": body.keys, "updated_at": now_iso()}},
                                  upsert=True)
    return {"ok": True}


def _send(sub: dict, payload: dict):
    webpush(subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]}, data=json.dumps(payload),
            vapid_private_key=os.environ["VAPID_PRIVATE_KEY"], vapid_claims={"sub": os.environ["VAPID_SUBJECT"]},
            ttl=86400, headers={"Urgency": "high"}, timeout=10)


async def push_user(user_id: str, payload: dict) -> int:
    subs = await db.push_subs.find({"user_id": user_id}, {"_id": 0}).to_list(50)
    sent = 0
    for s in subs:
        try:
            await asyncio.to_thread(_send, s, payload)
            sent += 1
            logger.info("push sent user=%s tag=%s", user_id[:8], payload.get("tag"))
        except WebPushException as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if code in (404, 410):
                await db.push_subs.delete_one({"endpoint": s["endpoint"]})
            logger.warning("push failed %s user=%s tag=%s", code, user_id[:8], payload.get("tag"))
        except Exception as e:
            logger.warning("push error %s", e)
    return sent


@api.post("/push/test")
async def push_test(user: dict = Depends(current_user)):
    n = await push_user(user["id"], {"title": "Epochveras", "body": "Test bildirimi çalışıyor", "tag": "test"})
    return {"sent": n}


def fmt_tr(v: float) -> str:
    s = f"{v:,.8f}".rstrip("0").rstrip(".")
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


async def evaluate_alarms():
    if not LAST_PRICES:
        return
    async with _ALARM_CHECK_LOCK:
        async for a in db.alarms.find({"active": True}, {"_id": 0}):
            p = LAST_PRICES.get(a["symbol"])
            if p is None:
                continue
            hit = p >= a["price"] if a["direction"] == "above" else p <= a["price"]
            if not hit:
                continue
            res = await db.alarms.update_one(
                {"id": a["id"], "active": True},
                {"$set": {"active": False, "triggered_at": now_iso(), "trigger_price": p}},
            )
            if res.modified_count:
                arrow = "yukarı kesti" if a["direction"] == "above" else "aşağı kesti"
                task = asyncio.create_task(push_user(a["user_id"], {
                    "title": f"⏰ {a['symbol']} alarm",
                    "body": f"{a['symbol']} {fmt_tr(a['price'])} seviyesini {arrow} · Fiyat {fmt_tr(p)}",
                    "tag": a["id"],
                    "url": f"/?symbol={a['symbol']}",
                }))
                PUSH_TASKS.add(task)
                task.add_done_callback(PUSH_TASKS.discard)


async def rest_fallback_tick():
    # WS bağlı değilse ve ban süresi dolmuşsa seyrek REST yedeği çalışır
    if WS_CONNECTED or time.time() < BAN_UNTIL:
        return
    try:
        data = await bget("/fapi/v1/ticker/price", ttl=15)
        for d in data:
            LAST_PRICES[d["symbol"]] = float(d["price"])
    except Exception as e:
        logger.warning("rest fallback: %s", e)


async def price_ws_loop():
    global WS_CONNECTED
    backoff = 2.0
    while True:
        try:
            async with websockets.connect(
                BINANCE_WS,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=10,
                max_size=10 * 1024 * 1024,
            ) as ws:
                WS_CONNECTED = True
                backoff = 2.0
                logger.info("binance ws connected: %s", BINANCE_WS)
                async for raw in ws:
                    items = json.loads(raw)
                    if isinstance(items, list):
                        for item in items:
                            sym = item.get("s")
                            price = item.get("c")
                            if sym and price is not None:
                                LAST_PRICES[sym] = float(price)
        except asyncio.CancelledError:
            WS_CONNECTED = False
            raise
        except Exception as e:
            WS_CONNECTED = False
            logger.warning("binance ws disconnected (%s), retrying in %.1fs", e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 1.5, 30.0)


async def alarm_loop():
    while True:
        try:
            if not LAST_PRICES:
                await rest_fallback_tick()
            await evaluate_alarms()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("alarm loop: %s", e)
        await asyncio.sleep(2)


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ['CORS_ORIGINS'].split(','),
                   allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    global http
    http = httpx.AsyncClient(timeout=15, headers={"User-Agent": "Mozilla/5.0 Epochveras"})
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.alarms.create_index([("user_id", 1), ("created_at", -1)])
    await db.alarms.create_index("active")
    await db.drawings.create_index([("user_id", 1), ("symbol", 1)], unique=True)
    await db.workspaces.create_index("user_id", unique=True)
    await db.push_subs.create_index("endpoint", unique=True)
    await db.push_subs.create_index("user_id")
    await db.login_attempts.create_index("identifier")
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    if not await db.users.find_one({"email": admin_email}):
        await db.users.insert_one({"id": str(uuid.uuid4()), "email": admin_email, "name": "Admin",
                                   "password_hash": hash_password(os.environ["ADMIN_PASSWORD"]), "role": "admin", "created_at": now_iso()})
    app.state.ws_task = asyncio.create_task(price_ws_loop())
    app.state.alarm_task = asyncio.create_task(alarm_loop())


@app.on_event("shutdown")
async def shutdown():
    for task_name in ("ws_task", "alarm_task"):
        task = getattr(app.state, task_name, None)
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
    await http.aclose()
    client.close()
