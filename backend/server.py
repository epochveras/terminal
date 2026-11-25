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
JWT_SECRET = os.environ['JWT_SECRET']

app = FastAPI()
api = APIRouter(prefix="/api")
http: Optional[httpx.AsyncClient] = None
LAST_PRICES: Dict[str, float] = {}
PUSH_TASKS: set = set()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@api.get("/health")
async def health():
    return {"ok": True, "prices": len(LAST_PRICES)}


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
        raise HTTPException(401, "Oturum sÃ¼resi doldu")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "GeÃ§ersiz oturum")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "KullanÄ±cÄ± bulunamadÄ±")
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
        raise HTTPException(400, "GeÃ§erli bir e-posta girin")
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Bu e-posta zaten kayÄ±tlÄ±")
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
        raise HTTPException(429, "Ãok fazla deneme. 15 dakika sonra tekrar deneyin")
    u = await db.users.find_one({"email": email})
    if not u or not verify_password(body.password, u["password_hash"]):
        cnt = (att or {}).get("count", 0) + 1
        await db.login_attempts.update_one({"identifier": ident}, {"$set": {"count": cnt, "until": time.time() + 900}}, upsert=True)
        raise HTTPException(401, "E-posta veya Åifre hatalÄ±")
    await db.login_attempts.delete_one({"identifier": ident})
    return {"token": make_token(u["id"], email), "user": public_user(u)}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)


# ---------------- binance proxy ----------------
_cache: Dict[str, Any] = {}
_cache_locks: Dict[str, asyncio.Lock] = {}
BINANCE_COOLDOWN_UNTIL = 0.0


async def save_binance_cooldown(until: float):
    """Ban bitiÅ zamanÄ±nÄ± MongoDB'ye yazar; sÃ¼reÃ§ yeniden baÅlasa da korunur."""
    await db.system_state.update_one(
        {"_id": "binance_cooldown"},
        {
            "$max": {"until": until},
            "$set": {"updated_at": now_iso()}
        },
        upsert=True
    )


async def bget(path: str, params: Optional[dict] = None, ttl: float = 2.0):
    """REST proxy with request coalescing and shared Binance 418/429 cooldown."""
    global BINANCE_COOLDOWN_UNTIL
    key = path + json.dumps(params or {}, sort_keys=True)
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    if now < BINANCE_COOLDOWN_UNTIL:
        wait = int(BINANCE_COOLDOWN_UNTIL - now)
        raise HTTPException(503, f"Binance korumasÄ± aktif. {wait} saniye bekleyin.")

    lock = _cache_locks.setdefault(key, asyncio.Lock())
    async with lock:
        now = time.time()
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
        if now < BINANCE_COOLDOWN_UNTIL:
            wait = int(BINANCE_COOLDOWN_UNTIL - now)
            raise HTTPException(503, f"Binance korumasÄ± aktif. {wait} saniye bekleyin.")
        try:
            response = await http.get(BINANCE + path, params=params)
        except httpx.HTTPError as exc:
            logger.warning("Binance baÄlantÄ± hatasÄ±: %s", exc)
            raise HTTPException(503, "Binance baÄlantÄ±sÄ±nda geÃ§ici hata") from exc

        if response.status_code in (418, 429):
            delay = 60
            retry_after = response.headers.get("Retry-After")
            if retry_after:
                try:
                    delay = max(delay, int(float(retry_after)))
                except (TypeError, ValueError):
                    pass
            try:
                message = str(response.json().get("msg", ""))
                import re
                match = re.search(r"banned until\s+(\d+)", message, re.I)
                if match:
                    delay = max(delay, int(int(match.group(1)) / 1000 - time.time()) + 5)
            except Exception:
                pass

            BINANCE_COOLDOWN_UNTIL = max(
                BINANCE_COOLDOWN_UNTIL,
                time.time() + delay
            )
            try:
                await save_binance_cooldown(BINANCE_COOLDOWN_UNTIL)
            except Exception:
                logger.exception("Binance ban sÃ¼resi MongoDB'ye kaydedilemedi")

            logger.error("Binance HTTP %s; tÃ¼m REST istekleri %s saniye durduruldu", response.status_code, delay)
            raise HTTPException(503, f"Binance hÄ±z sÄ±nÄ±rÄ± ({response.status_code}); {delay} saniye bekleniyor.")

        if response.status_code != 200:
            logger.warning("Binance HTTP %s: %s", response.status_code, response.text[:200])
            raise HTTPException(502, f"Binance hata: {response.text[:200]}")

        data = response.json()
        _cache[key] = (time.time() + ttl, data)
        if len(_cache) > 2000:
            now = time.time()
            for cache_key in [k for k, value in _cache.items() if value[0] < now]:
                _cache.pop(cache_key, None)
                _cache_locks.pop(cache_key, None)
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
    t24, prem = await asyncio.gather(bget("/fapi/v1/ticker/24hr", ttl=2), bget("/fapi/v1/premiumIndex", ttl=2))
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
    return await bget("/fapi/v1/klines", params, ttl=1.5)


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
        safe("/fapi/v1/premiumIndex", {"symbol": s}, 3),
        safe("/fapi/v1/openInterest", {"symbol": s}, 10),
        safe("/futures/data/openInterestHist", q, 30),
        safe("/futures/data/globalLongShortAccountRatio", q, 30),
        safe("/futures/data/topLongShortAccountRatio", q, 30),
        safe("/futures/data/topLongShortPositionRatio", q, 30),
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
        raise HTTPException(400, "GÃ¼ncel fiyat alÄ±namadÄ±")
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
        raise HTTPException(400, "GeÃ§ersiz push adresi")
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
    n = await push_user(user["id"], {"title": "Epochveras", "body": "Test bildirimi Ã§alÄ±ÅÄ±yor", "tag": "test"})
    return {"sent": n}


