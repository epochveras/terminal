
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import asyncio
import json
import logging
import math
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

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("epochveras")

client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]
BINANCE = os.environ['BINANCE_BASE']
JWT_SECRET = os.environ['JWT_SECRET']

app = FastAPI()
api = APIRouter(prefix="/api")
http: Optional[httpx.AsyncClient] = None

LAST_PRICES: Dict[str, float] = {}
LAST_PRICE_TIMES: Dict[str, float] = {}
PUSH_TASKS: set = set()

# ---------------- SFP MONITOR STATE ----------------

SFP_BARS: Dict[str, List[dict]] = {}

SFP_INTERVAL = "30m"
SFP_HISTORY_LIMIT = 200
SFP_SWING_LEN = 5
SFP_RIGHT_BARS = 1
SFP_EMA_FAST = 38
SFP_EMA_SLOW = 62

SFP_REFRESH_SECONDS = 10


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
    payload = {
        "sub": uid,
        "email": email,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(days=30)
    }
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

    user = await db.users.find_one(
        {"id": payload["sub"]},
        {"_id": 0, "password_hash": 0}
    )

    if not user:
        raise HTTPException(401, "Kullanıcı bulunamadı")

    return user


class AuthIn(BaseModel):
    email: str
    password: str = Field(min_length=6)
    name: Optional[str] = None


def public_user(u: dict) -> dict:
    return {
        "id": u["id"],
        "email": u["email"],
        "name": u.get("name") or u["email"].split("@")[0],
        "role": u.get("role", "user")
    }


@api.post("/auth/register")
async def register(body: AuthIn):
    email = body.email.strip().lower()

    if "@" not in email:
        raise HTTPException(400, "Geçerli bir e-posta girin")

    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Bu e-posta zaten kayıtlı")

    u = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": body.name or email.split("@")[0],
        "password_hash": hash_password(body.password),
        "role": "user",
        "created_at": now_iso()
    }

    await db.users.insert_one(u)

    return {
        "token": make_token(u["id"], email),
        "user": public_user(u)
    }


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

        await db.login_attempts.update_one(
            {"identifier": ident},
            {"$set": {"count": cnt, "until": time.time() + 900}},
            upsert=True
        )

        raise HTTPException(401, "E-posta veya şifre hatalı")

    await db.login_attempts.delete_one({"identifier": ident})

    return {
        "token": make_token(u["id"], email),
        "user": public_user(u)
    }


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)


# ---------------- binance proxy ----------------

_cache: Dict[str, Any] = {}
_cache_locks: Dict[str, asyncio.Lock] = {}
BINANCE_COOLDOWN_UNTIL = 0.0


async def save_binance_cooldown(until: float):
    await db.system_state.update_one(
        {"_id": "binance_cooldown"},
        {
            "$max": {"until": until},
            "$set": {"updated_at": now_iso()}
        },
        upsert=True
    )


async def bget(path: str, params: Optional[dict] = None, ttl: float = 2.0):
    global BINANCE_COOLDOWN_UNTIL

    key = path + json.dumps(params or {}, sort_keys=True)
    now = time.time()

    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]

    if now < BINANCE_COOLDOWN_UNTIL:
        wait = int(BINANCE_COOLDOWN_UNTIL - now)
        raise HTTPException(503, f"Binance koruması aktif. {wait} saniye bekleyin.")

    lock = _cache_locks.setdefault(key, asyncio.Lock())

    async with lock:
        now = time.time()

        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]

        if now < BINANCE_COOLDOWN_UNTIL:
            wait = int(BINANCE_COOLDOWN_UNTIL - now)
            raise HTTPException(503, f"Binance koruması aktif. {wait} saniye bekleyin.")

        try:
            response = await http.get(BINANCE + path, params=params)
        except httpx.HTTPError as exc:
            logger.warning("Binance bağlantı hatası: %s", exc)
            raise HTTPException(503, "Binance bağlantısında geçici hata") from exc

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
                    delay = max(
                        delay,
                        int(int(match.group(1)) / 1000 - time.time()) + 5
                    )
            except Exception:
                pass

            BINANCE_COOLDOWN_UNTIL = max(
                BINANCE_COOLDOWN_UNTIL,
                time.time() + delay
            )

            try:
                await save_binance_cooldown(BINANCE_COOLDOWN_UNTIL)
            except Exception:
                logger.exception("Binance ban süresi MongoDB'ye kaydedilemedi")

            logger.error(
                "Binance HTTP %s; tüm REST istekleri %s saniye durduruldu",
                response.status_code,
                delay
            )

            raise HTTPException(
                503,
                f"Binance hız sınırı ({response.status_code}); {delay} saniye bekleniyor."
            )

        if response.status_code != 200:
            logger.warning(
                "Binance HTTP %s: %s",
                response.status_code,
                response.text[:200]
            )
            raise HTTPException(502, f"Binance hata: {response.text[:200]}")

        data = response.json()
        _cache[key] = (time.time() + ttl, data)

        if len(_cache) > 2000:
            now = time.time()

            for cache_key in [
                k for k, value in _cache.items() if value[0] < now
            ]:
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
    ex, finfo = await asyncio.gather(
        bget("/fapi/v1/exchangeInfo", ttl=600),
        bget("/fapi/v1/fundingInfo", ttl=600)
    )

    hours = {
        f["symbol"]: f.get("fundingIntervalHours", 8)
        for f in finfo
    }

    out = []

    for s in ex["symbols"]:
        if (
            s.get("contractType") not in ("PERPETUAL", "TRADIFI_PERPETUAL")
            or s.get("status") != "TRADING"
        ):
            continue

        out.append({
            "symbol": s["symbol"],
            "base": s["baseAsset"],
            "quote": s["quoteAsset"],
            "type": s.get("underlyingType", "COIN"),
            "tick": _tick(s),
            "fundingHours": hours.get(s["symbol"], 8)
        })

    return out


