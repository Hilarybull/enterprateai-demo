"""Trust and transparency for a projection: how sure it is, how wide it could be, and where every input came from.

Simulation audit, Phase 2 (17 Nov 2026), findings F5 and F11. Pure calculation on top of projection.project.

* **Range** (low / base / high). The uncertain inputs move together, adversely in the low case and favourably in the
  high case:
    - revenue level by its 90% forecast range (Phase 4, `forecast_swing`: month-to-month variation, uncertainty in the
      3-month level and in the trend, seasonal pattern removed; 15% when there are fewer than 3 months). Cost of sales
      follows revenue;
    - operating expenses by their own 90% forecast range (10% when not measurable);
    - customers paying 15 days later in the low case;
    - the scenario's own uncertain inputs (price sensitivity, on-costs, a new hire's or service's revenue, launch cost).
  Revenue and costs move by a 90% range; with the other inputs moving too, the whole range is a cautious one.
* **Robustness**. The verdict is worked out again in the low and high cases (both sides adjusted alike). If it agrees in
  all three, it is robust; if not, it says which case changes it.
* **Sensitivity**. Each driver moved on its own; the result is the swing in the scenario's net cash and profit change
  against doing nothing. Largest first.
* **Inputs**. Every input with its value and where it came from: recorded, shared figure, from your history, estimate,
  entered by you, standard figure, assumed, not set.
* **Confidence**. High / medium / low, from the inputs' sources, with the reasons.
* **KPIs**. Standard measures for both sides at the end of the period.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from app.modules.scenario_intelligence.baseline import complete_months
from app.modules.scenario_intelligence.projection import (
    DEFAULT_HIRE_RAMP_MONTHS,  # noqa: F401  (documented default, kept with the others)
    DEFAULT_ONCOST_PCT,
    DEFAULT_PAYMENT_TERMS_DAYS,
    DEFAULT_PRICE_ELASTICITY,
    compare_projections,
    price_elasticity,
    project,
)

DEFAULT_REVENUE_SWING = 0.15
DEFAULT_COST_SWING = 0.10
MIN_SWING, MAX_SWING = 0.03, 0.50
LATE_PAYMENT_DAYS = 15
SENSITIVITY_STEP = 0.10


# ---------------------------------------------------------------------------------------------------------------------
# How much the business's figures move from month to month
# ---------------------------------------------------------------------------------------------------------------------

def typical_swing(history: Dict[str, Any] | None, as_of: Optional[date], default: float) -> Tuple[float, str]:
    """(relative swing, how it was found). The standard deviation of complete months around their straight-line trend
    (or around their mean with under 6 months), as a share of the mean. Within 3%-50%."""
    series = [v for _ym, v in complete_months(history, as_of)][-12:] if as_of else []
    if len(series) < 3 or sum(series) <= 0:
        return default, f"{default:.0%} assumed (fewer than 3 complete months on record to measure it)"
    n = len(series)
    mean = sum(series) / n
    if n >= 6:
        xs = range(n)
        mx = (n - 1) / 2
        slope = sum((x - mx) * (y - mean) for x, y in zip(xs, series)) / sum((x - mx) ** 2 for x in xs)
        resid = [y - (mean + slope * (x - mx)) for x, y in zip(xs, series)]
        sd = math.sqrt(sum(r * r for r in resid) / (n - 2))
    else:
        sd = math.sqrt(sum((y - mean) ** 2 for y in series) / (n - 1))
    swing = min(MAX_SWING, max(MIN_SWING, sd / mean))
    return swing, f"{swing:.0%}, the typical month-to-month variation over your last {n} complete months"


# ---------------------------------------------------------------------------------------------------------------------
# The low and high cases
# ---------------------------------------------------------------------------------------------------------------------

def _scenario_case_params(scenario_type: str, params: Dict[str, Any], case: str) -> Dict[str, Any]:
    """The scenario's own uncertain inputs moved for a case ("low" = adverse, "high" = favourable)."""
    if scenario_type == "combined":      # Phase 6: each step's own estimates moved alike
        from app.modules.scenario_intelligence.projection import combined_steps
        return {**(params or {}), "steps": [{"scenario_type": k, "params": _scenario_case_params(k, sp, case)}
                                            for k, sp in combined_steps(scenario_type, params)]}
    p = dict(params or {})
    if scenario_type == "price_change":
        e, _given = price_elasticity(p)
        s = abs(e)
        p.pop("price_sensitivity", None)
        rise = float(p.get("price_change_pct") or 0) >= 0
        # A price rise is worse when customers are more sensitive; a cut is worse when they are less
        more, less = max(2 * s, s + 0.5), s / 2
        p["price_elasticity"] = -(more if (case == "low") == rise else less)
    if scenario_type in ("hire_staff", "delay_hiring"):
        base = float(p.get("employer_oncost_pct") if p.get("employer_oncost_pct") not in (None, "") else DEFAULT_ONCOST_PCT)
        hi, lo = max(25.0, base + 5), max(0.0, min(10.0, base - 5))
        # Hiring: higher on-costs are adverse. Delaying a hire: higher on-costs are a bigger saving.
        adverse_high = scenario_type == "hire_staff"
        p["employer_oncost_pct"] = (hi if (case == "low") == adverse_high else lo)
        if scenario_type == "hire_staff" and p.get("revenue_per_hire_monthly"):
            p["revenue_per_hire_monthly"] = float(p["revenue_per_hire_monthly"]) * (0.5 if case == "low" else 1.0)
    if scenario_type == "buy_equipment":
        for k in ("extra_revenue_monthly", "cost_saving_monthly"):
            p[k] = float(p.get(k) or 0) * (0.5 if case == "low" else 1.25)
    if scenario_type == "service_launch":
        p["revenue_uplift_pct"] = float(p.get("revenue_uplift_pct") or 0) * (0.5 if case == "low" else 1.25)
        p["launch_cost"] = float(p.get("launch_cost") or 0) * (1.25 if case == "low" else 1.0)
    return p


