"""Cash and profit projection for scenario simulation.

Simulation audit. Phase 0 (16 Nov 2026) replaced the earlier timeline logic, which never collected money owed to the
business (finding F1). Phase 1 (17 Nov 2026) makes it an integrated model: a baseline from complete months with trend and
seasonality (F8), the rest of the current month, customers' response to price (F6), hiring on-costs and launch costs
(F10), tax, VAT, loans and cost inflation, a balance check every month, horizons up to 24 months and a 13-week cash view.
See docs/simulation-audit/ (01 baseline, 02 Phase 0, 03 Phase 1) and MODEL.md for the full specification.

Pure calculation: no database, network or model calls, so every figure can be reproduced and tested by hand.

Conventions, stated rather than hidden (they are returned with every projection as `assumptions`):

* Month 1 is the first full month after today. The projection opens on today's cash. When a date is given (`as_of`), the
  rest of the current month is included as period 0 at the normal rate, and scenario changes start from month 1.
* Profit is on an accruals basis: revenue and costs belong to the month they are earned or incurred.
* Cash moves only when money is received or paid. For every period:

      cash(m)        = cash(m-1)        + cash_in(m) - cash_out(m)
      receivables(m) = receivables(m-1) + revenue(m) - collected(m)
      change in assets - change in liabilities = profit(m)        (cash + receivables; bills, tax, VAT, loans)

  All three are checked on every run (``checks`` in the summary).
* Money already owed to the business (``pending_receivables_schedule``, index 0 = this month) is collected in the month it
  falls due; anything due this month or overdue is collected in the first period.
* New sales are collected after the customer payment terms (30 days when not known; fractional months are split).
* Costs are paid in the month they are incurred; bills already owed are paid when they fall due.
"""
from __future__ import annotations

import calendar
import math
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from app.modules.scenario_intelligence import factors
from app.modules.scenario_intelligence.baseline import add_months, build_baseline, value_in_month
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot

MODEL_VERSION = "projection-1.8"
DAYS_PER_MONTH = 30.0
DEFAULT_PAYMENT_TERMS_DAYS = 30
MIN_MONTHS, MAX_MONTHS = 3, 24
MATERIALITY_SHARE = 0.01      # 1% of the baseline's revenue over the horizon (see compare_projections)

# Defaults used when the owner has not said otherwise. Each is disclosed with the run, and Phase 2 shows the result
# across a range around it (see uncertainty.py).
DEFAULT_PRICE_ELASTICITY = -1.0     # sales volume falls 1% for each 1% price rise (moderate; published studies -0.5..-2.6)
DEFAULT_ONCOST_PCT = 15.0           # employer social security, pension and benefits on top of pay (typical 10-25%)
DEFAULT_HIRE_RAMP_MONTHS = 3        # months for a new hire to reach full output, when revenue from the hire is given
DEFAULT_SALES_TAX_PERIOD = 3        # VAT/GST returns every quarter
WEEKS_IN_VIEW = 13

UNAVAILABLE, UNBOUNDED, OK = "unavailable", "unbounded", "ok"


# ---------------------------------------------------------------------------------------------------------------------
# Small helpers (moved here from service.py so the projection has no circular import; service.py re-exports them)
# ---------------------------------------------------------------------------------------------------------------------

def _clamp(val: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, val))


def clamp_months(months: Any) -> int:
    try:
        return max(MIN_MONTHS, min(MAX_MONTHS, int(months)))
    except (TypeError, ValueError):
        return 6


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value) if value is not None and value != "" else default
    except (TypeError, ValueError):
        return default


def typed_ratios(cash: float, cumulative_profit: float, accruals: float) -> tuple:
    """The three risk ratios with what they mean when they can't be a number: "unavailable" when there is no profit to
    compare with (never 1.00 from zeros), "unbounded" when money is owed and there is no cash to set it against."""
    if cumulative_profit > 0:
        conv, conv_state = round(cash / cumulative_profit, 2), OK
        delayed, delayed_state = round(accruals / cumulative_profit, 2), OK
    else:
        conv, conv_state = None, UNAVAILABLE
        delayed, delayed_state = (None, UNBOUNDED) if accruals > 0 else (None, UNAVAILABLE)
    if cash > 0:
        exposure, exposure_state = round(accruals / cash, 2), OK
    else:
        exposure, exposure_state = (None, UNBOUNDED) if accruals > 0 else (0.0, OK)
    return conv, conv_state, exposure, exposure_state, delayed, delayed_state


def _stability_score(state: BusinessStateSnapshot) -> float:
    """Rule-based 0-100 indicator kept for display. Its point values are not calibrated against outcomes (audit F7); it no
    longer decides whether a scenario is better or worse (see compare_projections)."""
    revenue = float(state.revenue_monthly)
    costs = float(state.costs_monthly)
    net = revenue - costs
    cash = float(state.starting_cash)

    score = 70.0
    if net < 0:
        score -= 15.0
    elif net > (revenue * 0.2):
        score += 10.0

    coverage = cash / max(abs(costs), 1.0)
    if coverage < 1:
        score -= 15.0
    elif coverage > 3:
        score += 5.0

    if state.top_client_share_pct is not None and state.top_client_share_pct > 40:
        score -= 8.0
    if state.capacity_utilisation_pct is not None and state.capacity_utilisation_pct > 85:
        score -= 6.0

    accruals = float(state.accrued_revenue_total or 0.0)
    if cash > 0 and accruals > 0:
        exposure = accruals / cash
        if exposure >= 1.0:
            score -= 20.0
        elif exposure >= 0.5:
            score -= 10.0

    return _clamp(score, 0.0, 100.0)


def _classify_health_status(
    net_profit: float,
    cash_balance: float,
    total_costs: float,
    prev_cash: float | None = None,
) -> str:
    """Judged on the months of costs the cash covers and whether the month makes money, never on fixed amounts."""
    if cash_balance < 0:
        return "critical"      # overdrawn
    costs = abs(float(total_costs or 0))
    covered = cash_balance / costs if costs > 0 else float("inf")
    if covered < 1:
        return "at risk"
    if covered < 3:
        return "stress"
    if covered < 6 or net_profit < 0:
        return "tight"
    return "stable"


def _month_span_from_days(days: int | None, fallback: int = 1, cap: int = 3) -> int:
    if days is None:
        return fallback
    return max(0, min(cap, int(round(max(0, days) / 30.0)) or fallback))


def price_elasticity(params: Dict[str, Any]) -> Tuple[float, bool]:
    """(elasticity, given by the owner?). `price_elasticity` (negative), or `price_sensitivity` (the page's positive
    form: "sales fall X% for each 1% price rise"), else the default. A value equal to the default counts as not given."""
    if params.get("price_elasticity") not in (None, ""):
        e = _num(params.get("price_elasticity"), DEFAULT_PRICE_ELASTICITY)
    elif params.get("price_sensitivity") not in (None, ""):
        e = -abs(_num(params.get("price_sensitivity"), -DEFAULT_PRICE_ELASTICITY))
    else:
        return DEFAULT_PRICE_ELASTICITY, False
    return e, e != DEFAULT_PRICE_ELASTICITY


def _hire_cost(params: Dict[str, Any], state: Any = None) -> Tuple[int, float, float]:
    """(people, pay per person a month, on-cost rate) for the hiring scenarios. The owner's on-cost rate when given; else,
    when the business's country is known, that country's employer payroll costs on this pay (Phase 5, factors.py); else
    the standard figure."""
    count = max(1, int(_num(params.get("employee_count"), 1)))
    pay = _num(params.get("employee_monthly_cost"))
    if params.get("employer_oncost_pct") not in (None, ""):
        oncost = _num(params.get("employer_oncost_pct"), DEFAULT_ONCOST_PCT) / 100.0
    elif state is not None and factors.country_code(getattr(state, "tax_country", None)) and pay > 0:
        oncost = factors.employer_cost_per_person(state.tax_country, pay, getattr(state, "employer_pension_pct", None))["rate"]
    else:
        oncost = DEFAULT_ONCOST_PCT / 100.0
    return count, pay, oncost


