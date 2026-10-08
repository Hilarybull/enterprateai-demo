"""Deterministic readiness assessment (Blueprint s5, AD-04; Funding PRD s7-8; Launch PRD s7-8).

Pure functions of an input snapshot, a profile and a date: the same snapshot and ruleset always
give the same result. No language model is involved anywhere in this module.

Each criterion has two checks, each passed, failed or unknown. Both passed scores 100, one of
each 50, both failed 0; any unknown check makes the criterion unknown. Gates (funding) and
blockers (launch) are evaluated separately and override any aggregate score. Blank inputs are
unknown, never zero, and never filled in.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date
from decimal import Decimal
from typing import Any

from app.modules.readiness import forecast as fc
from app.modules.readiness import rules

ENGINE_VERSION = "readiness-engine-0.1"
PASSED, FAILED, UNKNOWN = "passed", "failed", "unknown"


# ── small helpers ─────────────────────────────────────────────────────────────

def blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "") or (isinstance(v, (list, dict)) and not v)


def parse_day(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def get(data: dict, path: str) -> Any:
    cur: Any = data
    for part in path.split("."):
        cur = cur.get(part) if isinstance(cur, dict) else None
    return cur


def fingerprint(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()[:24]


def _res(state: str, reason: str = "", **extra: Any) -> dict:
    return {"state": state, "reason": reason, **extra}


def documented(pairs: list[tuple[str, Any]]) -> dict:
    """All blank: unknown. All filled: passed. Some filled: failed, naming what is missing."""
    empty = [label for label, value in pairs if blank(value)]
    if not empty:
        return _res(PASSED)
    if len(empty) == len(pairs):
        return _res(UNKNOWN, "Not filled in yet: " + ", ".join(empty) + ".", missing=empty)
    return _res(FAILED, "Still missing: " + ", ".join(empty) + ".", missing=empty)


def _amount(value: Any) -> tuple[Decimal | None, bool]:
    """(amount, invalid)."""
    try:
        return fc.dec(value), False
    except fc.Invalid:
        return None, True


def _num(value: Decimal) -> str:
    """A quantity as plain digits: 30, not 3E+1."""
    return f"{value.normalize():f}"


def _items(value: Any) -> list[dict]:
    return [x for x in value or [] if isinstance(x, dict)]


def _yes(value: Any) -> bool | None:
    if value in (True, "yes", "true"):
        return True
    if value in (False, "no", "false"):
        return False
    return None


# ── evidence and attestation ──────────────────────────────────────────────────

def evidence_freshness(item: dict, today: date, days: int) -> dict:
    """current | stale | expired, with the reason. An explicit expiry date takes precedence;
    a recorded reviewer exception keeps an old item current. Reconfirming never changes the
    item's original date."""
    expires = parse_day(item.get("expires_on"))
    if expires:
        return ({"state": "expired", "reason": f"It expired on {expires.strftime('%d %b %Y').lstrip('0')}."} if expires < today
                else {"state": "current", "reason": ""})
    if isinstance(item.get("freshness_exception"), dict) and item["freshness_exception"].get("rationale"):
        return {"state": "current", "reason": "Kept current by a recorded reviewer exception."}
    last = max([d for d in (parse_day(item.get("effective_date")), parse_day(item.get("reviewed_at"))) if d], default=None)
    if last is None:
        return {"state": "stale", "reason": "It has no date."}
    if (today - last).days > days:
        return {"state": "stale", "reason": f"It was last reviewed more than {days} days ago."}
    return {"state": "current", "reason": ""}


def financing_proof(evidence: list[dict] | None, today: date, days: int):
    """The single rule for whether committed financing counts as cash. Returns a function
    giving None when its evidence qualifies, or the reason it does not. Qualifying evidence is
    attached, current, and a document or business record (fc.FINANCING_EVIDENCE_TYPES): an
    indication of interest such as a letter of intent is not a commitment."""
    by_id = {e["id"]: e for e in evidence or []}

    def proof(evidence_id: str | None) -> str | None:
        item = by_id.get(evidence_id) if evidence_id else None
        if item is None:
            return fc.NO_FINANCING_EVIDENCE
        if item.get("type") not in fc.FINANCING_EVIDENCE_TYPES:
            kind = rules.EVIDENCE_TYPES.get(item.get("type"), "This evidence").lower()
            return (f"Its evidence is a {kind}, which shows interest rather than a commitment. Only a document or business record, "
                    "such as a signed agreement, shows committed financing, so it is not counted as cash.")
        if evidence_freshness(item, today, days)["state"] != "current":
            return "Its evidence is out of date, so it is not counted as cash."
        return None
    return proof


def linked(snapshot: dict, check: str) -> list[dict]:
    sid = snapshot["subject"].get("id")
    return [e for e in snapshot.get("evidence") or []
            if any(l.get("subject_id") == sid and l.get("check") == check for l in e.get("links") or [])]


def attestation_inputs(subject_type: str, code: str, snapshot: dict) -> Any:
    """What a reviewer's confirmation is about. If these change, the confirmation no longer holds."""
    s = snapshot["subject"]
    if subject_type == rules.FUNDING:
        if code == "C4.B":
            return {"evidence": sorted((e["id"], e.get("version") or 1) for e in linked(snapshot, "C4.A")), "segment": get(s, "market.target_segment")}
        if code == "C5.B":
            return {k: str(get(s, f"economics.{k}") or "") for k in ("price", "direct_cost", "fixed_costs_monthly")}
    else:
        if code == "C1.B":
            return {"evidence": sorted((e["id"], e.get("version") or 1) for e in linked(snapshot, "C1.A")),
                    "segment": get(s, "customers.target_segment"), "problem": get(s, "customers.problem")}
        if code == "C2.B":
            return {k: str(get(s, f"economics.{k}") or "") for k in ("price_per_unit", "variable_cost_per_unit", "fixed_costs_monthly")}
        if code == "C6.A":
            return {"none": bool(s.get("no_prerequisites")),
                    "items": [(p.get("id"), p.get("name"), str(p.get("applicable")), p.get("rationale"), bool(p.get("critical")))
                              for p in _items(s.get("prerequisites"))]}
    return {}


def is_independent(attestation: dict, subject: dict) -> bool:
    """An independent review is one by someone who neither created nor edited the subject.
    Applied whenever an attestation is read, so records saved before this rule follow it too."""
    preparers = {subject.get("created_by"), *(subject.get("editors") or [])} - {None}
    return bool(attestation.get("independent")) and attestation.get("actor_id") not in preparers


def attested(subject_type: str, code: str, snapshot: dict, today: date, days: int) -> dict:
    """A qualitative check: passes only on an authorised person's explicit confirmation with a rationale."""
    a = (snapshot["subject"].get("attestations") or {}).get(code)
    if not isinstance(a, dict):
        return _res(UNKNOWN, "No reviewer has confirmed this yet.")
    independent = is_independent(a, snapshot["subject"])
    info = {"attestation": {"by": a.get("actor_name") or a.get("actor_id"), "at": a.get("at"), "independent": independent,
                            "rationale": a.get("rationale")}}
    if a.get("fingerprint") != fingerprint(attestation_inputs(subject_type, code, snapshot)):
        return _res(UNKNOWN, "What this review covered has changed since it was confirmed. It needs reviewing again.", stale=True, **info)
    at = parse_day(a.get("at"))
    if at is None or (today - at).days > days:
        return _res(UNKNOWN, f"This review is more than {days} days old. It needs confirming again.", stale=True, **info)
    if a.get("passed") is True:
        return _res(PASSED, "Confirmed by an independent reviewer." if independent else "Self-attested.", **info)
    return _res(FAILED, "A reviewer recorded that this is not in place.", **info)


