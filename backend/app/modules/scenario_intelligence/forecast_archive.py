"""Immutable saved forecasts, compared with the latest recorded monthly actuals."""
from datetime import date
from uuid import uuid4

from app.core.supabase import sb_insert, sb_select
from app.modules.scenario_intelligence import records
from app.modules.scenario_intelligence.projection import project


def comparison(snapshot: dict, data: dict, today: date) -> dict:
    built = records.build(data, today)
    histories = built["histories"]
    current = today.strftime("%Y-%m")
    rows = []
    for month, expected in sorted(snapshot["forecast"].items()):
        arrived = month <= current
        actual = None
        if arrived:
            actual = {name: (histories.get(key) or {}).get(month, 0) for name, key in (
                ("revenue", "revenue_by_month"), ("expenses", "expenses_by_month"), ("cost_of_sales", "cost_of_sales_by_month"))}
            actual["costs"] = round(actual["expenses"] + actual["cost_of_sales"], 2)
            actual["profit"] = round(actual["revenue"] - actual["costs"], 2)
        rows.append({"month": month, "status": "in_progress" if month == current else "complete" if arrived else "upcoming",
                     "forecast": expected, "actual": actual,
                     "variance": {key: round(actual[key] - float(expected.get(key) or 0), 2) for key in actual} if actual else None})
    return {**snapshot, "comparison": rows, "actuals_as_of": today.isoformat()}


async def save_snapshot(user_id, business_id, state, months, data, today):
    from app.modules.agent.business import currency_of
    _, summary = project(state, "do_nothing_projection", {}, months, clamp=False, as_of=today)
    snapshot = {"id": str(uuid4()), "business_id": business_id, "user_id": user_id, "as_of": today.isoformat(),
                "label": f"Baseline forecast · {today.isoformat()}", "currency": currency_of(data),
                "model_version": summary.get("model_version"), "forecast": summary["forecast_by_month"],
                "assumptions": state.model_dump()}
    stored = await sb_insert("forecast_snapshots", snapshot)  # No memory fallback: a successful save is durable.
    if not stored:
        raise RuntimeError("The forecast could not be confirmed as saved. Please try again.")
    return comparison(snapshot, data, today)


async def list_snapshots(business_id, data, today):
    saved = await sb_select("forecast_snapshots", filters=[("business_id", "eq", business_id)], order="created_at", desc=True, limit=50)
    return [comparison(row, data, today) for row in saved or []]