COMBINABLE = ("price_change", "cost_increase", "reduce_fixed_cost", "hire_staff", "delay_hiring", "contractor_addition",
              "service_launch", "client_loss", "revenue_drop", "payment_delay", "take_loan", "raise_investment", "buy_equipment")


def combined_steps(scenario_type: str, params: Dict[str, Any] | None) -> List[Tuple[str, Dict[str, Any]]]:
    """Phase 6 (model 1.6): a scenario as a list of (type, params) steps. A "combined" scenario carries
    params["steps"] = [{"scenario_type": ..., "params": {...}}, ...] (up to 5, each a combinable type, no nesting); any
    other scenario is one step."""
    params = params or {}
    if scenario_type != "combined":
        return [(scenario_type, params)]
    out = []
    for st in (params.get("steps") or [])[:5]:
        if isinstance(st, dict) and st.get("scenario_type") in COMBINABLE:
            out.append((st["scenario_type"], dict(st.get("params") or {})))
    return out


def _monthly_projection_values(
    state: BusinessStateSnapshot,
    scenario_type: str,
    params: Dict[str, Any],
    month_index: int,
    base: Optional[Tuple[float, float, float]] = None,
) -> Tuple[float, float, float]:
    """Revenue, operating expenses (one-off costs included) and cost of sales earned/incurred in a month under the
    scenario. `base` is the baseline (revenue, expenses, cost of sales) for that month; without it the state's monthly
    figures are used, flat."""
    if base is None:
        base_revenue = float(state.revenue_monthly or 0.0)
        base_expenses = float(state.expenses_monthly or max(float(state.costs_monthly) - float(state.cost_of_sales_monthly or 0), 0.0))
        base_cost_of_sales = float(state.cost_of_sales_monthly or 0.0)
    else:
        base_revenue, base_expenses, base_cost_of_sales = base
    if scenario_type == "combined":
        # each change applied in turn to the figures the previous one left (a price rise, then a hire, ...)
        vals = (base_revenue, base_expenses, base_cost_of_sales)
        for kind, step_params in combined_steps(scenario_type, params):
            vals = _monthly_projection_values(state, kind, step_params, month_index, base=vals)
        return vals
    cos_ratio = base_cost_of_sales / base_revenue if base_revenue > 0 else 0.0

    revenue = base_revenue
    expenses = base_expenses
    cost_of_sales = base_cost_of_sales


    if scenario_type == "client_loss":
        loss_pct = float(params.get("client_loss_pct", state.top_client_share_pct) or 0.0)
        progress = 1.0
        multiplier = max(0.0, 1.0 - ((loss_pct / 100.0) * progress))
        revenue *= multiplier
        cost_of_sales *= multiplier
    elif scenario_type == "revenue_drop":
        drop_pct = float(params.get("revenue_drop_pct") or 0.0)
        progress = 1.0
        multiplier = max(0.0, 1.0 - ((drop_pct / 100.0) * progress))
        revenue *= multiplier
        cost_of_sales *= multiplier
    elif scenario_type == "price_change":
        # Audit F6: customers respond to price. Constant-elasticity demand: volume x (1 + price change) ^ elasticity.
        # Revenue on the affected sales = price factor x volume factor; their cost of sales follows the volume.
        change_pct = float(params.get("price_change_pct") or 0.0)
        elasticity, _given = price_elasticity(params)
        effective_month = max(1, int(params.get("effective_month") or 1))
        selected_revenue = float(params.get("selected_product_revenue_monthly") or 0.0)
        if month_index >= effective_month and base_revenue > 0:
            progress = 1.0
            price_factor = max(0.01, 1.0 + (change_pct / 100.0) * progress)
            volume_factor = price_factor ** elasticity
            share = min(1.0, selected_revenue / base_revenue) if selected_revenue > 0 else 1.0
            revenue = base_revenue * (1 - share) + base_revenue * share * price_factor * volume_factor
            cost_of_sales = base_cost_of_sales * (1 - share) + base_cost_of_sales * share * volume_factor
    elif scenario_type == "cost_increase":
        inc_pct = float(params.get("cost_increase_pct") or 0.0)
        progress = 1.0
        multiplier = 1.0 + ((inc_pct / 100.0) * progress)
        expenses *= multiplier
        cost_of_sales *= multiplier
    elif scenario_type == "hire_staff":
        # Audit F10: pay plus employer on-costs, a one-off recruitment cost, a start month, and (if given) the revenue the
        # hire brings in, reaching full output over a ramp-up period, with its cost of sales at the current ratio.
        count, pay, oncost = _hire_cost(params, state)
        start = max(1, int(_num(params.get("start_month"), 1)))
        if month_index >= start:
            expenses += count * pay * (1 + oncost)
            per_hire = _num(params.get("revenue_per_hire_monthly"))
            if per_hire > 0:
                ramp = max(1, int(_num(params.get("ramp_months"), DEFAULT_HIRE_RAMP_MONTHS)))
                added = count * per_hire * min(1.0, (month_index - start + 1) / float(ramp))
                revenue += added
                cost_of_sales += added * cos_ratio
        if month_index == start:
            expenses += count * _num(params.get("recruitment_cost_per_hire"))
    elif scenario_type == "contractor_addition":
        add_cost = float(params.get("contractor_monthly_cost") or 0.0)
        contractor_count = max(1, int(params.get("employee_count") or 1))
        if params.get("cost_classification") == "direct":
            cost_of_sales += add_cost * contractor_count
        else:
            expenses += add_cost * contractor_count
    elif scenario_type == "reduce_fixed_cost":
        red_pct = float(params.get("cost_reduction_pct") or 0.0)
        progress = 1.0
        multiplier = max(0.0, 1.0 - ((red_pct / 100.0) * progress))
        expenses *= multiplier
    elif scenario_type == "buy_equipment":
        # Phase 5: the purchase itself (cash, depreciation) is handled in project(); here, what the equipment brings in:
        # extra sales a month (cost of sales at the current ratio) and/or running costs saved, from the purchase month.
        start = max(1, int(_num(params.get("purchase_month"), 1)))
        if month_index >= start:
            extra = _num(params.get("extra_revenue_monthly"))
            revenue += extra
            cost_of_sales += extra * cos_ratio
            expenses = max(0.0, expenses - _num(params.get("cost_saving_monthly")))
    elif scenario_type == "delay_hiring":
        count, pay, oncost = _hire_cost(params, state)
        if month_index >= 1:
            expenses = max(0.0, expenses - count * pay * (1 + oncost))
    elif scenario_type == "service_launch":
        # Audit F10: the new service's sales bring their own cost of sales (at the current ratio), extra overheads are a
        # percentage of operating expenses, and the launch itself can cost money up front (month 1).
        uplift = float(params.get("revenue_uplift_pct") or 0.0)
        cost_up = float(params.get("cost_uplift_pct") or 0.0)
        progress = min(1.0, month_index / 3.0)
        added = base_revenue * (uplift / 100.0) * progress
        revenue += added
        cost_of_sales += added * cos_ratio
        expenses *= 1.0 + ((cost_up / 100.0) * progress)
        if month_index == 1:
            expenses += _num(params.get("launch_cost"))

    return revenue, expenses, cost_of_sales


# ---------------------------------------------------------------------------------------------------------------------
# Timing of money in and out
# ---------------------------------------------------------------------------------------------------------------------