def fmt_tr(v: float) -> str:
    s = f"{v:,.8f}".rstrip("0").rstrip(".")
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def _alarm_symbols(alarms: List[dict]) -> set:
    """Only subscribe to symbols that currently have active alarms."""
    return {
        str(a.get("symbol", "")).upper()
        for a in alarms
        if str(a.get("symbol", "")).isalnum()
    }


async def _load_active_alarms() -> List[dict]:
    return await db.alarms.find({"active": True}, {"_id": 0}).to_list(1000)


async def _fire_alarm(alarm: dict, price: float):
    """Atomically deactivate an alarm before sending its push notification."""
    result = await db.alarms.update_one(
        {"id": alarm["id"], "active": True},
        {"$set": {
            "active": False,
            "triggered_at": now_iso(),
            "trigger_price": price
        }}
    )

    if not result.modified_count:
        return

    arrow = "yukarÄ± kesti" if alarm["direction"] == "above" else "aÅaÄÄ± kesti"
    task = asyncio.create_task(push_user(alarm["user_id"], {
        "title": f"â° {alarm['symbol']} alarm",
        "body": f"{alarm['symbol']} {fmt_tr(alarm['price'])} seviyesini {arrow} Â· Fiyat {fmt_tr(price)}",
        "tag": alarm["id"],
        "url": f"/?symbol={alarm['symbol']}"
    }))
    PUSH_TASKS.add(task)
    task.add_done_callback(PUSH_TASKS.discard)


