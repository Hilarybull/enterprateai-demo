"""The business's business plans, read one way wherever they are counted or listed (the owner, 27 Oct: "the agent chat says
3 waiting for review, Business Blueprints says 8 plans, Agent Centre's Documents says 10, and the approvals card shows 2").

A plan is a saved Blueprints document of type business_plan for this business; copies of the same plan (the same business
or service in the title) are its versions, newest first, never separate plans. A plan needs review while the Agent's draft
of it waits for the owner and they haven't put it off. Every plan is named for its business or service, never just
"Business plan"."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

_PREFIX = re.compile(r"^\s*business\s+plan\s*(?:for|:|-)?\s*", re.I)


def subject_of(title: Any) -> str:
    """"Business Plan for E2E Car Wash Abuja" and "Business plan: E2E Car Wash Abuja" are the same plan: "E2E Car Wash Abuja"."""
    return " ".join(_PREFIX.sub("", str(title or "")).split()).strip(" .")


def _key(title: Any) -> str:
    return subject_of(title).lower()


async def rows(business_id: str, user_id: str, company: str) -> list[dict]:
    """The saved plans: this business's, and the person's own older ones saved before plans kept their business, when they
    name this business."""
    from app.core.supabase import sb_select
    cols = "id,type,title,company_name,updated_at,created_at,workspace_id,document_markdown"
    mine = await sb_select("blueprint_documents", filters=[("workspace_id", "eq", business_id), ("type", "eq", "business_plan")], columns=cols,
                           order="updated_at", desc=True, limit=200) or []
    loose = await sb_select("blueprint_documents", filters=[("user_id", "eq", user_id), ("type", "eq", "business_plan"), ("workspace_id", "is", "null")],
                            columns=cols, order="updated_at", desc=True, limit=200) or []
    named = company.strip().lower()
    return [r for r in mine if r.get("document_markdown")] + [r for r in loose if r.get("document_markdown") and named
                                                              and named in f"{r.get('title') or ''} {r.get('company_name') or ''}".lower()]


def of(saved: list[dict], data: dict | None, user_id: str, now: datetime, company: str = "") -> dict:
    """{"items": [{id, title, subject, updated_at, needs_review, draft_id, to, versions: [{id, updated_at}]}], "total", "needs_review"}."""
    from app.modules.agent import chat_actions, drafts
    later = chat_actions.postponed(data, user_id, now)
    waiting = [d for d in drafts.pending(data) if d.get("kind") == "business_plan"]
    by_ref = {str(d.get("ref")): d for d in waiting if d.get("ref")}
    groups: dict[str, dict] = {}
    for r in sorted(saved, key=lambda x: str(x.get("updated_at") or ""), reverse=True):
        subject = subject_of(r.get("title")) or subject_of(r.get("company_name")) or company or "your business"
        g = groups.setdefault(subject.lower(), {"id": r["id"], "subject": subject, "title": f"Business plan: {subject}", "updated_at": r.get("updated_at"),
                                                "versions": [], "draft_id": None, "to": f"/blueprint?document_id={r['id']}"})
        g["versions"].append({"id": r["id"], "updated_at": r.get("updated_at")})
        d = by_ref.get(str(r["id"]))
        if d and not g["draft_id"]:
            g["draft_id"], g["to"] = d["id"], drafts.card(d, r.get("title")).get("to") or g["to"]
    # A draft whose document isn't saved yet is a plan too, named by the business it is for
    for d in waiting:
        if str(d.get("ref")) in {v["id"] for g in groups.values() for v in g["versions"]}:
            continue
        subject = subject_of(drafts.card(d).get("title")) or company or "your business"
        if subject.lower() in groups:
            groups[subject.lower()]["draft_id"] = groups[subject.lower()]["draft_id"] or d["id"]
            continue
        groups[subject.lower()] = {"id": f"draft:{d['id']}", "subject": subject, "title": f"Business plan: {subject}", "updated_at": d.get("updated_at") or d.get("created_at"),
                                   "versions": [], "draft_id": d["id"], "to": drafts.card(d).get("to")}
    items = []
    for g in groups.values():
        g["needs_review"] = bool(g["draft_id"]) and g["draft_id"] not in later and g["id"] not in later
        items.append(g)
    items.sort(key=lambda g: (g["needs_review"], str(g.get("updated_at") or "")), reverse=True)
    return {"items": items, "total": len(items), "needs_review": sum(1 for g in items if g["needs_review"])}


async def for_business(orch, user: dict, business_id: str, data: dict | None = None) -> dict:
    """The plans of this business, as `of` gives them; nothing (never an error) if the saved plans can't be read."""
    data = data if data is not None else (await orch.rt.business.load(business_id) or {})
    company = str(((data.get("workspace_profile") or {}).get("company_name")) or "").strip()
    try:
        saved = await rows(business_id, str(user["id"]), company)
    except Exception:      # noqa: BLE001 - the drafts alone are still counted
        saved = []
    return of(saved, data, str(user["id"]), orch.rt.clock(), company)