def collection_profile(payment_terms_days: float | None) -> Dict[int, float]:
    """Share of a month's sales collected after each whole number of months: {months_later: share}. Shares sum to 1.

    0 days -> {0: 1.0}; 30 -> {1: 1.0}; 45 -> {1: 0.5, 2: 0.5}; 14 -> {0: 0.533, 1: 0.467}.
    """
    days = DEFAULT_PAYMENT_TERMS_DAYS if payment_terms_days is None else max(0.0, float(payment_terms_days))
    lag = days / DAYS_PER_MONTH
    whole = int(math.floor(lag))
    frac = lag - whole
    profile = {whole: 1.0 - frac}
    if frac > 1e-9:
        profile[whole + 1] = frac
    return {k: v for k, v in profile.items() if v > 1e-12}


def _schedule(values: Any) -> List[float]:
    """A month-indexed amount list (index 0 = this month), cleaned to non-negative numbers."""
    out: List[float] = []
    for v in values if isinstance(values, list) else []:
        try:
            out.append(max(0.0, float(v or 0.0)))
        except (TypeError, ValueError):
            out.append(0.0)
    return out


def _to_projection_months(schedule: List[float], months: int) -> List[float]:
    """Map a this-month-first schedule onto projection months 1..months (list index 0 = month 1). This month's and overdue
    amounts land in month 1; amounts due after the horizon are not in it (they stay owed)."""
    out = [0.0] * months
    for idx, amount in enumerate(schedule):
        month = max(1, idx)
        if month <= months:
            out[month - 1] += amount
    return out


def _to_periods(schedule: List[float], months: int, first: int) -> List[float]:
    """Map a this-month-first schedule onto periods 0..months (0 = rest of this month). Index 0 (due this month or overdue)
    lands in `first`: period 0 when the rest of the month is modelled, else month 1."""
    out = [0.0] * (months + 1)
    for idx, amount in enumerate(schedule):
        p = max(first, idx)
        if p <= months:
            out[p] += amount
    return out


def _delay_earliest(amounts: List[float], amount: float, delay: int) -> List[float]:
    """Move `amount` of money owed, earliest-due first, `delay` months later. One-off: each pound moves once (audit F2)."""
    if delay <= 0 or amount <= 0:
        return list(amounts)
    out = list(amounts) + [0.0] * delay
    remaining = amount
    for i in range(len(amounts)):
        if remaining <= 0:
            break
        moved = min(amounts[i], remaining)
        if moved <= 0:
            continue
        out[i] -= moved
        out[i + delay] += moved
        remaining -= moved
    return out


def _stub(as_of: Optional[date]) -> Tuple[int, int]:
    """(days left in the month after `as_of`, days in that month). (0, 30) without a date."""
    if as_of is None:
        return 0, 30
    dim = calendar.monthrange(as_of.year, as_of.month)[1]
    return dim - as_of.day, dim


def annuity_payment(amount: float, annual_rate_pct: float, term_months: int) -> float:
    """The fixed monthly repayment that clears a loan over its term (standard annuity formula)."""
    n = max(1, int(term_months))
    i = max(0.0, annual_rate_pct) / 100.0 / 12.0
    if i == 0:
        return amount / n
    return amount * i / (1 - (1 + i) ** -n)


# ---------------------------------------------------------------------------------------------------------------------
# What the run assumed, in words
# ---------------------------------------------------------------------------------------------------------------------

def _money(v: float) -> str:
    return f"{v:,.2f}"


def assumptions_for(state: BusinessStateSnapshot, scenario_type: str, params: Dict[str, Any],
                    baseline: Optional[Dict[str, Any]] = None, stub_days: int = 0) -> List[str]:
    params = params or {}
    if scenario_type == "combined":      # Phase 6: the business's assumptions once, then each change's own
        out = assumptions_for(state, "do_nothing_projection", {}, baseline, stub_days)
        steps = combined_steps(scenario_type, params)
        out.append("Combined scenario: these changes are applied together, each to the figures the previous one leaves: "
                   + ", ".join(k.replace("_", " ") for k, _sp in steps) + ".")
        for kind, sp in steps:
            out += [f"({kind.replace('_', ' ')}) {line}" for line in assumptions_for(state, kind, sp, baseline, stub_days) if line not in out]
        return out
    terms = state.payment_terms_days
    out = [
        "Month 1 is the first full month after today; the projection opens on today's cash.",
        (f"The rest of this month ({stub_days} days) is included at the normal monthly rate, so month 1's cash and "
         "running profit include it. Scenario changes apply only to the full months ahead." if stub_days else
         "The rest of the current month is not modelled (no date was given)."),
        (f"Customers pay after {int(terms)} days ({state.figure_sources.get('payment_terms_days') or 'your recorded terms'})." if terms is not None
         else f"Customers pay after {DEFAULT_PAYMENT_TERMS_DAYS} days (assumed: no payment terms on record)."),
        "Money already owed to you is collected when it falls due; anything overdue is assumed collected straight away. "
        "No allowance is made for customers who never pay.",
        "Costs are paid in the month they are incurred; bills already owed are paid when they fall due.",
    ]
    if baseline:
        for name, label in (("revenue", "Revenue"), ("cost_of_sales", "Cost of sales"), ("expenses", "Operating expenses")):
            b = baseline.get(name) or {}
            line = f"{label}: {_money(float(b.get('level') or 0))} a month, from the {b.get('source', 'figures sent')}"
            if b.get("trend_applied"):
                line += f"; trend {b['trend_pct_per_month']:+.1f}% a month, damped"
            elif b.get("trend_note") and "not assessed" not in str(b.get("trend_note")):
                line += f"; trend {b['trend_note']}"
            if b.get("seasonality_applied"):
                line += "; seasonal pattern applied"
            out.append(line + ".")
    if state.excluded_fx_items:
        out.append(f"{state.excluded_fx_items} item(s) in another currency were left out: no exchange rate was available.")

    # Business settings
    tax = state.profit_tax_rate_pct
    out.append(f"Tax on profit at {tax:g}% is set aside each month"
               + (f" and paid in month {state.tax_payment_month}." if state.tax_payment_month else "; it is still owed at the end of the period.")
               if tax else "Tax on profit is not included (no rate set).")
    vat = state.sales_tax_rate_pct
    if vat:
        k = state.sales_tax_on_costs_pct
        out.append(f"VAT/sales tax at {vat:g}% is added to sales and paid over every {state.sales_tax_period_months or DEFAULT_SALES_TAX_PERIOD} "
                   "months, a month after each period ends (cash basis; your figures are taken as excluding VAT). "
                   + (f"{k:g}% of costs carry VAT you can reclaim." if k else "No VAT is reclaimed on costs (share not set)."))
    else:
        out.append("VAT/sales tax is not included (not set as registered).")
    if state.existing_loan_balance:
        rep = state.existing_loan_monthly_repayment
        out.append(f"Existing loan of {_money(state.existing_loan_balance)} at {state.existing_loan_annual_rate_pct or 0:g}% a year: "
                   + (f"{_money(rep)} repaid a month, interest first." if rep else "interest only (no repayment set)."))
    else:
        out.append("No existing loans are included (none set).")
    infl = state.cost_inflation_pct
    out.append(f"Costs rise {infl:g}% a year with inflation, where their own trend doesn't already show it."
               if infl else "No cost inflation is applied (not set).")

    if scenario_type in ("client_loss", "revenue_drop", "cost_increase", "reduce_fixed_cost", "price_change"):
        key = {"client_loss": "client_loss_pct", "revenue_drop": "revenue_drop_pct", "cost_increase": "cost_increase_pct",
               "reduce_fixed_cost": "cost_reduction_pct", "price_change": "price_change_pct"}[scenario_type]
        value = params.get(key, state.top_client_share_pct if scenario_type == "client_loss" else 0)
        out.append(f"{key.replace('_', ' ')}: {value or 0}%; applied in full from month {params.get('effective_month', 1) if scenario_type == 'price_change' else 1}, with no phase-in.")
    if scenario_type == "contractor_addition":
        out.append("Contractor fees are recorded as " + ("direct delivery costs (cost of sales)." if params.get("cost_classification") == "direct" else "operating expenses."))
    if scenario_type == "delay_hiring":
        out.append("The planned hire is cancelled for the whole forecast; the entered payroll cost is removed from month 1.")
    # The scenario's own assumptions
    if scenario_type == "price_change":
        e, given = price_elasticity(params)
        out.append(f"Customers respond to price with elasticity {e:g}: each 1% price change moves sales volume by "
                   f"{abs(e):g}% the other way" + ("." if given else " (assumed: the standard moderate response; enter your own "
                                                    "figure if you know how your customers react)."))
        out.append("Cost of sales follows the volume sold; capacity limits are not modelled.")
    if scenario_type in ("hire_staff", "delay_hiring"):
        count, pay, oncost = _hire_cost(params, state)
        given = params.get("employer_oncost_pct") not in (None, "")
        by_country = (not given and factors.country_code(getattr(state, "tax_country", None)) and pay > 0)
        out.append(f"Each person costs {_money(pay)} a month plus {oncost * 100:.4g}% employer on-costs"
                   + ("." if given else
                      f" ({factors.employer_cost_per_person(state.tax_country, pay, state.employer_pension_pct)['basis']})."
                      if by_country else " (assumed: typical employer tax, pension and benefits)."))
        if scenario_type == "hire_staff":
            out.append(f"Recruitment costs {_money(_num(params.get('recruitment_cost_per_hire')))} per hire, in the start month "
                       f"(month {max(1, int(_num(params.get('start_month'), 1)))}).")
            per_hire = _num(params.get("revenue_per_hire_monthly"))
            out.append(f"Each hire brings in {_money(per_hire)} a month at full output, reached over "
                       f"{max(1, int(_num(params.get('ramp_months'), DEFAULT_HIRE_RAMP_MONTHS)))} months." if per_hire > 0
                       else "No extra revenue from the hire is included (none entered).")
    if scenario_type == "raise_investment":
        kind = str(params.get("funding_type") or "equity")
        out.append(f"{_money(_num(params.get('funding_amount')))} received in month {max(1, int(_num(params.get('funding_month'), 1)))} as "
                   + {"grant": "a grant: income in the month received (IAS 20), cash in.",
                      "owner_capital": "owner capital: cash in, not income or a loan."}.get(kind,
                      "equity investment: cash in, not income or a loan. The share of the business given up is not costed."))
    if scenario_type == "buy_equipment":
        out.append(f"Equipment costing {_money(_num(params.get('equipment_cost')))} is paid for in month "
                   f"{max(1, int(_num(params.get('purchase_month'), 1)))} and depreciated evenly over "
                   f"{max(1, int(_num(params.get('useful_life_months'), 36)))} months (IAS 16); VAT on it is not modelled.")
        out.append(f"It brings in {_money(_num(params.get('extra_revenue_monthly')))} extra sales and saves "
                   f"{_money(_num(params.get('cost_saving_monthly')))} running costs a month (as entered).")
    if scenario_type == "service_launch":
        out.append("The new service's sales carry cost of sales at your current ratio; extra overheads are the cost uplift "
                   f"on operating expenses; launch cost {_money(_num(params.get('launch_cost')))} in month 1. "
                   "Sales uplift and extra overheads phase in over three months: one third in month 1, two thirds in month 2, full from month 3.")
    if scenario_type == "take_loan":
        amount = _num(params.get("loan_amount"))
        out.append(f"A loan of {_money(amount)} at {_num(params.get('loan_annual_rate_pct')):g}% a year, received in month "
                   f"{max(1, int(_num(params.get('loan_start_month'), 1)))} and repaid in equal monthly instalments over "
                   f"{max(1, int(_num(params.get('loan_term_months'), 12)))} months from the month after. Interest is a cost; "
                   "repaying the loan itself reduces cash but not profit.")
    if scenario_type == "payment_delay":
        delay = max(0, int(params.get("delay_months") or 0))
        selected = float(params.get("selected_pending_receivable_amount") or 0.0)
        if selected > 0:
            out.append(f"The selected invoices ({_money(selected)}) are paid {delay} month(s) later than due, once.")
        else:
            out.append(f"Every customer payment arrives {delay} month(s) later than it would otherwise.")
    out.append("Not modelled: exchange-rate movements, capacity limits, and changes in customers' behaviour other than "
               "the ones the scenario sets.")
    return out


