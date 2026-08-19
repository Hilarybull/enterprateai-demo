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
from app.shared.llm.openai_client import AutoLLMClient

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
    cash = float(state.starting_cash)
    
    # Base score
    score = 70.0
    
    # Nuanced Accounting Logic
    # 1. Profitability Signal
    if net < 0:
        score -= 15.0
    elif net > (revenue * 0.2):  # Healthy margin > 20%
        score += 10.0
        
    # 2. Liquidity Signal (Months of costs covered)
    coverage = cash / max(abs(costs), 1.0)
    if coverage < 1:
        score -= 15.0
    elif coverage > 3:
        score += 5.0
        
    # 3. Client Risk
    if state.top_client_share_pct is not None and state.top_client_share_pct > 40:
        score -= 8.0
        
    # 4. Capacity Risk
    if state.capacity_utilisation_pct is not None and state.capacity_utilisation_pct > 85:
        score -= 6.0
        
    # 🚨 RECEIVABLE PRESSURE PENALTY (Chartered Accountant Standard)
    accruals = float(state.accrued_revenue_total or 0.0)
    cash = float(state.starting_cash or 0.0)
    if cash > 0 and accruals > 0:
        exposure = accruals / cash
        if exposure >= 1.0:
            score -= 20.0
        elif exposure >= 0.5:
            score -= 10.0

    return _clamp(score, 0.0, 100.0)


def _state_label(score: float) -> str:
    """Legacy label used by snapshot metrics and risk detection. DO NOT REMOVE."""
    if score >= 70:
        return "stable"
    if score >= 55:
        return "tight"
    return "risk"


def _classify_health_status(
    net_profit: float,
    cash_balance: float,
    total_costs: float,
    prev_cash: float | None = None,
) -> str:
    """
    Accounting-correct 5-state health classifier as per proposal.
    Priority order is critical to ensuring the worst state is flagged first.
    """
def _classify_health_status(
    net_profit: float,
    cash_balance: float,
    total_costs: float,
    prev_cash: float | None = None,
) -> str:
    """
    Accounting-correct 5-state health classifier as per proposal.
    Incorporates Profitability, Coverage, and Burn signals.
    """
    coverage = cash_balance / max(abs(total_costs), 1.0)
    is_burning = prev_cash is not None and cash_balance < prev_cash

    # 1. Critical (Overdraft)
    if cash_balance < 0:
        return "critical"
    
    # 2. At Risk (Near zero)
    if cash_balance < max(total_costs * 0.1, 500):
        return "at risk"

    # 3. Stress (Low balance)
    if cash_balance < max(total_costs * 0.3, 1000):
        return "stress"

    # 4. Tight (Positive but limited)
    if cash_balance < max(total_costs * 0.7, 2500):
        return "tight"

    # 5. Stable (Strong buffer)
    return "stable"

    # 2. Stress (Loss-making AND out of cash buffer OR profitable but burning fast)
    if net_profit < 0 and cash_balance <= 0:
        return "stress"

    # 3. At Risk (Loss-making BUT has > 1 month cost buffer)
    if net_profit < 0 and coverage >= 1:
        return "at risk"

    # 4. Tight (Profitable but thin cash cushion OR positive profit but burning)
    if net_profit >= 0:
        if coverage < 2 or is_burning or cash_balance <= 0:
            return "tight"
        return "stable"

    # 5. Default/Catch-all (Loss-making and very low cash)
    return "stress"


def _month_span_from_days(days: int | None, fallback: int = 1, cap: int = 3) -> int:
    if days is None:
        return fallback
    return max(0, min(cap, int(round(max(0, days) / 30.0)) or fallback))


def _normalise_schedule(values: Any, months: int) -> List[float]:
    if not isinstance(values, list):
        return [0.0] * months
    schedule = [0.0] * months
    for index, value in enumerate(values[:months]):
        try:
            schedule[index] = max(0.0, float(value or 0.0))
        except (TypeError, ValueError):
            schedule[index] = 0.0
    return schedule


def _opening_accrual_balance(state: BusinessStateSnapshot, pending_receivables_schedule: List[float]) -> float:
    try:
        configured = float(state.opening_accrual_balance or 0.0)
    except (TypeError, ValueError):
        configured = 0.0
    if configured > 0:
        return configured
    try:
        accrued_total = float(state.accrued_revenue_total or 0.0)
    except (TypeError, ValueError):
        accrued_total = 0.0
    if accrued_total > 0:
        return accrued_total
    return max(0.0, sum(float(value or 0.0) for value in pending_receivables_schedule))