def _both(*results: dict) -> dict:
    """A check made of several parts: any failed part fails it, otherwise any unknown part leaves it unknown."""
    for state in (FAILED, UNKNOWN):
        hit = [r for r in results if r["state"] == state]
        if hit:
            merged = dict(hit[0])
            merged["reason"] = " ".join(r["reason"] for r in hit if r.get("reason"))
            for r in results:
                if r.get("attestation"):
                    merged["attestation"] = r["attestation"]
            return merged
    merged = dict(results[-1])
    merged["reason"] = " ".join(dict.fromkeys(r["reason"] for r in results if r.get("reason")))
    return merged


# ── scoring and classification (shared by both profiles) ──────────────────────

def score_criterion(checks: list[dict]) -> tuple[str, int | None]:
    states = [c["state"] for c in checks]
    if UNKNOWN in states:
        return "unknown", None
    passed = states.count(PASSED)
    return ("met", 100) if passed == 2 else ("partially_met", 50) if passed == 1 else ("unmet", 0)


def display_score(score: float | Decimal | None) -> int | float | None:
    """The score as shown: a whole number, or one decimal place when it isn't whole. Scores
    move in halves, so this is exact, and 59.5 can never appear as "60" beside "Not ready"."""
    if score is None:
        return None
    d = Decimal(str(score)).quantize(Decimal("0.1"), rounding="ROUND_HALF_UP")
    return int(d) if d == d.to_integral_value() else float(d)


def classify(profile: dict, criteria: list[dict], gates: list[dict]) -> dict:
    """Order matters: a confirmed failed gate gives not_ready even when other evidence is
    unknown; otherwise anything unknown gives insufficient_evidence; otherwise the score decides.
    Thresholds are evaluated on the unrounded score. The display shows that same score."""
    known = [c for c in criteria if c["score"] is not None]
    coverage = sum(c["weight"] for c in known)
    all_known = len(known) == len(criteria)
    gates_known = all(g["state"] != UNKNOWN for g in gates)
    known_points = sum(Decimal(c["score"]) * c["weight"] / Decimal(100) for c in known)
    score = known_points if all_known and (gates_known or not profile["score_needs_gates"]) else None
    t = profile["thresholds"]
    if any(g["state"] == FAILED for g in gates):
        classification = "not_ready"
    elif not all_known or not gates_known:
        classification = "insufficient_evidence"
    elif score < t["conditionally_ready"]:
        classification = "not_ready"
    elif score < t["ready"]:
        classification = "conditionally_ready"
    else:
        classification = "ready"
    return {
        "score": float(score) if score is not None else None,
        "score_display": display_score(score),
        "known_points": float(known_points), "coverage": coverage,
        "gate_completeness": round(100 * sum(1 for g in gates if g["state"] != UNKNOWN) / len(gates)) if gates else 100,
        "classification": classification, "headline": profile["wording"][classification],
        "blocker_count": sum(1 for g in gates if g["state"] == FAILED),
    }


def _assemble(profile: dict, subject_type: str, results: dict[str, dict], gate_results: dict[str, dict], extras: dict) -> dict:
    criteria = []
    for c in profile["criteria"]:
        checks = [{"code": ch["code"], "label": ch["label"], "kind": ch["kind"], "how_to": ch["missing"], **results[ch["code"]]} for ch in c["checks"]]
        state, score = score_criterion(checks)
        criteria.append({"code": c["code"], "title": c["title"], "weight": c["weight"], "state": state, "score": score, "applicable": True,
                         "section": c["section"], "tool": c["tool"], "checks": checks})
    gates = [{"code": g["code"], "label": g["label"], "criterion": g["criterion"], "severity": g.get("severity", "critical"),
              "remedy": g["remedy"], **gate_results[g["code"]]} for g in profile["gates"]]
    summary = classify(profile, criteria, gates)

    # Gaps become actions: confirmed failed gates first, then missing mandatory evidence, then other gaps.
    weights = {c["code"]: c["weight"] for c in criteria}
    order = {c["code"]: i for i, c in enumerate(criteria)}
    sections = {c["code"]: (c["section"], c["tool"]) for c in criteria}
    dates = extras.pop("_due", {})
    gaps = []
    states = {ch["code"]: ch["state"] for c in criteria for ch in c["checks"]}
    covers = {g["code"]: g.get("covers") for g in profile["gates"]}
    merged = {covers[g["code"]] for g in gates if g["state"] == FAILED and states.get(covers.get(g["code"])) == FAILED}
    for g in gates:
        if g["state"] == FAILED:
            gaps.append({"code": g["code"], "group": 1, "criterion": g["criterion"], "title": g["remedy"], "why": g["reason"],
                         "also": [covers[g["code"]]] if covers.get(g["code"]) in merged else [],
                         "priority_reason": "A confirmed blocker: nothing else can make this ready until it is resolved.",
                         "evidence_required": g["remedy"]})
    for c in criteria:
        for ch in c["checks"]:
            if ch["state"] == UNKNOWN:
                gaps.append({"code": ch["code"], "group": 2, "criterion": c["code"], "title": ch["how_to"], "why": ch["reason"] or "This hasn't been provided yet.",
                             "priority_reason": "Required evidence is missing, so this can't be assessed yet.", "evidence_required": ch["label"]})
            elif ch["state"] == FAILED and ch["code"] not in merged:      # the gate's action already covers it
                gaps.append({"code": ch["code"], "group": 3, "criterion": c["code"], "title": ch["how_to"], "why": ch["reason"] or "This is not in place yet.",
                             "priority_reason": "A preparation gap.", "evidence_required": ch["label"]})
    for gap in gaps:
        gap["weight"] = weights[gap["criterion"]]
        gap["order"] = order[gap["criterion"]]
        gap["section"], gap["tool"] = sections[gap["criterion"]]
        gap.setdefault("also", [])
        gap["due_date"] = dates.get(gap["code"]) or next((dates[c] for c in gap["also"] if dates.get(c)), None)
    gaps.sort(key=lambda x: (x["group"], x["due_date"] or "9999-12-31", x["order"], -x["weight"], x["code"]))

    unknown_checks = [ch for c in criteria for ch in c["checks"] if ch["state"] == UNKNOWN]
    stale = [{"code": ch["code"], "reason": ch["reason"]} for ch in unknown_checks if ch.get("stale")]
    reasons = []
    if unknown_checks or any(g["state"] == UNKNOWN for g in gates):
        reasons.append("Some required evidence is missing.")
    if stale:
        reasons.append("Some evidence is out of date.")
    if extras.get("_conflict"):
        reasons.append("Some figures contradict each other.")
    self_attested = [ch["code"] for c in criteria for ch in c["checks"] if ch.get("attestation") and not ch["attestation"]["independent"]]
    weak = extras.pop("_uncorroborated", [])
    if reasons:
        level = "low"
    elif self_attested or weak:
        level = "medium"
        reasons.append("Complete and current, but material claims rely on self-attestation.")
    else:
        level = "high"
        reasons.append("Complete and current, with material claims backed by records or an independent review.")
    extras.pop("_conflict", None)
    return {
        "subject_type": subject_type, "profile": rules.profile_key(profile), "profile_title": profile["title"], "ruleset_version": profile["version"],
        "engine_versions": {"readiness": ENGINE_VERSION, "forecast": fc.FORMULA_VERSION},
        **summary, "criteria": criteria, "gates": gates, "gaps": gaps,
        "confidence": {"level": level, "reasons": reasons, "note": "Forecasts remain assumptions at every confidence level."},
        "stale_checks": stale,
        "missing": [{"code": ch["code"], "label": ch["label"], "reason": ch["reason"]} for ch in unknown_checks],
        "disclaimer": profile["wording"]["disclaimer"], "status_note": profile["status_note"],
        **extras,
    }


