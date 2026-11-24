"""Data quality check before a projection is relied on. Simulation audit, Phase 6 (model projection-1.6).

Each issue says what was found, why it matters and how to fix it, with a severity:
* serious: the projection cannot be relied on as it stands (it lowers confidence by one point each, up to two);
* warning: the result may be off; worth fixing;
* info: worth knowing.

Methods:
* Unusual months: the modified z-score (Iglewicz & Hoaglin, 1993), 0.6745 x (value - median) / MAD, over the complete
  months; above 3.5 is flagged. Robust: one extreme month cannot hide itself by inflating the spread, as it would with a
  standard deviation.
* Gaps: months with no sales between the first and the last month on record.
* Records: possible duplicates (same customer, amount and date; same expense line), uncategorised expenses, undated and
  future-dated records (records.py `checks`), items in another currency left out.
Pure calculation.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from app.modules.scenario_intelligence.baseline import complete_months

MODIFIED_Z_LIMIT = 3.5


def _issue(severity: str, code: str, what: str, why: str, fix: str) -> Dict[str, str]:
    return dict(severity=severity, code=code, what=what, why=why, fix=fix)


def unusual_months(series: List[tuple]) -> List[Dict[str, Any]]:
    values = [v for _ym, v in series]
    if len(values) < 6:
        return []
    srt = sorted(values)
    n = len(srt)
    median = srt[n // 2] if n % 2 else (srt[n // 2 - 1] + srt[n // 2]) / 2
    dev = sorted(abs(v - median) for v in values)
    mad = dev[n // 2] if n % 2 else (dev[n // 2 - 1] + dev[n // 2]) / 2
    if mad <= 0:
        return []
    out = []
    for (y, m), v in series:
        z = 0.6745 * (v - median) / mad
        if abs(z) > MODIFIED_Z_LIMIT:
            out.append(dict(month=f"{y:04d}-{m:02d}", value=round(v, 2), modified_z=round(z, 1)))
    return out


def check(state: Any, as_of: Optional[date], months: int) -> Dict[str, Any]:
    issues: List[Dict[str, str]] = []
    rev_series = complete_months(state.revenue_by_month, as_of) if as_of else []
    n = len(rev_series)
    has_revenue = float(state.revenue_monthly or 0) > 0 or any(v for _ym, v in rev_series)
    has_costs = ((float(state.expenses_monthly or 0) + float(state.cost_of_sales_monthly or 0) + float(state.costs_monthly or 0)) > 0
                 or any(float(v or 0) > 0 for v in (state.expenses_by_month or {}).values())
                 or any(float(v or 0) > 0 for v in (state.cost_of_sales_by_month or {}).values()))

    if as_of is not None:
        if n < 3:
            issues.append(_issue("serious", "short_history", f"Only {n} complete month{'s' if n != 1 else ''} of sales on record.",
                                 "Trend, seasonality and the usual variation cannot be measured; the projection repeats today's level.",
                                 "Record your past invoices (at least 3 months, ideally 12 or more) or connect your accounting software."))
        elif n < 12:
            issues.append(_issue("info", "limited_history", f"{n} complete months of sales on record.",
                                 "Seasonal patterns need 24 months; the trend is less certain with under 12.",
                                 "Add older invoices if you have them."))
        gaps = [f"{y:04d}-{m:02d}" for (y, m), v in rev_series if v == 0]
        if gaps and n >= 3:
            issues.append(_issue("warning", "gaps", f"No sales recorded in {', '.join(gaps[-6:])}{' and more' if len(gaps) > 6 else ''}.",
                                 "Empty months pull the average and the trend down if sales did happen but were not recorded.",
                                 "Record the missing invoices, or ignore this if there really were no sales."))
        odd = unusual_months(rev_series[-24:])
        if odd:
            issues.append(_issue("warning", "unusual_months",
                                 "Unusual months: " + ", ".join(f"{o['month']} ({o['value']:,.2f})" for o in odd) + ".",
                                 "A month far from the others (modified z-score above 3.5) can distort the level or trend.",
                                 "Check those months' invoices for duplicates or mis-dated items."))
    if has_revenue and not has_costs:
        issues.append(_issue("serious", "no_costs", "Sales are recorded but no costs.",
                             "Profit and cash will look far better than they are.",
                             "Record your expenses, or connect your accounting software."))
    if not state.starting_cash and not (state.figure_sources or {}).get("starting_cash"):
        issues.append(_issue("warning", "no_cash", "No cash balance on record.",
                             "Cash is projected from zero, so the cash line is relative, not your bank balance.",
                             "Record your bank balance, or connect your bank or accounting software."))
    c = state.record_checks or {}
    if c.get("possible_duplicate_invoices"):
        issues.append(_issue("warning", "duplicate_invoices", f"{c['possible_duplicate_invoices']} possible duplicate invoice(s): same customer, amount and date.",
                             "Duplicates overstate sales.", "Check and archive any duplicates in Financials."))
    if c.get("possible_duplicate_expenses"):
        issues.append(_issue("warning", "duplicate_expenses", f"{c['possible_duplicate_expenses']} possible duplicate expense(s).",
                             "Duplicates overstate costs.", "Check and archive any duplicates in Financials."))
    if c.get("uncategorised_expenses"):
        issues.append(_issue("info", "uncategorised", f"{c['uncategorised_expenses']} expense(s) without a category.",
                             "Direct costs and salaries are found by category; uncategorised ones are treated as running costs.",
                             "Give each expense a category."))
    if c.get("undated") or c.get("future_dated"):
        issues.append(_issue("info", "dates", f"{c.get('undated', 0)} undated and {c.get('future_dated', 0)} future-dated record(s) left out.",
                             "They cannot be placed in a month.", "Add or correct their dates."))
    if state.excluded_fx_items:
        issues.append(_issue("warning", "currency", f"{state.excluded_fx_items} item(s) in another currency left out (no exchange rate).",
                             "Those sales or costs are missing from the projection.", "Add the exchange rate or the amount in your currency."))
    if as_of is not None and 0 < n < 12 and months > 2 * n:
        issues.append(_issue("info", "long_horizon", f"Projecting {months} months from {n} months of history.",
                             "The further ahead, the less certain; the range widens with the horizon.",
                             "Use a shorter period, or treat the later months as indicative."))
    serious = sum(1 for i in issues if i["severity"] == "serious")
    return dict(issues=issues, serious=serious, warnings=sum(1 for i in issues if i["severity"] == "warning"),
                summary=("No data problems found." if not issues else
                         f"{serious} serious, {sum(1 for i in issues if i['severity'] == 'warning')} to check, "
                         f"{sum(1 for i in issues if i['severity'] == 'info')} for information."),
                method="Modified z-score (Iglewicz & Hoaglin, 1993) for unusual months; record checks from your invoices and expenses.")
