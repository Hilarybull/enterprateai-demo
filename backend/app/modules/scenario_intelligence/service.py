from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Tuple
from uuid import uuid4

from app.core.supabase import sb_delete, sb_insert, sb_select
from app.modules.scenario_intelligence.schemas import (
    BusinessStateSnapshot,
    ScenarioRecommendation,
    ScenarioTemplate,
)
from app.shared.llm.openai_client import AutoLLMClient
from app.modules.scenario_intelligence.projection import (  # noqa: F401  (re-exported for existing callers)
    OK,
    UNAVAILABLE,
    UNBOUNDED,
    _clamp,
    _classify_health_status,
    _month_span_from_days,
    _monthly_projection_values,
    _stability_score,
    MODEL_VERSION,
    clamp_months,
    compare_projections,
    project,
    run_rate_snapshot,
    typed_ratios,
)

ENGINE_VERSION = "scenario_intel_v2.1"  # Phase 1 integrated projection (simulation audit, 17 Nov 2026); model: MODEL_VERSION
logger = logging.getLogger(__name__)
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


def _today() -> date:
    """The date projections run from (UTC). One function, so tests can fix it and every caller agrees."""
    return datetime.now(timezone.utc).date()


def _clean(doc: Dict[str, Any] | None) -> Dict[str, Any] | None:
    if not doc:
        return doc
    if "_id" in doc:
        doc = dict(doc)
        doc.pop("_id", None)
    return doc


