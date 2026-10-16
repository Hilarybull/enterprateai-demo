"""The workspace's exchange rates, stored with their date (the owner's QA, 16 Oct).

Documents keep their own currency; totals that mix currencies are converted into the workspace's at these stored rates and
shown as converted ("≈ ₦…"). Refreshed at most once a day, only for the currencies its documents use."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.modules.agent import business as bz

logger = logging.getLogger(__name__)


def currencies_used(data: dict) -> set[str]:
    base = bz.currency_of(data)
    f = data.get("financials") if isinstance(data.get("financials"), dict) else {}
    return {bz.doc_currency(d, base) for key in bz.DOCUMENT_LISTS for d in f.get(key) or [] if isinstance(d, dict)} - {base}


async def ensure(orch, business_id: str, data: dict | None = None) -> dict | None:
    """Today's rates for every other currency the documents use, stored on the workspace. Never blocks: a failure leaves
    the stored ones."""
    try:
        data = data if data is not None else await orch.rt.business.load(business_id) or {}
        need = currencies_used(data)
        base = bz.currency_of(data)
        today = datetime.now(timezone.utc).date().isoformat()
        snap = data.get("fx_rates") or {}
        if not need or (snap.get("base") == base and snap.get("date") == today and need <= set(snap.get("rates") or {})):
            return snap or None
        from app.shared.currency import get_rate_dated
        rates = dict(snap.get("rates") or {}) if snap.get("base") == base else {}
        dates = dict(snap.get("dates") or {}) if snap.get("base") == base else {}
        for code in need:
            r = await get_rate_dated(code, base)
            if r:
                rates[code], dates[code] = r["rate"], r["date"]
        # "date": when they were checked; "dates": the provider's own date for each rate (said with every converted amount).
        new = {"base": base, "date": today, "rates": rates, "dates": dates, "source": "exchangerate-api.com"}

        def _put(d: dict) -> None:
            d["fx_rates"] = new
        await orch.rt.business.mutate(business_id, _put)
        data["fx_rates"] = new
        return new
    except Exception:      # noqa: BLE001 - the stored rates stand
        logger.info("exchange rates not refreshed for %s", business_id, exc_info=True)
        return None
