"""One source of figures for a business (R-4, the owner's brief, 24 Oct): monthly revenue, monthly costs, cash, the biggest
customer's share and overdue invoices, read the same way by the risk check, the Agent and (later) Simulation.

Recorded actuals come first (paid invoices, paid expenses); a figure the owner accepted elsewhere (B6, planned.figures: a
review, a quick check) fills what the records don't hold. Each figure carries where it came from, in words, so a result
can say "from 2 expenses recorded" or "from your review, 21 Oct". Nothing is estimated beyond these."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

WINDOW_DAYS = 92      # the last three months


def day_words(value: Any) -> str:
    """ "2026-10-22" as "22 Oct 2026"; anything else as it is."""
    try:
        d = date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return str(value or "")
    return f"{d.day} {d.strftime('%b')} {d.year}"


def _when(rec: dict) -> date | None:
    from app.modules.agent import business as bz
    return bz.parse_day(rec.get("paid_at") or rec.get("date") or rec.get("expense_date") or rec.get("issued_at") or rec.get("issue_date") or rec.get("created_at"))


def of(data: dict | None, today: date | None = None) -> dict[str, Any]:
    from app.modules.agent import business as bz
    from app.modules.agent import planned
    data = data or {}
    today = today or datetime.now(timezone.utc).date()
    since = today - timedelta(days=WINDOW_DAYS)
    fin = data.get("financials") or {}
    out: dict[str, Any] = {"revenue_monthly": None, "costs_monthly": None, "cash": None, "runway_months": None, "top_customer": None,
                           "top_share": None, "clients": 0, "invoices": 0, "overdue": None, "expenses_counted": 0, "expense_days": [], "expense_months": 0,
                           "customers": [], "sources": {}}
    try:
        conc = bz.concentration(data, 40)
        if conc["customer_count"] >= 1 and conc["total_revenue"] > 0:
            out.update({"top_customer": conc["top_customers"][0]["customer"], "top_share": float(conc["top1_share_pct"]), "clients": conc["customer_count"],
                        "customers": [{"name": c["customer"], "share": float(c["share_pct"])} for c in conc["top_customers"]]})
            out["sources"]["top_share"] = "your paid invoices"
        recent = bz.revenue_by_customer(data, since=since)
        if recent:
            out["revenue_monthly"] = round(sum(recent.values()) / 3, 2)
            out["sources"]["revenue_monthly"] = "your paid invoices in the last 3 months"
        invs = [i for i in fin.get("invoices") or [] if not i.get("archived")]
        out["invoices"] = len(invs)
        if invs:
            out["overdue"] = len(bz.overdue_invoices(data, today))
        spent = [e for e in fin.get("expenses") or [] if not e.get("archived") and bz.status_of(e) == "paid" and (_when(e) or date.min) >= since]
        if spent:
            total = sum(bz.money(e.get("price") or e.get("total_amount") or e.get("amount")) for e in spent)
            out["costs_monthly"] = round(total / 3, 2)
            out["expenses_counted"] = len(spent)
            days = sorted({_when(e) for e in spent if _when(e)})
            out["expense_days"] = [x.isoformat() for x in days]
            out["expense_months"] = len({(x.year, x.month) for x in days})
            out["sources"]["costs_monthly"] = f"{len(spent)} expense{'s' if len(spent) != 1 else ''} recorded in the last 3 months"
        cp = bz.cash_position(data, today)
        if cp.get("recorded"):
            out["cash"] = float(cp["cash"])
            out["sources"]["cash"] = "your recorded payments in and out"
    except Exception:      # noqa: BLE001 - what can't be read stays unknown
        pass
    # What the owner accepted elsewhere (B6) fills the gaps, said as such
    try:
        plan = planned.figures(data, today)
    except Exception:      # noqa: BLE001
        plan = {}
    if "cash_in_bank" in plan:
        got = plan["cash_in_bank"]
        out["cash"] = float(got["value"])      # what the owner said is in the bank beats a sum of recorded movements
        out["sources"]["cash"] = f"{str(got.get('source') or 'what you told me').rstrip('.')}{', ' + day_words(got['at']) if got.get('at') else ''}"
    if out["costs_monthly"] is None and "fixed_costs" in plan:
        out["costs_monthly"] = float(plan["fixed_costs"]["value"])
        out["sources"]["costs_monthly"] = str(plan["fixed_costs"].get("source") or "your planned fixed costs")
    # What the owner told the risk check (R-2) beats a sum of records, wherever the figures are read
    said = _said(data)
    if "cash_in_bank" in said:
        out["cash"] = said["cash_in_bank"]["value"]
        out["sources"]["cash"] = f"what you told me{', ' + day_words(said['cash_in_bank']['at']) if said['cash_in_bank']['at'] else ''}"
    if said.get("monthly_costs", {}).get("value"):
        out["costs_monthly"] = said["monthly_costs"]["value"]
        out["sources"]["costs_monthly"] = "your usual monthly costs, as you told me"
    # Spending from fewer than two months of records is too thin to judge (R-9): any runway from it is an estimate
    out["costs_estimate"] = bool(out["costs_monthly"]) and out["sources"].get("costs_monthly", "").endswith("in the last 3 months") and out["expense_months"] < 2
    if out["cash"] is not None and out["costs_monthly"]:
        out["runway_months"] = round(max(0.0, out["cash"]) / out["costs_monthly"], 1)
    return out


def _said(data: dict) -> dict[str, dict]:
    """The risk check's money answers, kept on the business: {"cash_in_bank" | "monthly_costs": {"value", "at"}}."""
    kept = (data.get("quick_check_answers") or {}).get("business_risks") or {}
    out = {}
    for key in ("cash_in_bank", "monthly_costs"):
        try:
            value = float((kept.get("answers") or {}).get(key))
        except (TypeError, ValueError):
            continue
        if value >= 0:
            out[key] = {"value": value, "at": str(kept.get("at") or "")[:10]}
    return out


def estimate_basis(f: dict) -> str:
    """What an estimated runway rests on, in words: "2 expenses on 13 Oct", "4 expenses between 2 Oct and 13 Oct"."""
    days = [day_words(x)[:-5] for x in f.get("expense_days") or []]
    on = (f"on {days[0]}" if len(set(days)) == 1 else f"between {days[0]} and {days[-1]}") if days else "so far"
    n = f.get("expenses_counted") or 0
    return f"{n} expense{'s' if n != 1 else ''} {on}"
