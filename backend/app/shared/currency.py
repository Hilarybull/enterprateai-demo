"""Simple async currency conversion with a 1-hour in-process cache."""
from __future__ import annotations

import time
from typing import Optional

import httpx

# {base_currency: ({"USD": rate, ...}, fetched_at)}; the provider's own date for those rates in _rate_dates.
_rate_cache: dict[str, tuple[dict[str, float], float]] = {}
_rate_dates: dict[str, str] = {}
PROVIDER = "exchangerate-api.com"      # live rates (not a fixed table), with the provider's date for them
_CACHE_TTL = 3600  # 1 hour


async def fetch_rates(base: str) -> dict[str, float]:
    """Return exchange rates relative to base currency. Empty dict on failure."""
    base = base.upper()
    now = time.time()
    if base in _rate_cache:
        rates, ts = _rate_cache[base]
        if now - ts < _CACHE_TTL:
            return rates
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"https://api.exchangerate-api.com/v4/latest/{base}",
                follow_redirects=True,
            )
            if resp.status_code == 200:
                data = resp.json()
                rates = {k.upper(): float(v) for k, v in (data.get("rates") or {}).items()}
                _rate_cache[base] = (rates, now)
                if data.get("date"):
                    _rate_dates[base] = str(data["date"])[:10]
                return rates
    except Exception:
        pass
    return {}


async def get_rate(from_currency: str, to_currency: str) -> Optional[float]:
    """Return the exchange rate from→to, or None if unavailable."""
    from_currency = from_currency.upper()
    to_currency = to_currency.upper()
    if from_currency == to_currency:
        return 1.0
    rates = await fetch_rates(from_currency)
    return rates.get(to_currency)


async def get_rate_dated(from_currency: str, to_currency: str) -> Optional[dict]:
    """The rate with the provider's date for it: {"rate", "date", "source"}; None if unavailable."""
    import datetime as _dt
    rate = await get_rate(from_currency, to_currency)
    if rate is None:
        return None
    day = _rate_dates.get(from_currency.upper()) or _dt.date.today().isoformat()
    return {"rate": rate, "date": day, "source": PROVIDER}


def convert(amount: float, rate: Optional[float]) -> float:
    """Apply rate to amount; return original if rate is None."""
    if rate is None:
        return amount
    return round(amount * rate, 2)
