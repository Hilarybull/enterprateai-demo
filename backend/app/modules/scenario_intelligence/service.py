from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple
from uuid import uuid4

from app.core.supabase import sb_delete, sb_insert, sb_select
from app.modules.scenario_intelligence.schemas import (
    BusinessStateSnapshot,
    ScenarioRecommendation,
    ScenarioTemplate,
)

ENGINE_VERSION = "scenario_intel_v1.0"
_MEM_RUNS: Dict[str, Dict[str, Any]] = {}
_MEM_TIMELINES: Dict[str, List[Dict[str, Any]]] = {}
_MEM_RECOMMENDATIONS: Dict[str, List[Dict[str, Any]]] = {}
_MEM_DECISIONS: Dict[str, Dict[str, Any]] = {}
_MEM_RISK_SIGNALS: List[Dict[str, Any]] = []


async def _safe_insert(table: str, docs: Any) -> bool:
    try:
        await sb_insert(table, docs)
        return True
    except Exception:
        return False


async def _safe_select(table: str, **kwargs) -> List[Dict[str, Any]] | Dict[str, Any] | None:
    try:
        return await sb_select(table, **kwargs)
    except Exception:
        return None


async def _safe_delete(table: str, **kwargs) -> Any:
    try:
        return await sb_delete(table, **kwargs)
    except Exception:
        return None


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


def _month_span_from_days(days: int | None, fallback: int = 1, cap: int = 3) -> int:
    if days is None:
        return fallback
    return max(1, min(cap, int(round(max(1, days) / 30.0)) or fallback))


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

    if int(state.overdue_receivables_count or 0) > 0:
        signals.append(
            dict(
                risk_type="overdue_receivables",
                severity="high",
                metric_name="overdue_receivables_count",
                metric_value=int(state.overdue_receivables_count or 0),
                threshold_value=0,
                reason_code="OVERDUE_RECEIVABLES",
            )
        )

    if int(state.approaching_receivables_count or 0) > 0:
        signals.append(
            dict(
                risk_type="receivables_approaching_due",
                severity="medium",
                metric_name="approaching_receivables_count",
                metric_value=int(state.approaching_receivables_count or 0),
                threshold_value=0,
                reason_code="RECEIVABLES_APPROACHING_DUE",
            )
        )

    if int(state.overdue_payables_count or 0) > 0:
        signals.append(
            dict(
                risk_type="payables_pressure",
                severity="medium",
                metric_name="overdue_payables_count",
                metric_value=int(state.overdue_payables_count or 0),
                threshold_value=0,
                reason_code="PAYABLE_PRESSURE",
            )
        )

    if int(state.approaching_payables_count or 0) > 0:
        signals.append(
            dict(
                risk_type="payables_approaching_due",
                severity="low",
                metric_name="approaching_payables_count",
                metric_value=int(state.approaching_payables_count or 0),
                threshold_value=0,
                reason_code="PAYABLES_APPROACHING_DUE",
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
                    title="Simulate a margin recovery move",
                    trigger_reason=code,
                    priority=2,
                )
            )
        if code == "LOW_RUNWAY":
            recommendations.append(
                ScenarioRecommendation(
                    scenario_template_id="tmpl_payment_delay",
                    scenario_type="payment_delay",
                    title="Simulate slower collections",
                    trigger_reason=code,
                    priority=1,
                )
            )
        if code == "OVERDUE_RECEIVABLES":
            recommendations.append(
                ScenarioRecommendation(
                    scenario_template_id="tmpl_payment_delay",
                    scenario_type="payment_delay",
                    title="Simulate delayed customer payment",
                    trigger_reason=code,
                    priority=1,
                )
            )
        if code == "PAYABLE_PRESSURE":
            recommendations.append(
                ScenarioRecommendation(
                    scenario_template_id="tmpl_cost_increase",
                    scenario_type="cost_increase",
                    title="Simulate cost pressure escalation",
                    trigger_reason=code,
                    priority=3,
                )
            )
        if code == "RECEIVABLES_APPROACHING_DUE":
            recommendations.append(
                ScenarioRecommendation(
                    scenario_template_id="tmpl_payment_delay",
                    scenario_type="payment_delay",
                    title="Simulate receivables slipping past terms",
                    trigger_reason=code,
                    priority=2,
                )
            )
        if code == "PAYABLES_APPROACHING_DUE":
            recommendations.append(
                ScenarioRecommendation(
                    scenario_template_id="tmpl_cost_increase",
                    scenario_type="cost_increase",
                    title="Simulate payables maturing on time",
                    trigger_reason=code,
                    priority=3,
                )
            )
    # Always recommend at least one scenario to run.
    if not recommendations:
        recommendations.append(
            ScenarioRecommendation(
                scenario_template_id="tmpl_revenue_drop",
                scenario_type="revenue_drop",
                title="Simulate Revenue Drop",
                trigger_reason="BASELINE_CHECK",
                priority=1,
            )
        )
    return recommendations


