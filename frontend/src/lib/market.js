
const WS_BASE = "wss://fstream.binance.com/market/stream?streams=";
const REST_BASE = "https://fapi.binance.com";

async function binanceGet(path) {
  const response = await fetch(`${REST_BASE}${path}`);

  if (!response.ok) {
    throw new Error(`Binance HTTP ${response.status}`);
  }

  return response.json();
}

// Binance Futures sembol listesi
export async function fetchSymbols() {
  const results = await Promise.allSettled([
    binanceGet("/fapi/v1/exchangeInfo"),
    binanceGet("/fapi/v1/fundingInfo"),
  ]);

  const exchangeInfo =
    results[0].status === "fulfilled"
      ? results[0].value
      : null;

  if (!exchangeInfo?.symbols?.length) {
    throw new Error("Binance sembol listesi alınamadı");
  }

  const fundingInfo =
    results[1].status === "fulfilled"
      ? results[1].value
      : [];

  const fundingMap = new Map(
    (Array.isArray(fundingInfo) ? fundingInfo : []).map((x) => [
      x.symbol,
      Number(x.fundingIntervalHours) || 8,
    ])
  );

  return exchangeInfo.symbols
    .filter((s) =>
      s.status === "TRADING" &&
      s.contractType === "PERPETUAL" &&
      s.quoteAsset === "USDT"
    )
    .map((s) => {
      const priceFilter = s.filters?.find(
        (f) => f.filterType === "PRICE_FILTER"
      );

      return {
        symbol: s.symbol,
        base: s.baseAsset,
        quote: s.quoteAsset,
        tick: priceFilter?.tickSize || "0.01",
        type: s.underlyingType || "COIN",
        fundingHours: fundingMap.get(s.symbol) || 8,
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// WebSocket bağlantısı
class Socket {
  constructor(streams, onMsg, onStatus) {
    this.streams = streams;
    this.onMsg = onMsg;
    this.onStatus = onStatus;
    this.closed = false;
    this.open = false;
    this.retryTimer = null;

    this.connect();
  }

  connect() {
    if (this.closed) return;

    try {
      this.ws = new WebSocket(
        WS_BASE + this.streams.join("/")
      );
    } catch {
      this.retry();
      return;
    }

    this.ws.onopen = () => {
      this.open = true;
      this.onStatus?.(true);
    };

    this.ws.onmessage = (event) => {
      try {
        this.onMsg(JSON.parse(event.data));
      } catch (error) {
        console.warn("WebSocket mesajı okunamadı:", error);
      }
    };

    this.ws.onclose = () => {
      this.open = false;
      this.onStatus?.(false);
      this.retry();
    };

    this.ws.onerror = () => {
      try {
        this.ws.close();
      } catch {}
    };
  }

  retry() {
    if (this.closed || this.retryTimer) return;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, 3000);
  }

  close() {
    this.closed = true;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    try {
      this.ws?.close();
    } catch {}
  }
}

// Global piyasa verileri
export const market = {
  tickers: {},
  listeners: new Set(),
  wsOpen: false,
  statusListeners: new Set(),
  started: false,
  dirty: false,
  polling: false,

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  onStatus(fn) {
    this.statusListeners.add(fn);
    fn(this.wsOpen);

    return () => this.statusListeners.delete(fn);
  },

  emit() {
    this.listeners.forEach((fn) => fn(this.tickers));
  },

  merge(symbol, patch) {
    if (!symbol) return;

    this.tickers[symbol] = {
      ...(this.tickers[symbol] || {}),
      ...patch,
    };

    this.dirty = true;
  },

  // REST başlangıç verisi ve WebSocket kopma yedeği
  async poll() {
    if (this.polling) return;

    this.polling = true;

    try {
      const results = await Promise.allSettled([
        binanceGet("/fapi/v1/ticker/24hr"),
        binanceGet("/fapi/v1/premiumIndex"),
      ]);

      if (results[0].status === "fulfilled") {
        const tickers = results[0].value;

        if (Array.isArray(tickers)) {
          tickers.forEach((t) => {
            this.merge(t.symbol, {
              c: Number(t.lastPrice),
              P: Number(t.priceChangePercent),
              q: Number(t.quoteVolume),
            });
          });
        }
      }

      if (results[1].status === "fulfilled") {
        const premiums = results[1].value;

        if (Array.isArray(premiums)) {
          premiums.forEach((t) => {
            this.merge(t.symbol, {
              r: Number(t.lastFundingRate),
              m: Number(t.markPrice),
              T: t.nextFundingTime,
            });
          });
        }
      }
    } catch (error) {
      console.warn("Binance market data:", error.message);
    } finally {
      this.polling = false;
    }
  },

  // Tüm piyasa WebSocket akışını başlat
  start() {
    if (this.started) return;

    this.started = true;

    // İlk fiyat ve funding görüntüsü
    this.poll();

    this.sock = new Socket(
      ["!ticker@arr", "!markPrice@arr@1s"],

      (msg) => {
        const data = msg.data;

        if (!Array.isArray(data)) return;

        if (msg.stream === "!ticker@arr") {
          data.forEach((t) => {
            this.merge(t.s, {
              c: Number(t.c),
              P: Number(t.P),
              q: Number(t.q),
            });
          });
        }

        if (msg.stream === "!markPrice@arr@1s") {
          data.forEach((t) => {
            this.merge(t.s, {
              r: Number(t.r),
              m: Number(t.p),
              T: t.T,
            });
          });
        }
      },

      (open) => {
        this.wsOpen = open;

        this.statusListeners.forEach((fn) => fn(open));

        // Bağlantı yeniden açıldığında tam veri yenile
        if (open) {
          this.poll();
        }
      }
    );

    // WebSocket kapalıysa REST yedek
    this.pollTimer = setInterval(() => {
      if (!this.wsOpen) {
        this.poll();
      }
    }, 15000);

    // UI güncellemelerini grupla
    this.emitTimer = setInterval(() => {
      if (this.dirty) {
        this.dirty = false;
        this.emit();
      }
    }, 500);
  },
};

// Tek sembol ve zaman dilimi için canlı mum akışı
export function liveKlines(symbol, interval, onBar) {
  const sock = new Socket(
    [`${symbol.toLowerCase()}@kline_${interval}`],

    (msg) => {
      const k = msg.data?.k;

      if (!k) return;

      onBar({
        t: k.t,
        o: Number(k.o),
        h: Number(k.h),
        l: Number(k.l),
        c: Number(k.c),
        v: Number(k.v),
      });
    }
  );

  // WebSocket kesilirse REST yedek
  const intervalId = setInterval(async () => {
    if (sock.open) return;

    try {
      const { fetchKlines } = await import("./api");
      const bars = await fetchKlines(symbol, interval, 2);

      bars.forEach(onBar);
    } catch (error) {
      console.warn("Kline yedek verisi alınamadı:", error.message);
    }
  }, 5000);

  return () => {
    sock.close();
    clearInterval(intervalId);
  };
}