@api.get("/market/tickers")
async def market_tickers():
    t24, prem = await asyncio.gather(
        bget("/fapi/v1/ticker/24hr", ttl=2),
        bget("/fapi/v1/premiumIndex", ttl=2)
    )

    pm = {p["symbol"]: p for p in prem}
    out = []

    for t in t24:
        p = pm.get(t["symbol"], {})

        out.append({
            "s": t["symbol"],
            "c": t["lastPrice"],
            "P": t["priceChangePercent"],
            "q": t["quoteVolume"],
            "r": p.get("lastFundingRate"),
            "m": p.get("markPrice"),
            "T": p.get("nextFundingTime")
        })

    return out


@api.get("/market/klines")
async def market_klines(
    symbol: str,
    interval: str,
    limit: int = Query(1000, ge=1, le=1500),
    endTime: Optional[int] = None
):
    params = {
        "symbol": symbol.upper(),
        "interval": interval,
        "limit": limit
    }

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
        safe("/futures/data/topLongShortPositionRatio", q, 30)
    )

    return {
        "premium": prem,
        "openInterest": oi,
        "oiHist": oih or [],
        "global": g or [],
        "topAccount": ta or [],
        "topPosition": tp or []
    }


# ---------------- workspace & drawings ----------------

@api.get("/workspace")
async def get_workspace(user: dict = Depends(current_user)):
    doc = await db.workspaces.find_one(
        {"user_id": user["id"]},
        {"_id": 0}
    )

    return {
        "settings": (doc or {}).get("settings", {}),
        "favorites": (doc or {}).get("favorites"),
        "ts": (doc or {}).get("ts", 0)
    }


@api.put("/workspace")
async def put_workspace(body: Dict[str, Any], user: dict = Depends(current_user)):
    upd = {
        k: v for k, v in body.items()
        if k in ("settings", "favorites", "ts")
    }

    upd["updated_at"] = now_iso()

    await db.workspaces.update_one(
        {"user_id": user["id"]},
        {"$set": upd},
        upsert=True
    )

    return {"ok": True}


class DrawingsIn(BaseModel):
    drawings: List[Dict[str, Any]]


@api.get("/drawings/{symbol}")
async def get_drawings(symbol: str, user: dict = Depends(current_user)):
    doc = await db.drawings.find_one(
        {"user_id": user["id"], "symbol": symbol.upper()},
        {"_id": 0}
    )

    return {"drawings": (doc or {}).get("drawings", [])}


@api.put("/drawings/{symbol}")
async def put_drawings(
    symbol: str,
    body: DrawingsIn,
    user: dict = Depends(current_user)
):
    await db.drawings.update_one(
        {"user_id": user["id"], "symbol": symbol.upper()},
        {
            "$set": {
                "drawings": body.drawings[:500],
                "updated_at": now_iso()
            }
        },
        upsert=True
    )

    return {"ok": True}


# ---------------- alarms ----------------

class AlarmIn(BaseModel):
    symbol: str
    price: float
    current_price: Optional[float] = None
    note: Optional[str] = None


