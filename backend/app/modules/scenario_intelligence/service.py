from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.modules.scenario_intelligence.schemas import (
    BusinessStateSnapshot,
    ScenarioRecommendation,
    ScenarioTemplate,
)

ENGINE_VERSION = "scenario_intel_v1.0"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(doc: Dict[str, Any] | None) -> Dict[str, Any] | None:
    if not doc:
        return doc
    if "_id" in doc:
        doc = dict(doc)
        doc.pop("_id", None)
    return doc


def _clean_many(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [d for d in (_clean(doc) for doc in docs) if d]


def _clamp(val: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, val))


def _runway_months(revenue: float, costs: float, starting_cash: float) -> float:
    net = revenue - costs
    if net >= 0:
        return 999.0
    return max(0.0, starting_cash / max(abs(net), 1.0))


def _stability_score(state: BusinessStateSnapshot) -> float:
    revenue = float(state.revenue_monthly)
    costs = float(state.costs_monthly)
    net = revenue - costs
    runway = _runway_months(revenue, costs, float(state.starting_cash))
    score = 70.0
    if net < 0:
        score -= 18.0
    if runway < 3:
        score -= 12.0
    if state.top_client_share_pct is not None and state.top_client_share_pct > 40:
        score -= 8.0
    if state.capacity_utilisation_pct is not None and state.capacity_utilisation_pct > 85:
        score -= 6.0
    return _clamp(score, 0.0, 100.0)


def _state_label(score: float) -> str:
    if score >= 70:
        return "stable"
    if score >= 55:
        return "tight"
    return "risk"


