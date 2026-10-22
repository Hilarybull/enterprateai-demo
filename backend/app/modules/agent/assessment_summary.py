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
GATE_SECTION = {"G1": "goal", "G2": "finances", "G3": "finances", "G4": "documents"}
CONTRACT = ("business_id", "assessment_id", "profile_version", "classification", "score", "evidence_coverage", "gate_completeness", "confidence",
            "freshness", "blocker_count", "next_action_id")
# Accepted figure -> where the case keeps it (the readiness engine's own fields).
FEEDS = {"launch": {"price": "economics.price_per_unit", "cost": "economics.variable_cost_per_unit", "fixed_costs": "economics.fixed_costs_monthly"},
         "funding": {"price": "economics.price", "cost": "economics.direct_cost", "fixed_costs": "economics.fixed_costs_monthly", "amount": "target_amount",
                     "monthly_revenue": "traction.monthly_revenue"}}
FIELD_WORD = {"price": "price per sale", "cost": "cost per sale", "fixed_costs": "monthly fixed costs", "amount": "funding amount", "monthly_revenue": "revenue each month"}


def _differs(a: Any, b: Any) -> bool:
    try:
        return abs(float(str(a).replace(",", "")) - float(str(b).replace(",", ""))) > 0.005
    except (TypeError, ValueError):
        return str(a).strip() != str(b).strip()


def contract_of(pick: dict | None, kind: str) -> dict | None:
    """The summary contract, exactly the published fields (null means unavailable), from the module's own summary."""
    if not pick:
        return None
    out = {k: pick.get(k) for k in CONTRACT}
    out["evidence_coverage"] = pick.get("evidence_coverage", pick.get("coverage"))
    if kind == "launch":
        out.update({k: pick.get(k) for k in ("initiative_id", "launch_type", "scope", "target_date", "lifecycle_status")})
    else:
        out.update({"case_id": pick.get("case_id"), "lifecycle_status": pick.get("lifecycle_status"),
                    # P1.13: the verdict's top blockers (each a link to its section) and the pack, counted.
                    "top_blockers": [{**b, "to": f"/funding/{pick.get('case_id')}?tab=setup&section={GATE_SECTION.get(b.get('code'), 'goal')}"}
                                     for b in (pick.get("blockers") or [])[:3]], "pack": pick.get("pack")})
    out.update({"kind": kind, "title": pick.get("title"), "as_of": pick.get("as_of")})
    return out


async def current(orch, user_id: str, business_id: str, kind: str, email: str | None = None, subject_id: str | None = None) -> dict | None:
    """The assessment summary that belongs to THIS result (P0.6b): for funding, the business's one case; for a launch, only
    the initiative this task created or linked (`subject_id`), never another one (several launches are allowed)."""

    from app.modules.readiness.service import service_for
    try:
        actor, _ = await orch.actor_for(user_id, business_id, email)
        data = await orch.rt.business.load(business_id)
        picks = await service_for(orch).dashboard_summaries(business_id, data, actor, orch.rt.clock())
    except Exception:      # noqa: BLE001 - no readiness module or no access: unavailable
        logger.info("no readiness summary for %s", business_id, exc_info=True)
        return None
    out = contract_of(picks.get(kind), kind)
    if out and subject_id and (out.get("case_id") or out.get("initiative_id")) not in (None, subject_id):
        return None      # the current one is another launch: this result is shown as it is, never with another's score
    return out


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


# The answers a review asks for, and the case field each fills (F-1, 22 Oct)
ANSWER_PATH = {"team": "team.responsibilities", "customers": "market.target_segment", "traction": "traction.summary", "use": "purpose",
               "where": "market.location", "customer": "market.target_segment"}