@api.get("/alarms")
async def list_alarms(user: dict = Depends(current_user)):
    return await db.alarms.find(
        {"user_id": user["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(500)


@api.post("/alarms")
async def create_alarm(body: AlarmIn, user: dict = Depends(current_user)):
    sym = body.symbol.upper()

    if not math.isfinite(body.price) or body.price <= 0:
        raise HTTPException(400, "Geçerli bir alarm fiyatı girin.")

    last_price = LAST_PRICES.get(sym)
    last_time = LAST_PRICE_TIMES.get(sym, 0)

    if (
        last_price is not None
        and last_price > 0
        and time.time() - last_time <= 5
    ):
        cur = last_price
    else:
        cur = body.current_price

    if (
        cur is None
        or not isinstance(cur, (int, float))
        or not math.isfinite(cur)
        or cur <= 0
    ):
        raise HTTPException(
            400,
            "Güncel fiyat alınamadı. Fiyat verisi geldikten sonra tekrar deneyin."
        )

    if body.price == cur:
        raise HTTPException(
            400,
            "Alarm seviyesi mevcut fiyatla aynı olamaz."
        )

    direction = "above" if body.price > cur else "below"

    a = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "symbol": sym,
        "price": body.price,
        "direction": direction,
        "created_price": cur,
        "armed": False,
        "note": body.note,
        "active": True,
        "created_at": now_iso(),
        "triggered_at": None,
        "trigger_price": None
    }

    await db.alarms.insert_one(a)
    a.pop("_id", None)

    logger.info(
        "Alarm oluşturuldu: %s hedef=%s ilk_yön=%s oluşturma_fiyatı=%s",
        sym,
        body.price,
        direction,
        cur
    )

    return a


@api.delete("/alarms/{alarm_id}")
async def delete_alarm(alarm_id: str, user: dict = Depends(current_user)):
    await db.alarms.delete_one({
        "id": alarm_id,
        "user_id": user["id"]
    })

    return {"ok": True}


@api.delete("/alarms")
async def clear_triggered(user: dict = Depends(current_user)):
    r = await db.alarms.delete_many({
        "user_id": user["id"],
        "active": False
    })

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

    await db.push_subs.update_one(
        {"endpoint": body.endpoint},
        {
            "$set": {
                "user_id": user["id"],
                "endpoint": body.endpoint,
                "keys": body.keys,
                "updated_at": now_iso()
            }
        },
        upsert=True
    )

    return {"ok": True}


def _send(sub: dict, payload: dict):
    webpush(
        subscription_info={
            "endpoint": sub["endpoint"],
            "keys": sub["keys"]
        },
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=os.environ["VAPID_PRIVATE_KEY"],
        vapid_claims={"sub": os.environ["VAPID_SUBJECT"]},
        ttl=86400,
        headers={"Urgency": "high"},
        timeout=10
    )


async def push_user(user_id: str, payload: dict) -> int:
    subs = await db.push_subs.find(
        {"user_id": user_id},
        {"_id": 0}
    ).to_list(50)

    sent = 0

    for s in subs:
        try:
            await asyncio.to_thread(_send, s, payload)
            sent += 1

            logger.info(
                "push sent user=%s tag=%s",
                user_id[:8],
                payload.get("tag")
            )

        except WebPushException as e:
            code = getattr(
                getattr(e, "response", None),
                "status_code",
                None
            )

            if code in (404, 410):
                await db.push_subs.delete_one({
                    "endpoint": s["endpoint"]
                })

            logger.warning(
                "push failed %s user=%s tag=%s",
                code,
                user_id[:8],
                payload.get("tag")
            )

        except Exception as e:
            logger.warning("push error %s", e)

    return sent


@api.post("/push/test")
async def push_test(user: dict = Depends(current_user)):
    n = await push_user(
        user["id"],
        {
            "title": "Epochveras",
            "body": "Test bildirimi çalışıyor",
            "tag": "test"
        }
    )

    return {"sent": n}


def fmt_tr(v: float) -> str:
    s = f"{v:,.8f}".rstrip("0").rstrip(".")
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


async def _fire_alarm(alarm: dict, price: float):
    if (
        not isinstance(price, (int, float))
        or not math.isfinite(price)
        or price <= 0
    ):
        logger.warning(
            "Geçersiz tetikleme fiyatı engellendi: %s fiyat=%s",
            alarm.get("symbol"),
            price
        )
        return

    result = await db.alarms.update_one(
        {
            "id": alarm["id"],
            "active": True
        },
        {
            "$set": {
                "active": False,
                "triggered_at": now_iso(),
                "trigger_price": price
            }
        }
    )

    if not result.modified_count:
        return

    direction_text = (
        "üstüne çıktı"
        if alarm["direction"] == "above"
        else "altına indi"
    )

    title = f"⏰ {alarm['symbol']} alarmı"

    body = (
        f"{alarm['symbol']} {fmt_tr(alarm['price'])} seviyesinin "
        f"{direction_text}. Anlık fiyat: {fmt_tr(price)}"
    )

    logger.info(
        "Alarm tetiklendi: %s hedef=%s yön=%s gerçek_fiyat=%s",
        alarm["symbol"],
        alarm["price"],
        alarm["direction"],
        price
    )

    task = asyncio.create_task(
        push_user(
            alarm["user_id"],
            {
                "title": title,
                "body": body,
                "tag": alarm["id"],
                "url": f"/?symbol={alarm['symbol']}"
            }
        )
    )

    PUSH_TASKS.add(task)
    task.add_done_callback(PUSH_TASKS.discard)


def _alarm_symbols(alarms: List[dict]) -> set:
    return {
        str(a.get("symbol", "")).upper()
        for a in alarms
        if str(a.get("symbol", "")).isalnum()
    }


async def _load_active_alarms() -> List[dict]:
    return await db.alarms.find(
        {"active": True},
        {"_id": 0}
    ).to_list(1000)


async def alarm_loop():
    refresh_seconds = 10
    reconnect_delay = 3

    while True:
        try:
            alarms = await _load_active_alarms()
            symbols = _alarm_symbols(alarms)

            if not symbols:
                await asyncio.sleep(15)
                continue

            streams = "/".join(
                f"{symbol.lower()}@aggTrade"
                for symbol in sorted(symbols)
            )

            ws_url = f"wss://fstream.binance.com/market/stream?streams={streams}"

            logger.info(
                "Alarm WebSocket bağlanıyor. İzlenen semboller: %s",
                ", ".join(sorted(symbols))
            )

            async with websockets.connect(
                ws_url,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=10,
                max_size=2**20
            ) as ws:

                logger.info(
                    "Alarm WebSocket bağlandı. Aktif sembol sayısı: %s",
                    len(symbols)
                )

                last_refresh = time.monotonic()
                alarm_cache = {}

                for alarm in alarms:
                    alarm_cache.setdefault(
                        alarm["symbol"].upper(),
                        []
                    ).append(alarm)

                while True:
                    try:
                        raw_message = await asyncio.wait_for(
                            ws.recv(),
                            timeout=refresh_seconds
                        )
                    except asyncio.TimeoutError:
                        raw_message = None

                    if time.monotonic() - last_refresh >= refresh_seconds:
                        refreshed = await _load_active_alarms()
                        refreshed_symbols = _alarm_symbols(refreshed)

                        if refreshed_symbols != symbols:
                            logger.info(
                                "Aktif alarm sembolleri değişti; "
                                "WebSocket aboneliği yenilenecek"
                            )
                            break

                        alarm_cache = {}

                        for alarm in refreshed:
                            alarm_cache.setdefault(
                                alarm["symbol"].upper(),
                                []
                            ).append(alarm)

                        last_refresh = time.monotonic()

                    if raw_message is None:
                        continue

                    try:
                        message = json.loads(raw_message)

                        if not isinstance(message, dict):
                            raise TypeError("Mesaj dict formatında değil")

                        trade = message.get("data", message)

                        if not isinstance(trade, dict):
                            raise TypeError("Trade verisi dict formatında değil")

                        symbol = str(
                            trade.get("s", "")
                        ).upper()

                        raw_price = trade.get("p")

                        if raw_price is None:
                            logger.warning(
                                "Binance mesajında fiyat alanı yok: %s",
                                str(raw_message)[:500]
                            )
                            continue

                        price = float(raw_price)

                    except (
                        json.JSONDecodeError,
                        KeyError,
                        TypeError,
                        ValueError
                    ):
                        logger.warning(
                            "WebSocket fiyat mesajı çözümlenemedi: %s",
                            str(raw_message)[:500]
                        )
                        continue

                    if not symbol:
                        continue

                    if not math.isfinite(price) or price <= 0:
                        logger.warning(
                            "Geçersiz Binance fiyatı: sembol=%s fiyat=%r",
                            symbol,
                            raw_price
                        )
                        continue

                    LAST_PRICES[symbol] = price
                    LAST_PRICE_TIMES[symbol] = time.time()

                    for alarm in list(alarm_cache.get(symbol, [])):
                        target = float(alarm["price"])

                        if not math.isfinite(target) or target <= 0:
                            logger.warning(
                                "Geçersiz alarm seviyesi yok sayıldı: %s",
                                alarm.get("id")
                            )
                            continue

                        if not alarm.get("armed", False):
                            if price == target:
                                logger.info(
                                    "Alarm referans fiyatı hedefe eşit; "
                                    "sonraki fiyat bekleniyor: %s hedef=%s",
                                    symbol,
                                    target
                                )
                                continue

                            direction = (
                                "above"
                                if target > price
                                else "below"
                            )

                            result = await db.alarms.update_one(
                                {
                                    "id": alarm["id"],
                                    "active": True,
                                    "armed": {"$ne": True}
                                },
                                {
                                    "$set": {
                                        "armed": True,
                                        "direction": direction,
                                        "created_price": price,
                                        "armed_at": now_iso()
                                    }
                                }
                            )

                            if result.modified_count:
                                alarm["armed"] = True
                                alarm["direction"] = direction
                                alarm["created_price"] = price

                                logger.info(
                                    "Alarm hazırlandı: %s hedef=%s "
                                    "canlı_fiyat=%s yön=%s",
                                    symbol,
                                    target,
                                    price,
                                    direction
                                )

                            continue

                        triggered = (
                            price >= target
                            if alarm["direction"] == "above"
                            else price <= target
                        )

                        if triggered:
                            await _fire_alarm(alarm, price)

                            if alarm in alarm_cache.get(symbol, []):
                                alarm_cache[symbol].remove(alarm)

        except asyncio.CancelledError:
            raise

        except Exception as exc:
            logger.warning(
                "Alarm WebSocket bağlantısı koptu/hata oluştu: %s",
                exc
            )

            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, 60)

        else:
            reconnect_delay = 3


# ============================================================
# EPOCH SFP ALERT SYSTEM - WEBSOCKET + MONGODB
# ============================================================

def sfp_pivot(src: List[float], left: int, right: int, high: bool):
    out = [None] * len(src)

    for i in range(left + right, len(src)):
        p = i - right
        value = src[p]

        if value is None or not math.isfinite(value):
            continue

        ok = True

        for j in range(p - left, p):
            v = src[j]

            if v is None or not math.isfinite(v):
                ok = False
                break

            if high and v > value:
                ok = False
                break

            if not high and v < value:
                ok = False
                break

        if not ok:
            continue

        for j in range(p + 1, i + 1):
            v = src[j]

            if v is None or not math.isfinite(v):
                ok = False
                break

            if high and v >= value:
                ok = False
                break

            if not high and v <= value:
                ok = False
                break

        if ok:
            out[i] = value

    return out


def ema_last(values: List[float], length: int) -> Optional[float]:
    if len(values) < length:
        return None

    alpha = 2.0 / (length + 1.0)
    result = values[0]

    for value in values[1:]:
        result = (value * alpha) + (result * (1.0 - alpha))

    return result


def epoch_sfp_conditions(bars: List[dict]) -> dict:
    if len(bars) < SFP_SWING_LEN + SFP_RIGHT_BARS + 2:
        return {
            "bull": False,
            "bear": False,
            "ema_fast": None,
            "ema_slow": None
        }

    highs = [float(b["h"]) for b in bars]
    lows = [float(b["l"]) for b in bars]
    closes = [float(b["c"]) for b in bars]

    ph = sfp_pivot(
        highs,
        SFP_SWING_LEN,
        SFP_RIGHT_BARS,
        True
    )

    pl = sfp_pivot(
        lows,
        SFP_SWING_LEN,
        SFP_RIGHT_BARS,
        False
    )

    swing_high = None
    swing_low = None

    last_index = len(bars) - 1

    for i in range(len(bars)):
        if ph[i] is not None:
            swing_high = ph[i]

        if pl[i] is not None:
            swing_low = pl[i]

    current = bars[last_index]

    bull = False
    bear = False

    if swing_high is not None:
        bear = (
            current["h"] > swing_high
            and current["o"] < swing_high
            and current["c"] < swing_high
        )

    if swing_low is not None:
        bull = (
            current["l"] < swing_low
            and current["o"] > swing_low
            and current["c"] > swing_low
        )

    fast = ema_last(closes, SFP_EMA_FAST)
    slow = ema_last(closes, SFP_EMA_SLOW)

    return {
        "bull": bull,
        "bear": bear,
        "ema_fast": fast,
        "ema_slow": slow
    }


def _parse_ws_kline(kline: dict) -> Optional[dict]:
    try:
        bar = {
            "t": int(kline["t"]),
            "o": float(kline["o"]),
            "h": float(kline["h"]),
            "l": float(kline["l"]),
            "c": float(kline["c"])
        }

        values = (
            bar["o"],
            bar["h"],
            bar["l"],
            bar["c"]
        )

        if any(
            not math.isfinite(v) or v <= 0
            for v in values
        ):
            return None

        if bar["h"] < bar["l"]:
            return None

        return bar

    except (KeyError, TypeError, ValueError):
        return None


async def _load_sfp_symbol_history(symbol: str) -> int:
    """
    SFP geçmişini Binance REST yerine MongoDB'den yükler.
    """

    try:
        docs = await db.sfp_bars.find(
            {"symbol": symbol},
            {"_id": 0, "symbol": 0}
        ).sort("t", -1).limit(SFP_HISTORY_LIMIT).to_list(
            SFP_HISTORY_LIMIT
        )

        bars = list(reversed(docs))

        if bars:
            SFP_BARS[symbol] = bars

        logger.info(
            "SFP MongoDB geçmişi yüklendi: %s mum=%s",
            symbol,
            len(bars)
        )

        return len(bars)

    except Exception:
        logger.exception(
            "SFP MongoDB geçmişi yüklenemedi: %s",
            symbol
        )
        return 0


async def _save_sfp_closed_bar(symbol: str, bar: dict):
    """
    Yalnızca kapanmış mumları MongoDB'ye kaydeder.
    Canlı mum güncellemeleri MongoDB'ye yazılmaz.
    """

    try:
        await db.sfp_bars.update_one(
            {
                "symbol": symbol,
                "t": bar["t"]
            },
            {
                "$set": {
                    "symbol": symbol,
                    "t": bar["t"],
                    "o": bar["o"],
                    "h": bar["h"],
                    "l": bar["l"],
                    "c": bar["c"],
                    "updated_at": now_iso()
                }
            },
            upsert=True
        )

        # Her sembol için yalnızca son 200 kapanmış mum tutulur.
        latest = await db.sfp_bars.find(
            {"symbol": symbol},
            {"_id": 0, "t": 1}
        ).sort("t", -1).limit(SFP_HISTORY_LIMIT).to_list(
            SFP_HISTORY_LIMIT
        )

        if len(latest) >= SFP_HISTORY_LIMIT:
            oldest_kept = latest[-1]["t"]

            await db.sfp_bars.delete_many({
                "symbol": symbol,
                "t": {"$lt": oldest_kept}
            })

    except Exception:
        logger.exception(
            "SFP kapanmış mum MongoDB'ye kaydedilemedi: %s",
            symbol
        )


async def _load_favorite_users() -> Dict[str, set]:
    """
    Kullanıcıların tüm favori gruplarını tarar.
    Sonuç: {SYMBOL: {user_id, ...}}
    """

    result: Dict[str, set] = {}

    cursor = db.workspaces.find(
        {},
        {
            "_id": 0,
            "user_id": 1,
            "favorites": 1
        }
    )

    async for doc in cursor:
        user_id = doc.get("user_id")
        favorites = doc.get("favorites") or []

        if not user_id or not isinstance(favorites, list):
            continue

        for group in favorites:
            if not isinstance(group, dict):
                continue

            symbols = group.get("symbols", [])

            if not isinstance(symbols, list):
                continue

            for raw_symbol in symbols:
                symbol = str(raw_symbol).upper().strip()

                if not symbol.isalnum():
                    continue

                result.setdefault(symbol, set()).add(user_id)

    return result


async def _send_sfp_notification(
    user_id: str,
    symbol: str,
    direction: str,
    candle_time: int,
    price: float,
    ema_fast: float,
    ema_slow: float
):
    event_key = (
        f"{user_id}:{symbol}:{direction}:{candle_time}"
    )

    event = await db.sfp_events.find_one({
        "event_key": event_key
    })

    if event and event.get("sent"):
        return

    if event:
        last_attempt = float(event.get("last_attempt", 0) or 0)

        if time.time() - last_attempt < 60:
            return

    await db.sfp_events.update_one(
        {"event_key": event_key},
        {
            "$set": {
                "user_id": user_id,
                "symbol": symbol,
                "direction": direction,
                "candle_time": candle_time,
                "last_attempt": time.time(),
                "updated_at": now_iso()
            },
            "$setOnInsert": {
                "event_key": event_key,
                "created_at": now_iso(),
                "sent": False
            }
        },
        upsert=True
    )

    if direction == "LONG":
        title = f"🟢 {symbol} LONG SFP"
        body = (
            f"30m Bullish SFP oluştu. "
            f"EMA 38 ({fmt_tr(ema_fast)}) > "
            f"EMA 62 ({fmt_tr(ema_slow)}). "
            f"Fiyat: {fmt_tr(price)}"
        )
    else:
        title = f"🔴 {symbol} SHORT SFP"
        body = (
            f"30m Bearish SFP oluştu. "
            f"EMA 38 ({fmt_tr(ema_fast)}) < "
            f"EMA 62 ({fmt_tr(ema_slow)}). "
            f"Fiyat: {fmt_tr(price)}"
        )

    tag = f"sfp-{symbol}-{direction}-{candle_time}"

    sent = await push_user(
        user_id,
        {
            "title": title,
            "body": body,
            "tag": tag,
            "url": f"/?symbol={symbol}"
        }
    )

    await db.sfp_events.update_one(
        {"event_key": event_key},
        {
            "$set": {
                "sent": sent > 0,
                "sent_count": sent,
                "last_attempt": time.time(),
                "updated_at": now_iso()
            }
        }
    )

    if sent:
        logger.info(
            "SFP bildirimi gönderildi: %s %s user=%s mum=%s",
            symbol,
            direction,
            user_id[:8],
            candle_time
        )
    else:
        logger.warning(
            "SFP bildirimi gönderilemedi/abonelik yok: %s %s user=%s",
            symbol,
            direction,
            user_id[:8]
        )


async def _process_sfp_kline(
    symbol: str,
    kline: dict,
    favorite_users: Dict[str, set]
):
    """
    WebSocket 30m mumunu işler.

    Devam eden mum bellekte güncellenir.
    Kapanan mum MongoDB'ye kaydedilir.
    """

    bar = _parse_ws_kline(kline)

    if not bar:
        return

    bars = SFP_BARS.setdefault(symbol, [])

    if not bars:
        bars.append(bar)

    elif bars[-1]["t"] == bar["t"]:
        bars[-1] = bar

    elif bars[-1]["t"] < bar["t"]:
        bars.append(bar)
        bars[:] = bars[-SFP_HISTORY_LIMIT:]

    else:
        # Eski bir mum mesajı geldiyse geçmişi geriye sarmıyoruz.
        return

    # Binance kline mesajındaki x alanı mumun kapandığını belirtir.
    is_closed = bool(kline.get("x", False))

    if is_closed:
        await _save_sfp_closed_bar(symbol, bar)

    # EMA 62 için yeterli geçmiş yoksa henüz sinyal üretme.
    if len(bars) < SFP_EMA_SLOW:
        return

    users = favorite_users.get(symbol)

    if not users:
        return

    result = epoch_sfp_conditions(bars)

    fast = result["ema_fast"]
    slow = result["ema_slow"]

    if fast is None or slow is None:
        return

    price = bar["c"]
    candle_time = bar["t"]

    # Bullish SFP + EMA Fast > EMA Slow = LONG
    if result["bull"] and fast > slow:
        for user_id in users:
            await _send_sfp_notification(
                user_id,
                symbol,
                "LONG",
                candle_time,
                price,
                fast,
                slow
            )

    # Bearish SFP + EMA Fast < EMA Slow = SHORT
    if result["bear"] and fast < slow:
        for user_id in users:
            await _send_sfp_notification(
                user_id,
                symbol,
                "SHORT",
                candle_time,
                price,
                fast,
                slow
            )


async def sfp_loop():
    """
    Favori coinleri Binance USD-M Futures 30m kline WebSocket
    üzerinden takip eder.

    SFP geçmişi yalnızca MongoDB'den yüklenir.
    Bu görev Binance REST klines isteği yapmaz.
    """

    reconnect_delay = 3

    while True:
        try:
            favorite_users = await _load_favorite_users()
            symbols = set(favorite_users.keys())

            if not symbols:
                logger.info("SFP takip: Favorilerde izlenecek coin yok.")
                await asyncio.sleep(15)
                continue

            logger.info(
                "SFP takip başlıyor. Favori coin sayısı: %s",
                len(symbols)
            )

            # Geçmişi MongoDB'den yükle.
            # Daha önce kaydı olmayan semboller boş başlayacak.
            for symbol in sorted(symbols):
                if symbol not in SFP_BARS:
                    await _load_sfp_symbol_history(symbol)

            streams = "/".join(
                f"{symbol.lower()}@kline_30m"
                for symbol in sorted(symbols)
            )

            ws_url = (
                "wss://fstream.binance.com/market/stream"
                f"?streams={streams}"
            )

            logger.info(
                "SFP WebSocket bağlanıyor. Semboller: %s",
                ", ".join(sorted(symbols))
            )

            async with websockets.connect(
                ws_url,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=10,
                max_size=2**20
            ) as ws:

                logger.info(
                    "SFP WebSocket bağlandı. Coin sayısı: %s",
                    len(symbols)
                )

                last_refresh = time.monotonic()

                while True:
                    try:
                        raw_message = await asyncio.wait_for(
                            ws.recv(),
                            timeout=5
                        )
                    except asyncio.TimeoutError:
                        raw_message = None

                    if (
                        time.monotonic() - last_refresh
                        >= SFP_REFRESH_SECONDS
                    ):
                        favorite_users = await _load_favorite_users()
                        refreshed_symbols = set(favorite_users.keys())

                        if refreshed_symbols != symbols:
                            logger.info(
                                "Favori semboller değişti; "
                                "SFP WebSocket yenilenecek."
                            )
                            break

                        last_refresh = time.monotonic()

                    if raw_message is None:
                        continue

                    try:
                        message = json.loads(raw_message)

                        if not isinstance(message, dict):
                            continue

                        data = message.get("data", message)

                        if not isinstance(data, dict):
                            continue

                        symbol = str(data.get("s", "")).upper()
                        kline = data.get("k")

                        if (
                            not symbol
                            or not isinstance(kline, dict)
                            or kline.get("i") != SFP_INTERVAL
                        ):
                            continue

                    except (json.JSONDecodeError, TypeError, ValueError):
                        logger.warning(
                            "SFP WebSocket mesajı çözümlenemedi: %s",
                            str(raw_message)[:300]
                        )
                        continue

                    if symbol not in symbols:
                        continue

                    await _process_sfp_kline(
                        symbol,
                        kline,
                        favorite_users
                    )

        except asyncio.CancelledError:
            raise

        except Exception as exc:
            logger.warning(
                "SFP WebSocket bağlantısı koptu/hata oluştu: %s",
                exc
            )

            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, 60)

        else:
            reconnect_delay = 3


