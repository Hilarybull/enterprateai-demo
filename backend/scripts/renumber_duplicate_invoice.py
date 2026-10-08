"""One-off: resolve the duplicate invoice number INV-1041026 (QA round 7 follow-up 5).

Two invoices carry INV-1041026. The £40 one was sent to the customer under that number in a
reminder email, so it keeps it. The paid £50 one ("QA overdue reminder test") is renumbered to
the next free number in the business's invoice sequence.

    python scripts/renumber_duplicate_invoice.py            # look only
    python scripts/renumber_duplicate_invoice.py --apply
"""
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.modules.agent import business as bz  # noqa: E402
from app.modules.agent.router import get_orchestrator  # noqa: E402
from app.shared import invoice_numbers  # noqa: E402

BUSINESS = "1a6c2ef0-322f-4bc3-b23b-acb8ac7eab63"
NUMBER = "INV-1041026"
BACKUPS = Path(r"C:\Users\USER\AppData\Local\Temp\claude\c--Users-USER-Desktop-codeProjects-ent\6791474d-c99a-4e8d-a424-f07a6835acae\scratchpad\backups")


def _total(inv: dict) -> float:
    return bz.invoice_total(inv)


def _line(inv: dict) -> str:
    return (f"{inv['id']:<40} {invoice_numbers.number_of(inv):<13} {_total(inv):>7.2f} {str(inv.get('status')):<6} "
            f"{inv.get('description') or inv.get('title') or ''!r} reminders={len(inv.get('reminders') or [])}")


async def main(apply: bool) -> None:
    rt = get_orchestrator().rt
    data = await rt.business.load(BUSINESS)
    invoices = (data.get("financials") or {}).get("invoices") or []
    same = [i for i in invoices if invoice_numbers.key_of(invoice_numbers.number_of(i)) == NUMBER]
    print(f"invoices numbered {NUMBER}:")
    for i in same:
        print("  ", _line(i))
    target = [i for i in same if abs(_total(i) - 50) < 0.005 and bz.status_of(i) == "paid"
              and "qa overdue reminder test" in str(i.get("description") or i.get("title") or "").lower()]
    keep = [i for i in same if i not in target]
    if len(same) != 2 or len(target) != 1 or abs(_total(keep[0]) - 40) > 0.005:
        raise SystemExit("The invoices don't match what was described (one paid £50 'QA overdue reminder test', one £40). Nothing changed.")
    if not apply:
        print("\nLook only. Re-run with --apply to renumber the £50 invoice.")
        return

    BACKUPS.mkdir(parents=True, exist_ok=True)
    backup = BACKUPS / f"renumber_{NUMBER}.{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json"
    backup.write_text(json.dumps({"invoices": same}, indent=1, default=str), encoding="utf-8")

    target_id = target[0]["id"]
    taken = {invoice_numbers.number_of(i) for i in invoices if invoice_numbers.number_of(i)}
    new = await invoice_numbers.next_number(BUSINESS, bz.local_now(data, rt.clock()), taken, invoice_id=str(target_id))
    now = rt.clock().isoformat()

    def _apply(d: dict) -> None:
        inv = next(i for i in bz.records(d, "invoices") if i.get("id") == target_id)
        if invoice_numbers.key_of(invoice_numbers.number_of(inv)) != NUMBER:
            raise SystemExit("The invoice changed while this ran. Nothing changed.")
        inv.update({"invoice_number": new, "reference": new, "previous_invoice_number": NUMBER,
                    "renumbered_at": now, "renumber_reason": "Duplicate number; the other invoice was sent to the customer under it.",
                    "updated_at": now})
    await rt.business.mutate(BUSINESS, _apply)

    after = (await rt.business.load(BUSINESS)).get("financials", {}).get("invoices") or []
    print(f"\nrenumbered {target_id} -> {new}   (backup: {backup.name})")
    for i in after:
        if i["id"] in {x["id"] for x in same}:
            print("  ", _line(i))
    print("duplicate invoice numbers now:", [d["invoice_number"] for d in invoice_numbers.duplicate_numbers(after)] or "none")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
