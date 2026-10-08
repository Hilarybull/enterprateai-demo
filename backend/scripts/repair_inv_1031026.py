"""One-off repair for INV-1031026 (QA round 6, R-2).

The receipt for the £100 payment (REC-1031026) was approved and emailed, then its record was
erased by a save from a stale copy of the page. Run fa23ead4 has been stuck since, and the
£188 payment was never receipted.

This uses the Agent's own (now fixed) workflow rather than editing records by hand:
  1. retry the run: the £100 receipt is restored from the Agent's history (approval payload,
     email message id), nothing is re-sent;
  2. the run issues a receipt for the £188 payment and asks for approval to send it;
  3. with --approve, that send is approved as the business owner and the run closes.

    python scripts/repair_inv_1031026.py            # look only
    python scripts/repair_inv_1031026.py --apply    # steps 1-2
    python scripts/repair_inv_1031026.py --apply --approve
"""
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.supabase import sb_select  # noqa: E402
from app.modules.agent import integrity  # noqa: E402
from app.modules.agent.router import get_orchestrator  # noqa: E402

RUN_ID = "fa23ead4-a537-4766-aedf-aeb83d16f3d7"
INVOICE_REF = "INV-1031026"


def _invoice(data: dict) -> dict | None:
    return next((i for i in (data.get("financials") or {}).get("invoices") or [] if i.get("reference") == INVOICE_REF), None)


def _show(label: str, inv: dict | None, run: dict | None, issues: list) -> None:
    print(f"\n--- {label} ---")
    print("run:", (run or {}).get("status"), (run or {}).get("substatus"), "| step:", (run or {}).get("current_step"), "|", (run or {}).get("summary"))
    for p in (inv or {}).get("payments") or []:
        r = p.get("receipt") or {}
        print(f"  payment {p['id'][:8]} {p.get('amount'):>7}  receipt={r.get('number') or '-'}  sent_at={r.get('sent_at') or '-'}  to={r.get('sent_to') or '-'}")
    print("integrity issues:", json.dumps([{k: i.get(k) for k in ("issue", "receipt_number", "invoice_reference", "amount")} for i in issues]) or "none")


async def main(apply: bool, approve: bool) -> None:
    orch = get_orchestrator()
    run = await orch.rt.store.get_run(RUN_ID)
    if not run:
        raise SystemExit("Run not found in this database.")
    business_id = run["business_id"]
    owner = await orch.rt.business.owner_id(business_id)
    inv = _invoice(await orch.rt.business.load(business_id))
    if not inv or inv["id"] != (run.get("state") or {}).get("invoice_id"):
        raise SystemExit(f"{INVOICE_REF} is not the invoice of run {RUN_ID}; nothing done.")
    _show("before", inv, run, await integrity.check_business(orch.rt, business_id))
    if not apply:
        print("\nLook only. Re-run with --apply to repair.")
        return

    backup = Path(__file__).with_name(f"repair_inv_1031026.backup.{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json")
    approvals = await sb_select("agent_approvals", filters=[("run_id", "eq", RUN_ID)]) or []
    backup.write_text(json.dumps({"run": run, "invoice": inv, "approvals": approvals}, indent=1, default=str), encoding="utf-8")
    print(f"\nbackup written: {backup.name}")

    if run["status"] == "failed":
        run = await orch.retry(RUN_ID, owner)
    else:
        print(f"run is {run['status']}, not failed: not retried")
    inv = _invoice(await orch.rt.business.load(business_id))
    _show("after retry", inv, run, await integrity.check_business(orch.rt, business_id))

    pending = await orch.rt.store.list_approvals(run_id=RUN_ID, status="pending")
    for a in pending:
        p = a["payload"]
        print(f"\npending approval: {a['title']} | {p.get('receipt_number')} {p.get('amount')} {p.get('currency')} -> {p.get('to_email')}")
    if not approve:
        if pending:
            print("Approve it in the Agent Centre, or re-run with --apply --approve.")
        return
    for a in pending:
        if a["tool_id"] != "send_receipt" or a["payload"].get("invoice_id") != inv["id"]:
            print("unexpected approval; left for a person to decide:", a["title"])
            continue
        run = (await orch.decide_approval(RUN_ID, a["id"], owner, True))["run"]
    inv = _invoice(await orch.rt.business.load(business_id))
    _show("after approval", inv, run, await integrity.check_business(orch.rt, business_id))


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv, "--approve" in sys.argv))