FORECAST_Z = 1.645      # two-sided 90%
RANGE_CALIBRATION = 1.4      # calibrated on the 19 Nov mock set (90.6% coverage), confirmed on a separate holdout set (Phase 4 document)


def forecast_swing(history: Dict[str, Any] | None, as_of: Optional[date], months: int, default: float) -> Tuple[float, str]:
    """Simulation audit, Phase 4: the half-width of a 90% forecast range for the series over the projection, as a share of
    its level. It combines (standard forecast-interval reasoning) the month-to-month variation, which averages out over
    the months; the uncertainty in the level, which is the average of only 3 months and does not average out; and the
    uncertainty in the trend's slope, carried forward the way the projection carries a trend (damped). A seasonal pattern
    that passes the seasonality test is removed first. The 1.2 range used one month's variation alone and real outcomes
    fell outside it a third of the time (06, section 3.4). Within MIN_SWING..MAX_SWING; `default` with under 3 months."""
    from app.modules.scenario_intelligence.baseline import (LEVEL_MONTHS, TREND_DAMPING, TREND_WINDOW, seasonal_indices,
                                                            seasonality_test)
    series = complete_months(history, as_of) if as_of else []
    if len(series) < 3 or sum(v for _ym, v in series) <= 0:
        return default, f"{default:.0%} assumed (fewer than 3 complete months on record to measure it)"
    test = seasonality_test(series)
    idx = seasonal_indices(series) if (test and test["significant"]) else None
    values = [(v / idx[m]) if idx and idx.get(m) else v for (_y, m), v in series][-TREND_WINDOW:]
    n = len(values)
    mean = sum(values) / n
    if mean <= 0:
        return default, f"{default:.0%} assumed (no positive months to measure it)"
    se_slope, slope = 0.0, 0.0
    if n >= 6:
        xs = range(n)
        mx = (n - 1) / 2
        sxx = sum((x - mx) ** 2 for x in xs)
        slope = sum((x - mx) * (y - mean) for x, y in zip(xs, values)) / sxx
        resid = [y - (mean + slope * (x - mx)) for x, y in zip(xs, values)]
        sd = math.sqrt(sum(r * r for r in resid) / (n - 2))
        se_slope = sd / math.sqrt(sxx)
    else:
        sd = math.sqrt(sum((y - mean) ** 2 for y in values) / (n - 1))
    h = max(1, int(months or 1))
    level_n = min(LEVEL_MONTHS, n)
    steps = sum(sum(TREND_DAMPING ** k for k in range(1, m + 3)) for m in range(1, h + 1)) / h      # mean slope-months carried
    undamped = sum(m + 2 for m in range(1, h + 1)) / h
    noise = (sd / mean) ** 2
    parts = [noise / level_n, noise / h, (se_slope * steps / mean) ** 2,
             # the trend's damping is a modelling choice: what it holds back counts as uncertainty, not certainty
             (abs(slope) * (undamped - steps) / mean) ** 2]
    if idx:      # seasonal indices estimated from only a few years each carry their own error
        years = max(1, len(series) // 12)
        parts.append(noise / years)
    rel_sd = math.sqrt(sum(parts))
    swing = min(MAX_SWING, max(MIN_SWING, FORECAST_Z * RANGE_CALIBRATION * rel_sd))
    return swing, (f"±{swing:.0%}, a 90% forecast range from your last {n} complete months (their month-to-month variation "
                   f"and the uncertainty in the level and trend{', seasonal pattern removed' if idx else ''})")


def _case(state, case: str, rev_swing: float, cost_swing: float):
    """(state, adjust) for a case."""
    if case == "base":
        return state, None
    if case == "low":
        terms = state.payment_terms_days if state.payment_terms_days is not None else DEFAULT_PAYMENT_TERMS_DAYS
        return (state.model_copy(update={"payment_terms_days": min(365, int(terms) + LATE_PAYMENT_DAYS)}),
                {"revenue": 1 - rev_swing, "expenses": 1 + cost_swing})
    return state, {"revenue": 1 + rev_swing, "expenses": 1 - cost_swing}


def _net_cash(s: Dict[str, Any]) -> float:
    return round(float(s["closing_cash"]) - float(s.get("closing_loans") or 0) - float(s.get("closing_tax_owed") or 0)
                 - float(s.get("closing_sales_tax_owed") or 0), 2)


def _brief(s: Dict[str, Any]) -> Dict[str, Any]:
    return dict(closing_cash=s["closing_cash"], cash_after_vat_owed=round(s["closing_cash"] - float(s.get("closing_sales_tax_owed") or 0), 2), net_cash=_net_cash(s), cumulative_profit=s["cumulative_profit"],
                min_cash=s["min_cash"], first_negative_cash_month=s["first_negative_cash_month"])


def ranges(state, scenario_type: str, params: Dict[str, Any], months: int, as_of: Optional[date]) -> Dict[str, Any]:
    rev_swing, rev_basis = forecast_swing(state.revenue_by_month, as_of, months, DEFAULT_REVENUE_SWING)
    cost_swing, cost_basis = forecast_swing(state.expenses_by_month, as_of, months, DEFAULT_COST_SWING)
    is_scenario = scenario_type != "do_nothing_projection"
    cases, verdicts = {}, {}
    for case in ("low", "base", "high"):
        st, adj = _case(state, case, rev_swing, cost_swing)
        _r, base = project(st, "do_nothing_projection", {}, months, as_of=as_of, adjust=adj)
        cases[case] = {"baseline": _brief(base)}
        if is_scenario:
            sp = params if case == "base" else _scenario_case_params(scenario_type, params, case)
            _r, scen = project(st, scenario_type, sp, months, as_of=as_of, adjust=adj)
            cases[case]["scenario"] = _brief(scen)
            v = compare_projections(base, scen)
            verdicts[case] = dict(outcome=v["outcome"], state_result=v["state_result"], net_cash_change=v["net_cash_change"],
                                  cumulative_profit_change=v["cumulative_profit_change"])
    out = dict(
        cases=cases,
        drivers=dict(revenue_swing_pct=round(rev_swing * 100, 1), revenue_swing_basis=rev_basis,
                     cost_swing_pct=round(cost_swing * 100, 1), cost_swing_basis=cost_basis,
                     late_payment_days=LATE_PAYMENT_DAYS),
        note=("Revenue and costs move by a 90% forecast range from the business's own history; payment timing and the "
              "scenario's own estimates move with them, adversely in the low case and favourably in the high case. The whole "
              "range is therefore a cautious one rather than an exact probability."),
    )
    if is_scenario:
        outcomes = {c: v["outcome"] for c, v in verdicts.items()}
        robust = len(set(outcomes.values())) == 1
        out["verdicts"] = verdicts
        out["robust"] = robust
        out["robustness"] = ("The verdict is the same in the low, base and high cases." if robust else
                             "The verdict depends on the assumptions: " + "; ".join(
                                 f"{c} case {_words(o)}" for c, o in outcomes.items()) + ".")
    return out


def _words(outcome: str) -> str:
    return {"improved": "better than doing nothing", "worse": "worse than doing nothing", "mixed": "mixed",
            "no_material_change": "no material change"}.get(outcome, outcome)


# ---------------------------------------------------------------------------------------------------------------------
# Sensitivity: one driver at a time
# ---------------------------------------------------------------------------------------------------------------------

def sensitivity(state, scenario_type: str, params: Dict[str, Any], months: int, as_of: Optional[date]) -> List[Dict[str, Any]]:
    """For each driver, the scenario's net cash change and profit change against doing nothing, with the driver at its
    low and high values. Sorted by the swing in net cash change, largest first."""
    if scenario_type == "do_nothing_projection":
        return []
    step = SENSITIVITY_STEP
    terms = state.payment_terms_days if state.payment_terms_days is not None else DEFAULT_PAYMENT_TERMS_DAYS
    drivers: List[Tuple[str, Any, Any]] = [
        (f"Revenue ±{step:.0%}", ({"revenue": 1 - step}, None, None), ({"revenue": 1 + step}, None, None)),
        (f"Operating expenses ±{step:.0%}", ({"expenses": 1 + step}, None, None), ({"expenses": 1 - step}, None, None)),
        (f"Cost of sales ±{step:.0%}", ({"cost_of_sales": 1 + step}, None, None), ({"cost_of_sales": 1 - step}, None, None)),
        (f"Customers pay {LATE_PAYMENT_DAYS} days later / sooner",
         (None, {"payment_terms_days": min(365, int(terms) + LATE_PAYMENT_DAYS)}, None),
         (None, {"payment_terms_days": max(0, int(terms) - LATE_PAYMENT_DAYS)}, None)),
    ]
    if scenario_type in ("price_change", "hire_staff", "delay_hiring", "service_launch"):
        label = {"price_change": "Customer price sensitivity", "hire_staff": "On-costs and the hire's revenue",
                 "delay_hiring": "Employer on-costs", "service_launch": "New service's revenue and launch cost"}[scenario_type]
        drivers.append((label, (None, None, _scenario_case_params(scenario_type, params, "low")),
                        (None, None, _scenario_case_params(scenario_type, params, "high"))))
    out = []
    for name, low, high in drivers:
        results = []
        for adj, st_upd, sp in (low, high):
            st = state.model_copy(update=st_upd) if st_upd else state
            _r, base = project(st, "do_nothing_projection", {}, months, as_of=as_of, adjust=adj)
            _r, scen = project(st, scenario_type, sp if sp is not None else params, months, as_of=as_of, adjust=adj)
            v = compare_projections(base, scen)
            results.append(v)
        out.append(dict(
            driver=name,
            low=dict(net_cash_change=results[0]["net_cash_change"], cumulative_profit_change=results[0]["cumulative_profit_change"],
                     outcome=results[0]["outcome"]),
            high=dict(net_cash_change=results[1]["net_cash_change"], cumulative_profit_change=results[1]["cumulative_profit_change"],
                      outcome=results[1]["outcome"]),
            swing=round(abs(results[1]["net_cash_change"] - results[0]["net_cash_change"]), 2),
        ))
    out.sort(key=lambda d: d["swing"], reverse=True)
    return out


# ---------------------------------------------------------------------------------------------------------------------
# Where each input came from, and how much to trust the result
# ---------------------------------------------------------------------------------------------------------------------

SCENARIO_INPUT_DEFAULTS = {
    "price_sensitivity": -DEFAULT_PRICE_ELASTICITY,
    "employer_oncost_pct": DEFAULT_ONCOST_PCT,
}
SCENARIO_INPUT_NAMES = {
    "price_change_pct": "Price change (%)", "effective_month": "Effective from month", "price_sensitivity": "Customer price sensitivity",
    "price_elasticity": "Price elasticity", "client_loss_pct": "Revenue lost (%)", "revenue_drop_pct": "Revenue drop (%)",
    "cost_increase_pct": "Cost increase (%)", "cost_reduction_pct": "Cost reduction (%)", "employee_count": "People",
    "employee_monthly_cost": "Pay per person a month", "employer_oncost_pct": "Employer on-costs (%)",
    "recruitment_cost_per_hire": "Recruitment cost per hire", "start_month": "Starts in month",
    "revenue_per_hire_monthly": "Revenue per hire a month", "contractor_monthly_cost": "Contractor cost a month",
    "delay_months": "Delay (months)", "selected_pending_receivable_amount": "Selected invoices",
    "revenue_uplift_pct": "Revenue uplift (%)", "cost_uplift_pct": "Overheads uplift (%)", "launch_cost": "Launch cost",
    "loan_amount": "Loan amount", "loan_annual_rate_pct": "Loan interest (% a year)", "loan_term_months": "Loan term (months)",
    "loan_start_month": "Loan received in month",
    # Phase 5
    "funding_amount": "Funding amount", "funding_month": "Funding received in month", "funding_type": "Funding type",
    "equipment_cost": "Equipment cost", "purchase_month": "Bought in month", "useful_life_months": "Useful life (months)",
    "extra_revenue_monthly": "Extra sales a month", "cost_saving_monthly": "Running costs saved a month",
}
SETTING_NAMES = {
    "profit_tax_rate_pct": "Tax on profit (%)", "tax_payment_month": "Tax paid in month", "sales_tax_rate_pct": "VAT / sales tax (%)",
    "sales_tax_period_months": "VAT period (months)", "sales_tax_on_costs_pct": "Costs with reclaimable VAT (%)",
    "existing_loan_balance": "Loan balance", "existing_loan_annual_rate_pct": "Loan interest (% a year)",
    "existing_loan_monthly_repayment": "Loan repayment a month", "cost_inflation_pct": "Cost inflation (% a year)",
    # Phase 5
    "tax_country": "Country (payroll and tax rules)", "profit_tax_regime": "Corporation tax rules",
    "tax_losses_brought_forward": "Tax losses brought forward", "owner_drawings_monthly": "Owner drawings a month",
    "bad_debt_pct": "Sales never collected (%)", "payroll_staff_count": "Staff on payroll",
    "payroll_gross_monthly_per_person": "Gross pay per person a month", "employer_pension_pct": "Employer pension (%)",
}


def _baseline_label(b: Dict[str, Any], estimate: bool) -> str:
    src = str(b.get("source") or "")
    if estimate:
        return "estimate"
    if src.startswith("shared figure"):
        return "shared figure"
    if src.startswith("average of the last"):
        return "from your history"
    if src.startswith("total monthly costs"):
        return "recorded"
    return "recorded" if float(b.get("level") or 0) > 0 else "not set"


def inputs(state, scenario_type: str, params: Dict[str, Any], baseline: Dict[str, Any]) -> List[Dict[str, Any]]:
    params = params or {}
    estimate = params.get("basis") == "estimate"
    sources = state.figure_sources or {}
    out = []
    for key, name in (("revenue", "Monthly revenue"), ("cost_of_sales", "Monthly cost of sales"), ("expenses", "Monthly operating expenses")):
        b = baseline.get(key) or {}
        out.append(dict(input=name, value=b.get("level"), label=_baseline_label(b, estimate),
                        source=(params.get("estimate_basis") if estimate else b.get("source"))))
    out.append(dict(input="Cash today", value=state.starting_cash,
                    label="shared figure" if sources.get("starting_cash") else ("recorded" if state.starting_cash else "not set"),
                    source=sources.get("starting_cash") or "sent with the request"))
    out.append(dict(input="Customer payment terms (days)",
                    value=state.payment_terms_days if state.payment_terms_days is not None else DEFAULT_PAYMENT_TERMS_DAYS,
                    label="recorded" if state.payment_terms_days is not None else "assumed",
                    source="your customers' terms" if state.payment_terms_days is not None else "30 days assumed: no terms on record"))
    owed = sum(state.pending_receivables_schedule or []) or float(state.opening_accrual_balance or 0) or float(state.accrued_revenue_total or 0)
    out.append(dict(input="Money owed to you", value=round(owed, 2), label="recorded" if owed else "none recorded",
                    source="your unpaid invoices and contracts"))
    bills = sum(state.pending_payables_schedule or [])
    out.append(dict(input="Bills you owe", value=round(bills, 2), label="recorded" if bills else "none recorded",
                    source="your unpaid expenses"))
    for key, name in SETTING_NAMES.items():
        v = getattr(state, key, None)
        out.append(dict(input=name, value=v, label="entered by you" if v not in (None, 0, "") else "not set", source="business settings"))
    # Phase 5: what the records said, and the planned amounts
    if state.payroll_in_recorded_expenses is True:
        out.append(dict(input="Salaries", value=None, label="recorded",
                        source="already in your recorded expenses, so payroll settings are not added again"))
    for name, items in (("Funding planned", state.funding_events), ("Dividends planned", state.dividends),
                        ("Equipment purchases planned", state.capital_purchases)):
        total = sum(float((i or {}).get("amount") or 0) for i in (items or []) if isinstance(i, dict))
        out.append(dict(input=name, value=round(total, 2), label="entered by you" if total else "not set", source="business settings"))
    from app.modules.scenario_intelligence.projection import combined_steps
    if scenario_type == "combined":
        for kind, sp in combined_steps(scenario_type, params):
            for row in inputs(state, kind, sp, baseline):
                if row["source"] == "the scenario":
                    out.append({**row, "source": f"the scenario ({kind.replace('_', ' ')})"})
        return out
    if scenario_type != "do_nothing_projection":
        for key, value in params.items():
            if key not in SCENARIO_INPUT_NAMES:
                continue
            standard = key in SCENARIO_INPUT_DEFAULTS and float(value or 0) == SCENARIO_INPUT_DEFAULTS[key]
            out.append(dict(input=SCENARIO_INPUT_NAMES[key], value=value, label="standard figure" if standard else "entered by you",
                            source="the scenario"))
        if scenario_type == "price_change" and "price_sensitivity" not in params and "price_elasticity" not in params:
            out.append(dict(input="Customer price sensitivity", value=-DEFAULT_PRICE_ELASTICITY, label="standard figure", source="the scenario"))
        if scenario_type in ("hire_staff", "delay_hiring") and "employer_oncost_pct" not in params:
            from app.modules.scenario_intelligence import factors
            pay = float(params.get("employee_monthly_cost") or 0)
            if factors.country_code(state.tax_country) and pay > 0:
                c = factors.employer_cost_per_person(state.tax_country, pay, state.employer_pension_pct)
                out.append(dict(input="Employer on-costs (%)", value=round(c["rate"] * 100, 2), label="country rules", source=c["basis"]))
            else:
                out.append(dict(input="Employer on-costs (%)", value=DEFAULT_ONCOST_PCT, label="standard figure", source="the scenario"))
    return out


WIDE_RANGE, VERY_WIDE_RANGE = 0.20, 0.35      # Phase 4: a revenue forecast range wider than this lowers confidence


def confidence(state, scenario_type: str, params: Dict[str, Any], baseline: Dict[str, Any],
               input_list: List[Dict[str, Any]], revenue_range: Optional[float] = None,
               data_quality: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """High / medium / low with the reasons. Points: history and recorded figures add; estimates, assumptions and
    standard figures take away. 2+ = high, 0-1 = medium, below 0 = low."""
    reasons: List[Tuple[int, str]] = []
    months = int((baseline.get("revenue") or {}).get("complete_months_on_record") or 0)
    if months >= 12:
        reasons.append((2, f"{months} complete months of sales on record"))
    elif months >= 6:
        reasons.append((1, f"{months} complete months of sales on record"))
    elif months >= 3:
        reasons.append((0, f"only {months} complete months of sales on record"))
    else:
        reasons.append((-1, "fewer than 3 complete months of sales on record, so trend, seasonality and swings can't be measured"))
    labels = {i["input"]: i["label"] for i in input_list}
    if labels.get("Monthly revenue") == "estimate":
        reasons.append((-2, "revenue and costs are an estimate from your answers, not records"))
    if labels.get("Monthly revenue") == "not set":
        reasons.append((-2, "no revenue on record"))
    if labels.get("Monthly operating expenses") == "not set" and labels.get("Monthly cost of sales") == "not set":
        reasons.append((-2, "no costs on record"))
    if labels.get("Customer payment terms (days)") == "assumed":
        reasons.append((-1, "customer payment terms are assumed (30 days)"))
    # Phase 4: how predictable the business is, not only how much history it has (a long but erratic history used to
    # earn "high"). The revenue's own 90% forecast range, measured from its history.
    if revenue_range is not None and months >= 3:
        if revenue_range > VERY_WIDE_RANGE:
            reasons.append((-2, f"sales vary a lot from month to month (90% forecast range ±{revenue_range:.0%})"))
        elif revenue_range > WIDE_RANGE:
            reasons.append((-1, f"sales vary noticeably from month to month (90% forecast range ±{revenue_range:.0%})"))
    dq = data_quality or {}
    if dq.get("serious"):
        reasons.append((-min(2, int(dq["serious"])), f"{dq['serious']} serious data problem(s): see the data check"))
    if state.excluded_fx_items:
        reasons.append((-1, f"{state.excluded_fx_items} item(s) in another currency left out (no exchange rate)"))
    standard = [i["input"] for i in input_list if i["label"] == "standard figure"]
    if standard:
        reasons.append((-1, "standard figures used for: " + ", ".join(sorted(set(standard)))))
    score = sum(p for p, _ in reasons)
    level = "high" if score >= 2 else "medium" if score >= 0 else "low"
    return dict(level=level, points=score, reasons=[r for _p, r in reasons],
                basis="History and recorded figures raise confidence; estimates, assumptions and standard figures lower it.")


# ---------------------------------------------------------------------------------------------------------------------
# Standard measures
# ---------------------------------------------------------------------------------------------------------------------

def kpis(rows: List[Dict[str, Any]], summary: Dict[str, Any]) -> Dict[str, Any]:
    """Standard measures at the end of the period (last month) and over it."""
    if not rows:
        return {}
    last = rows[-1]
    detail = (summary.get("monthly_detail") or [{}])[-1]
    revenue, cos = float(last["revenue"]), float(last["cost_of_sales"])
    opex = float(detail.get("operating_expenses", last["expenses"]))
    interest = float(detail.get("interest", 0))
    months = len(rows)
    total_rev = float(summary.get("total_revenue") or 0)
    net_flow = (float(summary["closing_cash"]) - float(summary["opening_cash"])) / months
    cm_ratio = (revenue - cos) / revenue if revenue > 0 else None
    break_even = opex / cm_ratio if cm_ratio and cm_ratio > 0 else None
    operating_profit = revenue - cos - opex
    return dict(
        gross_margin_pct=round((revenue - cos) / revenue * 100, 1) if revenue > 0 else None,
        operating_margin_pct=round(operating_profit / revenue * 100, 1) if revenue > 0 else None,
        net_margin_pct_over_period=round(float(summary["cumulative_profit"]) / total_rev * 100, 1) if total_rev > 0 else None,
        average_monthly_cash_flow=round(net_flow, 2),
        monthly_burn=round(-net_flow, 2) if net_flow < 0 else 0.0,
        runway_months=(round(max(0.0, float(summary["closing_cash"])) / -net_flow, 1) if net_flow < 0 else None),
        days_sales_outstanding=round(float(summary["closing_receivables"]) / revenue * 30, 1) if revenue > 0 else None,
        break_even_revenue_monthly=round(break_even, 2) if break_even is not None else None,
        margin_of_safety_pct=round((revenue - break_even) / revenue * 100, 1) if break_even is not None and revenue > 0 else None,
        interest_cover=round(operating_profit / interest, 1) if interest > 0 else None,
        net_cash=_net_cash(summary),
        definitions=dict(
            gross_margin_pct="(revenue - cost of sales) / revenue, last month",
            operating_margin_pct="(revenue - cost of sales - operating expenses) / revenue, last month",
            net_margin_pct_over_period="profit after interest and tax / revenue, whole period",
            average_monthly_cash_flow="(closing cash - opening cash) / months",
            runway_months="closing cash / average monthly cash outflow, when cash is falling",
            days_sales_outstanding="money owed to you at the end / last month's revenue x 30",
            break_even_revenue_monthly="operating expenses / contribution margin ratio, last month",
            interest_cover="operating profit / interest, last month",
            net_cash="closing cash less loans, tax and VAT still owed",
        ),
    )


# ---------------------------------------------------------------------------------------------------------------------
# All of it for one run
# ---------------------------------------------------------------------------------------------------------------------

def analyse(state, scenario_type: str, params: Dict[str, Any], months: int, as_of: Optional[date],
            baseline_summary: Dict[str, Any], baseline_rows: List[Dict[str, Any]],
            scenario_summary: Optional[Dict[str, Any]] = None, scenario_rows: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    params = params or {}
    baseline = baseline_summary.get("baseline") or {}
    input_list = inputs(state, scenario_type, params, baseline)
    out = dict(
        ranges=ranges(state, scenario_type, params, months, as_of),
        sensitivity=sensitivity(state, scenario_type, params, months, as_of),
        inputs=input_list,
        confidence=confidence(state, scenario_type, params, baseline, input_list,
                              revenue_range=forecast_swing(state.revenue_by_month, as_of, months, DEFAULT_REVENUE_SWING)[0]
                              if as_of else None, data_quality=baseline_summary.get("data_quality")),
        kpis=dict(baseline=kpis(baseline_rows, baseline_summary)),
    )
    if scenario_summary is not None and scenario_rows is not None:
        out["kpis"]["scenario"] = kpis(scenario_rows, scenario_summary)
    return out