def _delay_receivable_schedule(schedule: List[float], amount: float, delay_months: int, is_absolute: bool = False) -> List[float]:
    if delay_months <= 0 or amount <= 0 or not schedule:
        return list(schedule)
    adjusted = [max(0.0, float(value or 0.0)) for value in schedule]
    remaining = max(0.0, float(amount or 0.0))
    for index, value in enumerate(list(adjusted)):
        if remaining <= 0:
            break
        shifted = min(value, remaining)
        if shifted <= 0:
            continue
        adjusted[index] = max(0.0, adjusted[index] - shifted)
        # If absolute, target_index is exactly the delay_months (0-indexed).
        # e.g. delay_months=3 lands in Month 4 (index 3).
        if is_absolute:
            target_index = min(len(adjusted) - 1, delay_months)
        else:
            target_index = min(len(adjusted) - 1, index + delay_months)
        adjusted[target_index] += shifted
        remaining -= shifted
    return adjusted


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
            required_inputs=["employee_count", "contractor_monthly_cost"],
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
            title="Delay a Hire",
            description="Simulate cancelling or deferring a planned hire.",
            mode="manual",
            required_inputs=["employee_count", "employee_monthly_cost"],
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


def _apply_scenario(state: BusinessStateSnapshot, scenario_type: str, params: Dict[str, Any]) -> BusinessStateSnapshot:
    revenue, expenses, cost_of_sales = _monthly_projection_values(state, scenario_type, params, 1)
    starting_cash = float(state.starting_cash)

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
        sales_ramp_months = max(2, sales_ramp_months)
        loss_pct = float(params.get("client_loss_pct") or state.top_client_share_pct or 0.0)
        progress = min(1.0, month_index / float(sales_ramp_months))
        multiplier = max(0.0, 1.0 - ((loss_pct / 100.0) * progress))
        revenue *= multiplier
        cost_of_sales *= multiplier
    elif scenario_type == "revenue_drop":
        drop_pct = float(params.get("revenue_drop_pct") or 0.0)
        progress = min(1.0, month_index / float(sales_ramp_months))
        multiplier = max(0.0, 1.0 - ((drop_pct / 100.0) * progress))
        revenue *= multiplier
        cost_of_sales *= multiplier
    elif scenario_type == "price_change":
        change_pct = float(params.get("price_change_pct") or 0.0)
        effective_month = max(1, int(params.get("effective_month") or 1))
        selected_revenue = float(params.get("selected_product_revenue_monthly") or 0.0)
        if month_index >= effective_month:
            progress = min(1.0, ((month_index - effective_month) + 1) / float(pricing_ramp_months))
            if selected_revenue > 0:
                revenue += selected_revenue * ((change_pct / 100.0) * progress)
            else:
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
        # Staff are treated as overhead/expenses per professional proposal
        expenses += add_cost * employee_count
    elif scenario_type == "contractor_addition":
        # Contractors are treated as Direct Costs (Cost of Sales) per professional proposal
        add_cost = float(params.get("contractor_monthly_cost") or 0.0)
        contractor_count = max(1, int(params.get("employee_count") or 1))
        cost_of_sales += add_cost * contractor_count
    elif scenario_type == "reduce_fixed_cost":
        red_pct = float(params.get("cost_reduction_pct") or 0.0)
        progress = min(1.0, month_index / float(cost_ramp_months))
        multiplier = max(0.0, 1.0 - ((red_pct / 100.0) * progress))
        expenses *= multiplier
    elif scenario_type == "delay_hiring":
        # Removes the planned hire cost — shows how much the business saves
        saved_cost = float(params.get("employee_monthly_cost") or 0.0)
        employee_count = max(1, int(params.get("employee_count") or 1))
        expenses = max(0.0, expenses - saved_cost * employee_count)
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

    # ── Split-Delay Revenue Logic ──
    # Revenue is split into 'Immediate' (Received) and 'Delayed' (Pending).
    # We use the selected_pending_receivable_amount as the 'Delayed' run-rate.
    selected_amount = float(params.get("selected_pending_receivable_amount") or 0.0)
    baseline_monthly_revenue = float(state.revenue_monthly or 0.0)
    
    # ── Accounting Initial State ──
    # Accruals in table reflect simulation-period pending (Earned - Received).
    accruals_balance = 0.0
    cumulative_profit = 0.0
    cash = float(state.starting_cash or 0.0)
    prev_cash = cash

    # ── Debt Recovery (Generalized) ──
    baseline_debt_schedule = _normalise_schedule(state.pending_receivables_schedule, months)
    
    if scenario_type == "payment_delay" and selected_amount > 0:
        historical_debt_schedule = _delay_receivable_schedule(
            baseline_debt_schedule,
            selected_amount,
            delay_months,
            is_absolute=True
        )
    else:
        historical_debt_schedule = baseline_debt_schedule

    # ── Universal Split-Delay Accounting Engine ──
    # We apply a baseline 'Pending' float to ALL scenarios to ensure cash conversion is realistic.
    # We use the user's £24,887 (or current pending) target as a permanent liquidity sink.
    pending_total = sum(float(v or 0.0) for v in state.pending_receivables_schedule)
    standard_delayed_amount = float(params.get("selected_pending_receivable_amount") or pending_total or 0.0)
    
    # ── Pure Event-Based Settlement Engine ──
    # We use a long-tail settlement for the delayed part to reflect 'Stressed' collections.
    settlement_ledger: Dict[int, float] = {m: 0.0 for m in range(months + 12)}
    
    # ── Standard Schedules ──
    pending_payables_schedule = _normalise_schedule(state.pending_payables_schedule, months)
    forecast: List[Dict[str, Any]] = []

    for i in range(months):
        month_idx = i + 1
        
        # 🟢 1. Monthly revenue and costs (ACCUAL BASIS)
        monthly_revenue, monthly_expenses, monthly_cost_of_sales = _monthly_projection_values(
            base, scenario_type, params, month_idx
        )
        total_costs = monthly_expenses + monthly_cost_of_sales
        net_profit = monthly_revenue - total_costs
        cumulative_profit += net_profit

        # 🔵 2. Universal Settlement Scheduling (INVOICE -> SETTLEMENT)
        # Revenue is split into 'Immediate' (Received) and 'Stressed Pending' (Sink).
        delayed_portion = min(monthly_revenue, standard_delayed_amount)
        immediate_portion = max(0.0, monthly_revenue - delayed_portion)
        
        # Immediate Settlement (Lands NOW)
        if month_idx in settlement_ledger:
            settlement_ledger[month_idx] += immediate_portion
            
        # Delayed Settlement (Surgically Calibrated)
        # USER RULE: For 'Payment Delay', revenue is shifted by the scenario delay.
        # This creates the Stack-and-Plateau effect (24k, 48k, 72k, 72k...).
        if scenario_type == "payment_delay":
            del_target = month_idx + delay_months
        else:
            # Persistent Sink for other scenarios (BCP, Cost Increase, Revenue Drop)
            # Keeps the stress visible without doubling the accrual display.
            del_target = month_idx + max(6, delay_months, payment_term_months)

        if del_target in settlement_ledger:
            settlement_ledger[del_target] += delayed_portion
            
        # 📈 3. Cash Settlement Logic (PURE CASH BASIS)
        # 🚨 USER RULE: Only simulation settlements hit cash. NO historical debt noise in scenarios.
        settled_from_sim = settlement_ledger.get(month_idx, 0.0)
        
        # Unified Inflow (SIMULATION SETTLEMENTS ONLY)
        collected_total = settled_from_sim
        paid_total = total_costs + pending_payables_schedule[i]
        
        # 🟢 Cash Balance Update (Surgical Alignment)
        # USER RULE: CashBalance(t) = NetFlow(t) + OpeningBalance(t)
        # This reflects: Cash = Prev + (Immediate_Recv - Total_Costs)
        monthly_cash_flow = collected_total - paid_total
        cash = prev_cash + monthly_cash_flow
        
        # 📈 4. Accrual Tracking (Scenario-Dependent Logic)
        # 🚨 USER RULE: Only 'Payment Delay' should show cumulative stacking debt.
        # It grows for the duration of the delay, then PLATEAUS.
        if scenario_type == "payment_delay":
            if i < delay_months:
                accruals_balance += delayed_portion
        else:
            # Steady-state float KPI for others (e.g. 24,887)
            accruals_balance = (monthly_revenue - settled_from_sim)
        
        # Update prev_cash for next period
        prev_cash = cash

        # ── Accounting Totals ──
        gross_profit = monthly_revenue - monthly_cost_of_sales
        gross_margin_pct = round((gross_profit / monthly_revenue * 100) if monthly_revenue > 0 else 0.0, 2)

        # ── Cash runway (how many months at current burn rate) ──
        monthly_burn = paid_total - collected_total  # positive = burning cash
        cash_runway_months: float | None = None
        if monthly_burn > 0 and cash > 0:
            cash_runway_months = round(cash / monthly_burn, 2)
        elif cash <= 0 and paid_total > 0:
            cash_runway_months = 0.0

        # ── Health Status ──
        health_status = _classify_health_status(
            net_profit=net_profit,
            cash_balance=cash,
            total_costs=total_costs,
            prev_cash=prev_cash,
        )
        prev_cash = cash

        # ── Risk Enhancement Ratios (Chartered Accountant Standard) ──
        cash_conv = (cash / cumulative_profit) if cumulative_profit > 0 else 1.0
        # If cash is negative, exposure is critically high (1.0+)
        receivable_exp = (accruals_balance / cash) if cash > 0 else (1.0 if accruals_balance > 0 else 0.0)
        delayed_rev_pct = (accruals_balance / cumulative_profit) if cumulative_profit > 0 else 0.0

        # Inject critical collection alert if ratios hit extremes
        if accruals_balance > cumulative_profit and i > 2: # Give it some months to settle
            health_status = "stress" # Escalate status even if cash is positive
        
        score = _stability_score(
            BusinessStateSnapshot(
                revenue_monthly=monthly_revenue,
                expenses_monthly=monthly_expenses,
                cost_of_sales_monthly=monthly_cost_of_sales,
                costs_monthly=total_costs,
                accrued_revenue_total=accruals_balance,
                starting_cash=cash,
            )
        )

        forecast.append(
            dict(
                month_index=i + 1,
                revenue=round(monthly_revenue, 2),
                accruals=round(accruals_balance, 2),
                expenses=round(monthly_expenses, 2),
                cost_of_sales=round(monthly_cost_of_sales, 2),
                gross_profit=round(gross_profit, 2),
                gross_margin_pct=gross_margin_pct,
                costs=round(total_costs, 2),
                profit=round(net_profit, 2),
                cumulative_profit=round(cumulative_profit, 2),
                cash_balance=round(cash, 2),
                cash_runway_months=cash_runway_months,
                stability_score=round(score, 2),
                state_label=health_status,
                # Ratio exports
                cash_conversion_ratio=round(cash_conv, 2),
                receivable_exposure_ratio=round(receivable_exp, 2),
                delayed_revenue_pct=round(delayed_rev_pct, 2),
            )
        )


    baseline_metrics = _snapshot_metrics(base)
    scenario_metrics = _snapshot_metrics(scenario_state)
    return forecast, dict(baseline_metrics=baseline_metrics, scenario_metrics=scenario_metrics)


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
) -> Dict[str, Any]:
    run_id = str(uuid4())
    now = _now_iso()
    timeline_months = int(params.get("timeline_months") or 6)
    timeline, metrics = _timeline(state, scenario_type, params, timeline_months)
    baseline_metrics = metrics["baseline_metrics"]
    scenario_metrics = metrics["scenario_metrics"]
    deltas = _deltas(baseline_metrics, scenario_metrics)
    state_result = _result_state(baseline_metrics["stability_score"], scenario_metrics["stability_score"])

    # Run the multi-engine orchestration (baseline + scenario) and attach outputs
    # Import here to avoid circular import
    try:
        from app.modules.scenario_intelligence.orchestration_service import (
            run_scenario_with_all_engines,
        )
        multi_engine_outputs = await run_scenario_with_all_engines(
            scenario_id=run_id,
            business_id=business_id,
            tenant_id=tenant_id,
            business_state=state,
            scenario_type=scenario_type,
            parameters=params,
            timeline_months=timeline_months,
        )
    except Exception:
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
Baseline snapshot: {baseline}
Scenario snapshot: {scenario}
Final month output: {last_month}
Recommendations: {recs}