def _templates() -> List[ScenarioTemplate]:
    return [
        ScenarioTemplate(
            scenario_template_id="tmpl_client_loss",
            scenario_type="client_loss",
            title="Loss of Largest Client",
            description="Simulate losing your largest client.",
            mode="adaptive_or_manual",
            required_inputs=[],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_price_increase",
            scenario_type="price_change",
            title="Increase Price",
            description="Simulate a price increase.",
            mode="manual",
            required_inputs=["price_change_pct", "effective_month"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_hire_staff",
            scenario_type="hire_staff",
            title="Hire Employees",
            description="Simulate hiring additional staff members.",
            mode="adaptive_or_manual",
            required_inputs=["employee_count", "employee_monthly_cost"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_cost_increase",
            scenario_type="cost_increase",
            title="Cost Increase",
            description="Simulate increased operating costs.",
            mode="adaptive_or_manual",
            required_inputs=["cost_increase_pct"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_revenue_drop",
            scenario_type="revenue_drop",
            title="Revenue Drop",
            description="Simulate a drop in revenue.",
            mode="adaptive_or_manual",
            required_inputs=["revenue_drop_pct"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_payment_delay",
            scenario_type="payment_delay",
            title="Delayed Payments",
            description="Simulate slower cash collection.",
            mode="adaptive_or_manual",
            required_inputs=["delay_months"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_service_launch",
            scenario_type="service_launch",
            title="Launch New Service",
            description="Simulate a new service launch.",
            mode="manual",
            required_inputs=["revenue_uplift_pct", "cost_uplift_pct"],
        ),
    ]


def detect_risks(state: BusinessStateSnapshot) -> List[Dict[str, Any]]:
    signals: List[Dict[str, Any]] = []

    if state.top_client_share_pct is not None and state.top_client_share_pct >= 40:
        signals.append(
            dict(
                risk_type="client_concentration",
                severity="high" if state.top_client_share_pct >= 50 else "medium",
                metric_name="top_client_share_pct",
                metric_value=state.top_client_share_pct,
                threshold_value=40,
                reason_code="CLIENT_CONCENTRATION_HIGH",
            )
        )

    if state.capacity_utilisation_pct is not None and state.capacity_utilisation_pct >= 85:
        signals.append(
            dict(
                risk_type="capacity_overload",
                severity="high" if state.capacity_utilisation_pct >= 95 else "medium",
                metric_name="capacity_utilisation_pct",
                metric_value=state.capacity_utilisation_pct,
                threshold_value=85,
                reason_code="CAPACITY_OVERLOAD",
            )
        )

    revenue = float(state.revenue_monthly)
    costs = float(state.costs_monthly)
    if revenue > 0 and costs > revenue:
        signals.append(
            dict(
                risk_type="negative_margin",
                severity="high",
                metric_name="net_profit",
                metric_value=revenue - costs,
                threshold_value=0,
                reason_code="NEGATIVE_MARGIN",
            )
        )

    runway = _runway_months(revenue, costs, float(state.starting_cash))
    if runway < 3:
        signals.append(
            dict(
                risk_type="low_runway",
                severity="high" if runway < 2 else "medium",
                metric_name="runway_months",
                metric_value=round(runway, 2),
                threshold_value=3,
                reason_code="LOW_RUNWAY",
            )
        )

    return signals


def recommend_scenarios(risk_signals: List[Dict[str, Any]]) -> List[ScenarioRecommendation]:
    recommendations: List[ScenarioRecommendation] = []
    for sig in risk_signals:
        code = sig.get("reason_code")
        if code == "CLIENT_CONCENTRATION_HIGH":
            recommendations.append(
                ScenarioRecommendation(
                    scenario_template_id="tmpl_client_loss",
                    scenario_type="client_loss",
                    title="Simulate Loss of Largest Client",
                    trigger_reason=code,
                    priority=1,
                )
            )
        if code == "CAPACITY_OVERLOAD":
            recommendations.append(
                ScenarioRecommendation(
                    scenario_template_id="tmpl_hire_staff",
                    scenario_type="hire_staff",
                    title="Simulate Hiring 1 Employee",
                    trigger_reason=code,
                    priority=2,
                )
            )
        if code == "NEGATIVE_MARGIN":
            recommendations.append(
                ScenarioRecommendation(
                    scenario_template_id="tmpl_price_increase",
                    scenario_type="price_change",
                    title="Simulate Price Increase",
                    trigger_reason=code,
                    priority=2,
                )
            )
        if code == "LOW_RUNWAY":
            recommendations.append(
                ScenarioRecommendation(
                    scenario_template_id="tmpl_revenue_drop",
                    scenario_type="revenue_drop",
                    title="Simulate Revenue Drop",
                    trigger_reason=code,
                    priority=3,
                )
            )
    return recommendations


def _apply_scenario(state: BusinessStateSnapshot, scenario_type: str, params: Dict[str, Any]) -> BusinessStateSnapshot:
    revenue = float(state.revenue_monthly)
    costs = float(state.costs_monthly)
    starting_cash = float(state.starting_cash)

    if scenario_type == "client_loss":
        loss_pct = float(params.get("client_loss_pct") or state.top_client_share_pct or 0.0)
        revenue = max(0.0, revenue * (1.0 - loss_pct / 100.0))
    elif scenario_type == "revenue_drop":
        drop_pct = float(params.get("revenue_drop_pct") or 0.0)
        revenue = max(0.0, revenue * (1.0 - drop_pct / 100.0))
    elif scenario_type == "price_change":
        change_pct = float(params.get("price_change_pct") or 0.0)
        revenue = max(0.0, revenue * (1.0 + change_pct / 100.0))
    elif scenario_type == "cost_increase":
        inc_pct = float(params.get("cost_increase_pct") or 0.0)
        costs = max(0.0, costs * (1.0 + inc_pct / 100.0))
    elif scenario_type == "hire_staff":
        add_cost = float(params.get("employee_monthly_cost") or 0.0)
        employee_count = int(params.get("employee_count") or 1)
        costs = max(0.0, costs + (add_cost * max(1, employee_count)))
    elif scenario_type == "contractor_addition":
        add_cost = float(params.get("contractor_monthly_cost") or 0.0)
        costs = max(0.0, costs + add_cost)
    elif scenario_type == "service_launch":
        uplift = float(params.get("revenue_uplift_pct") or 0.0)
        cost_up = float(params.get("cost_uplift_pct") or 0.0)
        revenue = max(0.0, revenue * (1.0 + uplift / 100.0))
        costs = max(0.0, costs * (1.0 + cost_up / 100.0))

    return BusinessStateSnapshot(
        revenue_monthly=revenue,
        costs_monthly=costs,
        starting_cash=starting_cash,
        top_client_share_pct=state.top_client_share_pct,
        capacity_utilisation_pct=state.capacity_utilisation_pct,
        payment_terms_days=state.payment_terms_days,
        sales_cycle_days=state.sales_cycle_days,
        clients_count=state.clients_count,
    )


def _timeline(
    state: BusinessStateSnapshot,
    scenario_type: str,
    params: Dict[str, Any],
    months: int,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    months = max(3, min(12, int(months)))
    base = state
    scenario_state = _apply_scenario(state, scenario_type, params)

    delay_months = int(params.get("delay_months") or 0)

    cash = float(scenario_state.starting_cash)
    timeline: List[Dict[str, Any]] = []

    for m in range(1, months + 1):
        revenue = float(scenario_state.revenue_monthly)
        costs = float(scenario_state.costs_monthly)
        profit = revenue - costs

        collected_revenue = 0.0 if scenario_type == "payment_delay" and m <= delay_months else revenue
        cash = max(0.0, cash + collected_revenue - costs)

        score = _stability_score(
            BusinessStateSnapshot(
                revenue_monthly=revenue,
                costs_monthly=costs,
                starting_cash=cash,
                top_client_share_pct=scenario_state.top_client_share_pct,
                capacity_utilisation_pct=scenario_state.capacity_utilisation_pct,
                payment_terms_days=scenario_state.payment_terms_days,
                sales_cycle_days=scenario_state.sales_cycle_days,
                clients_count=scenario_state.clients_count,
            )
        )

        timeline.append(
            dict(
                month_index=m,
                revenue=round(revenue, 2),
                costs=round(costs, 2),
                profit=round(profit, 2),
                cash_balance=round(cash, 2),
                stability_score=round(score, 2),
                state_label=_state_label(score),
            )
        )

    baseline_metrics = _snapshot_metrics(base)
    scenario_metrics = _snapshot_metrics(scenario_state)
    return timeline, dict(baseline_metrics=baseline_metrics, scenario_metrics=scenario_metrics)


def _snapshot_metrics(state: BusinessStateSnapshot) -> Dict[str, Any]:
    revenue = float(state.revenue_monthly)
    costs = float(state.costs_monthly)
    net = revenue - costs
    stability = _stability_score(state)
    return dict(
        monthly_revenue=round(revenue, 2),
        monthly_costs=round(costs, 2),
        net_profit=round(net, 2),
        stability_score=round(stability, 2),
    )


def _deltas(base: Dict[str, Any], scenario: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in base.items():
        sv = scenario.get(k)
        if isinstance(v, (int, float)) and isinstance(sv, (int, float)):
            out[k] = round(sv - v, 2)
        else:
            out[k] = {"from": v, "to": sv}
    return out


def _result_state(base_score: float, scenario_score: float) -> str:
    if scenario_score >= base_score + 3:
        return "improved"
    if scenario_score <= base_score - 3:
        return "worse"
    return "neutral"


async def save_risk_signals(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    business_id: str,
    state_version: str,
    signals: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    if not signals:
        return []
    now = _now_iso()
    docs = []
    for s in signals:
        docs.append(
            dict(
                risk_signal_id=str(uuid4()),
                tenant_id=tenant_id,
                business_id=business_id,
                state_version=state_version,
                detected_at=now,
                created_at=now,
                **s,
            )
        )
    await db.scenario_risk_signals.insert_many(docs)
    return _clean_many(docs)


async def create_scenario_run(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    business_id: str,
    state_version: str,
    template_id: str,
    scenario_mode: str,
    scenario_name: str,
    scenario_type: str,
    params: Dict[str, Any],
    state: BusinessStateSnapshot,
) -> Dict[str, Any]:
    run_id = str(uuid4())
    now = _now_iso()
    timeline_months = int(params.get("timeline_months") or 6)
    timeline, metrics = _timeline(state, scenario_type, params, timeline_months)
    baseline_metrics = metrics["baseline_metrics"]
    scenario_metrics = metrics["scenario_metrics"]
    deltas = _deltas(baseline_metrics, scenario_metrics)
    state_result = _result_state(baseline_metrics["stability_score"], scenario_metrics["stability_score"])

    run_doc = dict(
        scenario_run_id=run_id,
        tenant_id=tenant_id,
        business_id=business_id,
        state_version=state_version,
        scenario_template_id=template_id,
        scenario_mode=scenario_mode,
        scenario_name=scenario_name,
        scenario_type=scenario_type,
        parameters=params,
        baseline_snapshot=state.model_dump(),
        scenario_snapshot=_apply_scenario(state, scenario_type, params).model_dump(),
        engine_version=ENGINE_VERSION,
        status="completed",
        timeline_months=timeline_months,
        created_by_user_id=None,
        started_at=now,
        completed_at=now,
        created_at=now,
        baseline_metrics=baseline_metrics,
        scenario_metrics=scenario_metrics,
        deltas=deltas,
        state_result=state_result,
    )

    await db.scenario_runs.insert_one(run_doc)

    timeline_docs = [
        dict(scenario_run_id=run_id, created_at=now, **row) for row in timeline
    ]
    if timeline_docs:
        await db.scenario_timelines.insert_many(timeline_docs)

    recs = _recommendations_from_result(state_result)
    rec_docs = []
    for idx, rec in enumerate(recs, 1):
        rec_docs.append(
            dict(
                recommendation_id=str(uuid4()),
                scenario_run_id=run_id,
                action_type=rec["action_type"],
                title=rec["title"],
                description=rec.get("description"),
                priority=idx,
                created_at=now,
            )
        )
    if rec_docs:
        await db.scenario_recommendations.insert_many(rec_docs)

    return run_doc


def _recommendations_from_result(state_result: str) -> List[Dict[str, Any]]:
    if state_result == "improved":
        return [
            dict(
                action_type="pricing_action",
                title="Scenario appears safe",
                description="Projected stability improves. Proceed and monitor cash weekly.",
            )
        ]
    if state_result == "worse":
        return [
            dict(
                action_type="risk_mitigation",
                title="Scenario increases risk",
                description="Consider delaying or adjusting scope before execution.",
            )
        ]
    return [
        dict(
            action_type="monitor",
            title="Scenario is neutral",
            description="Impact is minimal. Run a second variant to confirm.",
        )
    ]


async def get_scenario_run(db: AsyncIOMotorDatabase, run_id: str) -> Dict[str, Any] | None:
    return _clean(await db.scenario_runs.find_one({"scenario_run_id": run_id}))


async def get_scenario_timeline(db: AsyncIOMotorDatabase, run_id: str) -> List[Dict[str, Any]]:
    cursor = db.scenario_timelines.find({"scenario_run_id": run_id}).sort("month_index", 1)
    return _clean_many([doc async for doc in cursor])


async def get_recommendations(db: AsyncIOMotorDatabase, run_id: str) -> List[Dict[str, Any]]:
    cursor = db.scenario_recommendations.find({"scenario_run_id": run_id}).sort("priority", 1)
    return _clean_many([doc async for doc in cursor])


async def save_decision(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    business_id: str,
    run_id: str,
    decision_status: str,
    selected_recommendation_id: str | None,
    notes: str | None,
) -> Dict[str, Any]:
    now = _now_iso()
    doc = dict(
        decision_memory_id=str(uuid4()),
        tenant_id=tenant_id,
        business_id=business_id,
        scenario_run_id=run_id,
        selected_recommendation_id=selected_recommendation_id,
        decision_status=decision_status,
        notes=notes,
        outcome_status=None,
        reviewed_at=None,
        created_at=now,
    )
    await db.scenario_decisions.insert_one(doc)
    return _clean(doc)


async def scenario_history(db: AsyncIOMotorDatabase, tenant_id: str, business_id: str) -> List[Dict[str, Any]]:
    runs = db.scenario_runs.find(
        {"tenant_id": tenant_id, "business_id": business_id}
    ).sort("created_at", -1)
    run_list = _clean_many([doc async for doc in runs])
    decisions = db.scenario_decisions.find(
        {"tenant_id": tenant_id, "business_id": business_id}
    )
    decision_map = {}
    async for d in decisions:
        d = _clean(d) or {}
        if d.get("scenario_run_id"):
            decision_map[d["scenario_run_id"]] = d.get("decision_status")
    history = []
    for r in run_list:
        history.append(
            dict(
                scenario_run_id=r["scenario_run_id"],
                scenario_name=r["scenario_name"],
                scenario_type=r["scenario_type"],
                executed_at=r.get("completed_at") or r.get("created_at"),
                decision_status=decision_map.get(r["scenario_run_id"]),
                state_result=r.get("state_result"),
            )
        )
    return history


async def clear_history(db: AsyncIOMotorDatabase, tenant_id: str, business_id: str) -> int:
    run_ids = []
    cursor = db.scenario_runs.find({"tenant_id": tenant_id, "business_id": business_id}, {"scenario_run_id": 1})
    async for doc in cursor:
        run_id = doc.get("scenario_run_id")
        if run_id:
            run_ids.append(run_id)

    deleted_runs = await db.scenario_runs.delete_many({"tenant_id": tenant_id, "business_id": business_id})

    if run_ids:
        await db.scenario_timelines.delete_many({"scenario_run_id": {"$in": run_ids}})
        await db.scenario_recommendations.delete_many({"scenario_run_id": {"$in": run_ids}})

    await db.scenario_decisions.delete_many({"tenant_id": tenant_id, "business_id": business_id})
    await db.scenario_risk_signals.delete_many({"tenant_id": tenant_id, "business_id": business_id})
    return deleted_runs.deleted_count


async def do_nothing_projection(
    tenant_id: str,
    business_id: str,
    state_version: str,
    state: BusinessStateSnapshot,
    timeline_months: int,
) -> Dict[str, Any]:
    projection_id = str(uuid4())
    months = max(1, min(12, int(timeline_months)))
    cash = float(state.starting_cash)
    forecast: List[Dict[str, Any]] = []
    for m in range(1, months + 1):
        revenue = float(state.revenue_monthly)
        costs = float(state.costs_monthly)
        profit = revenue - costs
        cash = max(0.0, cash + profit)
        score = _stability_score(
            BusinessStateSnapshot(
                revenue_monthly=revenue,
                costs_monthly=costs,
                starting_cash=cash,
                top_client_share_pct=state.top_client_share_pct,
                capacity_utilisation_pct=state.capacity_utilisation_pct,
                payment_terms_days=state.payment_terms_days,
                sales_cycle_days=state.sales_cycle_days,
                clients_count=state.clients_count,
            )
        )
        forecast.append(
            dict(
                month_index=m,
                revenue=round(revenue, 2),
                costs=round(costs, 2),
                profit=round(profit, 2),
                cash_balance=round(cash, 2),
                runway_months=round(_runway_months(revenue, costs, cash), 2),
                stability_score=round(score, 2),
                state_label=_state_label(score),
            )
        )

    return dict(
        projection_id=projection_id,
        timeline_months=months,
        forecast=forecast,
    )


def resolve_template(template_id: str) -> ScenarioTemplate | None:
    for t in _templates():
        if t.scenario_template_id == template_id:
            return t
    return None


def template_list() -> List[ScenarioTemplate]:
    return _templates()
