"""The shared monthly cash forecast (Funding PRD s5-6, Launch PRD s6).

One structure for both readiness checks. Money is decimal throughout. Blank means unknown,
never zero. Closing cash = opening cash + cash receipts + financing receipts - cash payments,
and each month opens on the previous month's close. The baseline counts only financing that
has been received, or is committed, dated and evidenced: a proposed raise appears in a funded
scenario, never in the baseline. Forecast amounts are never written to business records.
"""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation      # noqa: F401 - Decimal is used by callers as fc.Decimal
from typing import Any, Callable, Iterable

FORMULA_VERSION = "cash-forecast-0.1"
SCENARIO_VERSION = "scenario-0.1"
MONTHLY_LABEL = "This is a monthly projection. It cannot show whether every payment within a month can be made on its day."
_MONTH = re.compile(r"^(\d{4})-(\d{2})$")
CENT = Decimal("0.01")
# Evidence that can show financing is committed: a document (a signed agreement, an offer
# letter from a lender) or a business record (a bank statement). A letter of intent, research,
# an enquiry or a pilot is an indication of interest, not a commitment, so it never qualifies.
FINANCING_EVIDENCE_TYPES = ("document", "record", "other")
NO_FINANCING_EVIDENCE = "It is marked committed but has no evidence attached, so it is not counted as cash."


def no_proof(_evidence_id: str | None) -> str | None:
    return NO_FINANCING_EVIDENCE


class Invalid(ValueError):
    pass