# ---------------- app setup ----------------

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

    http = httpx.AsyncClient(
        timeout=15,
        headers={"User-Agent": "Mozilla/5.0 Epochveras"}
    )

    cooldown_doc = await db.system_state.find_one({
        "_id": "binance_cooldown"
    })

    if cooldown_doc:
        BINANCE_COOLDOWN_UNTIL = float(
            cooldown_doc.get("until", 0.0) or 0.0
        )

    if BINANCE_COOLDOWN_UNTIL > time.time():
        logger.warning(
            "Binance REST koruması devam ediyor. Kalan süre: %s saniye",
            int(BINANCE_COOLDOWN_UNTIL - time.time())
        )
    else:
        BINANCE_COOLDOWN_UNTIL = 0.0

    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)

    await db.alarms.create_index([
        ("user_id", 1),
        ("created_at", -1)
    ])
    await db.alarms.create_index("active")

    await db.drawings.create_index(
        [("user_id", 1), ("symbol", 1)],
        unique=True
    )

    await db.workspaces.create_index("user_id", unique=True)
    await db.push_subs.create_index("endpoint", unique=True)
    await db.push_subs.create_index("user_id")
    await db.login_attempts.create_index("identifier")

    # SFP bildirimlerinde aynı kullanıcı/coin/yön/mum tekrar etmesin.
    await db.sfp_events.create_index(
        "event_key",
        unique=True
    )

    # SFP kapanmış mumları sembol ve mum zamanına göre saklanır.
    await db.sfp_bars.create_index(
        [("symbol", 1), ("t", -1)],
        unique=True
    )

    admin_email = os.environ["ADMIN_EMAIL"].lower()

    if not await db.users.find_one({"email": admin_email}):
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "name": "Admin",
            "password_hash": hash_password(
                os.environ["ADMIN_PASSWORD"]
            ),
            "role": "admin",
            "created_at": now_iso()
        })

    app.state.alarm_task = asyncio.create_task(alarm_loop())
    app.state.sfp_task = asyncio.create_task(sfp_loop())

    logger.info("Epochveras alarm ve SFP görevleri başlatıldı.")


@app.on_event("shutdown")
async def shutdown():
    tasks = []

    for task_name in ("alarm_task", "sfp_task"):
        task = getattr(app.state, task_name, None)

        if task:
            task.cancel()
            tasks.append(task)

    if tasks:
        with suppress(asyncio.CancelledError):
            await asyncio.gather(*tasks, return_exceptions=True)

    if PUSH_TASKS:
        await asyncio.gather(
            *list(PUSH_TASKS),
            return_exceptions=True
        )

    if http is not None:
        await http.aclose()

    client.close()
