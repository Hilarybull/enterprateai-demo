"""Country rules for the projection: employer payroll costs and corporation tax. Simulation audit, Phase 5 (model
projection-1.4). Pure calculation.

Every rate here is a published figure with its source and the tax year it applies to (RATES_AS_OF). They change, so they
are reviewed every year (MODEL.md, section 6) and the owner can always override them (employer on-costs on a hire,
pension %, the tax rate). Where a country is not covered, the documented standard figure is used and labelled.

Simplifications, stated so they are not mistaken for full payroll or tax calculations:
* Employer costs are worked out per person from one average monthly gross pay; employment allowances, apprenticeship
  levy, US state unemployment insurance and wage caps above the average are not applied.
* UK corporation tax uses the small profits / main rate bands and marginal relief on the projected annual profit, for a
  company with no associated companies. Other countries use the flat rate the owner enters.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

RATES_AS_OF = "2025/26 tax year"

COUNTRY_ALIASES = {
    "GB": "GB", "UK": "GB", "UNITED KINGDOM": "GB", "GREAT BRITAIN": "GB", "ENGLAND": "GB", "SCOTLAND": "GB", "WALES": "GB",
    "NORTHERN IRELAND": "GB",
    "NG": "NG", "NIGERIA": "NG",
    "US": "US", "USA": "US", "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US",
}

# ── Employer payroll costs ───────────────────────────────────────────────────────────────────────────────────────────
# UK: employer Class 1 National Insurance 15% above the secondary threshold of £5,000 a year (HMRC, from 6 April 2025);
#     auto-enrolment minimum employer pension contribution 3% of qualifying earnings between £6,240 and £50,270 a year
#     (The Pensions Regulator, 2025/26).
UK_NI_RATE, UK_NI_THRESHOLD_YEAR = 0.15, 5000.0
UK_PENSION_RATE, UK_QE_LOWER_YEAR, UK_QE_UPPER_YEAR = 0.03, 6240.0, 50270.0
# Nigeria: employer pension contribution at least 10% of monthly emoluments (Pension Reform Act 2014, s.4; PenCom);
#     Employees' Compensation Act 2010 contribution 1% of payroll (NSITF); Industrial Training Fund 1% of payroll (ITF Act,
#     employers with 5+ staff or turnover of N50m+).
NG_PENSION_RATE, NG_NSITF_RATE, NG_ITF_RATE = 0.10, 0.01, 0.01
# US: employer FICA 6.2% Social Security + 1.45% Medicare (IRS); FUTA 0.6% net rate on the first $7,000 a year of each
#     employee's pay (IRS, with the standard state credit). State unemployment insurance varies by state: not included.
US_FICA_RATE, US_FUTA_RATE, US_FUTA_WAGE_BASE_YEAR = 0.0765, 0.006, 7000.0
DEFAULT_ONCOST_RATE = 0.15      # the documented standard figure (MODEL.md section 6) for other countries


def country_code(value: Any) -> Optional[str]:
    if not value:
        return None
    return COUNTRY_ALIASES.get(str(value).strip().upper())


def employer_cost_per_person(country: Optional[str], gross_monthly: float, pension_pct: Optional[float] = None) -> Dict[str, Any]:
    """Employer costs on top of one person's monthly gross pay: {ni_or_tax, pension, other, total, rate, basis}."""
    g = max(0.0, float(gross_monthly or 0.0))
    c = country_code(country)
    pension_override = None if pension_pct is None else max(0.0, float(pension_pct)) / 100.0
    if c == "GB":
        ni = UK_NI_RATE * max(0.0, g - UK_NI_THRESHOLD_YEAR / 12.0)
        qualifying = max(0.0, min(g, UK_QE_UPPER_YEAR / 12.0) - UK_QE_LOWER_YEAR / 12.0)
        pension = (pension_override * g) if pension_override is not None else UK_PENSION_RATE * qualifying
        other, basis = 0.0, f"UK employer National Insurance 15% above £5,000 a year; pension {'as entered' if pension_override is not None else '3% of qualifying earnings'} ({RATES_AS_OF})"
    elif c == "NG":
        ni = 0.0
        pension = (pension_override if pension_override is not None else NG_PENSION_RATE) * g
        other = (NG_NSITF_RATE + NG_ITF_RATE) * g
        basis = f"Nigeria: employer pension {'as entered' if pension_override is not None else '10%'} (Pension Reform Act 2014), NSITF 1%, ITF 1% ({RATES_AS_OF})"
    elif c == "US":
        ni = US_FICA_RATE * g
        pension = (pension_override or 0.0) * g
        other = US_FUTA_RATE * min(g * 12.0, US_FUTA_WAGE_BASE_YEAR) / 12.0
        basis = f"US employer FICA 7.65% and FUTA 0.6% on the first $7,000 a year; state unemployment insurance not included ({RATES_AS_OF})"
    else:
        total = DEFAULT_ONCOST_RATE * g + ((pension_override or 0.0) * g)
        return dict(ni_or_tax=0.0, pension=round((pension_override or 0.0) * g, 2), other=round(DEFAULT_ONCOST_RATE * g, 2),
                    total=round(total, 2), rate=(total / g if g else DEFAULT_ONCOST_RATE),
                    basis="standard figure: 15% on-costs (country not covered)" + ("; pension as entered" if pension_override else ""))
    total = ni + pension + other
    return dict(ni_or_tax=round(ni, 2), pension=round(pension, 2), other=round(other, 2), total=round(total, 2),
                rate=(total / g if g else 0.0), basis=basis)