def adopted_fields(adopted: list[dict], case_drafts: dict, today: str) -> dict:
    """What an adopt puts on the case, by path: the use-of-funds lines, the answers given, the Agent's drafts for the case's
    fields. Only values; where each goes empty or different is decided by the caller."""
    out: dict = {}
    for x in adopted or []:
        value = x.get("edited_value") if x.get("decision") == "edited" else (x.get("answer") if x.get("decision") == "answered" else x.get("value"))
        if x.get("derive") == "use_of_funds" and isinstance(x.get("table"), list) and x.get("decision") != "edited":
            rows = []
            for n, line in enumerate(x["table"]):
                name = str(line.get("line") or "")
                cat = "Reserve" if name.lower().startswith("reserve") else "Operations" if name.lower().startswith("working capital") else "Other"
                rows.append({"id": f"uof{n + 1}", "category": cat, "amount": str(line.get("amount")), "purpose": name,
                             **({"rationale": name} if cat == "Reserve" else {})})
            if rows:
                out["use_of_funds"] = rows
        elif x.get("kind") == "question" or x.get("decision") == "answered":
            path = ANSWER_PATH.get(str(x.get("field") or ""))
            text = str(value or "").strip()
            if path and text:
                out[path] = [{"id": "r1", "area": "Delivery and winning customers", "owner": text}] if path == "team.responsibilities" else text
    import uuid as _uuid
    for path, value in (case_drafts or {}).items():
        if isinstance(value, list):      # list rows with their own ids, so each can be picked and pointed at
            value = [{**v, "id": v.get("id") or _uuid.uuid4().hex[:12]} if isinstance(v, dict) else v for v in value]
        out.setdefault(path, value)
    return out


def saved_options(adopted: list[dict], today: str) -> list[dict]:
    """The funding options the owner saved to the case (F-2, 22 Oct), each with its source."""
    out = []
    for x in adopted or []:
        if not str(x.get("topic") or "").startswith("route_") or x.get("decision") != "accepted":
            continue
        src = (x.get("sources") or [{}])[0] or {}
        out.append({"id": x.get("id"), "route": str(x["topic"]).replace("route_", ""), "title": x.get("label") or src.get("title"),
                    "text": str(x.get("value") or "")[:600], "source": {"url": src.get("url"), "publisher": src.get("publisher") or src.get("site"),
                                                                        "date": src.get("date")}, "saved_at": today})
    return out


