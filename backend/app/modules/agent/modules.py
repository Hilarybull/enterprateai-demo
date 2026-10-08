"""What other modules hold about the business.

Most of a business's records live in its workspace record, which the Agent already reads. Launch
plans and funding cases are kept in their own tables, so they are read here: for the Agent's own
questions ("Is this your customer?"), and for its written answers, where they are only included
when the person asking is allowed to open them (the same check the pages make).
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _at(data: dict, path: str) -> str:
    node: Any = data
    for part in path.split("."):
        node = node.get(part) if isinstance(node, dict) else None
    return node.strip() if isinstance(node, str) else ""


def _first(data: dict, *paths: str) -> str:
    return next((v for v in (_at(data, p) for p in paths) if v), "")


def _live(rows: list[dict]) -> list[dict]:
    """Not archived; a pinned one first, then the most recently changed."""
    rows = [r for r in rows if r.get("status") != "archived"]
    return sorted(rows, key=lambda r: (not (r.get("data") or {}).get("pinned"), str(r.get("updated_at") or "")), reverse=False) \
        if any((r.get("data") or {}).get("pinned") for r in rows) else sorted(rows, key=lambda r: str(r.get("updated_at") or ""), reverse=True)


async def launch_facts(orch, business_id: str) -> dict:
    """What the owner has already said in a launch plan about who it is for, the problem and where.
    Empty when there is no launch plan or it can't be read: the question is simply asked."""
    try:
        from app.modules.readiness import rules
        from app.modules.readiness.service import service_for
        rows = _live(await service_for(orch).store.list("subjects", business_id, kind=rules.LAUNCH))
    except Exception:      # noqa: BLE001 - never in the way of the task
        logger.debug("launch plans not read for %s", business_id, exc_info=True)
        return {}
    for row in rows:
        d = row.get("data") or {}
        found = {"customer": _first(d, "customers.target_segment", "audience", "market.audience"),
                 "problem": _first(d, "customers.problem", "problem"),
                 "location": _first(d, "geography", "market.geography", "location")}
        if any(found.values()):
            return {**found, "title": str(d.get("name") or d.get("title") or row.get("title") or "").strip()}
    return {}


async def readiness_for(orch, user_id: str, business_id: str, email: str | None = None) -> dict:
    """Launch plans and funding cases as this person may see them, for a written answer. Each is
    listed through the module's own service, so its permission check decides what is included."""
    out: dict[str, list[dict]] = {}
    try:
        from app.modules.readiness import router as readiness_router
        from app.modules.readiness import rules
        from app.modules.readiness.service import service_for
        svc = service_for(orch)
    except Exception:      # noqa: BLE001
        return out
    for kind, label in ((rules.LAUNCH, "launch_plans"), (rules.FUNDING, "funding_cases")):
        try:
            if not readiness_router.enabled(kind):
                continue
            listed = await svc.list_subjects(user_id, business_id, kind, email, include_archived=False)
            raw = {r["id"]: r.get("data") or {} for r in await svc.store.list("subjects", business_id, kind=kind)}
        except Exception:      # noqa: BLE001 - not allowed, or not set up: left out
            continue
        items = []
        for item in (listed.get("items") or [])[:6]:
            d, s = raw.get(item["id"]) or {}, item.get("summary") or {}
            items.append({k: v for k, v in {
                "title": item.get("title"), "status": item.get("status"), "target_date": item.get("target_date"), "target_amount": item.get("target_amount"),
                "result": s.get("classification"), "score": s.get("score"), "evidence_coverage_pct": s.get("coverage") or s.get("evidence_coverage"),
                "blockers": s.get("blocker_count"), "result_is_current": s.get("freshness"), "next_action": (s.get("next_action") or {}).get("title"),
                "who_it_is_for": _first(d, "customers.target_segment", "audience", "market.audience"), "problem": _first(d, "customers.problem", "problem"),
                "where": _first(d, "geography", "market.geography"),
            }.items() if v not in (None, "", [])})
        if items:
            out[label] = items
    return out