def _clean_many(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [d for d in (_clean(doc) for doc in docs) if d]


# ── QA PF4: what the engine can and can't say (Blueprint AC-2, §11) ─────────────────────────────────────────────
CLIENT_SCENARIOS = ("tmpl_client_loss",)      # about a client on record: never offered, or run, without one


def sufficiency(state: BusinessStateSnapshot) -> dict:
    """Can a projection be worked out from what is on record? Not with no revenue and no costs at all: the engine
    would only be projecting zeros. Says what is missing, in words."""
    revenue = float(state.revenue_monthly or 0) + float(state.accrued_revenue_total or 0) + sum(state.pending_receivables_schedule or [])
    costs = float(state.expenses_monthly or 0) + float(state.cost_of_sales_monthly or 0) + float(state.costs_monthly or 0)
    missing = [w for w, v in (("Monthly revenue", revenue), ("Monthly costs", costs)) if not v]
    return {"enough": not (revenue == 0 and costs == 0), "missing": missing}


def has_client(state: BusinessStateSnapshot) -> bool:
    return bool((state.clients_count or 0) > 0 or (state.top_client_share_pct or 0) > 0)


def at_risk_months(timeline: List[Dict[str, Any]]) -> List[int]:
    """The months the projection itself marks at risk, under stress or critical."""
    return [int(t.get("month_index") or 0) for t in timeline or [] if t.get("state_label") in ("at_risk", "stress", "critical")]


def _runway_months(revenue: float, costs: float, starting_cash: float) -> float:
    net = revenue - costs
    if net >= 0:
        return 999.0
    return max(0.0, starting_cash / max(abs(net), 1.0))


def _state_label(score: float) -> str:
    """Legacy label used by snapshot metrics and risk detection. DO NOT REMOVE."""
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
            required_inputs=["client_loss_pct"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_contractor_addition",
            scenario_type="contractor_addition",
            title="Add a Contractor",
            description="Simulate bringing on a contractor to add capacity without a permanent hire.",
            mode="manual",
            required_inputs=["employee_count", "contractor_monthly_cost", "cost_classification"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_price_increase",
            scenario_type="price_change",
            title="Increase Price",
            description="Simulate a price increase.",
            mode="manual",
            required_inputs=["price_change_pct", "effective_month", "price_sensitivity"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_hire_staff",
            scenario_type="hire_staff",
            title="Hire Employees",
            description="Simulate hiring additional staff members.",
            mode="adaptive_or_manual",
            required_inputs=["employee_count", "employee_monthly_cost", "employer_oncost_pct", "recruitment_cost_per_hire",
                             "start_month", "revenue_per_hire_monthly"],
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
            scenario_template_id="tmpl_reduce_fixed_cost",
            scenario_type="reduce_fixed_cost",
            title="Reduce Fixed Costs",
            description="Simulate cutting overhead or fixed operating costs.",
            mode="manual",
            required_inputs=["cost_reduction_pct"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_delay_hiring",
            scenario_type="delay_hiring",
            title="Cancel a planned hire",
            description="Remove the planned hire and its payroll cost throughout the forecast.",
            mode="manual",
            required_inputs=["employee_count", "employee_monthly_cost", "employer_oncost_pct"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_service_launch",
            scenario_type="service_launch",
            title="Launch New Service",
            description="Simulate a new service launch.",
            mode="manual",
            required_inputs=["revenue_uplift_pct", "cost_uplift_pct", "launch_cost"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_take_loan",
            scenario_type="take_loan",
            title="Take a Loan",
            description="Simulate borrowing money and repaying it in monthly instalments.",
            mode="manual",
            required_inputs=["loan_amount", "loan_annual_rate_pct", "loan_term_months", "loan_start_month"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_raise_investment",
            scenario_type="raise_investment",
            title="Raise Investment",
            description="Simulate equity investment, owner capital or a grant coming in.",
            mode="manual",
            required_inputs=["funding_amount", "funding_month", "funding_type"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_buy_equipment",
            scenario_type="buy_equipment",
            title="Buy Equipment",
            description="Simulate buying equipment: the cash it costs, its depreciation and what it brings in.",
            mode="manual",
            required_inputs=["equipment_cost", "purchase_month", "useful_life_months", "extra_revenue_monthly", "cost_saving_monthly"],
        ),
        ScenarioTemplate(
            scenario_template_id="tmpl_combined",
            scenario_type="combined",
            title="Combine Changes",
            description="Simulate several changes together, such as a price rise and a new hire.",
            mode="manual",
            required_inputs=[],
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

    accruals = float(state.accrued_revenue_total or 0.0)
    cash = float(state.starting_cash or 0.0)

    # 1. Receivable Exposure (Medium/High)
    if cash > 0 and accruals > 0:
        exposure_ratio = accruals / cash
        if exposure_ratio >= 1.0:
            signals.append(
                dict(
                    risk_type="receivable_exposure",
                    severity="high",
                    metric_name="receivable_exposure_ratio",
                    metric_value=round(exposure_ratio, 2),
                    threshold_value=1.0,
                    reason_code="HIGH_RECEIVABLE_EXPOSURE",
                )
            )
        elif exposure_ratio >= 0.5:
            signals.append(
                dict(
                    risk_type="receivable_exposure",
                    severity="medium",
                    metric_name="receivable_exposure_ratio",
                    metric_value=round(exposure_ratio, 2),
                    threshold_value=0.5,
                    reason_code="MODERATE_RECEIVABLE_EXPOSURE",
                )
            )

    # 2. Critical Growth Gap (Paper Profit)
    # Accruals > Cumulative Profit Growth Expectations (interpreted as Cumulative Profit)
    # Note: For detect_risks (snapshot), we don't always have cumulative profit,
    # so we rely on the timeline-level analysis for this specific critical alert.
    # However, if we are in a simulation timeline, _stability_score handles this.
    
    for s in signals:
        if "risk_signal_id" not in s:
            s["risk_signal_id"] = str(uuid4())
    
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
        if code in ["HIGH_RECEIVABLE_EXPOSURE", "MODERATE_RECEIVABLE_EXPOSURE"]:
            recommendations.append(
                ScenarioRecommendation(
                    scenario_template_id="tmpl_revenue_drop",
                    scenario_type="revenue_drop",
                    title="Simulate cash flow sensitivity",
                    trigger_reason=code,
                    priority=1,
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


def _apply_scenario(state: BusinessStateSnapshot, scenario_type: str, params: Dict[str, Any],
                    as_of: date | None = None) -> BusinessStateSnapshot:
    """The business's monthly figures once the scenario has run its course: the last month of the projection, for every
    scenario alike (audit F7: losses used to be judged at month 12 and everything else at month 1)."""
    month = clamp_months((params or {}).get("timeline_months") or 6)
    return run_rate_snapshot(state, scenario_type, params or {}, month, as_of=as_of)


def _timeline(
    state: BusinessStateSnapshot,
    scenario_type: str,
    params: Dict[str, Any],
    months: int,
    as_of: date | None = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """The scenario's month-by-month projection, plus its comparison with the same business doing nothing.

    Returns (timeline_rows, metrics) where metrics holds baseline_metrics / scenario_metrics (the monthly figures before
    and at the end of the run, as before) and, new in Phase 0, baseline_summary / scenario_summary (horizon totals,
    closing cash, checks, assumptions) and verdict (see projection.compare_projections)."""
    months = clamp_months(months)
    params = {**(params or {}), "timeline_months": months}
    # Both sides use the same business settings (tax, VAT, loans, inflation live on the state) and the same date, so the
    # only difference between them is the scenario itself.
    rows, scenario_summary = project(state, scenario_type, params, months, as_of=as_of)
    base_rows, baseline_summary = project(state, "do_nothing_projection", {}, months, as_of=as_of)
    verdict = compare_projections(baseline_summary, scenario_summary)
    # Phase 2 (audit F5/F11): range, robustness of the verdict, sensitivity, where each input came from, confidence, KPIs
    from app.modules.scenario_intelligence.uncertainty import analyse
    uncertainty = analyse(state, scenario_type, params, months, as_of, baseline_summary, base_rows, scenario_summary, rows)
    scenario_state = run_rate_snapshot(state, scenario_type, params, months, as_of=as_of)
    base_state = run_rate_snapshot(state, "do_nothing_projection", {}, months, as_of=as_of) if as_of else state
    return rows, dict(
        baseline_metrics=_snapshot_metrics(base_state),
        scenario_metrics=_snapshot_metrics(scenario_state, rows, state),
        baseline_summary=baseline_summary,
        scenario_summary=scenario_summary,
        verdict=verdict,
        uncertainty=uncertainty,
    )


def _snapshot_metrics(state: BusinessStateSnapshot, rows: List[Dict[str, Any]] | None = None,
                      original: BusinessStateSnapshot | None = None) -> Dict[str, Any]:
    revenue = float(state.revenue_monthly)
    expenses = float(state.expenses_monthly or 0)
    cost_of_sales = float(state.cost_of_sales_monthly or 0)
    costs = float(state.costs_monthly)
    net = revenue - costs
    stability = _stability_score(state)
    out = dict(
        monthly_revenue=round(revenue, 2),
        monthly_expenses=round(expenses, 2),
        monthly_cost_of_sales=round(cost_of_sales, 2),
        monthly_costs=round(costs, 2),
        net_profit=round(net, 2),
        stability_score=round(stability, 2),
    )
    if rows is not None:
        # The names the Live Plan reads when a scenario is adopted (live_plan.service.adopt_scenario: revenue_monthly,
        # gross_margin_pct, cash_runway_months, clients_count). They were never written, so adopting a scenario set those
        # targets to blank (found in the Phase 1 coordination review, 17 Nov 2026).
        last = rows[-1] if rows else {}
        out.update(
            revenue_monthly=round(revenue, 2),
            gross_margin_pct=round((revenue - cost_of_sales) / revenue * 100, 2) if revenue > 0 else None,
            cash_runway_months=last.get("cash_runway_months"),      # None while cash is not running down
            clients_count=(original.clients_count if original is not None else state.clients_count),
        )
    return out


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
    """Legacy: compares the rule-based stability scores. No longer decides a run's verdict (simulation audit F7); runs
    use projection.compare_projections. Kept only for callers that still compare two stability scores directly."""
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
            {
                "tenant_id": tenant_id,
                "business_id": business_id,
                "state_version": state_version,
                "detected_at": now,
                "created_at": now,
                **s,
                "risk_signal_id": s.get("risk_signal_id") or str(uuid4()),
            }
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
    as_of: date | None = None,
) -> Dict[str, Any]:
    from app.modules.scenario_intelligence.validation import validate_parameters
    params = validate_parameters(params)
    run_id = str(uuid4())
    now = _now_iso()
    as_of = as_of or _today()
    timeline_months = clamp_months(params.get("timeline_months") or 6)
    params = {**params, "timeline_months": timeline_months}
    timeline, metrics = _timeline(state, scenario_type, params, timeline_months, as_of=as_of)
    baseline_metrics = metrics["baseline_metrics"]
    scenario_metrics = metrics["scenario_metrics"]
    deltas = _deltas(baseline_metrics, scenario_metrics)
    # Audit F7: better or worse is judged on the projection itself (profit and cash against doing nothing, same months),
    # no longer on the rule-based stability score. The verdict, its basis and the assumptions are kept with the run,
    # inside the existing JSON columns so no database change is needed.
    verdict = metrics["verdict"]
    state_result = verdict["state_result"]
    baseline_metrics = {**baseline_metrics, "projection": metrics["baseline_summary"]}
    scenario_metrics = {**scenario_metrics, "projection": metrics["scenario_summary"], "verdict": verdict,
                        "uncertainty": metrics["uncertainty"]}

    # Engine scores recomputed on the business's own figures at the end of the period, with and without the change
    # (audit F3/F4). A failure is logged, never silently swallowed.
    try:
        from app.modules.scenario_intelligence.orchestration_service import (
            run_scenario_with_all_engines,
        )
        multi_engine_outputs = await run_scenario_with_all_engines(
            scenario_id=run_id,
            business_id=business_id,
            tenant_id=tenant_id,
            baseline_end_state=run_rate_snapshot(state, "do_nothing_projection", {}, timeline_months,
                                                 cash=metrics["baseline_summary"]["closing_cash"], as_of=as_of),
            scenario_end_state=run_rate_snapshot(state, scenario_type, params, timeline_months,
                                                 cash=metrics["scenario_summary"]["closing_cash"], as_of=as_of),
            scenario_type=scenario_type,
            timeline_months=timeline_months,
            verdict=verdict,
        )
    except Exception:  # noqa: BLE001 - the projection stands on its own; the engine scores are supplementary
        logger.exception("multi-engine scoring failed for scenario run %s", run_id)
        multi_engine_outputs = None

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
        scenario_snapshot=_apply_scenario(state, scenario_type, params, as_of).model_dump(),
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
        multi_engine=multi_engine_outputs,
        risk_signals=[], # Will be populated below
    )

    # 🚨 RISK DETECTION (Based on simulation outcome)
    # We use the final row of the timeline to detect if the simulation 
    # leads to high receivable exposure or low cash conversion.
    final_state_doc = timeline[-1] if timeline else {}
    final_state = BusinessStateSnapshot(
        revenue_monthly=float(final_state_doc.get("revenue", 0)),
        expenses_monthly=float(final_state_doc.get("expenses", 0)),
        cost_of_sales_monthly=float(final_state_doc.get("cost_of_sales", 0)),
        costs_monthly=float(final_state_doc.get("costs", 0)),
        accrued_revenue_total=float(final_state_doc.get("accruals", 0)),
        starting_cash=float(final_state_doc.get("cash_balance", 0)),
        top_client_share_pct=state.top_client_share_pct,
        capacity_utilisation_pct=state.capacity_utilisation_pct,
        payment_terms_days=state.payment_terms_days,
        sales_cycle_days=state.sales_cycle_days,
        clients_count=state.clients_count,
    )
    
    run_risks = detect_risks(final_state)
    run_doc["risk_signals"] = run_risks
    # Keep the complete result in an existing JSON column. Some deployed schemas
    # predate the extra risk, engine and timeline columns; writing those columns
    # made the whole insert fail and left history only in process memory.
    run_doc["scenario_metrics"] = {
        **run_doc["scenario_metrics"],
        "_saved_result": {"timeline": timeline, "risk_signals": run_risks, "multi_engine": multi_engine_outputs},
    }
    database_doc = {key: value for key, value in run_doc.items() if key not in {"risk_signals", "multi_engine"}}
    stored = await _safe_insert("scenario_runs", database_doc)
    if not stored:
        _MEM_RUNS[run_id] = run_doc

    timeline_docs = [
        dict(scenario_run_id=run_id, created_at=now, **row) for row in timeline
    ]
    if timeline_docs:
        # New runs read their timeline from the same saved JSON snapshot. The
        # legacy table remains readable for runs saved by earlier versions.
        _MEM_TIMELINES[run_id] = timeline_docs

    # recs = _recommendations_from_result(state_result, scenario_type, run_risks)
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

    trigger_descriptions = {
        "CLIENT_CONCENTRATION_HIGH": "Client concentration remains high after this scenario run.",
        "RECEIVABLES_APPROACHING_DUE": "Some receivables are nearing their due date in this scenario.",
        "OVERDUE_RECEIVABLES": "Overdue receivables were detected in this scenario's output.",
        "CAPACITY_OVERLOAD": "Capacity utilisation is high in this scenario.",
        "NEGATIVE_MARGIN": "This scenario produces a negative profit margin.",
        "LOW_RUNWAY": "Cash runway is limited in this scenario.",
        "PAYABLE_PRESSURE": "Payables pressure was detected in this scenario's output.",
        "PAYABLES_APPROACHING_DUE": "Some payables are approaching their due date in this scenario.",
        "BASELINE_CHECK": "Run this to stress-test your current baseline.",
        "HIGH_RECEIVABLE_EXPOSURE": "Critical receivable exposure: Accruals exceed Cash Balance. Liquidity depends entirely on collections.",
        "MODERATE_RECEIVABLE_EXPOSURE": "Significant receivable exposure: Accruals exceed 50% of Cash Balance. Collections risk is mounting.",
        "CRITICAL_COLLECTION_RISK": "Critical: Paper profits are accumulating but cash conversion is failing. Check your billing terms.",
    }
    if scenario_follow_ups:
        return [
            dict(
                action_type="run_next_scenario",
                title=rec.title,
                description=trigger_descriptions.get(rec.trigger_reason, "Suggested based on this scenario's output."),
                scenario_template_id=rec.scenario_template_id,
            )
            for rec in scenario_follow_ups[:3]
        ]
    if state_result == "improved":
        return [
            dict(
                action_type="pricing_action",
                title="Scenario appears viable",
                description=f"This {scenario_type.replace('_', ' ')} run leaves profit and cash materially better than doing nothing. Proceed carefully and monitor cash weekly.",
            )
        ]
    if state_result == "worse":
        return [
            dict(
                action_type="risk_mitigation",
                title="Scenario increases risk",
                description=f"This {scenario_type.replace('_', ' ')} run leaves profit or cash materially worse than doing nothing. Adjust the plan before acting on it.",
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
    doc = _clean(doc or _MEM_RUNS.get(run_id))
    if not doc:
        return None
    metrics = dict(doc.get("scenario_metrics") or {})
    saved = metrics.pop("_saved_result", None)
    if not isinstance(saved, dict):
        return doc
    return {**doc, "scenario_metrics": metrics, "risk_signals": saved.get("risk_signals") or [],
            "multi_engine": saved.get("multi_engine"), "_timeline": saved.get("timeline") or []}


async def get_scenario_timeline(run_id: str) -> List[Dict[str, Any]]:
    run = await get_scenario_run(run_id)
    if run and "_timeline" in run:
        return _clean_many(run["_timeline"])
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


def run_digest(run: Dict[str, Any]) -> Dict[str, Any]:
    """A saved run in brief, for other modules that pass runs to an AI model (business assistant): the verdict, its
    reason and figures, confidence and robustness, and the monthly figures before and after. The full run (monthly detail,
    13-week view, ranges) is too large to pass whole and would be cut off (Phase 2 coordination, 17 Nov 2026)."""
    sm = run.get("scenario_metrics") or {}
    bm = run.get("baseline_metrics") or {}
    verdict = sm.get("verdict") or {}
    u = sm.get("uncertainty") or {}
    keep = ("monthly_revenue", "monthly_costs", "net_profit")
    return dict(
        scenario_run_id=run.get("scenario_run_id"),
        scenario_name=run.get("scenario_name"),
        scenario_type=run.get("scenario_type"),
        created_at=run.get("created_at"),
        state_result=run.get("state_result"),
        verdict={k: verdict.get(k) for k in ("outcome", "reason", "months", "net_cash_change", "cumulative_profit_change",
                                             "materiality_threshold", "cash_shortfall_introduced")} if verdict else None,
        confidence=(u.get("confidence") or {}).get("level"),
        robustness=(u.get("ranges") or {}).get("robustness"),
        before={k: bm.get(k) for k in keep},
        after={k: sm.get(k) for k in keep},
        basis=(run.get("parameters") or {}).get("basis") or "records",
    )


def _range_brief(run: Dict[str, Any]) -> Dict[str, Any]:
    """The verdicts in the low/base/high cases and whether the verdict is robust, for the AI explanation."""
    ranges = (((run.get("scenario_metrics") or {}).get("uncertainty") or {}).get("ranges") or {})
    return {k: v for k, v in ranges.items() if k in ("verdicts", "robustness", "note")}


async def generate_scenario_interpretation(run_id: str, user_id: str) -> Dict[str, Any]:
    run = await get_scenario_run(run_id)
    if not run:
        raise ValueError("Scenario run not found")

    timeline = await get_scenario_timeline(run_id)
    recs = await get_recommendations(run_id)

    baseline = run.get("baseline_snapshot") or {}
    scenario = run.get("scenario_snapshot") or {}
    last_month = timeline[-1] if timeline else {}

    prompt = f"""
Scenario run ID: {run_id}
Scenario name: {run.get("scenario_name")}
Scenario type: {run.get("scenario_type")}
Baseline at the final month: {run.get("baseline_metrics")}
Scenario at the same final month: {run.get("scenario_metrics")}
Entered parameters: {run.get("parameters")}
Final month output: {last_month}
Verdict against doing nothing (same months): {(run.get("scenario_metrics") or {}).get("verdict")}
Assumptions: {((run.get("scenario_metrics") or {}).get("projection") or {}).get("assumptions")}
Confidence in the data: {(((run.get("scenario_metrics") or {}).get("uncertainty") or {}).get("confidence"))}
Range and robustness: {_range_brief(run)}
Recommendations: {recs}

Basis: {"an estimate from the owner's own pricing answers (" + str((run.get("parameters") or {}).get("estimate_basis")) + ")" if (run.get("parameters") or {}).get("basis") == "estimate" else "the business's records"}

Write a concise business interpretation for the founder.
Include:
1. The likely impact in plain English.
2. The most important risk or upside.
3. One practical next step.
Compare baseline and scenario for the same final month and state the percentage the user entered. Never compare today with a future scenario month.
Only describe the engine output above: never add a figure, a cause or a risk that is not in it. Where a value is
missing, unavailable or unbounded, say so instead of guessing. If the basis is an estimate, say it is an estimate.
If there is not enough data for a point, say "not enough data" for it. State the confidence level, and if the verdict is
not robust across the low and high cases, say so plainly.
"""

    system = (
        "You are EnterprateAI's scenario interpretation assistant. "
        "Explain business scenarios clearly, briefly, and without hallucinating any numbers."
    )
    client = AutoLLMClient(user_id=user_id)
    result = await client.generate_text(system=system, prompt=prompt, feature="scenario_ai_interpretation")
    return {
        "scenario_run_id": run_id,
        "interpretation": result.text,
        "provider": result.provider,
        "model": result.model,
        "total_tokens": result.total_tokens,
    }


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
                # Phase 6: which model made it (for the model-update notice) and its verdict
                model_version=((r.get("scenario_metrics") or {}).get("projection") or {}).get("model_version"),
                outcome=((r.get("scenario_metrics") or {}).get("verdict") or {}).get("outcome"),
            )
        )
    return history


async def forecast_accuracy(tenant_id: str, business_id: str, state: BusinessStateSnapshot,
                            as_of: date | None = None) -> Dict[str, Any]:
    """Earlier runs' forecasts against the months that have since completed, and a backtest on the business's own
    history (Phase 3, accuracy.py)."""
    from app.modules.scenario_intelligence.accuracy import accuracy_report, run_record
    run_list = _clean_many(await _safe_select(
        "scenario_runs", filters=[("tenant_id", "eq", tenant_id), ("business_id", "eq", business_id)],
        order="created_at", desc=True) or [])
    if not run_list:
        run_list = [r for r in _MEM_RUNS.values() if r.get("tenant_id") == tenant_id and r.get("business_id") == business_id]
    decisions = _clean_many(await _safe_select(
        "scenario_decisions", filters=[("tenant_id", "eq", tenant_id), ("business_id", "eq", business_id)]) or [])
    if not decisions:
        decisions = [d for d in _MEM_DECISIONS.values() if d.get("tenant_id") == tenant_id and d.get("business_id") == business_id]
    status = {d.get("scenario_run_id"): d.get("decision_status") for d in decisions if d.get("scenario_run_id")}
    records = [run_record(r, status.get(r.get("scenario_run_id"))) for r in run_list]
    return accuracy_report(records, state.revenue_by_month, as_of or _today())


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
    # Simulation audit, Phase 4: only this tenant's runs for this business (it used to clear every business's runs)
    def mine(doc: Any) -> bool:
        return isinstance(doc, dict) and doc.get("tenant_id") == tenant_id and doc.get("business_id") == business_id
    mem_ids = [rid for rid, doc in _MEM_RUNS.items() if mine(doc)]
    for rid in mem_ids:
        _MEM_RUNS.pop(rid, None)
        _MEM_TIMELINES.pop(rid, None)
        _MEM_RECOMMENDATIONS.pop(rid, None)
        _MEM_DECISIONS.pop(rid, None)
    _MEM_RISK_SIGNALS[:] = [s for s in _MEM_RISK_SIGNALS if not mine(s)]
    if isinstance(deleted_runs, list):
        return len(deleted_runs)
    return len(mem_ids)


async def do_nothing_projection(
    tenant_id: str,
    business_id: str,
    state_version: str,
    state: BusinessStateSnapshot,
    timeline_months: int,
    as_of: date | None = None,
    params: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """The business as it is, projected forward on the same engine as every scenario (audit F1), with its range, inputs,
    confidence and KPIs (Phase 2). `params` carries only the estimate basis, when the run is from an estimate."""
    from app.modules.scenario_intelligence.uncertainty import analyse
    as_of = as_of or _today()
    forecast, summary = project(state, "do_nothing_projection", {}, timeline_months, clamp=False, as_of=as_of)
    summary["uncertainty"] = analyse(state, "do_nothing_projection", params or {}, summary["months"], as_of, summary, forecast)
    return dict(
        projection_id=str(uuid4()),
        timeline_months=summary["months"],
        forecast=forecast,
        summary=summary,
    )


def resolve_template(template_id: str) -> ScenarioTemplate | None:
    for t in _templates():
        if t.scenario_template_id == template_id:
            return t
    return None


def template_list() -> List[ScenarioTemplate]:
    return _templates()


# ── Simulation audit, Phase 6 (model 1.6): reproduce a saved run; compare runs side by side ─────────────────────────

def reproduce(run: Dict[str, Any]) -> Dict[str, Any]:
    """Run a saved scenario again from its own stored inputs (the snapshot: state, scenario, settings, date) and say
    whether it gives the same figures. With the same model version it must match exactly; after a model change it
    shows what moved and why (model_info)."""
    from app.modules.scenario_intelligence import model_info
    from app.modules.scenario_intelligence.projection import MODEL_VERSION, compare_projections, project
    saved = ((run.get("scenario_metrics") or {}).get("projection") or {})
    saved_base = ((run.get("baseline_metrics") or {}).get("projection") or {})
    state = BusinessStateSnapshot(**(run.get("baseline_snapshot") or {}))
    params = dict(run.get("parameters") or {})
    months = int(run.get("timeline_months") or params.get("timeline_months") or 6)
    as_of = date.fromisoformat(saved["as_of"]) if saved.get("as_of") else None
    _r, base = project(state, "do_nothing_projection", {}, months, as_of=as_of)
    _r, scen = project(state, run.get("scenario_type") or "do_nothing_projection", params, months, as_of=as_of)
    verdict = compare_projections(base, scen)
    then = saved.get("model_version")
    compared = []
    for label, now_v, then_v in (("Closing cash", scen["closing_cash"], saved.get("closing_cash")),
                                 ("Profit over the period", scen["cumulative_profit"], saved.get("cumulative_profit")),
                                 ("Closing cash if nothing changes", base["closing_cash"], saved_base.get("closing_cash"))):
        if then_v is not None:
            compared.append(dict(figure=label, saved=round(float(then_v), 2), now=round(float(now_v), 2),
                                 same=abs(float(then_v) - float(now_v)) < 0.01))
    saved_outcome = ((run.get("scenario_metrics") or {}).get("verdict") or {}).get("outcome")
    same = all(c["same"] for c in compared) and (saved_outcome in (None, verdict["outcome"]))
    return dict(scenario_run_id=run.get("scenario_run_id"), reproduced=same, model_version_saved=then, model_version_now=MODEL_VERSION,
                as_of=saved.get("as_of"), compared=compared, verdict_saved=saved_outcome, verdict_now=verdict["outcome"],
                explanation=("Run again from its saved inputs, it gives exactly the same figures." if same else
                             ("Different, because the model has changed since this run: " + " ".join(model_info.changes_since(then))
                              if then and then != MODEL_VERSION else
                              "Different with the same model version: please report this, it should not happen.")))


def comparison_row(run: Dict[str, Any]) -> Dict[str, Any]:
    """One run's key results, for the side-by-side comparison."""
    from app.modules.scenario_intelligence.projection import MODEL_VERSION
    m = run.get("scenario_metrics") or {}
    v = m.get("verdict") or {}
    u = m.get("uncertainty") or {}
    verdicts = ((u.get("ranges") or {}).get("verdicts") or {})
    proj = m.get("projection") or {}
    return dict(scenario_run_id=run.get("scenario_run_id"), scenario_name=run.get("scenario_name"), scenario_type=run.get("scenario_type"),
                created_at=run.get("created_at"), months=run.get("timeline_months"), outcome=v.get("outcome"), reason=v.get("reason"),
                profit_change=v.get("cumulative_profit_change"), net_cash_change=v.get("net_cash_change"),
                net_cash_change_low=(verdicts.get("low") or {}).get("net_cash_change"),
                net_cash_change_high=(verdicts.get("high") or {}).get("net_cash_change"),
                robust=(u.get("ranges") or {}).get("robust"), confidence=(u.get("confidence") or {}).get("level"),
                closing_cash=proj.get("closing_cash"), model_version=proj.get("model_version"),
                current_model=proj.get("model_version") in (None, MODEL_VERSION))
