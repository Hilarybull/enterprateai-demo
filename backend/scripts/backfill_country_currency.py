"""One-off, safe to run again (16 Oct 2026): a workspace with a country on its profile and no saved currency gets its
country's currency saved (Nigeria: NGN). Documents already made keep the currency they were made in (stamped GBP, the
default they showed in). Nothing is written without --apply.

    python scripts/backfill_country_currency.py            # look only
    python scripts/backfill_country_currency.py --apply    # write it
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def main(apply: bool) -> None:
    from app.core.supabase import sb_select
    from app.modules.agent.business import SupabaseBusiness, country_currency, save_country_currency
    rows = await sb_select("workspaces", columns="id,name,data") or []
    store = SupabaseBusiness()
    for row in rows:
        d = row.get("data") or {}
        if str((d.get("settings") or {}).get("currency") or "").strip():
            continue
        code = country_currency(d)
        if not code:
            continue
        country = (d.get("workspace_profile") or {}).get("country")
        print(f"{row['id']} {row.get('name')!r}: country {country!r} -> currency {code}")
        if apply:
            await store.mutate(row["id"], save_country_currency)


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