def _forecast_checks(snapshot: dict, required: list[str], today: date, profile: dict, proof) -> tuple[dict, dict]:
    """(computed forecast, result for "complete and reconciled")."""
    f = snapshot.get("forecast")
    computed = fc.compute(f, required, proof=proof)
    days = profile["freshness_days"]
    if computed["state"] == "missing":
        return computed, _res(UNKNOWN, "There is no monthly cash forecast yet.")
    if computed["state"] == "invalid":
        return computed, _res(FAILED, " ".join(computed["issues"][:4]))
    if computed["state"] == "incomplete":
        more = len(computed["missing"]) - 3
        return computed, _res(UNKNOWN, "The forecast is missing: " + "; ".join(computed["missing"][:3]) + (f" and {more} more." if more > 0 else "."))
    confirmed = parse_day(f.get("confirmed_at"))
    if confirmed is None or (today - confirmed).days > days["forecast"]:
        return computed, _res(UNKNOWN, f"The forecast was last confirmed more than {days['forecast']} days ago. Confirm it is still right.", stale=True)
    cash_as_of = parse_day(f.get("opening_cash_as_of"))
    if cash_as_of is None:
        return computed, _res(UNKNOWN, "Say what date the opening cash figure is from.")
    if (today - cash_as_of).days > days["cash_position"]:
        return computed, _res(UNKNOWN, f"The opening cash figure is more than {days['cash_position']} days old.", stale=True)
    return computed, _res(PASSED, "Every month is filled in and each month opens on the previous month's close.")


def _basis(computed: dict) -> dict:
    counts = computed.get("basis") or {}
    kinds = [k for k in rules.DATA_BASES if counts.get(k)]
    return {"months": counts, "label": "mixed" if len(kinds) > 1 else (kinds[0] if kinds else None),
            "note": "Forecast and estimated months are assumptions, not results." if any(k != "actual" for k in kinds) else None}


# ══ Funding Readiness ═════════════════════════════════════════════════════════

def funding_required_months(subject: dict, forecast: dict | None, profile: dict) -> list[str]:
    """12 consecutive months from the forecast's start, extended when the funded milestone is later."""
    months = sorted(m.get("month") for m in _items((forecast or {}).get("months")) if fc.parse_month(m.get("month")))
    start = fc.parse_month((forecast or {}).get("start_month")) or (fc.parse_month(months[0]) if months else None)
    if start is None:
        return []
    count = profile["forecast_months"]
    milestone = next((m for m in _items(subject.get("milestones")) if m.get("id") == subject.get("purpose_milestone_id")), None)
    due = parse_day((milestone or {}).get("due_date"))
    if due:
        count = max(count, fc.months_between(start, (due.year, due.month)) + 1)
    return fc.month_range(start, min(count, 60))


def document_facts(subject: dict, forecast: dict | None) -> dict:
    """The figures a case document must agree with (G4's deterministic checks)."""
    target, _ = _amount(subject.get("target_amount"))
    return {"target_amount": fc.money_str(target), "currency": subject.get("currency") or None,
            "forecast_start": (forecast or {}).get("start_month") or None}


