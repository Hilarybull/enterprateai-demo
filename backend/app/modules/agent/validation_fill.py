"""The Idea Validation form, filled in full by the Agent (the owner, 26 Oct: "many things are empty here", "description is not
even making sense"): every question the form shows that the owner and the records leave empty, answered in one model call
from what is known about the idea, as the form's own AI Suggest would. Choices are kept to the form's own options. Never
filled: what only the owner can know (evidence, paying customers, their capital, time and experience)."""
from __future__ import annotations

import asyncio
import json
import logging
import re

logger = logging.getLogger(__name__)

# The form's own questions (ValidationWizardPage), with the choices its dropdowns allow. "text" is a short answer,
# "many" several of the choices.
SCHEMA: dict[str, dict[str, tuple[str, list[str] | None]]] = {
    "step1": {
        "idea_tagline": ("one sentence on what it is and who it is for", None),
        "idea_description": ("two or three sentences: what is offered, to whom, where and how", None),
        "idea_type": ("choice", ["Professional service", "Local service", "Digital service", "SaaS", "Software product", "Mobile application",
                                 "Marketplace", "Platform business", "Physical product", "E-commerce", "Subscription business",
                                 "Training or education", "Event or conference", "Community or membership", "Property or real estate",
                                 "Manufacturing", "Franchise", "Social enterprise", "Nonprofit", "Hybrid", "Other"]),
        "idea_sector": ("the sector, a few words", None),
        "customer_model": ("choice", ["B2C", "B2B", "B2B2C", "B2G", "C2C", "Hybrid"]),
        "future_geography": ("where it could grow next, a few words", None),
    },
    "step2": {
        "who_affected": ("who has the problem, one phrase", None),
        "problem_trigger": ("what triggers the problem, one phrase", None),
        "pain_severity": ("choice", ["mild", "moderate", "severe", "critical"]),
        "problem_frequency": ("choice", ["daily", "weekly", "monthly", "quarterly", "rarely", "unknown"]),
        "urgency": ("choice", ["urgent", "moderate", "deferrable", "unknown"]),
        "problem_trend": ("choice", ["growing", "stable", "declining", "unknown"]),
        "problem_affects": ("choice", ["Buyer only", "End user only", "Both buyer and user", "Unknown"]),
        "financial_impact_description": ("what the problem costs them, one phrase", None),
        "if_nothing": ("what happens if the customer does nothing, one phrase", None),
    },
    "step3": {
        "secondary_segment": ("a second customer group, one phrase", None),
        "beachhead_segment": ("the first, most focused customer group, one phrase", None),
        "customer_specificity": ("choice", ["broad", "moderate", "narrow", "niche"]),
        "economic_buyer": ("who pays, a role", None),
        "end_user": ("who uses it, a role", None),
        "decision_maker": ("who decides, a role", None),
        "purchase_frequency": ("choice", ["one-off", "daily", "weekly", "monthly", "quarterly", "annually", "irregular", "unknown"]),
        "buying_triggers": ("what makes them buy now, one phrase", None),
        "channels": ("many", ["Paid ads", "Organic/SEO", "Social media", "Email", "Referrals", "Partnerships", "Direct sales", "Events",
                              "Marketplace", "Cold outreach", "PR/Media", "In-store", "Other"]),
        "main_objections": ("their main objections, one sentence", None),
    },
    "step4": {
        "how_solve_currently": ("how they solve it today, one sentence", None),
        "direct_competitors": ("the usual kinds of competitor there, one sentence (kinds, never invented names)", None),
        "alternative_frustrations": ("what frustrates them about today's options, one sentence", None),
        "existing_spending": ("what they spend on it today, one phrase", None),
        "switching_barriers": ("what stops them switching, one phrase", None),
    },
    "step5": {
        "solution_description": ("what the service or product does, one or two sentences", None),
        "core_outcome": ("the main result the customer gets, one phrase", None),
        "delivery_method": ("choice", ["Web app (SaaS)", "Mobile app", "Desktop software", "API / integration", "In-person service",
                                       "Remote service", "Physical product delivery", "Marketplace", "Hybrid digital and physical", "Other"]),
        "why_better": ("why it is better than today's options, one sentence", None),
        "behaviour_change": ("what the customer has to do differently, one phrase", None),
        "time_to_value": ("how soon they see the result, one phrase", None),
        "defensibility": ("what would make it hard to copy, one phrase", None),
    },
    "step6": {
        "market_category": ("the market category, a few words", None),
        "estimated_customers": ("roughly how many potential customers there, one phrase, said as an estimate", None),
        "market_scope": ("choice", ["local", "regional", "national", "global"]),
    },
    "step7": {
        "revenue_model": ("choice", ["One-off sale", "Subscription", "Usage-based", "Freemium", "Marketplace commission", "Service fee",
                                     "Licensing", "Advertising", "Donation/Grant", "Hybrid", "Other"]),
        "payment_frequency": ("how often they pay, one or two words", None),
    },
    "step9": {
        "delivery_unit": ("what one sale is, a few words (one job, one visit)", None),
        "key_bottleneck": ("what limits how much can be delivered, one phrase", None),
    },
    "step12": {
        "regulatory_risk_level": ("choice", ["none", "low", "medium", "high", "unknown"]),
    },
}