def dec(value: Any) -> Decimal | None:
    """A decimal amount, or None when blank. Raises Invalid for anything that isn't a number."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value
    text = str(value).replace(",", "").strip()
    if text == "":
        return None
    try:
        d = Decimal(text)
    except InvalidOperation as e:
        raise Invalid(f"'{value}' is not a number.") from e
    if not d.is_finite():
        raise Invalid(f"'{value}' is not a number.")
    return d


def money_str(value: Decimal | None) -> str | None:
    return None if value is None else str(value.quantize(CENT))


def parse_month(value: Any) -> tuple[int, int] | None:
    m = _MONTH.match(str(value or "").strip()[:7])
    if not m or not 1 <= int(m.group(2)) <= 12:
        return None
    return int(m.group(1)), int(m.group(2))


def month_key(ym: tuple[int, int]) -> str:
    return f"{ym[0]:04d}-{ym[1]:02d}"


def add_months(ym: tuple[int, int], n: int) -> tuple[int, int]:
    total = ym[0] * 12 + (ym[1] - 1) + n
    return total // 12, total % 12 + 1


def month_of_date(d: date) -> tuple[int, int]:
    return d.year, d.month


def months_between(a: tuple[int, int], b: tuple[int, int]) -> int:
    return (b[0] - a[0]) * 12 + (b[1] - a[1])


def month_range(start: tuple[int, int], count: int) -> list[str]:
    return [month_key(add_months(start, i)) for i in range(max(0, count))]


def month_label(key: str | None) -> str:
    ym = parse_month(key)
    return date(ym[0], ym[1], 1).strftime("%b %Y") if ym else ""


def baseline_financing(forecast: dict, proof: Callable[[str | None], str | None]) -> tuple[dict[str, Decimal], list[dict]]:
    """Financing that counts in the baseline, by month, and the items left out with the reason.
    `proof(evidence_id)` returns None when the evidence shows the financing is committed, or the
    reason it does not. It is the only place that decision is made: the forecast editor, the
    assessment and scenarios all pass the same function (engine.financing_proof)."""
    counted: dict[str, Decimal] = {}
    excluded: list[dict] = []
    for item in forecast.get("financing_items") or []:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "proposed")
        try:
            amount = dec(item.get("amount"))
        except Invalid:
            amount = None
        ym = parse_month(item.get("month"))
        label = item.get("label") or "Financing"
        problem = proof(item.get("evidence_id")) if status == "committed" else None
        if amount is None or ym is None:
            excluded.append({"id": item.get("id"), "label": label, "reason": "It has no amount or month."})
        elif status == "received" or (status == "committed" and problem is None):
            counted[month_key(ym)] = counted.get(month_key(ym), Decimal(0)) + amount
        elif status == "committed":
            excluded.append({"id": item.get("id"), "label": label, "month": month_key(ym), "amount": money_str(amount),
                             "reason": problem})
        else:
            excluded.append({"id": item.get("id"), "label": label, "month": month_key(ym), "amount": money_str(amount),
                             "reason": "It is proposed, not committed, so it is not counted as cash."})
    return counted, excluded


def compute(forecast: dict | None, required: Iterable[str], *, proof: Callable[[str | None], str | None] = no_proof,
            extra_financing: dict[str, Decimal] | None = None) -> dict:
    """Roll the forecast forward. `required` is the list of months the check needs.

    state: "missing" (no forecast), "incomplete" (a required figure is blank: unknown),
    "invalid" (a figure is wrong: a confirmed failure) or "complete".
    """
    required = list(required)
    out: dict[str, Any] = {"state": "missing", "issues": [], "missing": [], "required": required, "months": [], "min_cash": None,
                           "first_negative_month": None, "cash_by_month": {}, "excluded_financing": [], "basis": {},
                           "formula_version": FORMULA_VERSION, "label": MONTHLY_LABEL, "currency": None, "opening_cash": None}
    if not isinstance(forecast, dict) or not (forecast.get("months") or forecast.get("opening_cash") not in (None, "")):
        out["missing"].append("A monthly cash forecast")
        return out
    out["currency"] = forecast.get("currency")
    issues, missing = out["issues"], out["missing"]

    rows: dict[str, dict] = {}
    for raw in forecast.get("months") or []:
        if not isinstance(raw, dict):
            continue
        ym = parse_month(raw.get("month"))
        if ym is None:
            issues.append(f"'{raw.get('month')}' is not a month.")
            continue
        key = month_key(ym)
        if key in rows:
            issues.append(f"{month_label(key)} appears more than once.")
            continue
        row: dict[str, Any] = {"month": key, "basis": raw.get("basis") if raw.get("basis") in ("actual", "forecast", "estimate") else "forecast"}
        for field in ("receipts", "payments"):
            try:
                value = dec(raw.get(field))
            except Invalid:
                issues.append(f"{month_label(key)}: {field} is not a number.")
                value = None
            if value is not None and value < 0:
                issues.append(f"{month_label(key)}: {field} cannot be negative.")
            row[field] = value
        rows[key] = row

    try:
        opening = dec(forecast.get("opening_cash"))
    except Invalid:
        issues.append("Opening cash is not a number.")
        opening = None
    if opening is None and "Opening cash is not a number." not in issues:
        missing.append("Opening cash")
    out["opening_cash"] = money_str(opening)

    for key in required:
        row = rows.get(key)
        if row is None:
            missing.append(f"{month_label(key)}: receipts and payments")
            continue
        for field in ("receipts", "payments"):
            if row[field] is None and not any(i.startswith(f"{month_label(key)}: {field}") for i in issues):
                missing.append(f"{month_label(key)}: {field}")

    financing, out["excluded_financing"] = baseline_financing(forecast, proof)
    for key, amount in (extra_financing or {}).items():
        financing[key] = financing.get(key, Decimal(0)) + amount

    if issues:
        out["state"] = "invalid"
        return out
    if missing:
        out["state"] = "incomplete"
        return out

    # Complete: roll forward from the first month that has figures, through the last required one.
    ordered = sorted(rows)
    start = parse_month(ordered[0])
    last = max(parse_month(required[-1]) if required else start, parse_month(ordered[-1]))
    cash = opening
    result = []
    for key in month_range(start, months_between(start, last) + 1):
        row = rows.get(key)
        if row is None or row["receipts"] is None or row["payments"] is None:
            break      # a gap after the required months: stop the roll there
        fin = financing.get(key, Decimal(0))
        closing = cash + row["receipts"] + fin - row["payments"]
        result.append({"month": key, "opening": money_str(cash), "receipts": money_str(row["receipts"]), "financing": money_str(fin),
                       "payments": money_str(row["payments"]), "closing": money_str(closing), "basis": row["basis"]})
        out["cash_by_month"][key] = closing
        out["basis"][row["basis"]] = out["basis"].get(row["basis"], 0) + 1
        cash = closing
    covered = [k for k in required if k in out["cash_by_month"]]
    if len(covered) != len(required):
        out["state"] = "incomplete"
        out["missing"].append("A month between the start of the forecast and the months it must cover")
        return out
    out["months"] = result
    out["state"] = "complete"
    if covered:
        low = min(covered, key=lambda k: (out["cash_by_month"][k], k))
        out["min_cash"] = {"amount": money_str(out["cash_by_month"][low]), "month": low}
        out["first_negative_month"] = next((k for k in covered if out["cash_by_month"][k] < 0), None)
    return out


def public(result: dict) -> dict:
    """The computed forecast without its working values (Decimals are not JSON)."""
    return {k: v for k, v in result.items() if k != "cash_by_month"}


def funded(forecast: dict | None, required: list[str], amount: Decimal | None, receipt_month: str | None, *,
           proof: Callable[[str | None], str | None] = no_proof) -> dict | None:
    """The forecast with the proposed raise added in its assumed month. None when it can't be worked out."""
    if amount is None or not receipt_month:
        return None
    return compute(forecast, required, proof=proof, extra_financing={receipt_month: amount})


