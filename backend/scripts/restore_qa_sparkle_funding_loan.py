"""Restore QA Sparkle's prior £45k loan funding need from the case's own history.

Default is read-only. --apply snapshots the current case and evidence, archives the
current grant through ReadinessService.replace_need, restores the historic loan
fields, and reattaches the loan's saved evidence.
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

WORKSPACE_ID = "f5b66653-a332-44f6-a69f-917da32f4eba"
CASE_ID = "80f0f8fc-a3be-4fe9-bd93-dee94052f162"
EXPECTED_CURRENT = {"title": "₦5m grant for stock", "target_amount": 5_000_000, "currency": "NGN",
                    "purpose": "stock", "route_preference": "grant"}
EXPECTED_PREVIOUS_TITLE = "£50k loan for a second van and hiring one cleaner"
BACKUPS = Path(r"C:\Users\USER\AppData\Local\Temp\enterprateai_backups")


def same_need(data: dict, expected: dict) -> bool:
    def equal(a, b):
        try:
            return float(a) == float(b)
        except (TypeError, ValueError):
            return str(a) == str(b)
    return all(equal(data.get(k), v) for k, v in expected.items())


async def main(apply: bool) -> None:
    from app.core.supabase import sb_select

    row = await sb_select("readiness_subjects", filters=[("id", "eq", CASE_ID), ("business_id", "eq", WORKSPACE_ID),
                                                         ("kind", "eq", "funding_case")], single=True)
    if not row:
        raise SystemExit("QA Sparkle's expected funding case was not found; nothing changed.")
    data = row.get("data") or {}
    previous = next((p for p in (data.get("previous_needs") or []) if p.get("title") == EXPECTED_PREVIOUS_TITLE), None)
    if not same_need(data, EXPECTED_CURRENT) or not previous:
        raise SystemExit("The current grant or saved loan history differs from the reviewed QA data; nothing changed.")
    values = previous.get("values") or {}
    aside = previous.get("set_aside") or {}
    target = {**values, **aside, "title": previous["title"], "route": "loan", "route_preference": "loan"}
    evidence_ids = [str(e["id"]) for e in previous.get("evidence") or [] if e.get("id")]
    print(json.dumps({
        "workspace_id": WORKSPACE_ID, "case_id": CASE_ID, "current": {k: data.get(k) for k in EXPECTED_CURRENT},
        "restore": {k: target.get(k) for k in ("title", "target_amount", "currency", "purpose", "route", "route_preference",
                                                "receipt_date", "stage", "timing_confirmed")},
        "restore_fields": sorted(k for k in target if k not in ("title", "target_amount", "currency", "purpose", "route",
                                                                  "route_preference", "receipt_date", "stage", "timing_confirmed")),
        "evidence_to_relink": evidence_ids, "grant_will_remain_in_history": True,
        "mode": "apply" if apply else "dry_run",
    }, ensure_ascii=False, default=str, indent=2))
    if not apply:
        print("Dry run only: nothing changed.")
        return

    workspace = await sb_select("workspaces", filters=[("id", "eq", WORKSPACE_ID)], columns="id,user_id,data", single=True)
    if not workspace or not workspace.get("user_id"):
        raise SystemExit("The QA Sparkle owner could not be verified; nothing changed.")
    evidence = await sb_select("readiness_evidence", filters=[("business_id", "eq", WORKSPACE_ID)], limit=500) or []
    BACKUPS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = BACKUPS / f"qa_sparkle_funding_before_restore_{stamp}.json"
    backup.write_text(json.dumps({"subject": row, "evidence": evidence}, ensure_ascii=False, default=str, indent=1), encoding="utf-8")

    from app.modules.agent.goals import need_summary
    from app.modules.agent.router import get_orchestrator
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for

    profile = ((workspace.get("data") or {}).get("workspace_profile") or {})
    email = profile.get("email")
    svc = service_for(get_orchestrator())
    restored = await svc.replace_need(
        workspace["user_id"], WORKSPACE_ID, CASE_ID, target, email=email,
        provenance={k: "Restored from your Funding Readiness history" for k in target},
        summary=need_summary(data), previous_title=data.get("title"),
    )
    # replace_need puts the grant at index 0 and leaves the old loan at index 1.
    for evidence_id in evidence_ids:
        await svc.keep_previous(workspace["user_id"], WORKSPACE_ID, CASE_ID, f"evidence:{evidence_id}", True, email=email, need=1)
    verified = await svc.store.get("subjects", CASE_ID)
    after = (verified or {}).get("data") or {}
    if not same_need(after, {"title": EXPECTED_PREVIOUS_TITLE, "target_amount": 45_000, "currency": "GBP",
                             "purpose": "second van and hiring one cleaner", "route_preference": "loan"}):
        raise SystemExit(f"Post-restore verification failed. Backup: {backup}")
    await svc.emit(await svc._ctx(workspace["user_id"], WORKSPACE_ID, email), "FundingCaseChanged", verified,
                   {"change": "restored_previous_need", "revision": verified.get("revision")})
    print(f"Restored and verified {CASE_ID}; prior grant is retained in history. Backup: {backup}")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
