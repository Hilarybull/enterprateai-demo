"""What a task or goal learned about the business, kept as a proposal (First-Value PRD 6.1, QA R1).

Answers given for one task ("Busy pet owners in Manchester" for a dog-grooming idea) are not facts
about the company. They are kept here, with where they came from, and change the company profile
only when the owner confirms one. A confirmed value carries its provenance on the profile.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.modules.agent.models import new_id

# The profile fields a task may propose, and what each is called to the owner.
FIELDS = {"about_company": "What the business does", "target_customer": "Target customer", "problem": "The problem it solves",
          "primary_industry": "Industry", "location": "Location"}
PROPOSED, CONFIRMED, DISMISSED = "proposed", "confirmed", "dismissed"


def propose(data: dict, facts: dict[str, Any], source: dict, now: datetime | None = None) -> list[dict]:
    """Keep each fact as a proposal (never on the profile). The same value for the same field is kept once."""
    now = now or datetime.now(timezone.utc)
    kept = data.setdefault("profile_proposals", [])
    added = []
    for field, value in facts.items():
        text = str(value or "").strip()
        if field not in FIELDS or not text:
            continue
        if any(p["field"] == field and p["value"].lower() == text.lower() and p["status"] == PROPOSED for p in kept):
            continue
        item = {"id": new_id(), "field": field, "label": FIELDS[field], "value": text[:2000], "status": PROPOSED,
                "source": dict(source), "proposed_at": now.isoformat()}
        kept.append(item)
        added.append(item)
    del kept[:-50]      # the newest fifty at most
    return added


def pending(data: dict | None) -> list[dict]:
    return [p for p in (data or {}).get("profile_proposals") or [] if p.get("status") == PROPOSED]


def decide(data: dict, proposal_id: str, *, confirm: bool, user_id: str, now: datetime | None = None) -> dict:
    """Confirm (the value goes on the profile, with where it came from) or dismiss one proposal."""
    now = now or datetime.now(timezone.utc)
    item = next((p for p in data.get("profile_proposals") or [] if p.get("id") == proposal_id), None)
    if not item or item.get("status") != PROPOSED:
        raise KeyError(proposal_id)
    item.update({"status": CONFIRMED if confirm else DISMISSED, "decided_by": user_id, "decided_at": now.isoformat()})
    if confirm:
        profile = data.setdefault("workspace_profile", {})
        profile[item["field"]] = item["value"]
        profile.setdefault("provenance", {})[item["field"]] = {"source": item["source"], "confirmed_by": user_id, "confirmed_at": now.isoformat()}
    return item