def assess_funding(snapshot: dict, profile: dict, today: date) -> dict:
    s = snapshot["subject"]
    forecast = snapshot.get("forecast")
    days = profile["freshness_days"]
    by_id = {e["id"]: e for e in snapshot.get("evidence") or []}
    artifacts = {a["id"]: a for a in snapshot.get("artifacts") or []}

    proof = financing_proof(snapshot.get("evidence"), today, days["evidence"])

    r: dict[str, dict] = {}
    g: dict[str, dict] = {}
    milestones = {m.get("id"): m for m in _items(s.get("milestones"))}

    def measurable(mid: Any) -> bool:
        m = milestones.get(mid)
        return bool(m) and not blank(m.get("measure")) and not blank(m.get("target"))

    # C1 / G1: target, currency, timing
    target, bad_target = _amount(s.get("target_amount"))
    receipt = parse_day(s.get("receipt_date"))
    currency = str(s.get("currency") or "").upper()
    if bad_target or (target is not None and target <= 0):
        r["C1.A"] = g["G1"] = _res(FAILED, "The funding target must be an amount above zero.", trigger={"target_amount": s.get("target_amount")})
    elif currency and currency not in rules.SUPPORTED_CURRENCIES:
        r["C1.A"] = g["G1"] = _res(FAILED, f"{currency} is not a supported currency for this check.", trigger={"currency": currency})
    elif not blank(s.get("receipt_date")) and receipt is None:
        r["C1.A"] = g["G1"] = _res(FAILED, "The intended receipt date is not a valid date.", trigger={"receipt_date": s.get("receipt_date")})
    elif target is None or not currency or receipt is None:
        gone = [n for n, v in (("target amount", target), ("currency", currency or None), ("intended receipt date", receipt)) if v is None]
        # The action asks only for what is missing: an amount already given is not asked for again.
        ask = [w for w, v in (("the amount you want to raise", target), ("its currency" if target is None else "the currency", currency or None),
                              ("when you expect to receive it" if target is None else "when you expect to receive the funding", receipt)) if v is None]
        have = [f"{currency or ''} {target:,.2f}".strip()] if target is not None else []
        r["C1.A"] = g["G1"] = _res(UNKNOWN, "Not entered yet: " + ", ".join(gone) + "." + (f" Already entered: {have[0]}." if have else ""),
                                   how_to="Enter " + (", ".join(ask[:-1]) + " and " + ask[-1] if len(ask) > 1 else ask[0]) + ", then confirm the amount and date.")
    elif not s.get("timing_confirmed"):
        r["C1.A"] = g["G1"] = _res(UNKNOWN, "The amount and date are entered but not confirmed yet.", how_to="Confirm the amount and date you entered.")
    else:
        r["C1.A"] = g["G1"] = _res(PASSED, f"{currency} {target:,.2f}, expected {receipt.strftime('%d %b %Y').lstrip('0')}.")

    if not blank(s.get("purpose")) and not milestones:
        r["C1.B"] = _res(UNKNOWN, "What the funding is for is entered. It isn't linked to a milestone yet.",
                         how_to="Add a milestone the funding pays for, with a measure and a target, and link the purpose to it.")
    elif blank(s.get("purpose")) and milestones:
        r["C1.B"] = _res(UNKNOWN, "Say what the funding is for.", how_to="Say what the funding is for and link it to one of your milestones.")
    elif blank(s.get("purpose")) or not milestones:
        r["C1.B"] = _res(UNKNOWN, "Say what the funding is for and add a milestone it pays for.")
    elif measurable(s.get("purpose_milestone_id")):
        r["C1.B"] = _res(PASSED)
    elif s.get("purpose_milestone_id") in milestones:
        r["C1.B"] = _res(FAILED, "The linked milestone has no measure or target, so it can't be measured.")
    else:
        r["C1.B"] = _res(FAILED, "The purpose isn't linked to a milestone.")

    # C2 / G2: use of funds
    allocations = _items(s.get("use_of_funds"))
    parsed = [_amount(a.get("amount")) for a in allocations]
    if not allocations or target is None:
        r["C2.A"] = g["G2"] = _res(UNKNOWN, "Enter the target and at least one allocation." if not allocations else "Enter the funding target first.")
    elif any(bad or (amt is not None and amt < 0) for amt, bad in parsed):
        r["C2.A"] = g["G2"] = _res(FAILED, "An allocation has an amount that isn't a positive number.")
    elif any(amt is None for amt, _ in parsed):
        r["C2.A"] = g["G2"] = _res(UNKNOWN, "An allocation has no amount yet.")
    else:
        total = sum((amt for amt, _ in parsed), Decimal(0)).quantize(fc.CENT)
        if total == target.quantize(fc.CENT):
            r["C2.A"] = g["G2"] = _res(PASSED, f"Allocations total {currency} {total:,.2f}, equal to the target.")
        else:
            diff = target.quantize(fc.CENT) - total
            r["C2.A"] = g["G2"] = _res(FAILED, f"Allocations total {currency} {total:,.2f} against a target of {currency} {target:,.2f}: "
                                               f"{currency} {abs(diff):,.2f} {'is not allocated' if diff > 0 else 'more than the target'}.",
                                       trigger={"target_amount": fc.money_str(target), "allocations_total": fc.money_str(total)})
    if not allocations:
        r["C2.B"] = _res(UNKNOWN, "No allocations yet.")
    else:
        poor = [a.get("category") or "An allocation" for a in allocations
                if fc.parse_month(a.get("period")) is None or (blank(a.get("purpose")) and blank(a.get("rationale")))]
        r["C2.B"] = _res(FAILED, f"{len(poor)} allocation{'s have' if len(poor) != 1 else ' has'} no month or no purpose: " + ", ".join(poor[:4]) + ".") if poor else _res(PASSED)

    # C3 / G3: forecast
    required = funding_required_months(s, forecast, profile)
    computed, complete = _forecast_checks(snapshot, required, today, profile, proof)
    r["C3.A"] = g["G3"] = complete
    if computed["state"] == "missing":
        r["C3.B"] = _res(UNKNOWN, "There is no forecast to document yet.")
    else:
        documented_lines = {a.get("applies_to") for a in _items(forecast.get("assumptions")) if not blank(a.get("text")) and not blank(a.get("source"))}
        need = [line for line in ("receipts", "payments")
                if any(_amount(m.get(line))[0] not in (None, Decimal(0)) for m in _items(forecast.get("months")))] or ["receipts", "payments"]
        lacking = [line for line in need if line not in documented_lines]
        r["C3.B"] = _res(FAILED, "No documented assumption and source for: " + " and ".join(lacking) + ".") if lacking else _res(PASSED)

    # C4: demand evidence
    demand = linked(snapshot, "C4.A")
    fresh = [e for e in demand if evidence_freshness(e, today, days["evidence"])["state"] == "current"]
    if not demand:
        r["C4.A"] = _res(UNKNOWN, "No customer or market evidence is attached yet.")
    elif not fresh:
        r["C4.A"] = _res(UNKNOWN, "The attached evidence is out of date: " + evidence_freshness(demand[0], today, days["evidence"])["reason"], stale=True)
    else:
        r["C4.A"] = _res(PASSED, f"{len(fresh)} dated item{'s' if len(fresh) != 1 else ''}: " + ", ".join(rules.EVIDENCE_TYPES.get(e.get("type"), "Evidence").lower() for e in fresh[:3]) + ".",
                         evidence_ids=[e["id"] for e in fresh])
    r["C4.B"] = attested(rules.FUNDING, "C4.B", snapshot, today, days["attestation"]) if demand else _res(UNKNOWN, "There is no evidence to review yet.")

    # C5: economics
    econ = {k: _amount(get(s, f"economics.{k}")) for k in ("price", "direct_cost", "fixed_costs_monthly")}
    results_through = parse_day(get(s, "traction.results_through"))
    if any(bad or (v is not None and v < 0) for v, bad in econ.values()):
        r["C5.A"] = _res(FAILED, "Price and costs must be amounts of zero or more.")
    elif any(v is None for v, _ in econ.values()):
        r["C5.A"] = _res(UNKNOWN, "Enter your price, direct cost per sale and monthly fixed costs.")
    elif s.get("stage") == "trading" and results_through and (today - results_through).days > days["operating_results"]:
        r["C5.A"] = _res(UNKNOWN, f"Your trading results are recorded up to more than {days['operating_results']} days ago.", stale=True)
    else:
        r["C5.A"] = _res(PASSED, "Price is per sale, direct cost is per sale and fixed costs are per month.")
    r["C5.B"] = attested(rules.FUNDING, "C5.B", snapshot, today, days["attestation"])

    # C6: market and growth plan
    r["C6.A"] = documented([("target segment", get(s, "market.target_segment")), ("differentiation", get(s, "market.differentiation"))])
    r["C6.B"] = documented([("acquisition approach", get(s, "market.acquisition_approach")), ("owner", get(s, "market.acquisition_owner")),
                            ("cost assumption", get(s, "market.acquisition_cost")),
                            ("a measurable milestone", True if measurable(get(s, "market.acquisition_milestone_id")) else None)])

    # C7: team and delivery
    people = _items(get(s, "team.responsibilities"))
    if not people:
        r["C7.A"] = _res(UNKNOWN, "No responsibilities are listed yet.")
    else:
        unowned = [p.get("area") or "An area" for p in people if blank(p.get("owner")) or blank(p.get("area"))]
        r["C7.A"] = _res(FAILED, "No named owner for: " + ", ".join(unowned[:4]) + ".") if unowned else _res(PASSED)
    team_gaps = _items(get(s, "team.gaps"))
    if not team_gaps:
        r["C7.B"] = _res(PASSED, "Recorded: no material capacity or dependency gaps.") if get(s, "team.no_gaps") else _res(UNKNOWN, "List any gaps, or confirm there are none.")
    else:
        open_gaps = [x.get("gap") or "A gap" for x in team_gaps if blank(x.get("action"))]
        r["C7.B"] = _res(FAILED, "No action recorded for: " + ", ".join(open_gaps[:4]) + ".") if open_gaps else _res(PASSED)

    # Cash metrics: the baseline never includes the proposed raise.
    receipt_month = fc.month_key((receipt.year, receipt.month)) if receipt else None
    funded = fc.funded(forecast, required, target if target and target > 0 else None, receipt_month, proof=proof) if computed["state"] == "complete" else None
    first_neg = computed["first_negative_month"]
    timing_gap = None
    if computed["state"] == "complete" and receipt_month:
        exists = bool(first_neg and first_neg < receipt_month)
        timing_gap = {"exists": exists, "first_negative_month": first_neg, "receipt_month": receipt_month,
                      "months": fc.months_between(fc.parse_month(first_neg), fc.parse_month(receipt_month)) if exists else 0,
                      "text": (f"Cash runs out in {fc.month_label(first_neg)}, before the funding is expected in {fc.month_label(receipt_month)}. "
                               "The proposed funding is not current cash.") if exists else None}
    coverage = []
    if funded and funded["state"] == "complete":
        for m in milestones.values():
            due = parse_day(m.get("due_date"))
            key = fc.month_key((due.year, due.month)) if due else None
            if key is None or key not in funded["cash_by_month"]:
                coverage.append({"milestone_id": m.get("id"), "outcome": m.get("outcome"), "covered": None,
                                 "reason": "No due date." if key is None else "Its due date is outside the forecast."})
            else:
                short = next((k for k in sorted(funded["cash_by_month"]) if k <= key and funded["cash_by_month"][k] < 0), None)
                coverage.append({"milestone_id": m.get("id"), "outcome": m.get("outcome"), "covered": short is None,
                                 "reason": None if short is None else f"Funded cash is below zero in {fc.month_label(short)}."})

    # C8 / G4: documents and risks
    facts = document_facts(s, forecast)
    docs, missing_docs, unreviewed, conflicts = [], [], [], []
    for d in profile["required_documents"]:
        entry = (s.get("documents") or {}).get(d["key"]) or {}
        source, doc_facts = None, None
        if d.get("record") == "use_of_funds" and allocations:
            source = "Use of funds in this case"
        elif d.get("record") == "forecast" and computed["state"] != "missing":
            source = "Forecast in this case"
        elif entry.get("artifact_id") in artifacts and artifacts[entry["artifact_id"]].get("status") != "superseded":
            source, doc_facts = "Prepared here", artifacts[entry["artifact_id"]].get("facts")
        elif entry.get("evidence_id") in by_id:
            source, doc_facts = by_id[entry["evidence_id"]].get("title") or "Attached document", by_id[entry["evidence_id"]].get("facts")
        reviewed = bool(entry.get("reviewed")) and entry.get("facts_fingerprint") == fingerprint(facts)
        if source is None:
            missing_docs.append(d["label"])
        elif not reviewed:
            unreviewed.append(d["label"])
        for name, label in (("target_amount", "funding target"), ("currency", "currency"), ("forecast_start", "forecast start month")):
            theirs = (doc_facts or {}).get(name)
            if theirs not in (None, "") and facts[name] not in (None, "") and str(theirs) != str(facts[name]):
                conflicts.append(f"{d['label']} states a {label} of {theirs}; the case has {facts[name]}.")
        docs.append({"key": d["key"], "label": d["label"], "source": source, "exists": source is not None, "reviewed": reviewed if source else False,
                     "needs_review": bool(entry.get("reviewed")) and not reviewed})
    if forecast and forecast.get("currency") and currency and str(forecast["currency"]).upper() != currency:
        conflicts.append(f"The forecast is in {forecast['currency']} and the case is in {currency}. Mixed currencies need an explicit conversion before assessment.")
    raised = [c.get("description") or "A contradiction" for c in _items(s.get("contradictions")) if not c.get("resolved")]

    if missing_docs:
        r["C8.A"] = _res(UNKNOWN, "Not provided yet: " + ", ".join(missing_docs) + ".")
    elif unreviewed:
        r["C8.A"] = _res(FAILED, "Not reviewed: " + ", ".join(unreviewed) + ".")
    else:
        r["C8.A"] = _res(PASSED)
    if conflicts or raised:
        g["G4"] = _res(FAILED, " ".join((conflicts + raised)[:4]), trigger={"conflicts": conflicts, "raised": raised})
    elif missing_docs or unreviewed:
        g["G4"] = _res(UNKNOWN, "Documents that have not been provided and reviewed can't be checked for contradictions.")
    else:
        g["G4"] = _res(PASSED, "Target amount, currency and forecast period agree across the case documents.")

    risks_listed = _items(s.get("risks"))
    timing_disclosed = any(x.get("kind") == "funding_timing" and not blank(x.get("action")) for x in risks_listed)
    if not risks_listed and not s.get("no_known_risks"):
        r["C8.B"] = _res(UNKNOWN, "List known material risks, or confirm there are none.")
    elif timing_gap and timing_gap["exists"] and not timing_disclosed:
        r["C8.B"] = _res(FAILED, "The cash gap before the funding arrives is not disclosed as a funding-timing risk with an action.")
    else:
        no_action = [x.get("risk") or "A risk" for x in risks_listed if blank(x.get("action"))]
        r["C8.B"] = _res(FAILED, "No action recorded for: " + ", ".join(no_action[:4]) + ".") if no_action else _res(PASSED)

    # Commercial findings, shown beside readiness and never folded into it.
    price, direct, fixed = (econ[k][0] for k in ("price", "direct_cost", "fixed_costs_monthly"))
    economics: dict[str, Any] = {"state": "unavailable", "reason": "Price and costs are not all entered."}
    risks: list[dict] = []
    if None not in (price, direct, fixed):
        contribution = price - direct
        economics = {"state": "available", "contribution_per_sale": fc.money_str(contribution),
                     "break_even_sales_per_month": (str((fixed / contribution).quantize(Decimal("0.1"))) if contribution > 0 else None),
                     "break_even_state": "available" if contribution > 0 else "unreachable",
                     "note": "Monthly break-even sales: how many sales a month cover fixed costs. It is not a number of months."}
        if contribution <= 0:
            risks.append({"code": "non_positive_contribution", "severity": "high", "text": "Each sale costs as much as, or more than, it earns. No volume of sales covers fixed costs."})
    if first_neg:
        risks.append({"code": "cash_shortfall", "severity": "high", "text": f"Without the proposed funding, cash runs out in {fc.month_label(first_neg)}."})
    if timing_gap and timing_gap["exists"]:
        risks.append({"code": "funding_timing_gap", "severity": "high", "text": timing_gap["text"]})
    if funded and funded["state"] == "complete" and funded["first_negative_month"]:
        risks.append({"code": "funded_shortfall", "severity": "high",
                      "text": f"Even with the funding, cash is below zero in {fc.month_label(funded['first_negative_month'])}."})
    if s.get("stage") != "trading":
        risks.append({"code": "pre_revenue", "severity": "info", "text": "Not trading yet: there is no trading history, so nothing here is based on past results."})
    if fresh and all(rules.EVIDENCE_STRENGTH.get(e.get("type"), "indicative") == "indicative" for e in fresh):
        risks.append({"code": "indicative_demand", "severity": "medium", "text": "Demand evidence is research or interviews only. It supports preparation, not proven demand."})

    uncorroborated = [e["id"] for e in fresh if e.get("verification") not in ("independently_reviewed", "corroborated")]
    return _assemble(profile, rules.FUNDING, r, g, {
        "metrics": {
            "forecast": fc.public(computed),
            "baseline_min_cash": computed["min_cash"], "first_negative_month": first_neg,
            "funded_min_cash": funded["min_cash"] if funded and funded["state"] == "complete" else None,
            "funded_first_negative_month": funded["first_negative_month"] if funded and funded["state"] == "complete" else None,
            "funding_timing_gap": timing_gap, "milestone_coverage": coverage, "economics": economics,
            "runway": ({"state": "unknown", "reason": "The forecast is not complete."} if computed["state"] != "complete"
                       else {"state": "bounded", "until": first_neg} if first_neg
                       else {"state": "unbounded", "reason": "Cash stays above zero for every month of the forecast."}),
        },
        "data_basis": _basis(computed), "documents": docs, "risks": risks,
        "evidence_used": [{"id": e["id"], "title": e.get("title"), "type": e.get("type"), "strength": rules.EVIDENCE_STRENGTH.get(e.get("type")),
                           "effective_date": e.get("effective_date"), "verification": e.get("verification") or "unverified"} for e in demand],
        "limitations": [fc.MONTHLY_LABEL, "Forecast figures are assumptions, however well evidenced.",
                        "Ownership and team information describes preparation. It is not a legal verification."],
        "_conflict": bool(conflicts or raised), "_uncorroborated": uncorroborated,
    })


