# Epochveras — PRD

## Original problem statement (summary)
TradingView-like PWA terminal "Epochveras" for Binance USDT-M perpetuals (crypto + commodities). Black UI. Watchlist (last, %chg, 24h vol, exact funding + interval), favorites + custom groups, Kripto/Emtia tabs, soft red/green price flash. Drawings (trendline, horizontal ray, long/short template, soft magnet, ruler) that are timeframe-independent, with remembered color/width. Alarms via "+" on price scale, small tag only, server-side 24/7 checking, web push + sound + toast. Futures data panel (funding, L/S ratios as buyer/seller bars). Exact Turkish price format + candle countdown. TFs 1m..1W. Epoch Script (Pine port) + CakmaUstad RSI with all inputs editable. Account sync across devices. Reload after 2+ min in background. Backend wake splash with logo.

## Architecture
- Backend FastAPI (server.py): JWT email/password auth (30-day bearer), Binance proxy via https://www.binance.com/fapi (pod is geo-blocked from fapi.binance.com), workspace/drawings/alarms in MongoDB, alarm loop every 2s, pywebpush VAPID.
- Frontend React: custom canvas ChartEngine (src/chart/ChartEngine.js), indicators (src/lib/indicators.js), live data via wss://fstream.binance.com/market/stream with REST fallback, react-resizable-panels layout, service worker sw.js + manifest.

## Implemented (2026-11-19)
- Auth, register/login, admin seed
- Chart: candles, pan/zoom/pinch, price/time axis scaling, auto-scale, crosshair, TR price format, countdown, history load on scroll
- Drawings: trendline, hray, long/short, ruler, soft magnet, props bar, defaults remembered, per-symbol server storage by time/price
- Alarms: + button, axis tags with ×, panel, server trigger, push, sound, toast
- Watchlist, favorites/groups, Kripto/Emtia, sorting, search, white price with red/green bg
- Futures panel: funding (exact digits, interval), next funding, OI, 3 ratio bars + history
- Epoch Script: pivot breakout bar colors, EMA100/200/300, dual auto trendlines, EMA38/62 cloud, yellow/aqua candles, triangles, arrows, SFP, MTF tables, RSI divergence on whole chart
- CakmaUstad-RSI sub-pane (resizable), RSI trendlines, bands, ATR box
- Gray/white theme (no blue selections)

## Backlog
- P1: Mobile plot width (narrower axis/collapsible toolbar), axis label collision hiding, sound toggle label
- P1: Filter non-USDT pairs or add USDC/TradFi tabs; alarm price validation; CORS explicit origins
- P2: More drawing tools (fib, rectangle), more indicators, alarm on drawings

## 2026-06 Geri al / İleri al
- Üst barda geri al/ileri al düğmeleri (undo-button, redo-button), Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z kısayolları
- Sadece çizimleri kapsar (ekleme, taşıma, stil, silme, hepsini sil); 100 adım; sembol/zaman dilimi değişince geçmiş sıfırlanır
- ChartEngine: past/future/snap, undo(), redo(), onHistory callback

## Backlog
- P1: Epoch Script parametrelerinin (EMA 38/62, SFP, bulut) tamamen ayarlanabilir olduğunu doğrula
- P1: Watchlist çoklu favori grupları
- P2: Fibonacci etiketleri sol kenarda kırpılıyor

## 2026-06 Watchlist bölümleri
- Tüm listelerde (Favoriler, gruplar, Kripto, Emtia) adlandırılabilir bölümler: ekle (klasör simgesi), yeniden adlandır, sil, aç/kapat
- Sembol bölüme menüden (Bölüme taşı / Bölümden çıkar) veya tutamaktan sürükle-bırak ile taşınır; bölümsüzler "Diğer" altında
- Sıralama seçilince bölümler gizlenir; sütun başlığına 3. tıklama ya da "Bölümleri göster" ile manuel düzene dönülür
- Veri: prefs.watchlist.sections[listId] = {list:[{id,name,symbols,collapsed}], order, otherCollapsed}
