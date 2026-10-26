"""Every Agent output is a draft in its own module, for the owner's review (the owner's QA, 15 Oct): a business plan in
Business Blueprints, an idea's validation in Idea Validation History, a launch plan in Launch Readiness. Each is pending
until the owner accepts or rejects it; pending drafts are in Needs Approval ("Needs your review"), and the task that made
one reads "Waiting for your review" until it is accepted, then "Done"."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

PENDING, ACCEPTED, REJECTED = "pending", "accepted", "rejected"
WORD = {"business_plan": "Business plan", "sales_letter": "Sales letter", "proposal": "Proposal", "idea_validation": "Idea validation",
        "launch_plan": "Launch plan"}


def add(data: dict, *, kind: str, title: str, to: str, run_id: str | None, ref: str | None = None, now: datetime | None = None,
        inputs: dict | None = None) -> dict:
    """The draft, pending (one per document: the same one again is updated, never listed twice)."""
    now = now or datetime.now(timezone.utc)
    items = data.setdefault("agent_drafts", [])
    key = ref or run_id or to
    found = next((d for d in items if d.get("ref") == key), None)
    entry = {"id": (found or {}).get("id") or f"dr-{abs(hash((kind, key))) % 10**10}", "kind": kind, "title": title[:120], "to": to, "run_id": run_id,
             "ref": key, "status": PENDING, "created_at": (found or {}).get("created_at") or now.isoformat(), "updated_at": now.isoformat(),
             # What it was written from, for its page's form (the owner's QA, 23 Oct: "it didn't populate the inputs accordingly")
             **({"inputs": {k: v for k, v in inputs.items() if v not in (None, "")}} if inputs else {})}
    if found:
        found.update(entry)
        return found
    items.append(entry)
    return entry


def withdraw(data: dict, ref: str) -> int:
    """The document a draft points at was deleted (the owner's QA, 23 Oct: "I just deleted it from the blueprints, why still
    on the approval?"): its pending draft leaves Needs Approval. Returns how many were withdrawn."""
    n = 0
    for d in data.get("agent_drafts") or []:
        if d.get("status") == PENDING and (str(d.get("ref")) == str(ref) or f"document_id={ref}" in str(d.get("to") or "")):
            d["status"], n = "deleted", n + 1
    return n


def pending(data: dict | None) -> list[dict]:
    return [d for d in (data or {}).get("agent_drafts") or [] if d.get("status") == PENDING]


def decide(data: dict, draft_id: str, decision: str) -> dict | None:
    """[Accept] or [Reject]: the draft's status, and the matching record in its module where it has one."""
    d = next((x for x in data.get("agent_drafts") or [] if x.get("id") == draft_id), None)
    if not d or decision not in ("accept", "reject"):
        return None
    d["status"] = ACCEPTED if decision == "accept" else REJECTED
    d["decided_at"] = datetime.now(timezone.utc).isoformat()
    if d.get("kind") == "idea_validation":
        if decision == "reject":
            # Rejected: gone from Idea Validation History too, never kept as "Rejected" (the owner, 26 Oct)
            data["validation_history"] = [e for e in data.get("validation_history") or [] if not (isinstance(e, dict) and e.get("id") == d.get("ref"))]
            if data.get("active_validation_id") == d.get("ref"):
                data.pop("active_validation_id", None)
        for e in data.get("validation_history") or []:
            if isinstance(e, dict) and e.get("id") == d.get("ref"):
                e["status"] = "accepted"
    return d


def untitled(d: dict) -> bool:
    """A draft saved without a name of its own ("Business plan")."""
    word = WORD.get(d.get("kind"), "Draft")
    return not re.sub(rf"^{re.escape(word)}\s*(?:for|:|-)?\s*", "", str(d.get("title") or "").strip(), flags=re.I).strip()


def card(d: dict, document_title: str | None = None) -> dict:
    """In Needs Approval: "Business plan: Drone Cleaning", "Needs your review", opening the draft itself with its review bar
    (Accept, Edit, Reject). Never "Business plan: Business plan" (the owner's QA, 23 Oct)."""
    word = WORD.get(d.get("kind"), "Draft")
    title = str(d.get("title") or "").strip()
    title = re.sub(rf"^{re.escape(word)}\s*(?:for|:|-)?\s*", "", title, flags=re.I).strip() if title else ""
    to = str(d.get("to") or "")
    if to and "review=" not in to:
        to = f"{to}{'&' if '?' in to else '?'}review={d['id']}"
    if not title and document_title:      # named by its own document when it has no title of its own
        title = re.sub(rf"^{re.escape(word)}\s*(?:for|:|-)?\s*", "", str(document_title).strip(), flags=re.I).strip()
    return {"type": "draft", "kind": d.get("kind"), "draft_id": d["id"], "run_id": d.get("run_id"), "title": f"{word}: {title}" if title else word,
            "subtitle": "Needs your review", "to": to or None, "created_at": d.get("created_at")}


def for_run(data: dict | None, run_id: str) -> dict | None:
    return next((d for d in (data or {}).get("agent_drafts") or [] if d.get("run_id") == run_id), None)


def run_label(data: dict | None, run: dict) -> str | None:
    """"Waiting for your review" while the task's draft is pending; None otherwise (the run's own status stands)."""
    d = for_run(data, run.get("id") or "")
    if d and d.get("status") == PENDING and run.get("status") == "succeeded":
        return "Waiting for your review"
    return None


def _ignore(*_a: Any) -> None:
    return None