def _apply_scenario(state: BusinessStateSnapshot, scenario_type: str, params: Dict[str, Any]) -> BusinessStateSnapshot:
    revenue = float(state.revenue_monthly)
    expenses = float(state.expenses_monthly or max(float(state.costs_monthly) - float(state.cost_of_sales_monthly or 0), 0.0))
    cost_of_sales = float(state.cost_of_sales_monthly or 0.0)
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
        expenses = max(0.0, expenses * (1.0 + inc_pct / 100.0))
        cost_of_sales = max(0.0, cost_of_sales * (1.0 + inc_pct / 100.0))
    elif scenario_type == "hire_staff":
        add_cost = float(params.get("employee_monthly_cost") or 0.0)
        employee_count = int(params.get("employee_count") or 1)
        expenses = max(0.0, expenses + (add_cost * max(1, employee_count)))
    elif scenario_type == "contractor_addition":
        add_cost = float(params.get("contractor_monthly_cost") or 0.0)
        expenses = max(0.0, expenses + add_cost)
    elif scenario_type == "service_launch":
        uplift = float(params.get("revenue_uplift_pct") or 0.0)
        cost_up = float(params.get("cost_uplift_pct") or 0.0)
        revenue = max(0.0, revenue * (1.0 + uplift / 100.0))
        expenses = max(0.0, expenses * (1.0 + cost_up / 100.0))
        cost_of_sales = max(0.0, cost_of_sales * (1.0 + cost_up / 100.0))

    return BusinessStateSnapshot(
        revenue_monthly=revenue,
        expenses_monthly=expenses,
        cost_of_sales_monthly=cost_of_sales,
        costs_monthly=expenses + cost_of_sales,
        accrued_revenue_total=state.accrued_revenue_total,
        accrued_expenses_total=state.accrued_expenses_total,
        accrued_cost_of_sales_total=state.accrued_cost_of_sales_total,
        starting_cash=starting_cash,
        top_client_share_pct=state.top_client_share_pct,
        capacity_utilisation_pct=state.capacity_utilisation_pct,
        payment_terms_days=state.payment_terms_days,
        sales_cycle_days=state.sales_cycle_days,
        clients_count=state.clients_count,
        approaching_receivables_count=state.approaching_receivables_count,
        overdue_receivables_count=state.overdue_receivables_count,
        approaching_payables_count=state.approaching_payables_count,
        overdue_payables_count=state.overdue_payables_count,
    )


