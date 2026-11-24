"""Shadow model, Phase 5 (model 1.4): the further factors, rebuilt from MODEL.md sections 5.1, 5.3, 5.4a and 5.5 ONLY.
Imports nothing from the application. Projection without a date (months 1..N, figures flat), as shadow_model.project.
"""
from __future__ import annotations

import math


def employer_costs(country, gross, pension_pct=None):
    """MODEL.md 5.4a, per person per month."""
    c = (country or "").strip().upper()
    c = {"UNITED KINGDOM": "GB", "UK": "GB", "NIGERIA": "NG", "UNITED STATES": "US", "USA": "US"}.get(c, c)
    pen = None if pension_pct is None else pension_pct / 100
    if c == "GB":
        ni = 0.15 * max(0.0, gross - 5000 / 12)
        pension = pen * gross if pen is not None else 0.03 * max(0.0, min(gross, 50270 / 12) - 6240 / 12)
        return ni + pension
    if c == "NG":
        return (pen if pen is not None else 0.10) * gross + 0.02 * gross
    if c == "US":
        return 0.0765 * gross + 0.006 * min(12 * gross, 7000) / 12 + (pen or 0) * gross
    return 0.15 * gross + (pen or 0) * gross


def uk_tax(profit):
    p = max(0.0, profit)
    if p <= 50000:
        return 0.19 * p
    if p >= 250000:
        return 0.25 * p
    return 0.25 * p - 0.015 * (250000 - p)


def project(s: dict, months: int) -> dict:
    """The business as it is (no scenario), with every 1.4 factor. Terms 0 (paid in the month) keep this independent of
    the collection-timing rules already replicated in shadow_model.py."""
    R, C, E = s["revenue_monthly"], s["cost_of_sales_monthly"], s["expenses_monthly"]
    bad = (s.get("bad_debt_pct") or 0) / 100
    payroll = 0.0
    if s.get("payroll_staff_count") and s.get("payroll_gross_monthly_per_person") and s.get("payroll_in_recorded_expenses") is not True:
        g = s["payroll_gross_monthly_per_person"]
        payroll = s["payroll_staff_count"] * (g + employer_costs(s.get("tax_country"), g, s.get("employer_pension_pct")))
    rate = (s.get("profit_tax_rate_pct") or 0) / 100
    uk = s.get("profit_tax_regime") == "uk_corporation_tax"
    losses = s.get("tax_losses_brought_forward") or 0.0
    cash, assets, rec = s["starting_cash"], 0.0, 0.0
    cum_pbt = provision = profit_total = 0.0
    owner_in = owner_out = 0.0
    for m in range(1, months + 1):
        equity = sum(e["amount"] for e in s.get("funding_events", []) if e["month"] == m and e["type"] in ("equity", "owner_capital"))
        grant = sum(e["amount"] for e in s.get("funding_events", []) if e["month"] == m and e["type"] == "grant")
        buy = sum(c["amount"] for c in s.get("capital_purchases", []) if c["month"] == m)
        dep = sum(c["amount"] / c["life_months"] for c in s.get("capital_purchases", []) if c["month"] <= m < c["month"] + c["life_months"])
        out = (s.get("owner_drawings_monthly") or 0) + sum(d["amount"] for d in s.get("dividends", []) if d["month"] == m)
        bd = R * bad
        pbt = R + grant - C - (E + payroll) - dep - bd
        cum_pbt += pbt
        taxable = max(0.0, cum_pbt - losses)
        if uk:
            new = 0.0 if taxable <= 0 else uk_tax(taxable * 12 / m) / (taxable * 12 / m) * taxable
        else:
            new = rate * taxable
        tax = new - provision
        provision = new
        profit_total += pbt - tax
        cash += (R - bd) + grant + equity - C - (E + payroll) - buy - out      # terms 0: collected in the month; tax not paid
        assets += buy - dep
        owner_in += equity
        owner_out += out
    return dict(closing_cash=cash, cumulative_profit=profit_total, closing_fixed_assets=assets, closing_tax_owed=provision,
                total_owner_in=owner_in, total_owner_out=owner_out)
