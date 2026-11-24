"""How every figure was calculated, in plain words with the numbers used. Simulation audit, Phase 6 (model 1.5).

Built from the projection's own baseline, rows and monthly detail, so the explanation always matches the figures. Each
method is named with the standard it follows (METHODS); MODEL.md holds the full specification.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from app.modules.scenario_intelligence.baseline import TREND_DAMPING, add_months, damped_steps


def _m(v: Any) -> str:
    try:
        return f"{float(v):,.2f}"
    except (TypeError, ValueError):
        return "0.00"


METHODS: List[Dict[str, str]] = [
    dict(name="Your normal month (starting level)",
         what="The average of your last three complete months; the month in progress is left out because it is unfinished. "
              "Where EnterprateAI already shows a monthly figure on the dashboard, that figure is used, unless it is outside the "
              "usual variation of your complete months.",
         standard="Financial modelling practice: inputs from a stated, reliable period (FAST Standard; ICAEW Financial Modelling Code)"),
    dict(name="Growth or decline (trend)",
         what="A straight line fitted through your last 12 complete months (least squares). It is used only if it is "
              "statistically clear: the t-statistic must be at least 2, about 95% confidence. Growth is then carried forward "
              "'damped': each month adds 0.9 times the previous month's growth, so a run of growth is not assumed to last for ever.",
         standard="Ordinary least squares with a t-test; damped trend (Gardner & McKenzie, 1985)"),
    dict(name="Seasonal pattern",
         what="Only with two years of history, and only if the differences between calendar months are larger than chance "
              "would produce (F-test, 1% level). Each calendar month then gets an index: 1.10 means 10% above an average month.",
         standard="F-test for stable seasonality and ratio-to-moving-average indices (US Census Bureau X-11 / X-13ARIMA-SEATS)"),
    dict(name="When you are paid",
         what="Sales are collected after your customers' actual payment time (days sales outstanding, from your paid invoices). "
              "Money already owed is collected when due.",
         standard="Direct-method cash flow (IAS 7); days sales outstanding"),
    dict(name="Accounting checks",
         what="Every month: cash = last month's cash + money in - money out; money owed to you = last month's + sales - "
              "collected; and what you own less what you owe changes by exactly the profit plus money owners put in, less what "
              "they take out. All three must hold or the run says so.",
         standard="Integrated three-statement modelling with built-in checks (FAST Standard; ICAEW Financial Modelling Code)"),
    dict(name="Tax, VAT, loans, payroll, equipment",
         what="Tax on profit is set aside as profit is made (UK bands with marginal relief if chosen); VAT is collected with "
              "payments and paid over after each VAT period; loans follow their repayment schedule; employer National Insurance "
              "and pension follow your country's rules; equipment is depreciated evenly over its life.",
         standard="HMRC and country rules for 2025/26; IAS 16 (equipment); IAS 20 (grants)"),
    dict(name="Low / base / high range",
         what="Revenue and costs moved by a 90% forecast range from your own history (month-to-month variation, and how sure "
              "the starting level and trend are), with payment timing and the scenario's own estimates moved too.",
         standard="Forecast intervals from residual variation, calibrated and tested on separate data (07-phase4-changes.md)"),
    dict(name="Verdict",
         what="The change against doing nothing over the same months. A difference counts only if it is more than 1% of your "
              "revenue over the period. Cash is compared after loans, tax and VAT still owed.",
         standard="Scenario analysis against a do-nothing baseline (model risk management practice, SR 11-7)"),
]


def _series_text(name: str, b: Dict[str, Any]) -> str:
    months = b.get("months_used")
    level = f"{_m(b.get('level'))} a month"
    src = str(b.get("source") or "")
    text = f"{name}: {level}, {src}"
    if months:
        text += f" ({', '.join(months)})"
    if b.get("trend_applied"):
        text += (f". Trend {_m(b.get('trend_per_month'))} a month (t = {b.get('trend_t_stat')}, statistically clear), "
                 f"carried forward damped at {TREND_DAMPING}")
    elif b.get("trend_t_stat") is not None:
        text += f". No trend applied (t = {b.get('trend_t_stat')}, below 2: not statistically clear)"
    t = b.get("seasonality_test")
    if b.get("seasonality_applied") and t:
        text += f". Seasonal pattern applied (F = {t.get('f_stat')}, p = {t.get('p_value')})"
    elif t:
        text += f". No seasonal pattern (F = {t.get('f_stat')}, p = {t.get('p_value')}: could be chance)"
    return text + "."


def explain(state: Any, baseline: Dict[str, Any], rows: List[Dict[str, Any]], detail: List[Dict[str, Any]],
            summary: Dict[str, Any], as_of: Optional[date], scenario_type: str) -> Dict[str, Any]:
    starting = [_series_text("Revenue", baseline.get("revenue") or {}),
                _series_text("Cost of sales", baseline.get("cost_of_sales") or {}),
                _series_text("Running costs", baseline.get("expenses") or {})]
    for note in getattr(state, "figure_notes", None) or []:
        starting.append(note)
    terms = state.payment_terms_days
    sources = getattr(state, "figure_sources", None) or {}
    starting.append(f"Payment time: {terms if terms is not None else 30} days"
                    + (f", {sources['payment_terms_days']}." if sources.get("payment_terms_days")
                       else ("." if terms is not None else " (assumed: none on record).")))

    rev = baseline.get("revenue") or {}
    by_detail = {d["month_index"]: d for d in detail or []}
    months: List[Dict[str, Any]] = []
    prev_cash = summary.get("cash_at_period_0_end")
    if prev_cash is None:
        prev_cash = (summary.get("stub") or {}).get("closing_cash", summary.get("opening_cash"))
    for r in rows:
        m = r["month_index"]
        d = by_detail.get(m, {})
        label = None
        if as_of:
            y, mo = add_months(as_of.year, as_of.month, m)
            label = date(y, mo, 1).strftime("%b %Y")
        steps = damped_steps(m + 2)
        base_rev = float(rev.get("level") or 0) + float(rev.get("trend_per_month") or 0) * steps
        rev_text = f"{_m(rev.get('level'))}" if rev.get("trend_applied") else f"normal month {_m(rev.get('level'))}"
        if rev.get("trend_applied"):
            rev_text += f" + trend {_m(rev.get('trend_per_month'))} x {steps:.2f} damped months = {_m(base_rev)}"
            rev_text = "normal month " + rev_text
        if rev.get("seasonality_applied") and as_of and rev.get("seasonal_indices"):
            idx = (rev["seasonal_indices"].get(mo) or rev["seasonal_indices"].get(str(mo)) or 1.0)
            rev_text += f", x seasonal index {float(idx):.3f}"
        if scenario_type != "do_nothing_projection":
            rev_text += "; then the scenario's change"
        if not (rev.get("trend_applied") and abs(base_rev - float(r["revenue"])) < 0.01):
            rev_text += f" = revenue {_m(r['revenue'])}"
        if r.get("other_income"):
            rev_text += f"; plus other income (grant) {_m(r['other_income'])}"
        payroll = float(d.get("payroll") or 0)
        running = float(d.get("operating_expenses") or 0) - payroll
        parts = [f"running costs {_m(running)}"]
        for k, name in (("payroll", "payroll"), ("depreciation", "depreciation"), ("bad_debts", "sales not collected"),
                        ("interest", "interest"), ("tax_set_aside", "tax set aside")):
            if float(d.get(k) or 0):
                parts.append(f"{name} {_m(d.get(k))}")
        cost_text = f"cost of sales {_m(r['cost_of_sales'])} + {' + '.join(parts)} = total costs {_m(r['costs'])}; "
        other = float(r.get("other_income") or 0)
        cost_text += (f"profit = revenue {_m(r['revenue'])} + other income {_m(other)} - costs = {_m(r['profit'])}" if other
                      else f"profit = revenue {_m(r['revenue'])} - costs = {_m(r['profit'])}")
        ins_items = [("collected from customers", float(d.get("collected_from_customers") or 0))]
        for k, name in (("loan_received", "loan received"), ("funding_received", "investment / owner capital"), ("grants", "grant")):
            if float(d.get(k) or 0):
                ins_items.append((name, float(d.get(k))))
        named_outs = []
        for k, name in (("bills_paid", "bills already owed"), ("loan_repaid", "loan repaid"), ("tax_paid", "tax paid"),
                        ("vat_paid", "VAT paid"), ("equipment_bought", "equipment"), ("owner_drawings_and_dividends", "drawings / dividends")):
            if float(d.get(k) or 0):
                named_outs.append((name, float(d.get(k))))
        # what was paid for costs this month (cost of sales, running costs, payroll, interest, VAT on costs), so the line adds up
        costs_paid = float(prev_cash) + sum(v for _n, v in ins_items) - sum(v for _n, v in named_outs) - float(r["cash_balance"])
        outs = [("costs paid", costs_paid)] + named_outs
        cash_text = (f"{_m(prev_cash)} + " + " + ".join(f"{n} {_m(v)}" for n, v in ins_items)
                     + " - " + " - ".join(f"{n} {_m(v)}" for n, v in outs) + f" = cash {_m(r['cash_balance'])}")
        months.append(dict(month_index=m, label=label, revenue=rev_text, costs=cost_text, cash=cash_text))
        prev_cash = r["cash_balance"]
    return dict(starting_point=starting, months=months, methods=METHODS)
