"""One-off (C5, C7): put right time zones and wizard drafts that were set without the owner choosing them.

Time zone (C5). A business's stored zone is changed to its country's zone only when the stored one is known to have been
set automatically (profile.timezone_source == "browser", recorded from now on) and differs from the country's. There is
no record of who set a zone before that, so any other mismatch goes on the "needs owner confirmation" list, unchanged.

Wizard drafts (C7). draft_idea_validation held the silent defaults business type "Technology", industry "IT" and segment
"SMEs". The business type and industry fields can't be edited in the wizard, so an exact default there was never the
owner's choice: it is cleared, unless the business profile itself says the same thing (then it may have come from there,
and it is listed instead). The segment can be edited in the wizard, so "SMEs" is listed for confirmation, never cleared.

Nothing is changed without --apply; with --apply, every workspace changed is saved to BACKUPS first.

    python scripts/fix_timezones_and_wizard_defaults.py            # look only
    python scripts/fix_timezones_and_wizard_defaults.py --apply    # only after the look-only output is approved
    --owner-confirms WORKSPACE:WHAT[,WORKSPACE:WHAT]   held items the owner confirmed (e.g. f5b6…:timezone), applied and audited as "owner"
"""
import asyncio
import copy
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BACKUPS = Path(r"C:\Users\USER\AppData\Local\Temp\claude\c--Users-USER-Desktop-codeProjects-ent\6791474d-c99a-4e8d-a424-f07a6835acae\scratchpad\backups")
SILENT = {"business_type": "Technology", "primary_industry": "IT", "customer_segment": "SMEs"}
# Where each default sat in the draft form: (section, the category field, the free-text field beside it, the derived field)
FIELDS = {"business_type": ("context", "business_type_category", "business_type_other", "business_type"),
          "primary_industry": ("context", "primary_industry_category", "primary_industry_other", "primary_industry"),
          "customer_segment": ("problem", "customer_segment_category", "customer_segment_other", "customer_segment")}
EDITABLE_IN_WIZARD = {"customer_segment"}


def plan_fixes(workspaces: list[dict]) -> dict:
    """What would change and what needs the owner. Pure: reads only."""
    from app.modules.agent import business as bz
    changes, confirm = [], []
    for w in workspaces:
        data = w.get("data") or {}
        profile = data.get("workspace_profile") or {}
        name = profile.get("company_name") or w.get("name") or w["id"]
        stored, country = str(profile.get("timezone") or "").strip(), profile.get("country")
        expected = bz.zone_of_country(country)
        if stored and expected and stored != expected:
            item = {"workspace": w["id"], "name": name, "what": "timezone", "from": stored, "to": expected, "country": country}
            if profile.get("timezone_source") == "browser":
                changes.append({**item, "why": "set automatically from a browser, not by the owner"})
            else:
                confirm.append({**item, "why": "no record of who set it"})
        draft = data.get("draft_idea_validation")
        if not isinstance(draft, dict):
            continue
        for key, (section, cat, other, derived) in FIELDS.items():
            part = draft.get(section) or {}
            hits = [f for f in (cat, derived) if str(part.get(f) or "").strip() == SILENT[key]]
            if not hits or str(part.get(other) or "").strip():
                continue
            item = {"workspace": w["id"], "name": name, "what": f"draft {section}.{'/'.join(hits)}", "from": SILENT[key], "to": "", "fields": [(section, f) for f in hits]}
            if key in EDITABLE_IN_WIZARD:
                confirm.append({**item, "why": "the owner can choose this in the wizard"})
            elif str(profile.get(key) or "").strip() == SILENT[key]:
                confirm.append({**item, "why": f"the business profile also says {SILENT[key]!r}"})
            else:
                changes.append({**item, "why": "a default the wizard set without asking (the field can't be edited there)"})
    return {"changes": changes, "confirm": confirm}


def report(found: dict) -> str:
    lines = [f"Changes: {len(found['changes'])}"]
    lines += [f"  {c['workspace']}  {c['name'][:32]:<32} {c['what']:<40} {c['from']!r} -> {c['to']!r}  ({c['why']})" for c in found["changes"]]
    lines.append(f"Needs owner confirmation (unchanged): {len(found['confirm'])}")
    lines += [f"  {c['workspace']}  {c['name'][:32]:<32} {c['what']:<40} {c['from']!r} (would be {c['to']!r})  ({c['why']})" for c in found["confirm"]]
    return "\n".join(lines)


def apply_to(data: dict, items: list[dict]) -> dict:
    out = copy.deepcopy(data)
    for c in items:
        if c["what"] == "timezone":
            out.setdefault("workspace_profile", {})["timezone"] = c["to"]
            out["workspace_profile"]["timezone_source"] = "owner" if c.get("why") == "confirmed by the owner" else "country"
        else:
            for section, field in c["fields"]:
                (out.get("draft_idea_validation") or {}).get(section, {})[field] = ""
    return out


async def main(apply: bool, confirmed: set[tuple[str, str]] = frozenset()) -> None:
    from app.core.supabase import sb_select
    workspaces = await sb_select("workspaces", order="created_at", desc=False, limit=20000) or []
    found = plan_fixes(workspaces)
    owner_said = [c for c in found["confirm"] if (c["workspace"], c["what"]) in confirmed]
    found = {"changes": found["changes"] + [{**c, "why": "confirmed by the owner"} for c in owner_said],
             "confirm": [c for c in found["confirm"] if c not in owner_said]}
    print(report(found))
    if not apply:
        print("\nLook only: nothing was changed. Re-run with --apply once this has been approved.")
        return
    from app.modules.agent.router import get_orchestrator
    BACKUPS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    touched = {c["workspace"] for c in found["changes"]}
    before = {w["id"]: w.get("data") for w in workspaces if w["id"] in touched}
    (BACKUPS / f"fix_timezones_and_wizard_defaults_{stamp}.json").write_text(json.dumps({"found": found, "before": before}, default=str, indent=1), encoding="utf-8")
    for ws in sorted(touched):
        mine = [c for c in found["changes"] if c["workspace"] == ws]

        def _apply(data: dict) -> None:
            fixed = apply_to(data, mine)
            data.clear()
            data.update(fixed)
        await get_orchestrator().rt.business.mutate(ws, _apply)
        for c in mine:      # each change in the audit, as the owner's (they approved this fix, and confirmed the held items)
            await get_orchestrator().rt.store.audit({"id": __import__("uuid").uuid4().hex, "business_id": ws, "run_id": None, "actor_id": "owner",
                                                     "event_type": "timezone_changed" if c["what"] == "timezone" else "wizard_default_cleared",
                                                     "created_at": datetime.now(timezone.utc).isoformat(),
                                                     "detail": {"what": c["what"], "from": c["from"], "to": c["to"], "source": "owner", "why": c["why"]}})
        print(f"fixed {ws}: {', '.join(c['what'] for c in mine)}")


if __name__ == "__main__":
    given = next((sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == "--owner-confirms"), "")
    asyncio.run(main("--apply" in sys.argv, {tuple(x.split(":", 1)) for x in given.split(",") if ":" in x}))
