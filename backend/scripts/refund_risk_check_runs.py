"""R-1 (the owner's brief, 24 Oct): the risk check started a paid "Risk & Concentration" task every time it was run (2 credits
each, "9 similar" in History). This lists those charged runs for one workspace and, only with --apply and the owner's yes,
refunds them through the existing refund path (scripts/cleanup_agent_charges.py --refund-run).

    python scripts/refund_risk_check_runs.py <workspace_id>            # look only: what would be refunded
    python scripts/refund_risk_check_runs.py <workspace_id> --apply    # only after the owner approves the look-only output
"""
import asyncio
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def main(ws: str, apply: bool) -> None:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    from app.core.supabase import sb_select
    runs = await sb_select("agent_workflow_runs", filters=[("business_id", "eq", ws), ("workflow_key", "eq", "risk_concentration")],
                           order="created_at", desc=True, limit=200) or []
    charged = []
    for r in runs:
        credits = sum(int(c.get("credits") or 0) for c in (r.get("state") or {}).get("credits") or [] if isinstance(c, dict))
        if credits > 0 and not (r.get("state") or {}).get("refunded"):
            charged.append((r["id"], str(r.get("created_at"))[:16], r.get("source_channel"), credits))
    for rid, at, channel, credits in charged:
        print(f"{rid}  {at}  {channel or '':<14}  {credits} credits")
    print(f"\n{len(charged)} charged risk runs, {sum(c for *_, c in charged)} credits in all.")
    if not apply:
        print("Look only: nothing was changed. Re-run with --apply once this has been approved.")
        return
    for rid, *_ in charged:
        subprocess.run([sys.executable, str(Path(__file__).with_name("cleanup_agent_charges.py")), "--refund-run", rid, "--apply"], check=True)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], "--apply" in sys.argv))