def _monthly_projection_values(
    state: BusinessStateSnapshot,
    scenario_type: str,
    params: Dict[str, Any],
    month_index: int,
) -> Tuple[float, float, float]:
    base_revenue = float(state.revenue_monthly or 0.0)
    base_expenses = float(state.expenses_monthly or max(float(state.costs_monthly) - float(state.cost_of_sales_monthly or 0), 0.0))
    base_cost_of_sales = float(state.cost_of_sales_monthly or 0.0)

    revenue = base_revenue
    expenses = base_expenses
    cost_of_sales = base_cost_of_sales

    sales_ramp_months = _month_span_from_days(state.sales_cycle_days, fallback=1, cap=3)
    pricing_ramp_months = max(1, min(2, sales_ramp_months))
    cost_ramp_months = 2

    if scenario_type == "client_loss":
        loss_pct = float(params.get("client_loss_pct") or state.top_client_share_pct or 0.0)
        progress = min(1.0, month_index / float(sales_ramp_months))
        multiplier = max(0.0, 1.0 - ((loss_pct / 100.0) * progress))
        sticky_factor = max(0.35, 1.0 - ((loss_pct / 100.0) * min(1.0, max(0, month_index - 1) / 2.0)))
        revenue *= multiplier
        cost_of_sales *= sticky_factor
    elif scenario_type == "revenue_drop":
        drop_pct = float(params.get("revenue_drop_pct") or 0.0)
        progress = min(1.0, month_index / float(sales_ramp_months))
        multiplier = max(0.0, 1.0 - ((drop_pct / 100.0) * progress))
        revenue *= multiplier
        cost_of_sales *= multiplier
    elif scenario_type == "price_change":
        change_pct = float(params.get("price_change_pct") or 0.0)
        effective_month = max(1, int(params.get("effective_month") or 1))
        if month_index >= effective_month:
            progress = min(1.0, ((month_index - effective_month) + 1) / float(pricing_ramp_months))
            revenue *= 1.0 + ((change_pct / 100.0) * progress)
    elif scenario_type == "cost_increase":
        inc_pct = float(params.get("cost_increase_pct") or 0.0)
        progress = min(1.0, month_index / float(cost_ramp_months))
        multiplier = 1.0 + ((inc_pct / 100.0) * progress)
        expenses *= multiplier
        cost_of_sales *= multiplier
    elif scenario_type == "hire_staff":
        add_cost = float(params.get("employee_monthly_cost") or 0.0)
        employee_count = max(1, int(params.get("employee_count") or 1))
        expenses += add_cost * employee_count
    elif scenario_type == "contractor_addition":
        expenses += float(params.get("contractor_monthly_cost") or 0.0)
    elif scenario_type == "service_launch":
        uplift = float(params.get("revenue_uplift_pct") or 0.0)
        cost_up = float(params.get("cost_uplift_pct") or 0.0)
        progress = min(1.0, month_index / 3.0)
        revenue *= 1.0 + ((uplift / 100.0) * progress)
        expenses *= 1.0 + ((cost_up / 100.0) * progress)
        cost_of_sales *= 1.0 + ((cost_up / 100.0) * progress)

    return revenue, expenses, cost_of_sales


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
    payment_term_months = _month_span_from_days(state.payment_terms_days, fallback=1, cap=6)
    receivables_queue = [0.0] * max(1, delay_months + payment_term_months)
    payables_queue = [0.0] * max(1, payment_term_months)

    cash = float(scenario_state.starting_cash)
    timeline: List[Dict[str, Any]] = []

    for m in range(1, months + 1):
        revenue, expenses, cost_of_sales = _monthly_projection_values(state, scenario_type, params, m)
        costs = expenses + cost_of_sales
        profit = revenue - costs

        receivables_queue.append(revenue)
        collected_revenue = receivables_queue.pop(0)
        payables_queue.append(costs)
        paid_costs = payables_queue.pop(0)
        cash = max(0.0, cash + collected_revenue - paid_costs)

        score = _stability_score(
            BusinessStateSnapshot(
                revenue_monthly=revenue,
                expenses_monthly=expenses,
                cost_of_sales_monthly=cost_of_sales,
                costs_monthly=costs,
                accrued_revenue_total=state.accrued_revenue_total,
                accrued_expenses_total=state.accrued_expenses_total,
                accrued_cost_of_sales_total=state.accrued_cost_of_sales_total,
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
                expenses=round(expenses, 2),
                cost_of_sales=round(cost_of_sales, 2),
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
    expenses = float(state.expenses_monthly or 0)
    cost_of_sales = float(state.cost_of_sales_monthly or 0)
    costs = float(state.costs_monthly)
    net = revenue - costs
    stability = _stability_score(state)
    return dict(
        monthly_revenue=round(revenue, 2),
        monthly_expenses=round(expenses, 2),
        monthly_cost_of_sales=round(cost_of_sales, 2),
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
    stored = await _safe_insert("scenario_risk_signals", docs)
    if not stored:
        _MEM_RISK_SIGNALS.extend(docs)
    return _clean_many(docs)


async def create_scenario_run(
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

    stored = await _safe_insert("scenario_runs", run_doc)
    if not stored:
        _MEM_RUNS[run_id] = run_doc

    timeline_docs = [
        dict(scenario_run_id=run_id, created_at=now, **row) for row in timeline
    ]
    if timeline_docs:
        stored = await _safe_insert("scenario_timelines", timeline_docs)
        if not stored:
            _MEM_TIMELINES[run_id] = timeline_docs

    scenario_snapshot = _apply_scenario(state, scenario_type, params)
    run_risks = detect_risks(scenario_snapshot)
    recs = _recommendations_from_result(state_result, scenario_type, run_risks)
    rec_docs = []
    for idx, rec in enumerate(recs, 1):
        rec_docs.append(
            dict(
                recommendation_id=str(uuid4()),
                scenario_run_id=run_id,
                action_type=rec["action_type"],
                title=rec["title"],
                description=rec.get("description"),
                scenario_template_id=rec.get("scenario_template_id"),
                priority=idx,
                created_at=now,
            )
        )
    if rec_docs:
        stored = await _safe_insert("scenario_recommendations", rec_docs)
        if not stored:
            _MEM_RECOMMENDATIONS[run_id] = rec_docs

    return run_doc


def _recommendations_from_result(
    state_result: str,
    scenario_type: str,
    risk_signals: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    scenario_follow_ups = recommend_scenarios(risk_signals)
    seen_templates = set()
    filtered_follow_ups: List[ScenarioRecommendation] = []
    for rec in scenario_follow_ups:
        if rec.scenario_type == scenario_type:
            continue
        if rec.scenario_template_id in seen_templates:
            continue
        seen_templates.add(rec.scenario_template_id)
        filtered_follow_ups.append(rec)
    scenario_follow_ups = filtered_follow_ups

    if not scenario_follow_ups:
        fallback_by_scenario = {
            "client_loss": [
                dict(
                    action_type="run_next_scenario",
                    title="Simulate slower customer payments",
                    description="Client concentration remains high after this run. Compare the effect of delayed collections on cash.",
                    scenario_template_id="tmpl_payment_delay",
                ),
                dict(
                    action_type="run_next_scenario",
                    title="Simulate a margin recovery move",
                    description="Test whether pricing or margin improvement offsets concentration risk.",
                    scenario_template_id="tmpl_price_increase",
                ),
            ],
            "payment_delay": [
                dict(
                    action_type="run_next_scenario",
                    title="Simulate cost pressure escalation",
                    description="Compare delayed collections against a higher-cost environment.",
                    scenario_template_id="tmpl_cost_increase",
                ),
            ],
            "cost_increase": [
                dict(
                    action_type="run_next_scenario",
                    title="Simulate a margin recovery move",
                    description="Test whether a pricing response can absorb the cost increase.",
                    scenario_template_id="tmpl_price_increase",
                ),
            ],
        }
        if scenario_type in fallback_by_scenario:
            return fallback_by_scenario[scenario_type]

    if scenario_follow_ups:
        return [
            dict(
                action_type="run_next_scenario",
                title=rec.title,
                description=f"Triggered by {rec.trigger_reason.lower().replace('_', ' ')} in this run's output.",
                scenario_template_id=rec.scenario_template_id,
            )
            for rec in scenario_follow_ups[:3]
        ]
    if state_result == "improved":
        return [
            dict(
                action_type="pricing_action",
                title="Scenario appears viable",
                description=f"This {scenario_type.replace('_', ' ')} run improves stability. Proceed carefully and monitor cash weekly.",
            )
        ]
    if state_result == "worse":
        return [
            dict(
                action_type="risk_mitigation",
                title="Scenario increases risk",
                description=f"This {scenario_type.replace('_', ' ')} run worsens the business state. Adjust the plan before acting on it.",
            )
        ]
    return [
        dict(
            action_type="monitor",
            title="Scenario is neutral",
            description="Impact is limited. Run a follow-up scenario to compare a stronger intervention.",
        )
    ]


async def get_scenario_run(run_id: str) -> Dict[str, Any] | None:
    doc = await _safe_select("scenario_runs", filters=[("scenario_run_id", "eq", run_id)], single=True)
    if doc:
        return _clean(doc)
    return _clean(_MEM_RUNS.get(run_id))


async def get_scenario_timeline(run_id: str) -> List[Dict[str, Any]]:
    data = await _safe_select(
        "scenario_timelines",
        filters=[("scenario_run_id", "eq", run_id)],
        order="month_index",
        desc=False,
    )
    if data:
        return _clean_many(data)
    return _clean_many(_MEM_TIMELINES.get(run_id, []))


async def get_recommendations(run_id: str) -> List[Dict[str, Any]]:
    data = await _safe_select(
        "scenario_recommendations",
        filters=[("scenario_run_id", "eq", run_id)],
        order="priority",
        desc=False,
    )
    if data:
        return _clean_many(data)
    return _clean_many(_MEM_RECOMMENDATIONS.get(run_id, []))


async def save_decision(
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
    stored = await _safe_insert("scenario_decisions", doc)
    if not stored:
        _MEM_DECISIONS[run_id] = doc
    return _clean(doc)


async def scenario_history(tenant_id: str, business_id: str) -> List[Dict[str, Any]]:
    run_list = _clean_many(
        await _safe_select(
            "scenario_runs",
            filters=[("tenant_id", "eq", tenant_id), ("business_id", "eq", business_id)],
            order="created_at",
            desc=True,
        )
        or []
    )
    decision_rows = _clean_many(
        await _safe_select(
            "scenario_decisions",
            filters=[("tenant_id", "eq", tenant_id), ("business_id", "eq", business_id)],
        )
        or []
    )
    if not run_list:
        run_list = [r for r in _MEM_RUNS.values() if r.get("tenant_id") == tenant_id and r.get("business_id") == business_id]
    if not decision_rows:
        decision_rows = [d for d in _MEM_DECISIONS.values() if d.get("tenant_id") == tenant_id and d.get("business_id") == business_id]
    decision_map: Dict[str, Any] = {}
    for d in decision_rows:
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


async def clear_history(tenant_id: str, business_id: str) -> int:
    run_rows = await _safe_select(
        "scenario_runs",
        filters=[("tenant_id", "eq", tenant_id), ("business_id", "eq", business_id)],
        columns="scenario_run_id",
    )
    run_rows = run_rows or []
    run_ids = [r.get("scenario_run_id") for r in run_rows if r.get("scenario_run_id")]

    deleted_runs = await _safe_delete(
        "scenario_runs",
        filters=[("tenant_id", "eq", tenant_id), ("business_id", "eq", business_id)],
    )

    if run_ids:
        await _safe_delete("scenario_timelines", filters=[("scenario_run_id", "in", run_ids)])
        await _safe_delete("scenario_recommendations", filters=[("scenario_run_id", "in", run_ids)])

    await _safe_delete("scenario_decisions", filters=[("tenant_id", "eq", tenant_id), ("business_id", "eq", business_id)])
    await _safe_delete("scenario_risk_signals", filters=[("tenant_id", "eq", tenant_id), ("business_id", "eq", business_id)])
    _MEM_RUNS.clear()
    _MEM_TIMELINES.clear()
    _MEM_RECOMMENDATIONS.clear()
    _MEM_DECISIONS.clear()
    _MEM_RISK_SIGNALS.clear()
    return len(deleted_runs) if isinstance(deleted_runs, list) else 0


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
    payment_term_months = _month_span_from_days(state.payment_terms_days, fallback=1, cap=6)
    receivables_queue = [0.0] * max(1, payment_term_months)
    payables_queue = [0.0] * max(1, payment_term_months)
    forecast: List[Dict[str, Any]] = []
    for m in range(1, months + 1):
        revenue, expenses, cost_of_sales = _monthly_projection_values(state, "do_nothing_projection", {}, m)
        costs = expenses + cost_of_sales
        profit = revenue - costs
        receivables_queue.append(revenue)
        collected_revenue = receivables_queue.pop(0)
        payables_queue.append(costs)
        paid_costs = payables_queue.pop(0)
        cash = max(0.0, cash + collected_revenue - paid_costs)
        score = _stability_score(
            BusinessStateSnapshot(
                revenue_monthly=revenue,
                expenses_monthly=expenses,
                cost_of_sales_monthly=cost_of_sales,
                costs_monthly=costs,
                accrued_revenue_total=state.accrued_revenue_total,
                accrued_expenses_total=state.accrued_expenses_total,
                accrued_cost_of_sales_total=state.accrued_cost_of_sales_total,
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
                expenses=round(expenses, 2),
                cost_of_sales=round(cost_of_sales, 2),
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