# ══ Launch Readiness ══════════════════════════════════════════════════════════

def launch_required_months(subject: dict, profile: dict, today: date) -> list[str]:
    """At least six months from the assessment month, and at least three full months after launch."""
    start = (today.year, today.month)
    count = profile["forecast_months"]
    target = parse_day(subject.get("target_date"))
    if target:
        count = max(count, fc.months_between(start, (target.year, target.month)) + profile["months_after_launch"] + 1)
    return fc.month_range(start, min(count, 60))


OVERCOMMITTED = "Committed can't be more than what you have available."


def capacity_of(subject: dict) -> dict:
    """Planned demand against capacity that is actually free: available minus what existing
    work already uses, in matching units. Never headcount times nominal hours."""
    volume, bad_v = _amount(get(subject, "planned_volume.amount"))
    available, bad_a = _amount(get(subject, "delivery.capacity_available"))
    committed, bad_c = _amount(get(subject, "delivery.capacity_committed"))
    per_unit, bad_p = _amount(get(subject, "delivery.capacity_per_unit"))
    v_unit = str(get(subject, "planned_volume.unit") or "").strip().lower()
    c_unit = str(get(subject, "delivery.capacity_unit") or "").strip().lower()
    out: dict[str, Any] = {"state": "unknown", "unit": c_unit or None}
    if bad_v or bad_a or bad_c or bad_p or any(x is not None and x < 0 for x in (volume, available, committed, per_unit)):
        return {**out, "state": "invalid", "reason": "Volume and capacity must be numbers of zero or more."}
    if volume is None or volume == 0:
        return {**out, "reason": "Enter how many you plan to deliver each month."}
    gone = [n for n, x in (("capacity available", available), ("capacity already committed", committed)) if x is None]
    if gone:
        return {**out, "reason": "Not entered yet: " + ", ".join(gone) + "."}
    if committed > available:
        return {**out, "reason": OVERCOMMITTED}
    if not v_unit or not c_unit:
        return {**out, "reason": "Say what volume and capacity are measured in."}
    if v_unit != c_unit and per_unit is None:
        return {**out, "reason": f"Volume is in {v_unit} and capacity is in {c_unit}. Say how much capacity one unit of volume uses so they can be compared."}
    need = volume if v_unit == c_unit else volume * per_unit
    free = available - committed
    overload = need - free
    return {"state": "known", "unit": c_unit, "need": _num(need), "available": _num(available), "committed": _num(committed),
            "free": _num(free), "overload": _num(overload) if overload > 0 else None, "fits": overload <= 0}