async def alarm_loop():
    """
    Binance USD-M Futures trade WebSocket Ã¼zerinden yalnÄ±zca aktif alarm
    bulunan sembolleri izler. Alarm fiyatlarÄ± REST ile taranmaz.
    MongoDB alarm listesi 10 saniyede bir yenilenir.
    """
    refresh_seconds = 10
    reconnect_delay = 3

    while True:
        try:
            alarms = await _load_active_alarms()
            symbols = _alarm_symbols(alarms)

            if not symbols:
                await asyncio.sleep(15)
                continue

            streams = "/".join(f"{symbol.lower()}@trade" for symbol in sorted(symbols))
            ws_url = f"wss://fstream.binance.com/stream?streams={streams}"

            logger.info("Alarm WebSocket baÄlanÄ±yor. Ä°zlenen semboller: %s", ", ".join(sorted(symbols)))

            async with websockets.connect(
                ws_url,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=10,
                max_size=2**20
            ) as ws:
                logger.info("Alarm WebSocket baÄlandÄ±. Aktif sembol sayÄ±sÄ±: %s", len(symbols))
                last_refresh = time.monotonic()
                alarm_cache = {}
                for alarm in alarms:
                    alarm_cache.setdefault(alarm["symbol"].upper(), []).append(alarm)

                while True:
                    try:
                        raw_message = await asyncio.wait_for(ws.recv(), timeout=refresh_seconds)
                    except asyncio.TimeoutError:
                        raw_message = None

                    # Periodically refresh alarm data without reconnecting if the symbol set is unchanged.
                    if time.monotonic() - last_refresh >= refresh_seconds:
                        refreshed = await _load_active_alarms()
                        refreshed_symbols = _alarm_symbols(refreshed)
                        if refreshed_symbols != symbols:
                            logger.info("Aktif alarm sembolleri deÄiÅti; WebSocket aboneliÄi yenilenecek")
                            break

                        alarm_cache = {}
                        for alarm in refreshed:
                            alarm_cache.setdefault(alarm["symbol"].upper(), []).append(alarm)
                        last_refresh = time.monotonic()

                    if raw_message is None:
                        continue

                    try:
                        message = json.loads(raw_message)
                        trade = message.get("data", message)
                        symbol = str(trade.get("s", "")).upper()
                        price = float(trade["p"])
                    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                        logger.warning("WebSocket fiyat mesajÄ± Ã§Ã¶zÃ¼mlenemedi")
                        continue

                    if not symbol:
                        continue

                    LAST_PRICES[symbol] = price

                    # Check only alarms for the symbol that just received a trade.
                    for alarm in list(alarm_cache.get(symbol, [])):
                        triggered = (
                            price >= float(alarm["price"])
                            if alarm["direction"] == "above"
                            else price <= float(alarm["price"])
                        )
                        if triggered:
                            await _fire_alarm(alarm, price)
                            alarm_cache[symbol].remove(alarm)

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Alarm WebSocket baÄlantÄ±sÄ± koptu/hata oluÅtu: %s", exc)
            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, 60)
        else:
            # A normal exit means the active alarm symbol list changed.
            reconnect_delay = 3


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ['CORS_ORIGINS'].split(','),
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.on_event("startup")
async def startup():
    global http, BINANCE_COOLDOWN_UNTIL

    http = httpx.AsyncClient(timeout=15, headers={"User-Agent": "Mozilla/5.0 Epochveras"})

    # Restore the previously persisted REST API cooldown after a Render restart.
    cooldown_doc = await db.system_state.find_one({"_id": "binance_cooldown"})
    if cooldown_doc:
        BINANCE_COOLDOWN_UNTIL = float(cooldown_doc.get("until", 0.0) or 0.0)

    if BINANCE_COOLDOWN_UNTIL > time.time():
        logger.warning(
            "Binance REST korumasÄ± devam ediyor. Kalan sÃ¼re: %s saniye",
            int(BINANCE_COOLDOWN_UNTIL - time.time())
        )
    else:
        BINANCE_COOLDOWN_UNTIL = 0.0

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
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "name": "Admin",
            "password_hash": hash_password(os.environ["ADMIN_PASSWORD"]),
            "role": "admin",
            "created_at": now_iso()
        })

    app.state.alarm_task = asyncio.create_task(alarm_loop())


@app.on_event("shutdown")
async def shutdown():
    app.state.alarm_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.alarm_task

    if PUSH_TASKS:
        await asyncio.gather(*list(PUSH_TASKS), return_exceptions=True)

    if http is not None:
        await http.aclose()
    client.close()