async def feed(orch, user: dict, business_id: str, goal: str, figures: dict[str, float], said: dict, reference: str,
               research: list[dict] | None = None, owner_set: set[str] | None = None, subject_id: str | None = None,
               adopted: list[dict] | None = None, case_drafts: dict | None = None) -> dict | None:
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
    differences: list[dict] = []
    reactivated = None
    try:
        listed = await svc.list_subjects(user["id"], business_id, subject_type, email, include_archived=True)
        live = [x for x in listed.get("items") or [] if x.get("status") not in ("cancelled", "archived")]
        # The case this research belongs to, never simply the first one (F-1, 22 Oct)
        live.sort(key=lambda x: 0 if subject_id and str(x.get("id")) == str(subject_id) else 1)
        if not live and kind == "funding":
            # The business's one funding case, archived: reactivated and updated, never a second one beside it.
            archived = [x for x in listed.get("items") or [] if x.get("status") == "archived"]
            if archived:
                await svc.set_status(user["id"], business_id, subject_type, archived[0]["id"], "reactivate", email)
                reactivated = archived[0].get("title") or archived[0].get("name") or "your funding case"
                live = [archived[0]]
        today = orch.rt.clock().date().isoformat()
        changes: dict = {}
        if live:
            subject = await svc.get_subject(user["id"], business_id, subject_type, live[0]["id"], email)
            data = subject.get("data") or subject
            for f, path in FEEDS[kind].items():
                if figures.get(f) is None:
                    continue
                held = _get(data, path)
                if held in (None, ""):
                    _put(changes, path, str(figures[f]))
                elif _differs(held, figures[f]) and f in (owner_set or set()):
                    # The owner's own edit or answer in the review, adopted: their latest word, so the case takes it at once
                    # (the owner's QA, 17 Oct). Only a figure the research found is asked about before it replaces theirs.
                    _put(changes, path, str(figures[f]))
                elif _differs(held, figures[f]):
                    # R2: the case's own figure is never overwritten: the difference is shown, with a way to use the review's.
                    differences.append({"field": f, "label": FIELD_WORD.get(f, f), "case_value": held, "review_value": figures[f]})
            # The drafts, lines and answers adopted: into the case's empty fields, each marked where it came from; a field
            # the case already holds is listed as a difference, never overwritten.
            said_from: dict = {}
            from app.modules.agent import first_value as _fv
            for path, value in adopted_fields(adopted or [], case_drafts or {}, today).items():
                held = _get(data, path)
                if held in (None, "", [], {}) or (isinstance(held, str) and not _fv._said(held)):
                    _put(changes, path, value)
                    said_from[path] = "Adopted from the Agent's research"
                elif str(held).strip() != str(value).strip() and not isinstance(value, list):
                    differences.append({"field": path, "label": path.split(".")[-1].replace("_", " "), "case_value": held, "review_value": value})
            first = next((m.get("id") for m in (changes.get("milestones") or data.get("milestones") or []) if isinstance(m, dict) and m.get("id")), None)
            if first and not data.get("purpose_milestone_id"):
                changes["purpose_milestone_id"] = first
                said_from["purpose_milestone_id"] = "Adopted from the Agent's research"
            if first and not _get(data, "market.acquisition_milestone_id"):
                _put(changes, "market.acquisition_milestone_id", first)
                said_from["market.acquisition_milestone_id"] = "Adopted from the Agent's research"
            options = saved_options(adopted or [], today)
            if options:
                have = {str(o.get("id")) for o in data.get("funding_options") or [] if isinstance(o, dict)}
                fresh_options = [o for o in options if str(o["id"]) not in have]
                if fresh_options:
                    changes["funding_options"] = [*(data.get("funding_options") or []), *fresh_options]
            if changes.get("economics"):
                changes["economics"]["confirmed_at"] = today      # the owner accepted them now
            if kind == "launch" and said.get("customer") and not _get(data, "customers.target_segment"):
                _put(changes, "customers.target_segment", str(said["customer"]))
            if kind == "launch" and said.get("problem") and not _get(data, "customers.problem"):
                _put(changes, "customers.problem", str(said["problem"]))
            if changes:
                merged = {k: {**(data.get(k) or {}), **v} if isinstance(v, dict) else v for k, v in changes.items()}
                await svc.update_subject(user["id"], business_id, subject_type, live[0]["id"], subject.get("revision"), merged, email,
                                         provenance=said_from or None)
            subject_id = live[0]["id"]
            # The case's forecast follows what was adopted (the owner's QA, 21 Oct: an edited ₦1,200,000 a month left every
            # month at ₦331,425): its months rewritten from the adopted figures, the owner's own edits first.
            try:
                await svc.refresh_forecast(user["id"], business_id, subject_type, subject_id, figures, owner_set or set(), email)
            except Exception:      # noqa: BLE001 - the case is updated either way; its forecast is edited on its own page
                logger.info("case forecast not refreshed for %s", business_id, exc_info=True)
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
    out = await current(orch, user["id"], business_id, kind, email)
    if out is not None:
        out.update({"differences": differences, "reactivated": reactivated})
    return out


async def use_figures(orch, user: dict, business_id: str, kind: str, figures: dict[str, float], reference: str) -> dict | None:
    """The owner chose the review's figures over the case's own: those fields are updated (their choice, seen), the case is
    assessed again, and its summary returned."""
    from app.modules.readiness import rules as rr
    from app.modules.readiness.service import service_for
    svc = service_for(orch)
    subject_type = rr.LAUNCH if kind == "launch" else rr.FUNDING
    email = user.get("email")
    listed = await svc.list_subjects(user["id"], business_id, subject_type, email, include_archived=False)
    live = [x for x in listed.get("items") or [] if x.get("status") not in ("cancelled", "archived")]
    if not live:
        return None
    subject = await svc.get_subject(user["id"], business_id, subject_type, live[0]["id"], email)
    data = subject.get("data") or subject
    changes: dict = {}
    for f, value in figures.items():
        if f in FEEDS[kind] and value is not None:
            _put(changes, FEEDS[kind][f], str(value))
    if not changes:
        return await current(orch, user["id"], business_id, kind, email)
    for part in ("economics", "traction"):
        if changes.get(part):
            changes[part]["confirmed_at"] = orch.rt.clock().date().isoformat()      # chosen by the owner: never asked again
    merged = {k: {**(data.get(k) or {}), **v} if isinstance(v, dict) else v for k, v in changes.items()}
    await svc.update_subject(user["id"], business_id, subject_type, live[0]["id"], subject.get("revision"), merged, email)
    await svc.request_assessment(user["id"], business_id, subject_type, live[0]["id"], idempotency_key=reference, email=email)
    return await current(orch, user["id"], business_id, kind, email)