def assess_launch(snapshot: dict, profile: dict, today: date) -> dict:
    s = snapshot["subject"]
    forecast = snapshot.get("forecast")
    days = profile["freshness_days"]
    by_id = {e["id"]: e for e in snapshot.get("evidence") or []}
    target = parse_day(s.get("target_date"))

    proof = financing_proof(snapshot.get("evidence"), today, days["evidence"])

    def confirmed_within(path: str, limit: int, what: str) -> dict | None:
        at = parse_day(get(s, path))
        if at is None or (today - at).days > limit:
            return _res(UNKNOWN, f"{what} were last confirmed more than {limit} days ago. Confirm they are still right.", stale=True)
        return None

    r: dict[str, dict] = {}
    b: dict[str, dict] = {}
    due: dict[str, str] = {}

    # C1: customer and demand
    demand = linked(snapshot, "C1.A")
    fresh = [e for e in demand if evidence_freshness(e, today, days["evidence"])["state"] == "current"]
    described = documented([("target customer", get(s, "customers.target_segment")), ("their problem", get(s, "customers.problem"))])
    if not demand:
        r["C1.A"] = _res(UNKNOWN, "No dated demand evidence is attached yet.")
    elif not fresh:
        r["C1.A"] = _res(UNKNOWN, "The attached demand evidence is out of date: " + evidence_freshness(demand[0], today, days["evidence"])["reason"], stale=True)
    else:
        r["C1.A"] = {**described, "evidence_ids": [e["id"] for e in fresh]}
        if described["state"] == PASSED:
            r["C1.A"]["reason"] = f"{len(fresh)} dated item{'s' if len(fresh) != 1 else ''}: " + ", ".join(rules.EVIDENCE_TYPES.get(e.get("type"), "Evidence").lower() for e in fresh[:3]) + "."
    r["C1.B"] = attested(rules.LAUNCH, "C1.B", snapshot, today, days["attestation"]) if demand else _res(UNKNOWN, "There is no evidence to review yet.")

    # C2 / B5: offer, pricing and contribution
    offer = documented([("what you are launching", get(s, "offer.launch_scope")), ("price", get(s, "offer.price")),
                        ("delivery terms", get(s, "offer.delivery_terms")), ("customer promise", get(s, "offer.customer_promise"))])
    r["C2.A"] = _res(UNKNOWN, "The offer is filled in but not confirmed yet.") if offer["state"] == PASSED and not get(s, "offer.confirmed") else offer
    econ = {k: _amount(get(s, f"economics.{k}")) for k in ("price_per_unit", "variable_cost_per_unit", "fixed_costs_monthly")}
    price, variable, fixed = (econ[k][0] for k in econ)
    stale_econ = confirmed_within("economics.confirmed_at", days["economics"], "Price and costs")
    if any(bad or (v is not None and v < 0) for v, bad in econ.values()):
        inputs = _res(FAILED, "Price and costs must be amounts of zero or more.")
        b["B5"] = _res(UNKNOWN, "Price and costs are not valid figures.")
    elif any(v is None for v, _ in econ.values()):
        inputs = _res(UNKNOWN, "Enter the price per unit, the cost to deliver one unit and monthly fixed costs.")
        b["B5"] = _res(UNKNOWN, "Price and cost per unit are needed to work out the contribution.") if None in (price, variable) else None
    else:
        inputs = stale_econ or _res(PASSED)
        b["B5"] = None
    contribution = price - variable if None not in (price, variable) and not any(bad for _, bad in econ.values()) else None
    if b.get("B5") is None:
        if stale_econ:
            b["B5"] = _res(UNKNOWN, stale_econ["reason"], stale=True)
        elif contribution <= 0:
            b["B5"] = _res(FAILED, f"Each unit sells for {price:,.2f} and costs {variable:,.2f} to deliver: a contribution of {contribution:,.2f}.",
                           trigger={"price_per_unit": fc.money_str(price), "variable_cost_per_unit": fc.money_str(variable)}, source="Pricing and economics")
        else:
            b["B5"] = _res(PASSED, f"Each unit contributes {contribution:,.2f} after delivery cost.")
    r["C2.B"] = _both(inputs, attested(rules.LAUNCH, "C2.B", snapshot, today, days["attestation"])) if inputs["state"] != UNKNOWN else inputs

    # C3 / B1: cash
    required = launch_required_months(s, profile, today)
    computed, complete = _forecast_checks(snapshot, required, today, profile, proof)
    if complete["state"] == PASSED and target is None:
        complete = _res(UNKNOWN, "Set a launch date so the projection can be checked against it.")
    r["C3.A"] = complete
    if complete["state"] != PASSED:
        b["B1"] = _res(UNKNOWN, "The cash projection is not complete, so a shortfall can't be ruled in or out.", stale=bool(complete.get("stale")))
        if computed["state"] == "invalid":
            b["B1"]["reason"] = "The cash projection has invalid figures, so a shortfall can't be ruled in or out."
    elif computed["first_negative_month"]:
        low = computed["min_cash"]
        b["B1"] = _res(FAILED, f"Cash is below zero in {fc.month_label(computed['first_negative_month'])} (lowest {low['amount']} in {fc.month_label(low['month'])}). "
                               "Funding that is expected but not committed is not counted.",
                       trigger={"first_negative_month": computed["first_negative_month"], "min_cash": low}, source="Cash projection")
    else:
        b["B1"] = _res(PASSED, "Cash stays above zero in every month the projection must cover.")
    if computed["state"] == "missing":
        r["C3.B"] = _res(UNKNOWN, "There is no cash projection yet.")
    else:
        commitments = _items(forecast.get("commitments"))
        if not commitments:
            r["C3.B"] = (_res(PASSED, "Recorded: no setup or operating commitments.") if forecast.get("no_commitments")
                         else _res(UNKNOWN, "List your setup and operating commitments, or confirm there are none."))
        else:
            poor = [c.get("label") or "A commitment" for c in commitments
                    if blank(c.get("label")) or _amount(c.get("amount"))[0] is None or fc.parse_month(c.get("month")) is None
                    or c.get("basis") not in ("evidenced", "assumption") or (c.get("basis") == "evidenced" and c.get("evidence_id") not in by_id)]
            r["C3.B"] = _res(FAILED, "Not fully recorded (amount, month, and evidence or an assumption label): " + ", ".join(poor[:4]) + ".") if poor else _res(PASSED)

    # C4 / B2: delivery capability
    cap = capacity_of(s)
    stale_cap = confirmed_within("delivery.capacity_confirmed_at", days["capacity"], "Capacity figures")
    if cap["state"] == "invalid":
        r["C4.A"] = _res(FAILED, cap["reason"])
        b["B2"] = _res(UNKNOWN, cap["reason"])
    elif cap["state"] == "unknown":
        r["C4.A"] = b["B2"] = _res(UNKNOWN, cap["reason"])
    elif stale_cap:
        r["C4.A"] = b["B2"] = stale_cap
    elif cap["fits"]:
        r["C4.A"] = b["B2"] = _res(PASSED, f"The launch needs {cap['need']} {cap['unit']} a month and {cap['free']} are free.")
    else:
        text = (f"The launch needs {cap['need']} {cap['unit']} a month. {cap['committed']} of {cap['available']} are already committed, "
                f"leaving {cap['free']}: {cap['overload']} {cap['unit']} short.")
        r["C4.A"] = _res(FAILED, text)
        b["B2"] = _res(FAILED, text, trigger={k: cap[k] for k in ("need", "available", "committed", "free", "overload", "unit")}, source="Delivery")
    deps = _items(get(s, "delivery.dependencies"))
    if not deps:
        r["C4.B"] = (_res(PASSED, "Recorded: no critical supplier, person or system.") if get(s, "delivery.no_dependencies")
                     else _res(UNKNOWN, "List what the launch depends on, or confirm it depends on nothing critical."))
    elif any(_yes(d.get("available")) is None for d in deps):
        r["C4.B"] = _res(UNKNOWN, "Say whether each dependency will be available by launch.")
    else:
        poor = [d.get("name") or "A dependency" for d in deps if not _yes(d.get("available")) or (d.get("needs_contingency") and blank(d.get("contingency")))]
        r["C4.B"] = _res(FAILED, "Not available, or missing a backup: " + ", ".join(poor[:4]) + ".") if poor else _res(PASSED)

    # C5 / B4: operational process and dry run
    r["C5.A"] = _res(UNKNOWN, "The process isn't described yet.") if blank(get(s, "operations.process")) else _res(PASSED)
    run = get(s, "operations.dry_run") or {}
    if blank(run.get("date")) or run.get("outcome") not in ("passed", "failed"):
        r["C5.B"] = b["B4"] = _res(UNKNOWN, "No end-to-end test run is recorded yet.")
    elif parse_day(run.get("date")) is None:
        r["C5.B"] = b["B4"] = _res(UNKNOWN, "The test run has no valid date.")
    elif str(run.get("process_version") or "") != str(get(s, "operations.process_version") or ""):
        r["C5.B"] = b["B4"] = _res(UNKNOWN, "The process changed after this test run. Run the test again on the current process.", stale=True)
    elif run["outcome"] == "failed" and not run.get("failures_resolved"):
        text = "The end-to-end test failed at a critical step and the failure has not been resolved."
        r["C5.B"] = _res(FAILED, text)
        b["B4"] = _res(FAILED, text, trigger={"date": run.get("date"), "outcome": "failed"}, source="Test run")
    else:
        r["C5.B"] = b["B4"] = _res(PASSED, "Worked end to end." if run["outcome"] == "passed" else "A failure was found and has been resolved.")

    # C6 / B3: prerequisites
    prereqs = _items(s.get("prerequisites"))
    applicable = [p for p in prereqs if _yes(p.get("applicable")) is True]
    unresolved = [p for p in prereqs if _yes(p.get("applicable")) is None]
    if not prereqs:
        listed = (_res(PASSED) if s.get("no_prerequisites") and not blank(s.get("no_prerequisites_rationale"))
                  else _res(UNKNOWN, "List what must be in place before launch, or record why nothing is required."))
    elif unresolved:
        listed = _res(UNKNOWN, "Say whether each prerequisite applies: " + ", ".join(p.get("name") or "A prerequisite" for p in unresolved[:4]) + ".")
    else:
        no_reason = [p.get("name") or "A prerequisite" for p in prereqs if _yes(p.get("applicable")) is False and blank(p.get("rationale"))]
        listed = _res(FAILED, "Marked as not applying without a reason: " + ", ".join(no_reason[:4]) + ".") if no_reason else _res(PASSED)
    r["C6.A"] = _both(listed, attested(rules.LAUNCH, "C6.A", snapshot, today, days["attestation"])) if listed["state"] == PASSED else listed

    def at_launch(p: dict) -> str | None:
        """Why a completed prerequisite still can't pass at launch, if it can't."""
        until = parse_day(p.get("valid_until"))
        if until and target and until < target:
            return f"{p.get('name')} is valid until {until.strftime('%d %b %Y').lstrip('0')}, before the launch date."
        if until and until < today:
            return f"{p.get('name')} expired on {until.strftime('%d %b %Y').lstrip('0')}."
        return None

    if not prereqs:
        r["C6.B"] = _res(PASSED, "Recorded: nothing is required before launch.") if listed["state"] == PASSED else _res(UNKNOWN, "No prerequisites are recorded yet.")
        b["B3"] = _res(PASSED, "Recorded: nothing is required before launch.") if listed["state"] == PASSED else _res(UNKNOWN, "No prerequisites are recorded yet.")
    else:
        undone = [p for p in applicable if p.get("status") == "not_completed"]
        expired = [x for x in (at_launch(p) for p in applicable if p.get("status") == "completed") if x]
        unevidenced = [p for p in applicable if p.get("status") == "completed" and p.get("evidence_id") not in by_id]
        no_status = [p for p in applicable if p.get("status") not in ("completed", "not_completed")]
        needs_date = [p for p in applicable if p.get("status") == "completed" and parse_day(p.get("valid_until")) and target is None]
        if undone or expired or unevidenced:
            parts = ([f"Not completed: {', '.join(p.get('name') or 'A prerequisite' for p in undone[:4])}."] if undone else []) + expired[:2] + \
                    ([f"Completed without evidence: {', '.join(p.get('name') or 'A prerequisite' for p in unevidenced[:4])}."] if unevidenced else [])
            r["C6.B"] = _res(FAILED, " ".join(parts))
        elif unresolved or no_status or needs_date:
            r["C6.B"] = _res(UNKNOWN, "Not yet known for every prerequisite: whether it applies, its status, or the launch date its validity is checked against.")
        else:
            r["C6.B"] = _res(PASSED, evidence_ids=[p["evidence_id"] for p in applicable if p.get("evidence_id")])
        critical_undone = [p for p in undone if p.get("critical")]
        critical_expired = [x for x in (at_launch(p) for p in applicable if p.get("critical") and p.get("status") == "completed") if x]
        if critical_undone or critical_expired:
            parts = ([f"Required and not completed: {', '.join(p.get('name') or 'A prerequisite' for p in critical_undone[:4])}."] if critical_undone else []) + critical_expired[:2]
            b["B3"] = _res(FAILED, " ".join(parts), trigger={"prerequisites": [p.get("id") for p in critical_undone]}, source="Operational prerequisites")
            dated = sorted(str(p["required_by"])[:10] for p in critical_undone if parse_day(p.get("required_by")))
            if dated:
                due["B3"] = dated[0]
        elif unresolved or [p for p in no_status if p.get("critical")] or [p for p in needs_date if p.get("critical")]:
            b["B3"] = _res(UNKNOWN, "It isn't yet known whether every required prerequisite applies and is completed.")
        else:
            b["B3"] = _res(PASSED, "Every required prerequisite is completed and valid at launch.")
        dated = sorted(str(p["required_by"])[:10] for p in undone + no_status if parse_day(p.get("required_by")))
        if dated:
            due["C6.B"] = dated[0]

    # C7: route to market
    r["C7.A"] = documented([("channel", get(s, "market.channel")), ("audience", get(s, "market.audience")), ("launch message", get(s, "market.message"))])
    r["C7.B"] = documented([("owner", get(s, "market.owner")), ("budget", get(s, "market.budget")), ("target", get(s, "market.target"))])

    # C8: launch control
    milestones = _items(get(s, "control.milestones"))
    if target is None or not milestones:
        r["C8.A"] = _res(UNKNOWN, "Set the launch date and add at least one milestone." if target is None else "Add at least one launch milestone.")
    else:
        poor = [m.get("outcome") or "A milestone" for m in milestones if blank(m.get("owner")) or parse_day(m.get("due_date")) is None]
        r["C8.A"] = _res(FAILED, "No date or no owner: " + ", ".join(poor[:4]) + ".") if poor else _res(PASSED)
        dated = sorted(str(m["due_date"])[:10] for m in milestones if parse_day(m.get("due_date")) and m.get("status") != "done")
        if dated and poor:
            due["C8.A"] = dated[0]
    r["C8.B"] = documented([("success measures", get(s, "control.success_measures")), ("incident response", get(s, "control.incident_response")),
                            ("post-launch review date", get(s, "control.review_date"))])

    # Commercial risks, shown separately from preparation.
    risks: list[dict] = []
    if contribution is not None and contribution <= 0:
        risks.append({"code": "non_positive_contribution", "severity": "high", "text": "Each unit costs as much as, or more than, it earns."})
    elif contribution is not None and fixed is not None and cap["state"] == "known":
        volume = fc.dec(get(s, "planned_volume.amount"))
        if contribution * volume < fixed:
            risks.append({"code": "below_break_even", "severity": "medium",
                          "text": f"At the planned volume, contribution of {contribution * volume:,.2f} a month does not cover fixed costs of {fixed:,.2f}."})
    if s.get("launch_type") == "initial_business":
        risks.append({"code": "pre_revenue", "severity": "info", "text": "A first launch: there is no trading history, so no stability figure is calculated from past revenue."})
    if fresh and all(rules.EVIDENCE_STRENGTH.get(e.get("type"), "indicative") == "indicative" for e in fresh):
        risks.append({"code": "indicative_demand", "severity": "medium", "text": "Demand evidence is research or interviews only. It supports preparation, not proven demand."})
    if computed.get("excluded_financing"):
        risks.append({"code": "uncommitted_financing", "severity": "medium",
                      "text": "Financing that is not committed and evidenced is left out of the baseline: " + "; ".join(x["label"] for x in computed["excluded_financing"][:3]) + "."})

    launch_month = fc.month_key((target.year, target.month)) if target else None
    economics: dict[str, Any] = {"state": "unavailable", "reason": "Price and cost per unit are not both entered."}
    if contribution is not None:
        economics = {"state": "available", "contribution_per_unit": fc.money_str(contribution),
                     "break_even_units_per_month": str((fixed / contribution).quantize(Decimal("0.1"))) if fixed is not None and contribution > 0 else None,
                     "break_even_state": "available" if fixed is not None and contribution > 0 else "unreachable" if contribution <= 0 else "unavailable",
                     "basis": "incremental" if s.get("launch_type") == "new_offering" else "whole business",
                     "note": "Monthly break-even units: how many units a month cover fixed costs. It is not a number of months."}
    uncorroborated = [e["id"] for e in fresh if e.get("verification") not in ("independently_reviewed", "corroborated")]
    return _assemble(profile, rules.LAUNCH, r, b, {
        "metrics": {
            "forecast": fc.public(computed), "required_months": required, "launch_month": launch_month,
            "baseline_min_cash": computed["min_cash"], "first_negative_month": computed["first_negative_month"],
            "cash_at_launch": fc.money_str(computed["cash_by_month"].get(launch_month)) if launch_month in computed["cash_by_month"] else None,
            "capacity": cap, "economics": economics,
        },
        "data_basis": _basis(computed), "risks": risks,
        "evidence_used": [{"id": e["id"], "title": e.get("title"), "type": e.get("type"), "strength": rules.EVIDENCE_STRENGTH.get(e.get("type")),
                           "effective_date": e.get("effective_date"), "verification": e.get("verification") or "unverified"} for e in demand],
        "limitations": [fc.MONTHLY_LABEL, "Forecast figures are assumptions, however well evidenced.",
                        "The prerequisites are the ones you recorded. This check does not claim the list is complete and does not certify compliance."],
        "_due": due, "_conflict": False, "_uncorroborated": uncorroborated,
    })