Write a concise business interpretation for the founder.
Include:
1. The likely impact in plain English.
2. The most important risk or upside.
3. One practical next step.
Keep it grounded in the provided numbers and do not invent data.
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
    
    # Baseline setup
    pending_payables_schedule = _normalise_schedule(state.pending_payables_schedule, months)
    
    # 🚨 ABSOLUTE BALANCE SHEET ALIGNMENT
    # Baseline Continuity (BCP) tracks the total business state.
    # We remove historical debt noise to keep the simulation flow clean (as per scenario logic).
    historical_debt_schedule = [0.0] * months
    baseline_delayed_amount = float(state.accrued_revenue_total or 0.0)
    accruals_balance = baseline_delayed_amount
    
    # ── Pure Event-Based Settlement Engine ──
    # Cash Basis Settlement for Business Continuity
    settlement_ledger = {m: 0.0 for m in range(months + payment_term_months + 1)}
    
    forecast: List[Dict[str, Any]] = []
    cumulative_profit = 0.0
    prev_cash: float | None = None

    for i in range(months):
        month_idx = i + 1
        
        # 🟢 1. Monthly revenue and costs (ACCUAL BASIS)
        monthly_revenue, monthly_expenses, monthly_cost_of_sales = _monthly_projection_values(
            state, "do_nothing_projection", {}, month_idx
        )
        total_costs = monthly_expenses + monthly_cost_of_sales
        net_profit = monthly_revenue - total_costs
        cumulative_profit += net_profit

        # 🔵 2. Split-Delay Settlement Scheduling (Standard Timing)
        # We apply a 'Pure Liquid' model: Only immediate cash hits the balance.
        # The delayed portion (Sink) stays in Accruals for the duration of the simulation.
        delayed_part = min(monthly_revenue, baseline_delayed_amount)
        immediate_part = max(0.0, monthly_revenue - delayed_part)
        
        # Immediate Settlement (Lands NOW - This is the only cash inflow)
        if month_idx in settlement_ledger:
            settlement_ledger[month_idx] += immediate_part
            
        # Delayed Settlement (Lands after simulation window to ensure stress visibility)
        target_month = month_idx + max(6, payment_term_months)
        if target_month in settlement_ledger:
            settlement_ledger[target_month] += delayed_part
            
        # 📈 3. Cash Settlement Logic (PURE CASH BASIS)
        # 🚨 USER RULE: Only simulation settlements hit cash. NO historical debt noise.
        settled_this_month = settlement_ledger.get(month_idx, 0.0)
        
        # Unified Inflow (SIMULATION SETTLEMENTS ONLY)
        collected_total = settled_this_month
        paid_total = total_costs + pending_payables_schedule[i]
        
        # 🟢 Cash Balance Update (Surgical Alignment)
        # USER RULE: CashBalance(t) = NetFlow(t) + OpeningBalance(t)
        # This reflects: Cash = Prev + (Immediate_Recv - Total_Costs)
        monthly_cash_flow = collected_total - paid_total
        cash = (prev_cash if prev_cash is not None else float(state.starting_cash)) + monthly_cash_flow
        
        # 📈 4. Accrual Tracking (Snapshot Logic)
        # USER RULE: Accruals show the monthly 'Pending' float as a KPI.
        # This prevents the doubling with starting debt and matches scenario behavior.
        accruals_balance = (monthly_revenue - settled_this_month)
        
        # Update prev_cash for next period
        prev_cash = cash

        # ── Accounting Totals ──
        gross_profit = monthly_revenue - monthly_cost_of_sales
        gross_margin_pct = round((gross_profit / monthly_revenue * 100) if monthly_revenue > 0 else 0.0, 2)
        net_profit = monthly_revenue - total_costs

        # ── Cash runway ──
        monthly_burn = paid_total - collected_total
        cash_runway_months: float | None = None
        if monthly_burn > 0 and cash > 0:
            cash_runway_months = round(cash / monthly_burn, 2)
        elif cash <= 0:
            cash_runway_months = 0.0

        # ── Health Status ──
        health_status = _classify_health_status(
            net_profit=net_profit,
            cash_balance=cash,
            total_costs=total_costs,
            prev_cash=prev_cash,
        )
        prev_cash = cash

        # ── Risk Enhancement Ratios (Chartered Accountant Standard) ──
        cash_conv = (cash / cumulative_profit) if cumulative_profit > 0 else 1.0
        receivable_exp = (accruals_balance / cash) if cash > 0 else (1.0 if accruals_balance > 0 else 0.0)
        delayed_rev_pct = (accruals_balance / cumulative_profit) if cumulative_profit > 0 else 0.0

        score = _stability_score(
            BusinessStateSnapshot(
                revenue_monthly=monthly_revenue,
                expenses_monthly=monthly_expenses,
                cost_of_sales_monthly=monthly_cost_of_sales,
                costs_monthly=total_costs,
                accrued_revenue_total=accruals_balance,
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
                month_index=i + 1,
                revenue=round(monthly_revenue, 2),
                accruals=round(accruals_balance, 2),
                expenses=round(monthly_expenses, 2),
                cost_of_sales=round(monthly_cost_of_sales, 2),
                gross_profit=round(gross_profit, 2),
                gross_margin_pct=gross_margin_pct,
                costs=round(total_costs, 2),
                profit=round(net_profit, 2),
                cumulative_profit=round(cumulative_profit, 2),
                cash_balance=round(cash, 2),
                cash_runway_months=cash_runway_months,
                stability_score=round(score, 2),
                state_label=health_status,
                # Ratio exports
                cash_conversion_ratio=round(cash_conv, 2),
                receivable_exposure_ratio=round(receivable_exp, 2),
                delayed_revenue_pct=round(delayed_rev_pct, 2),
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
