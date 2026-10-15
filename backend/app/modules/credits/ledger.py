"""The credit history as the owner reads it (P2.17): one line per action, in plain words. A hold and its commit are one
line ("Business plan · 40 credits · Used"); a refund for part of a research run is netted into that run's line
("Funding research · 5 findings · 50 credits"); no price-list codes, run ids, "held" or "committed" anywhere."""
from __future__ import annotations

import re
from typing import Any

LABEL = {"research_funding_readiness": "Funding research", "research_launch_blockers": "Launch research", "research_best_price": "Price research",
         "research_customer_opportunities": "Customer research", "business_plan_full": "Business plan", "business_plan_section": "Business plan section",
         "proposal_full": "Business proposal", "proposal_section": "Proposal section", "sales_letter_full": "Sales letter",
         "sales_letter_section": "Sales letter section", "idea_validation": "Idea validation", "idea_validation_comprehensive": "Comprehensive idea validation",
         "agent_task": "Agent task", "agent_quote_draft": "Quotation draft", "agent_invoice_draft": "Invoice draft", "agent_contract_draft": "Contract draft",
         "agent_send": "Sending a document", "agent_reminder": "Payment reminder", "agent_receipt": "Receipt", "agent_classify": "Reading an enquiry",
         "agent_analyse": "Risk check", "scenario_ai_interpretation": "Scenario explanation", "live_plan_full_refresh": "Live plan refresh",
         "market_data_refresh": "Market data refresh", "chat_message": "Assistant chat", "suggest_field": "Field suggestion", "email_share": "Email",
         "rfq_response": "Reply to a request for quotation", "live_plan_import_extract": "Live plan import"}
KIND = {"allocation": "Monthly credits", "top_up": "Top up", "promotion": "Promotion", "admin_adjustment": "Adjustment", "expiry": "Credits expired"}
_TAG = re.compile(r"\s*\[[^\]]*\]")
_RUN_TAG = re.compile(r"\[(rr_[0-9a-f]+):unused\]")
_FINDINGS = re.compile(r"Only (\d+) findings? found")


def label_of(feature: str | None) -> str:
    return LABEL.get(str(feature or ""), "AI task")


def actions(txns: list[dict]) -> list[dict]:
    """The transactions, newest first, as one line per action: {id, at, label, detail, credits, status, source}."""
    from app.modules.credits.service import generation_uuid
    groups: dict[str, dict] = {}
    singles: list[dict] = []
    refunds: list[dict] = []
    for t in txns or []:
        kind = t.get("transaction_type")
        if kind in ("hold", "deduction", "hold_release") and t.get("generation_id"):
            g = groups.setdefault(t["generation_id"], {"hold": None, "deduction": None, "release": None, "feature": t.get("feature_code"), "at": t.get("created_at")})
            g[{"hold": "hold", "deduction": "deduction", "hold_release": "release"}[kind]] = t
            g["at"] = max(str(g["at"] or ""), str(t.get("created_at") or ""))
        elif kind == "refund":
            refunds.append(t)
        else:
            singles.append(t)
    out: list[dict] = []
    netted: set[str] = set()
    by_run = {}
    for r in refunds:
        m = _RUN_TAG.search(str(r.get("description") or ""))
        if m:
            by_run[generation_uuid(m.group(1))] = r
    for gid, g in groups.items():
        feature = g["feature"]
        source = "by the Agent" if str(feature or "").startswith("agent_") else "by you"
        if g["deduction"]:
            used = abs(int(g["deduction"].get("credits") or 0))
            detail = ""
            refund = by_run.get(gid)
            if refund:
                back = abs(int(refund.get("credits") or 0))
                used -= back
                found = _FINDINGS.search(str(refund.get("description") or ""))
                detail = f"{found.group(1)} finding{'s' if found.group(1) != '1' else ''}" if found else ""
                netted.add(refund["id"])
            out.append({"id": gid, "at": g["at"], "label": label_of(feature), "detail": detail, "credits": -used, "status": "Used", "source": source})
        elif g["release"]:
            out.append({"id": gid, "at": g["at"], "label": label_of(feature), "detail": "", "credits": 0, "status": "Not charged", "source": source})
        else:
            held = abs(int((g["hold"] or {}).get("credits") or 0))
            out.append({"id": gid, "at": g["at"], "label": label_of(feature), "detail": "", "credits": -held, "status": "Reserved", "source": source})
    for r in refunds:
        if r["id"] in netted:
            continue
        reason = _TAG.sub("", str(r.get("description") or "")).strip() or "Refunded"
        reason = reason if reason.lower().startswith("refunded") else f"Refunded: {reason[:1].lower()}{reason[1:]}"
        out.append({"id": r["id"], "at": r.get("created_at"), "label": reason, "detail": "", "credits": abs(int(r.get("credits") or 0)), "status": "Refunded", "source": ""})
    for t in singles:
        credits = int(t.get("credits") or 0)
        out.append({"id": t["id"], "at": t.get("created_at"), "label": KIND.get(t.get("transaction_type"), label_of(t.get("feature_code"))),
                    "detail": _TAG.sub("", str(t.get("description") or "")).strip() if t.get("transaction_type") in ("admin_adjustment", "promotion") else "",
                    "credits": credits if t.get("transaction_type") != "expiry" else -abs(credits), "status": "Added" if credits > 0 else "Used", "source": ""})
    return sorted(out, key=lambda a: str(a.get("at") or ""), reverse=True)


def line(a: dict) -> str:
    """"Funding research · 5 findings · 50 credits · Used", "Refunded: research found nothing · +60" """
    c = int(a.get("credits") or 0)
    if c > 0:      # given back or added: "Refunded: unused · +10"
        return " · ".join(p for p in (a["label"], a.get("detail") or "", f"+{c}") if p)
    n = abs(c)
    parts = [a["label"], a.get("detail") or "", f"{n} credit{'s' if n != 1 else ''}" if n else "", a.get("status") or ""]
    return " · ".join(p for p in parts if p)