_SYSTEM = ("You fill in an idea validation form for a small business idea, as a careful adviser would, from what is known about it. "
           "Return JSON only: {\"stepN\": {\"field\": value}} for the fields asked, each answer specific to this idea, place and customer. "
           "For a choice, use exactly one of its options; for \"many\", a list of its options. Plain words, no marketing language, no "
           "invented names, figures or evidence. Use null for anything you cannot answer sensibly.")


def _empty(v) -> bool:
    return v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, (list, dict)) and not v)


def _open(v, options) -> bool:
    """Not answered yet: empty, or a choice still on its catch-all ("Other", "unknown": the Agent's own first guess)."""
    return _empty(v) or (options is not None and isinstance(v, str) and v.strip().lower() in ("other", "unknown"))


def asked(form: dict) -> dict:
    """The questions still empty on the form, as the model is asked them."""
    out = {}
    for step, fields in SCHEMA.items():
        have = form.get(step) or {}
        want = {f: (k if options is None else {"type": k, "options": options}) for f, (k, options) in fields.items() if _open(have.get(f), options)}
        if want:
            out[step] = want
    return out


def take(form: dict, got: dict) -> tuple[dict, list[str]]:
    """The model's answers, only into empty questions and only as the form allows: a choice from its options, text kept short."""
    form = {s: dict(v) for s, v in form.items() if isinstance(v, dict)} | {s: v for s, v in form.items() if not isinstance(v, dict)}
    filled = []
    for step, fields in SCHEMA.items():
        answers = got.get(step) if isinstance(got.get(step), dict) else {}
        for f, (kind, options) in fields.items():
            if not _open((form.get(step) or {}).get(f), options):
                continue
            v = answers.get(f)
            if options is not None and kind == "many":
                by = {o.lower(): o for o in options}
                v = [by[str(x).strip().lower()] for x in (v if isinstance(v, list) else []) if str(x).strip().lower() in by]
                v = list(dict.fromkeys(v))
            elif options is not None:
                by = {o.lower(): o for o in options}
                v = by.get(str(v or "").strip().lower())
            else:
                v = " ".join(str(v or "").split())[:400] if isinstance(v, (str, int, float)) else ""
                if v.lower() in ("null", "none", "unknown", "n/a"):
                    v = ""
            if _empty(v):
                continue
            form.setdefault(step, {})[f] = v
            filled.append(f"{step}.{f}")
    return form, filled


async def fill(llm, form: dict, facts: dict, seconds: float = 30) -> tuple[dict, list[str]]:
    """Every empty question on the form answered in one call; the form as it was when there is no model or no answer."""
    want = asked(form)
    if llm is None or not want:
        return form, []
    prompt = "IDEA:\n" + json.dumps(facts, ensure_ascii=False)[:2500] + "\nFORM SO FAR:\n" + json.dumps(form, ensure_ascii=False)[:3000] \
             + "\nFIELDS TO FILL:\n" + json.dumps(want, ensure_ascii=False)
    try:
        res = await asyncio.wait_for(llm.generate_text(system=_SYSTEM, prompt=prompt, feature="agent_plan_inputs", max_tokens=1800), seconds)
        m = re.search(r"\{.*\}", str(getattr(res, "text", "") or ""), re.S)
        got = json.loads(m.group(0)) if m else {}
    except Exception:      # noqa: BLE001 - the form as it was: the owner can still fill the rest, or press AI Suggest
        logger.info("idea validation form not filled in full", exc_info=True)
        return form, []
    return take(form, got if isinstance(got, dict) else {})
