async def _bootstrap_sfp_symbol(symbol: str):
    """
    EMA ve pivot hesaplaması için geçmiş 30m mumlarını yükler.
    Başarısız denemelerde de 60 saniyelik bekleme süresini uygular.
    """

    # ÖNEMLİ: Başarısız olsa bile deneme zamanını kaydet.
    # Böylece her WebSocket mesajında tekrar REST denemesi yapılmaz.
    SFP_LAST_BOOTSTRAP[symbol] = time.time()

    try:
        data = await bget(
            "/fapi/v1/klines",
            {
                "symbol": symbol,
                "interval": SFP_INTERVAL,
                "limit": SFP_HISTORY_LIMIT
            },
            ttl=5
        )

        bars = [
            _parse_binance_kline(row)
            for row in data
            if isinstance(row, list) and len(row) >= 5
        ]

        if len(bars) < SFP_EMA_SLOW:
            logger.warning(
                "SFP geçmiş verisi yetersiz: %s mum=%s",
                symbol,
                len(bars)
            )
            return False

        SFP_BARS[symbol] = bars[-SFP_HISTORY_LIMIT:]

        logger.info(
            "SFP geçmiş mumları yüklendi: %s mum=%s",
            symbol,
            len(SFP_BARS[symbol])
        )

        return True

    except Exception as exc:
        logger.warning(
            "SFP geçmiş mumları alınamadı: %s hata=%s",
            symbol,
            exc
        )
        return False
