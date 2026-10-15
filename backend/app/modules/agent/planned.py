"""B6: the figures a business has adopted or given anywhere (a readiness review, a quick check, the catalogue), read the
same way by every engine. Before there is revenue on record, the growth tools work from these, labelled as planned,
instead of saying "none on record".

Where a figure comes from, in order: the owner's own answers kept in the shared store (shared_answers, written when a
review is adopted, with its source and date), the newest adopted review dataset, then the catalogue. The source and the
date travel with each figure, so every answer can say where its numbers came from."""
from __future__ import annotations

from typing import Any

from app.modules.agent import first_value
from app.modules.agent.research import GOAL_WORDS, INPUT_LABEL

PLANNED_FIELDS = ("price", "cost", "monthly_sales", "fixed_costs", "capacity", "cash_in_bank", "team_size")


def _day(at: Any) -> str:
    return str(at or "")[:10]


def figures(data: dict, today=None) -> dict[str, dict]:
    """{field: {"value", "source", "at", "basis"}} for the planned figures on record, newest first within each source.
    §5: a figure past its freshness (price, cost, forecast and capacity 30 days; market 180) is unknown again, not reused."""
    from datetime import datetime, timezone
    from app.modules.agent import credibility
    today = today or datetime.now(timezone.utc).date()
    data = data or {}
    out: dict[str, dict] = {}
    num = first_value._num

    def take(field: str, value: Any, source: str, at: Any, basis: str = "forecast") -> None:
        if at and basis != "actual" and not credibility.fresh(credibility.freshness_kind(field), str(at), today):
            return      # stale: asked again, never carried on as if current
        if field in PLANNED_FIELDS and field not in out and num(value) is not None:
            out[field] = {"value": float(num(value)), "source": source, "at": _day(at), "basis": basis}
    # §1 (R1): only what the owner accepted is reused. A proposed value (AI, research, not yet accepted) never is.
    shared = [(f, v) for f, v in (data.get("shared_answers") or {}).items() if isinstance(v, dict) and v.get("state", "accepted") == "accepted"]
    for field, got in sorted(shared, key=lambda kv: str(kv[1].get("at") or ""), reverse=True):
        source = got.get("source") or f"From your {GOAL_WORDS.get(got.get('goal'), 'earlier check')}"
        if (got.get("basis") == "estimate" or "estimate" in source) and not got.get("sources"):
            continue      # §5: an estimate with no checked source is never a planned figure
        take(field, got.get("value"), source, got.get("at"), got.get("basis") or ("estimate" if "estimate" in source else "forecast"))
    versions = [(goal, v) for goal, vs in (data.get("assessment_datasets") or {}).items() for v in vs or [] if isinstance(v, dict)]
    for goal, v in sorted(versions, key=lambda gv: str(gv[1].get("created_at") or ""), reverse=True):
        words = GOAL_WORDS.get(goal, "check").replace("check", "review")
        for field, value in (v.get("inputs") or {}).items():
            if "estimate" in str((v.get("inputs_from") or {}).get(field) or ""):
                continue      # an estimate is never a planned figure of the owner's
            take(field, value, f"From your {words}", v.get("created_at"), "forecast")
    co = first_value._company(data)
    if co["priced"]:
        take("price", co["priced"][0]["base_price"], "From your catalogue", None, "actual")
    if co["costed"]:
        take("cost", co["costed"][0]["cost_of_sales"], "From your catalogue", None, "actual")
    return out


def monthly(data: dict) -> dict:
    """What a planned month looks like: revenue (price × sales a month) and costs (fixed costs + cost per sale × sales),
    each only when its figures are known. `sources`: where each figure came from, said with the answer."""
    f = figures(data)
    v = {k: x["value"] for k, x in f.items()}
    out: dict[str, Any] = {"figures": v, "sources": {k: x["source"] + (f" ({x['at']})" if x.get("at") else "") + f", {x['basis']}" for k, x in f.items()},
                           "basis": {k: x["basis"] for k, x in f.items()}}
    if v.get("price") and v.get("monthly_sales"):
        out["revenue"] = round(v["price"] * v["monthly_sales"], 2)
    if v.get("fixed_costs") is not None or (v.get("cost") is not None and v.get("monthly_sales")):
        out["costs"] = round(float(v.get("fixed_costs") or 0) + float(v.get("cost") or 0) * float(v.get("monthly_sales") or 0), 2)
    if v.get("price") and v.get("cost") is not None and v["price"] > 0:
        out["margin"] = max(0.01, min(0.99, (v["price"] - v["cost"]) / v["price"]))
    return out


def said(sources: dict, *fields: str) -> str:
    """ "planned: price from your launch readiness review (2026-10-13), sales a month from your launch readiness review" """
    parts = [f"{INPUT_LABEL.get(k, k).lower()} {sources[k][0].lower() + sources[k][1:]}" for k in fields if sources.get(k)]
    return "; ".join(parts)


def ask_fields(missing: list[str]) -> list[dict]:
    """The planned figures still needed, asked for (never a dead end before there is revenue)."""
    return [{"key": k, "label": INPUT_LABEL[k], "type": "number", "required": True,
             "hint": "Your planned figure: it is kept, labelled as planned, for every other check."} for k in missing]


