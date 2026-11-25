const WS_BASE = "wss://fstream.binance.com/market/stream?streams=";
const REST_BASE = "https://fapi.binance.com";

async function binanceGet(path) {
  const response = await fetch(`${REST_BASE}${path}`);

  if (!response.ok) {
    throw new Error(`Binance HTTP ${response.status}`);
  }

  return response.json();
}

export async function fetchSymbols() {
  const results = await Promise.allSettled([
    binanceGet("/fapi/v1/exchangeInfo"),
    binanceGet("/fapi/v1/fundingInfo"),
  ]);

  const exchangeInfo = results[0].status === "fulfilled"
    ? results[0].value
    : null;

  if (!exchangeInfo?.symbols?.length) {
    throw new Error("Binance sembol listesi alınamadı");
  }

  const fundingInfo = results[1].status === "fulfilled"
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
        type: "COIN",
        fundingHours: fundingMap.get(s.symbol) || 8,
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

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
      this.ws = new WebSocket(WS_BASE + this.streams.join("/"));
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
      } catch {}
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
    this.tickers[symbol] = {
      ...(this.tickers[symbol] || {}),
      ...patch,
    };

    this.dirty = true;
  },

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

        tickers.forEach((t) => {
          this.merge(t.symbol, {
            c: +t.lastPrice,
            P: +t.priceChangePercent,
            q: +t.quoteVolume,
          });
        });
      }

      if (results[1].status === "fulfilled") {
        const premiums = results[1].value;

        premiums.forEach((t) => {
          this.merge(t.symbol, {
            r: +t.lastFundingRate,
            m: +t.markPrice,
            T: t.nextFundingTime,
          });
        });
      }
    } catch (error) {
      console.warn("Binance market data:", error.message);
    } finally {
      this.polling = false;
    }
  },

  start() {
    if (this.started) return;

    this.started = true;

    // Initial snapshot: all symbols, prices, volume and funding.
    this.poll();

    this.sock = new Socket(
      ["!ticker@arr", "!markPrice@arr@1s"],
      (msg) => {
        const data = msg.data;

        if (!Array.isArray(data)) return;

        if (msg.stream === "!ticker@arr") {
          data.forEach((t) => {
            this.merge(t.s, {
              c: +t.c,
              P: +t.P,
              q: +t.q,
            });
          });
        } else if (msg.stream === "!markPrice@arr@1s") {
          data.forEach((t) => {
            this.merge(t.s, {
              r: +t.r,
              m: +t.p,
              T: t.T,
            });
          });
        }
      },
      (open) => {
        this.wsOpen = open;
        this.statusListeners.forEach((fn) => fn(open));

        // Refresh a full snapshot after reconnecting.
        if (open) this.poll();
      }
    );

    // REST fallback only while the WebSocket is disconnected.
    this.pollTimer = setInterval(() => {
      if (!this.wsOpen) this.poll();
    }, 15000);

    // Batch UI updates instead of rendering on every incoming message.
    this.emitTimer = setInterval(() => {
      if (this.dirty) {
        this.dirty = false;
        this.emit();
      }
    }, 500);
  },
};

// Live kline feed for one symbol/interval.
// Historical fallback uses direct Binance REST through api.js.
export function liveKlines(symbol, interval, onBar) {
  const sock = new Socket(
    [`${symbol.toLowerCase()}@kline_${interval}`],
    (msg) => {
      const k = msg.data?.k;

      if (!k) return;

      onBar({
        t: k.t,
        o: +k.o,
        h: +k.h,
        l: +k.l,
        c: +k.c,
        v: +k.v,
      });
    }
  );

  const intervalId = setInterval(async () => {
    if (sock.open) return;

    try {
      const { fetchKlines } = await import("./api");
      const bars = await fetchKlines(symbol, interval, 2);
      bars.forEach(onBar);
    } catch {}
  }, 5000);

  return () => {
    sock.close();
    clearInterval(intervalId);
  };
}