# ── Corporation tax ──────────────────────────────────────────────────────────────────────────────────────────────────
# UK (HMRC, from 1 April 2023): 19% small profits rate up to £50,000; 25% main rate above £250,000; between them the main
# rate less marginal relief = 3/200 x (£250,000 - profit). Limits are for a 12-month period with no associated companies.
UK_SMALL_RATE, UK_MAIN_RATE, UK_LOWER, UK_UPPER, UK_MR_FRACTION = 0.19, 0.25, 50000.0, 250000.0, 3.0 / 200.0


def uk_corporation_tax(annual_profit: float) -> float:
    """Corporation tax on a 12-month taxable profit (UK, no associated companies)."""
    p = max(0.0, float(annual_profit or 0.0))
    if p <= UK_LOWER:
        return UK_SMALL_RATE * p
    if p >= UK_UPPER:
        return UK_MAIN_RATE * p
    return UK_MAIN_RATE * p - UK_MR_FRACTION * (UK_UPPER - p)


def tax_on_cumulative(regime: Optional[str], flat_rate: float, cumulative_taxable: float, months_elapsed: float) -> Tuple[float, float]:
    """(tax provision to date, effective rate) on the taxable profit accumulated over `months_elapsed` months.
    UK: the bands are applied to the profit scaled to a year, and the resulting effective rate to the profit to date."""
    taxable = max(0.0, cumulative_taxable)
    if regime == "uk_corporation_tax":
        if taxable <= 0 or months_elapsed <= 0:
            return 0.0, 0.0
        annual = taxable * 12.0 / months_elapsed
        rate = uk_corporation_tax(annual) / annual
        return rate * taxable, rate
    return flat_rate * taxable, flat_rate


# ── Expense categories ───────────────────────────────────────────────────────────────────────────────────────────────
# Direct costs vary with what is sold (cost of sales); payroll lines show salaries are already in the recorded expenses.
# The same words are used by the page (frontend/src/lib/financialIntelligence.js) so the history and the level agree.
import re as _re

DIRECT_COST_RX = _re.compile(r"subcontract|contractor|freelanc|material|\bstock\b|inventory|cost of (goods|sales)|\bcogs\b|"
                             r"raw |parts\b|components?\b|packaging|merchandise|wholesale|resale|purchases? for", _re.I)
PAYROLL_RX = _re.compile(r"salar|wage|payroll|\bpaye\b|national insurance|\bnic?s?\b|pension|staff cost", _re.I)


def expense_kind(expense: Dict[str, Any]) -> str:
    """"direct", "payroll" or "other", from an expense's category and description."""
    if expense.get("expense_type") == "staff_payments":
        return "payroll"
    if expense.get("expense_type") == "cost_of_sales" or expense.get("category") == "cost_of_sales":
        return "direct"
    text = f"{expense.get('category') or ''} {expense.get('description') or ''}"
    if PAYROLL_RX.search(text):
        return "payroll"
    if DIRECT_COST_RX.search(text):
        return "direct"
    return "other"


def classify_expenses(expenses: list) -> Dict[str, float]:
    """Totals by kind for a list of expense records: {direct, payroll, other, total}."""
    out = {"direct": 0.0, "payroll": 0.0, "other": 0.0}
    for e in expenses or []:
        if not isinstance(e, dict):
            continue
        try:
            amount = float(e.get("price") or e.get("amount") or e.get("total_amount") or 0)
        except (TypeError, ValueError):
            continue
        out[expense_kind(e)] += max(0.0, amount)
    out["total"] = sum(out.values())
    return out