# ---------------------------------------------------------------------------------------------------------------------
# The projection
# ---------------------------------------------------------------------------------------------------------------------

def _base_values(baseline: Dict[str, Any], state: BusinessStateSnapshot, as_of: Optional[date], p: int) -> Tuple[float, float, float]:
    """Baseline (revenue, operating expenses, cost of sales) in period p, with cost inflation where costs have no trend."""
    revenue = value_in_month(baseline["revenue"], as_of, p)
    expenses = value_in_month(baseline["expenses"], as_of, p)
    cost_of_sales = value_in_month(baseline["cost_of_sales"], as_of, p)
    infl = _num(state.cost_inflation_pct)
    if infl and p > 0:
        factor = (1 + infl / 100.0) ** (p / 12.0)
        if not baseline["cost_of_sales"].get("trend_applied"):
            cost_of_sales *= factor
        if not baseline["expenses"].get("trend_applied"):
            expenses *= factor
    return revenue, expenses, cost_of_sales


def project(
    state: BusinessStateSnapshot,
    scenario_type: str,
    params: Dict[str, Any] | None,
    months: int,
    *,
    clamp: bool = True,
    as_of: Optional[date] = None,
    adjust: Optional[Dict[str, float]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Month-by-month projection. Returns (rows, summary). `scenario_type` "do_nothing_projection" (or any type without a
    rule) is the baseline: the business as it is. `as_of` (today) turns on the baseline from monthly history, the rest
    of the current month and the 13-week view; without it the state's monthly figures are used flat from month 1.
    `adjust` scales the baseline drivers for the low/high cases and sensitivity (uncertainty.py):
    {"revenue": x, "cost_of_sales": x, "expenses": x}."""
    params = params or {}
    adjust = adjust or {}
    months = clamp_months(months) if clamp else max(1, min(MAX_MONTHS, int(months)))
    baseline = build_baseline(state, as_of)
    stub_days, days_in_month = _stub(as_of)
    if (state.current_month_recorded or {}).get("basis") == "actual":
        stub_days = 0  # Recorded current-month activity is an anchor, never a projected period.
    stub_weight = stub_days / days_in_month if stub_days else 0.0
    first = 0 if stub_days else 1
    P = months + 1                                   # periods 0 (rest of this month) .. months

    opening_cash = float(state.starting_cash or 0.0)
    receivable_sched = _schedule(state.pending_receivables_schedule)
    payable_sched = _schedule(state.pending_payables_schedule)
    profile = collection_profile(state.payment_terms_days)

    # Money already owed to the business, by period
    if sum(receivable_sched) > 0:
        opening_receivables = sum(receivable_sched)
        owed_in = _to_periods(receivable_sched, months, first)
    else:
        # A balance with no due dates (older records): collected on the normal terms
        opening_receivables = max(float(state.opening_accrual_balance or 0.0), float(state.accrued_revenue_total or 0.0))
        owed_in = [0.0] * P
        for lag, share in profile.items():
            if first + lag <= months:
                owed_in[first + lag] += opening_receivables * share
    owed_out = _to_periods(payable_sched, months, first)
    opening_payables = sum(payable_sched)

    # Scenario: payments arriving later (Phase 6: also as a step of a combined scenario)
    steps = combined_steps(scenario_type, params)
    step_of = lambda kind: next((sp for k, sp in steps if k == kind), None)      # noqa: E731
    delay_params = step_of("payment_delay")
    is_delay = delay_params is not None
    delay = max(0, int(delay_params.get("delay_months") or 0)) if is_delay else 0
    selected = float(delay_params.get("selected_pending_receivable_amount") or 0.0) if is_delay else 0.0
    delay_all = delay > 0 and selected <= 0
    if delay > 0 and selected > 0:
        owed_in = owed_in[:first] + _delay_earliest(owed_in[first:], selected, delay)[:P - first]
    elif delay_all:
        owed_in = owed_in[:first] + ([0.0] * delay + owed_in[first:])[:P - first]

    # Business settings
    tax_rate = _num(state.profit_tax_rate_pct) / 100.0
    tax_month = state.tax_payment_month
    vat_rate = _num(state.sales_tax_rate_pct) / 100.0
    vat_cost_share = _num(state.sales_tax_on_costs_pct) / 100.0
    vat_period = int(state.sales_tax_period_months or DEFAULT_SALES_TAX_PERIOD)
    loan_e = _num(state.existing_loan_balance)
    loan_e_rate = _num(state.existing_loan_annual_rate_pct) / 100.0 / 12.0
    loan_e_rep = _num(state.existing_loan_monthly_repayment)
    loan_params = step_of("take_loan")
    is_loan = loan_params is not None
    loan_n_amount = _num(loan_params.get("loan_amount")) if is_loan else 0.0
    loan_n_rate_pct = _num(loan_params.get("loan_annual_rate_pct")) if is_loan else 0.0
    loan_n_term = max(1, int(_num(loan_params.get("loan_term_months"), 12))) if is_loan else 0
    loan_n_start = max(1, int(_num(loan_params.get("loan_start_month"), 1))) if is_loan else 0
    loan_n_payment = annuity_payment(loan_n_amount, loan_n_rate_pct, loan_n_term) if loan_n_amount > 0 else 0.0
    loan_n = 0.0
    opening_loans = loan_e

    # ── Phase 5 (model 1.4): the further factors of a standard forecast ──────────────────────────────────────────────
    def _month(v: Any, default: int = 1) -> int:
        return max(1, int(_num(v, default)))
    funding: Dict[int, Dict[str, float]] = {}

    def _fund(kind: Any, amount: Any, month: Any) -> None:
        amt = _num(amount)
        if amt <= 0:
            return
        k = str(kind or "equity").lower()
        k = k if k in ("equity", "owner_capital", "grant") else "equity"
        slot = funding.setdefault(_month(month), {"equity": 0.0, "owner_capital": 0.0, "grant": 0.0})
        slot[k] += amt
    for ev in (state.funding_events or []):
        if isinstance(ev, dict):
            _fund(ev.get("type"), ev.get("amount"), ev.get("month"))
    for kind, sp in steps:
        if kind == "raise_investment":
            _fund(sp.get("funding_type"), sp.get("funding_amount"), sp.get("funding_month"))
    drawings_m = _num(state.owner_drawings_monthly)
    dividends_by_p: Dict[int, float] = {}
    for d in (state.dividends or []):
        if isinstance(d, dict) and _num(d.get("amount")) > 0:
            dividends_by_p[_month(d.get("month"))] = dividends_by_p.get(_month(d.get("month")), 0.0) + _num(d.get("amount"))
    capex: List[Tuple[int, float, int]] = []
    for c in (state.capital_purchases or []):
        if isinstance(c, dict) and _num(c.get("amount")) > 0:
            capex.append((_month(c.get("month")), _num(c.get("amount")), max(1, int(_num(c.get("life_months"), 36)))))
    for kind, sp in steps:
        if kind == "buy_equipment" and _num(sp.get("equipment_cost")) > 0:
            capex.append((_month(sp.get("purchase_month")), _num(sp.get("equipment_cost")),
                          max(1, int(_num(sp.get("useful_life_months"), 36)))))
    bad_debt = min(1.0, max(0.0, _num(state.bad_debt_pct) / 100.0))
    payroll_m, payroll_basis = 0.0, None
    staff, gross = int(state.payroll_staff_count or 0), _num(state.payroll_gross_monthly_per_person)
    if staff > 0 and gross > 0 and state.payroll_in_recorded_expenses is not True:
        per = factors.employer_cost_per_person(state.tax_country, gross, state.employer_pension_pct)
        payroll_m, payroll_basis = staff * (gross + per["total"]) + _num(state.employee_benefits_monthly), per["basis"]
    tax_regime = state.profit_tax_regime
    losses_bf = _num(state.tax_losses_brought_forward)
    fixed_assets = 0.0
    totals_p5 = dict(depreciation=0.0, bad_debts=0.0, equity_in=0.0, grants=0.0, owner_out=0.0, capex=0.0, payroll=0.0)

    new_sales_in = [0.0] * P
    rows: List[Dict[str, Any]] = []
    detail: List[Dict[str, Any]] = []
    periods: List[Dict[str, Any]] = []            # cash components by period, for the 13-week view
    cash = opening_cash
    receivables = opening_receivables
    payables = opening_payables
    tax_payable = vat_payable = vat_period_acc = 0.0
    cumulative_profit = cumulative_pbt = provision = 0.0
    totals = dict(revenue=0.0, costs=0.0, cash_in=0.0, cash_out=0.0, interest=0.0, tax=0.0, tax_paid=0.0, vat_paid=0.0)
    cash_ok = receivables_ok = balance_ok = True
    min_cash, min_cash_month, first_negative = opening_cash, 0, None
    # Phase 4: the same, over the months ahead only (month 1 onwards). A scenario starts in month 1, so this is what its
    # verdict compares; cash already below zero today is reported on its own.
    min_cash_ahead, first_negative_ahead = None, None
    stub: Dict[str, Any] | None = None

    for p in range(P):
        weight = stub_weight if p == 0 else 1.0
        base = _base_values(baseline, state, as_of, p)
        if adjust:
            base = (base[0] * adjust.get("revenue", 1.0), base[1] * adjust.get("expenses", 1.0),
                    base[2] * adjust.get("cost_of_sales", adjust.get("revenue", 1.0)))
        if p == 0:
            revenue, expenses, cost_of_sales = (v * weight for v in base)      # no change in the scenario yet
        else:
            revenue, expenses, cost_of_sales = _monthly_projection_values(state, scenario_type, params, p, base=base)
        payroll_now = payroll_m * weight
        expenses += payroll_now

        # Phase 5: equipment (cash when bought, straight-line depreciation over its life from that month), funding, owners
        capex_out = depreciation = equity_in = grant_in = owner_out = 0.0
        if p >= 1:
            for (m_buy, amt, life) in capex:
                if p == m_buy:
                    capex_out += amt
                if m_buy <= p < m_buy + life:
                    depreciation += amt / life
            f = funding.get(p) or {}
            equity_in = f.get("equity", 0.0) + f.get("owner_capital", 0.0)
            grant_in = f.get("grant", 0.0)
            owner_out = drawings_m + dividends_by_p.get(p, 0.0)
        prev_fixed = fixed_assets
        fixed_assets += capex_out - depreciation
        bad_debts = revenue * bad_debt                      # sales that will never be collected (an expense when made)
        net_sales = revenue - bad_debts

        # Financing (from month 1)
        interest = principal = loan_in = 0.0
        if p == 0 and loan_e > 0:
            interest += loan_e * loan_e_rate * weight
        if p >= 1:
            if loan_e > 0:
                i_e = loan_e * loan_e_rate
                pr_e = min(loan_e, max(0.0, loan_e_rep - i_e)) if loan_e_rep > 0 else 0.0
                interest += i_e
                principal += pr_e
                loan_e -= pr_e
            if loan_n_amount > 0:
                if p == loan_n_start:
                    loan_in = loan_n_amount
                    loan_n += loan_n_amount
                elif loan_n_start < p <= loan_n_start + loan_n_term and loan_n > 1e-9:
                    i_n = loan_n * loan_n_rate_pct / 100.0 / 12.0
                    pr_n = loan_n if p == loan_n_start + loan_n_term else min(loan_n, loan_n_payment - i_n)
                    interest += i_n
                    principal += pr_n
                    loan_n -= pr_n

        profit_before_tax = revenue + grant_in - cost_of_sales - expenses - interest - depreciation - bad_debts
        cumulative_pbt += profit_before_tax
        tax_charge = tax_paid = 0.0
        if tax_rate > 0 or tax_regime == "uk_corporation_tax":
            # losses within the period, and losses brought forward, reduce the taxable profit (Phase 5: UK bands optional)
            elapsed = p + (stub_weight if stub_days else 0.0)
            new_provision, _rate = factors.tax_on_cumulative(tax_regime, tax_rate, cumulative_pbt - losses_bf, elapsed)
            tax_charge = new_provision - provision
            provision = new_provision
            tax_payable += tax_charge
            if tax_month and p == tax_month:
                tax_paid, tax_payable = tax_payable, 0.0
        profit = profit_before_tax - tax_charge
        cumulative_profit += profit

        for lag, share in profile.items():          # when this period's sales are paid for
            target = p + lag + (delay if delay_all and p >= first else 0)
            if target < P:                          # later than the horizon: still owed at the end
                new_sales_in[target] += net_sales * share
        collected = owed_in[p] + new_sales_in[p]

        # VAT / sales tax (cash basis): added to what customers pay, reclaimed on the share of costs that carry it,
        # paid over a month after each period of `vat_period` months
        vat_due = 0.0
        if vat_rate > 0:
            if p > 1 and (p - 1) % vat_period == 0:
                vat_due, vat_period_acc = vat_period_acc, 0.0
                vat_payable -= vat_due
            out_vat = collected * vat_rate
            in_vat = (cost_of_sales + expenses + owed_out[p]) * vat_rate * vat_cost_share
            vat_payable += out_vat - in_vat
            vat_period_acc += out_vat - in_vat
        else:
            out_vat = in_vat = 0.0

        regular_in = new_sales_in[p] + out_vat
        regular_out = cost_of_sales + expenses + in_vat
        lumps_in = loan_in + (-vat_due if vat_due < 0 else 0.0) + equity_in + grant_in
        lumps_out = interest + principal + tax_paid + (vat_due if vat_due > 0 else 0.0) + capex_out + owner_out
        cash_in = owed_in[p] + regular_in + lumps_in
        cash_out = owed_out[p] + regular_out + lumps_out
        periods.append(dict(p=p, owed_in=owed_in[p], owed_out=owed_out[p], regular_in=regular_in, regular_out=regular_out,
                            lumps_in=lumps_in, lumps_out=lumps_out))

        opening = cash
        prev = dict(rec=receivables, pay=payables, tax=tax_payable - tax_charge + tax_paid, vat=vat_payable - (out_vat - in_vat) + vat_due,
                    loans=loan_e + loan_n + principal - loan_in)
        cash = opening + cash_in - cash_out
        receivables = receivables + net_sales - collected
        payables -= owed_out[p]
        loans = loan_e + loan_n

        cash_ok &= abs(cash - (opening + cash_in - cash_out)) < 0.005
        receivables_ok &= abs(receivables - (prev["rec"] + net_sales - collected)) < 0.005
        d_assets = (cash - opening) + (receivables - prev["rec"]) + (fixed_assets - prev_fixed)
        d_liabilities = (payables - prev["pay"]) + (tax_payable - prev["tax"]) + (vat_payable - prev["vat"]) + (loans - prev["loans"])
        # assets less liabilities move by the profit plus what owners put in, less what they take out (Phase 5)
        balance_ok &= abs(d_assets - d_liabilities - profit - equity_in + owner_out) < 0.01

        total_costs = expenses + cost_of_sales + interest + tax_charge + depreciation + bad_debts
        for k, v in (("depreciation", depreciation), ("bad_debts", bad_debts), ("equity_in", equity_in), ("grants", grant_in),
                     ("owner_out", owner_out), ("capex", capex_out), ("payroll", payroll_now)):
            totals_p5[k] += v
        totals["revenue"] += revenue
        totals["costs"] += total_costs
        totals["cash_in"] += cash_in
        totals["cash_out"] += cash_out
        totals["interest"] += interest
        totals["tax"] += tax_charge
        totals["tax_paid"] += tax_paid
        totals["vat_paid"] += vat_due
        if cash < min_cash:
            min_cash, min_cash_month = cash, p
        if cash < 0 and first_negative is None:
            first_negative = p
        if p >= 1:
            min_cash_ahead = cash if min_cash_ahead is None else min(min_cash_ahead, cash)
            if cash < 0 and first_negative_ahead is None:
                first_negative_ahead = p

        if p == 0:
            if stub_days:
                stub = dict(days=stub_days, revenue=round(revenue, 2), costs=round(total_costs, 2), profit=round(profit, 2),
                            cash_in=round(cash_in, 2), cash_out=round(cash_out, 2), closing_cash=round(cash, 2))
            continue

        detail.append(dict(month_index=p, operating_expenses=round(expenses, 2), interest=round(interest, 2),
                           tax_set_aside=round(tax_charge, 2), tax_paid=round(tax_paid, 2), vat_paid=round(vat_due, 2),
                           loan_received=round(loan_in, 2), loan_repaid=round(principal, 2),
                           collected_from_customers=round(collected, 2), bills_paid=round(owed_out[p], 2),
                           payroll=round(payroll_now, 2), depreciation=round(depreciation, 2), bad_debts=round(bad_debts, 2),
                           equipment_bought=round(capex_out, 2), funding_received=round(equity_in, 2), grants=round(grant_in, 2),
                           owner_drawings_and_dividends=round(owner_out, 2)))
        net_cash_flow = cash_in - cash_out
        runway = None
        if net_cash_flow < 0:
            runway = round(cash / -net_cash_flow, 2) if cash > 0 else 0.0

        conv, conv_state, exposure, exposure_state, delayed, delayed_state = typed_ratios(cash, cumulative_profit, receivables)
        all_expenses = expenses + interest + tax_charge + depreciation + bad_debts
        score = _stability_score(BusinessStateSnapshot(
            revenue_monthly=revenue, expenses_monthly=all_expenses, cost_of_sales_monthly=cost_of_sales, costs_monthly=total_costs,
            accrued_revenue_total=max(0.0, receivables), starting_cash=cash,
            top_client_share_pct=state.top_client_share_pct, capacity_utilisation_pct=state.capacity_utilisation_pct,
        ))
        gross_profit = revenue - cost_of_sales
        rows.append(dict(
            month_index=p,
            revenue=round(revenue, 2),
            accruals=round(receivables, 2),      # receivables at month end: money earned and still owed to the business
            expenses=round(all_expenses, 2),     # operating expenses, plus interest and tax set aside when those are set
            cost_of_sales=round(cost_of_sales, 2),
            gross_profit=round(gross_profit, 2),
            gross_margin_pct=round((gross_profit / revenue * 100) if revenue > 0 else 0.0, 2),
            costs=round(total_costs, 2),
            profit=round(profit, 2),
            cumulative_profit=round(cumulative_profit, 2),
            cash_balance=round(cash, 2),
            cash_runway_months=runway,
            stability_score=round(score, 2),
            state_label=_classify_health_status(profit, cash, total_costs),
            cash_conversion_ratio=conv,
            cash_conversion_state=conv_state,
            receivable_exposure_ratio=exposure,
            receivable_exposure_state=exposure_state,
            delayed_revenue_pct=delayed,
            delayed_revenue_state=delayed_state,
            other_income=round(grant_in, 2),     # Phase 5: grants (income, not sales); profit = revenue + other income - costs
        ))

    summary = dict(
        model_version=MODEL_VERSION,
        as_of=as_of.isoformat() if as_of else None,
        months=months,
        opening_cash=round(opening_cash, 2),
        closing_cash=round(cash, 2),
        cash_after_vat_owed=round(round(cash, 2) - round(vat_payable, 2), 2),
        min_cash=round(min_cash, 2),
        min_cash_month=min_cash_month,
        first_negative_cash_month=first_negative,
        min_cash_ahead=None if min_cash_ahead is None else round(min_cash_ahead, 2),
        first_negative_month_ahead=first_negative_ahead,
        overdrawn_today=opening_cash < 0,
        opening_receivables=round(opening_receivables, 2),
        closing_receivables=round(receivables, 2),
        opening_payables=round(opening_payables, 2),
        closing_payables=round(payables, 2),
        closing_tax_owed=round(tax_payable, 2),
        closing_sales_tax_owed=round(vat_payable, 2),
        opening_loans=round(opening_loans, 2),
        closing_loans=round(loan_e + loan_n, 2),
        total_revenue=round(totals["revenue"], 2),
        total_costs=round(totals["costs"], 2),
        total_interest=round(totals["interest"], 2),
        total_tax_set_aside=round(totals["tax"], 2),
        cumulative_profit=round(cumulative_profit, 2),
        # Phase 5 (model 1.4)
        total_payroll=round(totals_p5["payroll"], 2),
        total_depreciation=round(totals_p5["depreciation"], 2),
        total_bad_debts=round(totals_p5["bad_debts"], 2),
        total_funding_in=round(totals_p5["equity_in"], 2),
        total_grants=round(totals_p5["grants"], 2),
        total_owner_payments=round(totals_p5["owner_out"], 2),
        total_equipment_bought=round(totals_p5["capex"], 2),
        closing_fixed_assets=round(fixed_assets, 2),
        payroll_basis=payroll_basis,
        total_cash_in=round(totals["cash_in"], 2),
        total_cash_out=round(totals["cash_out"], 2),
        stub=stub,
        baseline=baseline,
        monthly_detail=detail,
        checks=dict(cash_reconciles=bool(cash_ok), receivables_reconcile=bool(receivables_ok), balance_sheet_balances=bool(balance_ok)),
        assumptions=assumptions_for(state, scenario_type, params, baseline if as_of else None, stub_days),
    )
    summary["thirteen_week"] = thirteen_week_view(state, as_of, opening_cash, periods) if as_of else None
    summary["current_month"] = current_month_view(state, as_of, opening_cash, stub) if as_of else None
    # Phase 6 (model 1.5): how every figure was calculated, in words with the numbers used
    from app.modules.scenario_intelligence.explain import explain as _explain
    summary["how_calculated"] = _explain(state, baseline, rows, detail, summary, as_of, scenario_type)
    # Phase 6 (model 1.6): data quality check
    from app.modules.scenario_intelligence import quality as _quality
    summary["data_quality"] = _quality.check(state, as_of, months)
    # What this run forecast for each calendar month, so it can be checked against what happens (Phase 3, accuracy.py)
    if as_of:
        summary["forecast_by_month"] = {
            "%04d-%02d" % add_months(as_of.year, as_of.month, r["month_index"]): dict(revenue=r["revenue"], costs=r["costs"], expenses=r["expenses"], cost_of_sales=r["cost_of_sales"], profit=round(r["revenue"]-r["costs"],2), cash=r["cash_balance"])
            for r in rows}
    return rows, summary


def current_month_view(state: BusinessStateSnapshot, as_of: date, opening_cash: float, stub: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """This calendar month's recorded actuals, with no estimated remainder or month-end cash."""
    key = "%04d-%02d" % (as_of.year, as_of.month)
    rec = state.current_month_recorded if isinstance(state.current_month_recorded, dict) else None
    if rec and rec.get("month") == key:
        revenue, cos, exp = (_num(rec.get(k)) for k in ("revenue", "cost_of_sales", "expenses"))
        source = (f"your records: {int(_num(rec.get('invoices')))} invoices and {int(_num(rec.get('expense_records')))} expenses "
                  f"dated 1-{as_of.day} {as_of.strftime('%b')}")
    else:
        revenue = _num((state.revenue_by_month or {}).get(key))
        cos = _num((state.cost_of_sales_by_month or {}).get(key))
        exp = _num((state.expenses_by_month or {}).get(key))
        source = "the monthly figures sent with the request"
    recorded = dict(revenue=round(revenue, 2), cost_of_sales=round(cos, 2), expenses=round(exp, 2), costs=round(cos + exp, 2),
                    profit=round(revenue - cos - exp, 2), source=source)
    recorded["receivables"] = _num((rec or {}).get("receivables"))
    recorded["gross_profit"] = round(revenue - cos, 2)
    recorded["gross_margin_pct"] = round((revenue - cos) / revenue * 100, 2) if revenue else None
    # Legacy runs can carry a period-zero stub, but it is never included in actuals.
    rest = dict(days=0, revenue=0.0, costs=0.0, profit=0.0)
    total = dict(recorded)
    actual_cash = (rec or {}).get("cash")
    return dict(month=key, label=as_of.strftime("%b %Y"), as_of=as_of.isoformat(), recorded_so_far=recorded,
                rest_of_month=rest, month_total=total, cash_today=round(actual_cash if actual_cash is not None else opening_cash, 2),
                cash_at_month_end=None, basis="actual",
                explanation=f"Actuals recorded in Business Operations through {as_of.isoformat()}.")


def thirteen_week_view(state: BusinessStateSnapshot, as_of: date, opening_cash: float,
                       periods: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Weekly cash for the next 13 weeks. Regular sales receipts and costs are spread evenly over the days of their month;
    one-off amounts (loan money, repayments, tax and VAT payments) fall on the first day of their month; money already
    owed falls in the week it is due when weekly due dates were sent, else spread over its month."""
    by_day_in: Dict[date, float] = {}
    by_day_out: Dict[date, float] = {}
    start = as_of + timedelta(days=1)
    end = as_of + timedelta(days=7 * WEEKS_IN_VIEW)
    weekly_in = _schedule(state.pending_receivables_weekly)[:WEEKS_IN_VIEW]
    weekly_out = _schedule(state.pending_payables_weekly)[:WEEKS_IN_VIEW]

    def add(book, d, v):
        if v and start <= d <= end:
            book[d] = book.get(d, 0.0) + v

    for per in periods:
        p = per["p"]
        y, m = as_of.year, as_of.month
        total = y * 12 + (m - 1) + p
        y, m = total // 12, total % 12 + 1
        dim = calendar.monthrange(y, m)[1]
        days = [date(y, m, d) for d in range((as_of.day + 1) if p == 0 else 1, dim + 1)]
        if not days:
            continue
        spread_in = per["regular_in"] + (0.0 if weekly_in else per["owed_in"])
        spread_out = per["regular_out"] + (0.0 if weekly_out else per["owed_out"])
        for d in days:
            add(by_day_in, d, spread_in / len(days))
            add(by_day_out, d, spread_out / len(days))
        add(by_day_in, days[0], per["lumps_in"])
        add(by_day_out, days[0], per["lumps_out"])

    weeks = []
    cash = opening_cash
    for w in range(WEEKS_IN_VIEW):
        ws = start + timedelta(days=7 * w)
        we = ws + timedelta(days=6)
        cin = sum(v for d, v in by_day_in.items() if ws <= d <= we) + (weekly_in[w] if w < len(weekly_in) else 0.0)
        cout = sum(v for d, v in by_day_out.items() if ws <= d <= we) + (weekly_out[w] if w < len(weekly_out) else 0.0)
        opening = cash
        cash = opening + cin - cout
        weeks.append(dict(week=w + 1, start=ws.isoformat(), end=we.isoformat(), opening_cash=round(opening, 2),
                          cash_in=round(cin, 2), cash_out=round(cout, 2), closing_cash=round(cash, 2)))
    low = min(weeks, key=lambda r: r["closing_cash"]) if weeks else None
    return dict(
        weeks=weeks,
        lowest_week=low["week"] if low else None,
        lowest_cash=low["closing_cash"] if low else None,
        uses_due_dates=bool(weekly_in or weekly_out),
        reconciles=all(abs(r["closing_cash"] - (r["opening_cash"] + r["cash_in"] - r["cash_out"])) < 0.02 for r in weeks),
        note=("Money already owed is placed in the week it is due; regular sales receipts and costs are spread evenly "
              "through each month." if (weekly_in or weekly_out) else
              "Regular sales receipts, costs and money already owed are spread evenly through each month; one-off "
              "amounts fall at the start of their month."),
    )


def run_rate_snapshot(state: BusinessStateSnapshot, scenario_type: str, params: Dict[str, Any] | None, month: int,
                      cash: float | None = None, as_of: Optional[date] = None) -> BusinessStateSnapshot:
    """The business's monthly figures in a given projection month (and, optionally, its cash then)."""
    base = _base_values(build_baseline(state, as_of), state, as_of, month)
    revenue, expenses, cost_of_sales = _monthly_projection_values(state, scenario_type, params or {}, month, base=base)
    return state.model_copy(update=dict(
        revenue_monthly=revenue, expenses_monthly=expenses, cost_of_sales_monthly=cost_of_sales,
        costs_monthly=expenses + cost_of_sales,
        **({"starting_cash": cash} if cash is not None else {}),
    ))


# ---------------------------------------------------------------------------------------------------------------------
# Better or worse? (audit finding F7)
# ---------------------------------------------------------------------------------------------------------------------

def compare_projections(baseline: Dict[str, Any], scenario: Dict[str, Any]) -> Dict[str, Any]:
    """The verdict on a scenario: its projection against the same business doing nothing, over the same months.

    A change counts only when it is material: more than 1% of the baseline's revenue over the horizon (or of its costs,
    when there is no revenue). "Cash" in rules 3-5 is net cash: closing cash less loans, tax and VAT still owed (Phase 1),
    so borrowing is not mistaken for an improvement and profit is not counted before its tax. Rules, in order:
      1. The scenario takes cash below zero where the baseline did not  -> worse.
      2. The scenario keeps cash above zero where the baseline did not -> improved.
      2a. Both run short, the scenario sooner -> worse. Both run short, the scenario later (Phase 1) -> improved, or
          mixed when it costs a material amount of profit or net cash (time bought at a price: a trade-off to weigh).
      3. Profit or closing cash materially lower, and neither materially higher -> worse.
      4. Profit or closing cash materially higher, and neither materially lower -> improved.
      5. One materially higher and the other materially lower -> neutral ("mixed": a trade-off to weigh).
      6. Otherwise -> neutral ("no material change").
    """
    base_rev = float(baseline.get("total_revenue") or 0.0)
    base_costs = float(baseline.get("total_costs") or 0.0)
    materiality = round(max(MATERIALITY_SHARE * (base_rev if base_rev > 0 else base_costs), 0.01), 2)

    def net_cash(s: Dict[str, Any]) -> float:
        return (float(s["closing_cash"]) - float(s.get("closing_loans") or 0.0) - float(s.get("closing_tax_owed") or 0.0)
                - float(s.get("closing_sales_tax_owed") or 0.0))

    d_raw_cash = round(float(scenario["closing_cash"]) - float(baseline["closing_cash"]), 2)
    d_cash = round(net_cash(scenario) - net_cash(baseline), 2)
    d_profit = round(float(scenario["cumulative_profit"]) - float(baseline["cumulative_profit"]), 2)
    # Phase 4: running short is judged over the months ahead (month 1 onwards), where a scenario can make a difference.
    # Counting today as well meant a business already overdrawn "ran short" in both projections, so a scenario that
    # clears the overdraft read as "no material change" (06, section 2.3). Older summaries fall back to the whole period.
    def _ahead(s: Dict[str, Any]):
        if "min_cash_ahead" in s and s.get("min_cash_ahead") is not None:
            return float(s["min_cash_ahead"]), s.get("first_negative_month_ahead")
        return float(s["min_cash"]), s.get("first_negative_cash_month")
    base_min, base_neg = _ahead(baseline)
    scen_min, scen_neg = _ahead(scenario)
    base_short, scen_short = base_min < 0, scen_min < 0
    overdrawn_today = bool(baseline.get("overdrawn_today"))

    better = d_cash > materiality or d_profit > materiality
    worse = d_cash < -materiality or d_profit < -materiality

    def when(m):
        return "later this month" if m == 0 else f"in month {m}"

    if scen_short and not base_short:
        outcome, result = "worse", "worse"
        neg = scenario.get('first_negative_cash_month')
        reason = f"Cash goes below zero {'later this month' if neg == 0 else f'in month {neg}'}, which does not happen if nothing changes."
    elif base_short and not scen_short:
        outcome, result = "improved", "improved"
        reason = ("Cash is below zero today; with this change it is back above zero from month 1, where it would stay below zero "
                  "if nothing changes." if overdrawn_today else
                  "Cash stays above zero, where it would go below zero if nothing changes.")
    elif base_short and scen_short and base_neg is not None and scen_neg is not None and scen_neg != base_neg:
        if scen_neg < base_neg:
            outcome, result = "worse", "worse"
            reason = f"Cash goes below zero sooner: {when(scen_neg)} instead of {when(base_neg)}."
        elif worse:
            outcome, result = "mixed", "neutral"
            reason = (f"Cash goes below zero later ({when(scen_neg)} instead of {when(base_neg)}), but profit and/or net "
                      "cash end materially lower: time bought at a cost, a trade-off to weigh.")
        else:
            outcome, result = "improved", "improved"
            reason = f"Cash goes below zero later: {when(scen_neg)} instead of {when(base_neg)}."
    elif worse and not better:
        outcome, result = "worse", "worse"
        reason = "Profit and/or cash end materially lower than if nothing changes."
    elif better and not worse:
        outcome, result = "improved", "improved"
        reason = "Profit and/or cash end materially higher than if nothing changes."
    elif better and worse:
        outcome, result = "mixed", "neutral"
        reason = ("Profit is higher but cash is lower by the end of the period" if d_profit > 0
                  else "Cash is higher but profit is lower over the period") + ": a trade-off to weigh."
    else:
        outcome, result = "no_material_change", "neutral"
        reason = "Neither profit nor cash changes materially compared with doing nothing."

    # Phase 5: new equity or owner capital raises cash without the business earning more; say so plainly
    new_funding = float(scenario.get("total_funding_in") or 0) - float(baseline.get("total_funding_in") or 0)
    if new_funding > materiality:
        reason += (f" Cash is higher partly because of {new_funding:,.2f} of new investment or owner capital, not because the "
                   "business earns more; any share of the business given up is not costed here.")
    return dict(
        state_result=result,
        outcome=outcome,
        reason=reason,
        basis=("Scenario against the same business with no change, over the same months. Cash is compared after loans, "
               "tax and VAT still owed at the end."),
        months=int(scenario.get("months") or baseline.get("months") or 0),
        closing_cash_change=d_raw_cash,
        net_cash_change=d_cash,
        cumulative_profit_change=d_profit,
        materiality_threshold=materiality,
        cash_shortfall_introduced=bool(scen_short and not base_short),
        cash_shortfall_removed=bool(base_short and not scen_short),
        cash_below_zero_today=overdrawn_today,
        funding_effect=round(float(scenario.get("total_funding_in") or 0) - float(baseline.get("total_funding_in") or 0), 2),
        baseline_closing_cash=baseline["closing_cash"],
        scenario_closing_cash=scenario["closing_cash"],
        baseline_cumulative_profit=baseline["cumulative_profit"],
        scenario_cumulative_profit=scenario["cumulative_profit"],
    )