def scenario_forecast(forecast: dict, change: dict, launch_month: str | None = None) -> tuple[dict, list[str]]:
    """A copy of the forecast with one supported change applied, and the changes in words.
    The stored forecast is not touched."""
    import copy
    f = copy.deepcopy(forecast or {})
    kind = change.get("kind")
    notes: list[str] = []
    from_key = launch_month or (sorted(m.get("month") for m in f.get("months") or [] if m.get("month")) or [None])[0]

    def scale(field: str, factor: Decimal, label: str) -> None:
        for m in f.get("months") or []:
            if from_key and str(m.get("month")) >= from_key:
                try:
                    v = dec(m.get(field))
                except Invalid:
                    v = None
                if v is not None:
                    m[field] = money_str(v * factor)
        notes.append(label)

    pct = dec(change.get("percent")) or Decimal(0)
    if kind == "lower_demand":
        if not 0 < pct <= 100:
            raise Invalid("Choose a fall in demand between 1 and 100 percent.")
        scale("receipts", (Decimal(100) - pct) / Decimal(100), f"Receipts from {month_label(from_key)} are {pct.normalize():f}% lower.")
    elif kind == "higher_costs":
        if not 0 < pct <= 500:
            raise Invalid("Choose a cost rise between 1 and 500 percent.")
        scale("payments", (Decimal(100) + pct) / Decimal(100), f"Payments from {month_label(from_key)} are {pct.normalize():f}% higher.")
    elif kind == "launch_delay":
        n = int(change.get("months") or 0)
        if not 1 <= n <= 12:
            raise Invalid("Choose a delay between 1 and 12 months.")
        if not from_key:
            raise Invalid("Set a launch date before testing a delay.")
        months = sorted((m for m in f.get("months") or [] if m.get("month")), key=lambda m: m["month"])
        before = [m for m in months if m["month"] < from_key]
        level = before[-1].get("receipts") if before else "0"
        after = [m for m in months if m["month"] >= from_key]
        original = [m.get("receipts") for m in after]
        for i, m in enumerate(after):
            m["receipts"] = level if i < n else original[i - n]
        notes.append(f"Launch moves {n} month{'s' if n != 1 else ''} later: receipts from {month_label(from_key)} start {n} month{'s' if n != 1 else ''} later, payments are unchanged.")
    else:
        raise Invalid("That scenario isn't supported.")
    return f, notes
