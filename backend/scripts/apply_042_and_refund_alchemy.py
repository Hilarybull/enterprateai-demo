"""One-off (approved by the owner, 15 Oct 2026):
  1. Migration 042 (credit allocation v2) applied to the price list through the API: the same UPDATEs and the four new
     research rows. The SQL file stays the record; this writes the same values.
  2. Alchemy Test's research charge for a run that found nothing, refunded once: "Refunded: research found nothing · +60".
     The refund carries the charge's id in its description, so a second run finds it and skips it.

Nothing is written without --apply.

    python scripts/apply_042_and_refund_alchemy.py            # look only
    python scripts/apply_042_and_refund_alchemy.py --apply    # do it
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

UPDATES = {"idea_validation": {"credit_cost": 0, "credit_controlled": False}, "idea_validation_comprehensive": {"credit_cost": 25},
           "business_plan_full": {"credit_cost": 40}, "business_plan_section": {"credit_cost": 5}, "proposal_full": {"credit_cost": 10},
           "sales_letter_full": {"credit_cost": 4}, "scenario_ai_interpretation": {"credit_cost": 15}, "live_plan_full_refresh": {"credit_cost": 20},
           "agent_task": {"credit_cost": 2}}
NEW = [("research_launch_blockers", "Resolve launch blockers", 50), ("research_funding_readiness", "Funding readiness research", 60),
       ("research_best_price", "Find my best price", 40), ("research_customer_opportunities", "Find customer opportunities", 40)]
WORKSPACE = "Alchemy Test"
FEATURE = "research_funding_readiness"


async def main(apply: bool) -> None:
    from app.core.supabase import sb_select, sb_update, sb_upsert
    from app.modules.credits.service import get_transactions, grant_credits

    print("── 042: price list")
    rows = {r["feature_code"]: r for r in await sb_select("credit_feature_config", filters=[("feature_code", "in", list(UPDATES) + [n[0] for n in NEW])]) or []}
    for code, change in UPDATES.items():
        had = rows.get(code)
        print(f"  {code:34} {'missing' if not had else {k: had.get(k) for k in change}} -> {change}")
        if apply and had:
            await sb_update("credit_feature_config", payload=change, filters=[("feature_code", "eq", code)])
    for code, name, cost in NEW:
        print(f"  {code:34} {'new' if code not in rows else rows[code].get('credit_cost')} -> {cost}")
        if apply:
            await sb_upsert("credit_feature_config", payload={"feature_code": code, "feature_name": name, "credit_cost": cost, "enabled": True,
                                                              "minimum_plan": "starter_insight", "refundable_on_failure": True, "credit_controlled": True},
                            on_conflict="feature_code")

    print(f"── refund: {WORKSPACE}")
    ws = await sb_select("workspaces", filters=[("name", "eq", WORKSPACE)], columns="id,user_id,name")
    if not ws:
        print("  workspace not found by name; nothing refunded")
        return
    owner = ws[0]["user_id"]
    charges = [t for t in await get_transactions(owner, limit=200, feature_code=FEATURE) if int(t.get("amount") or 0) < 0]
    refunds = await get_transactions(owner, limit=200, transaction_type="refund")
    for t in charges:
        tag = f"[charge:{t['id']}]"
        done = any(tag in str(r.get("description") or "") for r in refunds)
        amount = abs(int(t["amount"]))
        print(f"  charge {t['id']} {t.get('created_at')} {t.get('status')} {t.get('description')!r} {-amount}  {'already refunded' if done else 'to refund +' + str(amount)}")
        if apply and not done:
            print("   ", await grant_credits(owner, amount, "refund", f"Refunded: research found nothing {tag}"))
    if not charges:
        print("  no research_funding_readiness charge found")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
