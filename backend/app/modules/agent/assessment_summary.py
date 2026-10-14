"""§2 (P4, R3): one source for readiness numbers.

Launch and Funding each have one current assessment, the readiness module's (LR §10, FR §10). It publishes a summary;
the Agent's answers, the dashboard cards, the first-value card and the review page read that summary and never
recalculate. A launch or funding review adopted on the dashboard feeds that one assessment (its accepted figures go into
the launch initiative or funding case, into empty fields only, as the case's own inputs with where they came from) and the
assessment is run again: there is no second score.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

KIND_OF_GOAL = {"launch": "launch", "need_funding": "funding"}
CONTRACT = ("business_id", "assessment_id", "profile_version", "classification", "score", "evidence_coverage", "gate_completeness", "confidence",
            "freshness", "blocker_count", "next_action_id")
# Accepted figure -> where the case keeps it (the readiness engine's own fields).
FEEDS = {"launch": {"price": "economics.price_per_unit", "cost": "economics.variable_cost_per_unit", "fixed_costs": "economics.fixed_costs_monthly"},
         "funding": {"price": "economics.price", "cost": "economics.direct_cost", "fixed_costs": "economics.fixed_costs_monthly", "amount": "target_amount"}}


def contract_of(pick: dict | None, kind: str) -> dict | None:
    """The summary contract, exactly the published fields (null means unavailable), from the module's own summary."""
    if not pick:
        return None
    out = {k: pick.get(k) for k in CONTRACT}
    out["evidence_coverage"] = pick.get("evidence_coverage", pick.get("coverage"))
    if kind == "launch":
        out.update({k: pick.get(k) for k in ("initiative_id", "launch_type", "scope", "target_date", "lifecycle_status")})
    else:
        out.update({"case_id": pick.get("case_id"), "lifecycle_status": pick.get("lifecycle_status")})
    out.update({"kind": kind, "title": pick.get("title"), "as_of": pick.get("as_of")})
    return out


async def current(orch, user_id: str, business_id: str, kind: str, email: str | None = None) -> dict | None:
    """The one current assessment's summary for this business: launch or funding."""
    from app.modules.readiness.service import service_for
    try:
        actor, _ = await orch.actor_for(user_id, business_id, email)
        data = await orch.rt.business.load(business_id)
        picks = await service_for(orch).dashboard_summaries(business_id, data, actor, orch.rt.clock())
    except Exception:      # noqa: BLE001 - no readiness module or no access: unavailable
        logger.info("no readiness summary for %s", business_id, exc_info=True)
        return None
    return contract_of(picks.get(kind), kind)


def _get(data: dict, path: str) -> Any:
    for part in path.split("."):
        data = (data or {}).get(part) if isinstance(data, dict) else None
    return data


def _put(out: dict, path: str, value: Any) -> None:
    *head, last = path.split(".")
    for part in head:
        out = out.setdefault(part, {})
    out[last] = value


DEMAND_TOPICS = ("demand", "competitors", "market", "channels")
DEMAND_CHECK = {"launch": "C1.A", "funding": "C4.A"}


async def feed(orch, user: dict, business_id: str, goal: str, figures: dict[str, float], said: dict, reference: str,
               research: list[dict] | None = None) -> dict | None:
    """Accepted figures into the one launch initiative or funding case (made if there is none), into its empty fields
    only, then the case is assessed again. Returns that assessment's summary. A field the case already holds is left as it
    is (the case's own assumption): it is listed, never overwritten."""
    from app.modules.readiness import rules as rr
    from app.modules.readiness.service import service_for
    kind = KIND_OF_GOAL.get(goal)
    if not kind:
        return None
    svc = service_for(orch)
    subject_type = rr.LAUNCH if kind == "launch" else rr.FUNDING
    email = user.get("email")
    try:
        listed = await svc.list_subjects(user["id"], business_id, subject_type, email, include_archived=False)
        live = [x for x in listed.get("items") or [] if x.get("status") not in ("cancelled", "archived")]
        today = orch.rt.clock().date().isoformat()
        changes: dict = {}
        if live:
            subject = await svc.get_subject(user["id"], business_id, subject_type, live[0]["id"], email)
            data = subject.get("data") or subject
            kept = []
            for f, path in FEEDS[kind].items():
                if figures.get(f) is None:
                    continue
                if _get(data, path) in (None, ""):
                    _put(changes, path, str(figures[f]))
                else:
                    kept.append(path)
            if changes.get("economics"):
                changes["economics"]["confirmed_at"] = today      # the owner accepted them now
            if kind == "launch" and said.get("customer") and not _get(data, "customers.target_segment"):
                _put(changes, "customers.target_segment", str(said["customer"]))
            if kind == "launch" and said.get("problem") and not _get(data, "customers.problem"):
                _put(changes, "customers.problem", str(said["problem"]))
            if changes:
                merged = {k: {**(data.get(k) or {}), **v} if isinstance(v, dict) else v for k, v in changes.items()}
                await svc.update_subject(user["id"], business_id, subject_type, live[0]["id"], subject.get("revision"), merged, email)
            subject_id = live[0]["id"]
        else:
            payload: dict = {("name" if kind == "launch" else "title"): (str(said.get("sell") or said.get("description") or "My launch" if kind == "launch" else "My funding case"))[:80]}
            for f, path in FEEDS[kind].items():
                if figures.get(f) is not None:
                    _put(payload, path, str(figures[f]))
            if payload.get("economics"):
                payload["economics"]["confirmed_at"] = today
            if kind == "launch" and said.get("customer"):
                _put(payload, "customers.target_segment", str(said["customer"]))
            created = await svc.create_subject(user["id"], business_id, subject_type, payload, email)
            subject_id = created.get("id")
        # §5: accepted research on demand and the market goes on the case as dated research evidence, with its source and
        # the quote that supports it, unverified until the owner reviews it (AI never verifies a claim).
        for x in research or []:
            if x.get("topic") not in DEMAND_TOPICS:
                continue
            for src in (x.get("sources") or [])[:2]:
                if not (src.get("url") and src.get("quote") and src.get("date")):
                    continue
                try:
                    await svc.add_evidence(user["id"], business_id, {
                        "title": f"{x.get('label') or 'Research'}: {src.get('publisher') or src.get('site')}"[:200], "type": "research",
                        "claim": src["quote"][:1000], "source": {"kind": "link", "reference": src["url"]}, "effective_date": src["date"][:10],
                        "links": [{"subject_id": subject_id, "check": DEMAND_CHECK[kind]}]}, email, feature=subject_type)
                except Exception:      # noqa: BLE001 - one source that can't be added doesn't stop the rest
                    logger.info("research source not added as evidence: %s", src.get("url"), exc_info=True)
        await svc.request_assessment(user["id"], business_id, subject_type, subject_id, idempotency_key=reference, email=email)
        fed = {f: figures[f] for f in FEEDS[kind] if figures.get(f) is not None}

        def _remember(d: dict) -> None:
            d.setdefault("readiness_fed", {}).setdefault(kind, {}).update(fed)
        await orch.rt.business.mutate(business_id, _remember)
    except Exception:      # noqa: BLE001 - the review is adopted either way; its case is updated from its own page
        logger.warning("review not fed into the %s assessment for %s", kind, business_id, exc_info=True)
    return await current(orch, user["id"], business_id, kind, email)