def assess(subject_type: str, snapshot: dict, profile: dict, today: date) -> dict:
    return assess_funding(snapshot, profile, today) if subject_type == rules.FUNDING else assess_launch(snapshot, profile, today)


# ── section progress (kept separate from readiness) ───────────────────────────

def section_progress(profile: dict, subject: dict, forecast: dict | None) -> list[dict]:
    out = []
    for section in profile["sections"]:
        fields = [f for f in section["fields"] if not f.get("when") or all(subject.get(k) == v for k, v in f["when"].items())]
        answered = sum(1 for f in fields if not blank(get(subject, f["key"])) or (f["type"] == "boolean" and get(subject, f["key"]) is False))
        total = len(fields)
        if section.get("forecast"):
            total += 1
            answered += 1 if forecast and (forecast.get("months") or forecast.get("opening_cash") not in (None, "")) else 0
        out.append({"key": section["key"], "title": section["title"], "answered": answered, "total": total})
    return out


# ── dependencies ──────────────────────────────────────────────────────────────

def dependency_cycle(items: list[dict]) -> list[str] | None:
    """The first cycle among items' `depends_on`, as a list of ids, or None."""
    graph = {str(i.get("id")): [str(d) for d in i.get("depends_on") or [] if d] for i in items if i.get("id")}
    state: dict[str, int] = {}
    path: list[str] = []

    def visit(node: str) -> list[str] | None:
        if state.get(node) == 2 or node not in graph:
            return None
        if state.get(node) == 1:
            return path[path.index(node):] + [node]
        state[node] = 1
        path.append(node)
        for nxt in graph[node]:
            found = visit(nxt)
            if found:
                return found
        path.pop()
        state[node] = 2
        return None

    for node in list(graph):
        found = visit(node)
        if found:
            return found
    return None
