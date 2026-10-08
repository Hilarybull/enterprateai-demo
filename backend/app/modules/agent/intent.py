"""Intent + enquiry interpretation (s5.1, s15.2).

Deterministic rules run first: they are free, predictable and immune to prompt
injection. The LLM is consulted only when the rules are unsure, and its answer
is accepted only if it is one of a fixed set of options. It can never invent a
capability or reach a tool: workflows, not the model, decide which tools run.
"""
from __future__ import annotations

import re
from typing import Any

from app.modules.agent.services import Classifier

ENQUIRY_CLASSES = ["quotation_request", "proposal_request", "complaint", "general_enquiry", "uncertain"]

_COMPLAINT = re.compile(r"\b(complain\w*|refund|unhappy|disappointed|terrible|poor service|not working|faulty|damaged|chargeback|dispute)\b", re.I)
_PROPOSAL = re.compile(r"\b(proposal|tender|rfp|request for proposal|pitch|bid)\b", re.I)
_QUOTE = re.compile(r"\b(quot\w*|estimate|how much|price|pricing|cost|rate card|rates)\b", re.I)

# Capability routing for user goals. Order matters: most specific first.
_START = r"^\s*(?:please\s+|can you\s+|could you\s+|i(?:'d| would) like to\s+|i (?:need|want) to\s+)?"
_ONE = r"(?:a\s+|an\s+|the\s+|my\s+|new\s+|another\s+)*"
_GOAL_RULES: list[tuple[str, re.Pattern]] = [
    # Records kept after one confirmation.
    ("credit_note", re.compile(r"\b(credit notes?|refund\w*|credit (?:the |an |that |this )?invoice)\b", re.I)),
    ("record_payment", re.compile(r"\b(?:record|log|add|enter|mark)\s+" + _ONE + r"payment\b|\bpayment (?:received )?from\b|\bmark\b.*\bas paid\b|\b(?:has|have) paid\b|\bpaid\s+(?:us\s+|me\s+)?(?:[£$€₦]|\d)", re.I)),
    ("marketplace_profile", re.compile(r"\bmarketplace (?:profile|listing|description)\b|\b(?:update|edit|change|improve)\b.*\bmarketplace\b.*\b(?:profile|description|page)\b", re.I)),
    ("marketplace_offering", re.compile(r"\b(?:un)?(?:list|publish)\b.*\b(?:marketplace|offering|service|product|item)\b|\b(?:remove|hide|take)\b.*\b(?:from|off) (?:the )?marketplace\b"
                                        r"|\b(?:un)?list\s+\S", re.I)),
    ("supplier_bill", re.compile(r"\bsupplier bill\b|\bbill from\b|\b(?:record|log|add|enter)\s+" + _ONE + r"bill\b", re.I)),
    ("record_expense", re.compile(r"\b(?:record|log|add|enter)\s+" + _ONE + r"(?:expense|cost)\b|\bnew expense\b", re.I)),
    ("new_purchase_order", re.compile(r"\bpurchase orders?\b|\bPO\b|\border\b.*\bfrom\b", re.I)),
    # A change to something already on record: pick it, then edit it.
    ("update_record", re.compile(r"\b(?:update|edit|change|correct|amend)\b.*\b(?:customer|client|vendor|supplier|catalogue item|catalog item|product|service|item|price of|email (?:of|for)|phone)\b", re.I)),
    ("add_customer", re.compile(_START + r"(?:add|create|save|set up)\s+" + _ONE + r"customer\b|\bnew customer\s*:", re.I)),
    ("add_vendor", re.compile(_START + r"(?:add|create|save|set up)\s+" + _ONE + r"(?:vendor|supplier)\b|\bnew (?:vendor|supplier)\s*:", re.I)),
    ("add_catalogue_item", re.compile(_START + r"(?:add|create|save|set up)\s+" + _ONE + r"(?:catalogue item|catalog item|product|service|item)\b", re.I)),
    # Documents.
    ("receipt_send", re.compile(r"\breceipts?\b", re.I)),
    ("payment_followup", re.compile(r"\b(remind\w*|chase|follow[- ]?up|overdue|late pay\w*|collect\w*)\b", re.I)),
    ("new_contract", re.compile(r"\b(contracts?|service agreements?|agreements?)\b", re.I)),
    # An invoice is made from a quotation only when the request points at one.
    ("quote_to_cash", re.compile(r"\b(quote to invoice|convert .*quot\w*|accepted quot\w*|turn .*quot\w* into|invoice (?:for |from )?(?:the |that |this |my )?(?:accepted )?quot\w*|invoice\w* (?:for |from )?QUO-\S+)\b", re.I)),
    ("new_invoice", re.compile(r"\b(invoice\w*|bill)\b", re.I)),
    ("new_proposal", re.compile(r"\bproposals?\b", re.I)),
    ("enquiry_to_quote", re.compile(r"\b(quot\w*|enquir\w*|inquir\w*|estimate)\b", re.I)),
    ("scenario_help", re.compile(r"\b(what[- ]?ifs?|what happens if|scenario|simulat\w*|if i lose|losing|cost increase)\b", re.I)),
    ("risk_concentration", re.compile(r"\b(risk\w*|concentration|fragil\w*|biggest client|depend\w* on)\b", re.I)),
    # Planning and preparation tasks. They were only ever started from a dashboard button, so asking
    # for one in words fell through to "isn't available as an Agent action yet": each has its words now.
    ("business_plan_draft", re.compile(r"\bbusiness plans?\b", re.I)),
    ("idea_validation", re.compile(r"\b(idea validation|validat\w+ (?:my |the |this |an? |our )?(?:business |startup |new )?idea|(?:test|score|check|assess) (?:my|an?|the|this|our) (?:business |startup |new )?idea)\b", re.I)),
    ("market_size", re.compile(r"\b(market siz\w+|size (?:of )?(?:the|my|our) market|how (?:big|large) is (?:the|my|our) market|market size)\b", re.I)),
    ("funding_pack_draft", re.compile(r"\b(funding pack|pitch deck|investor (?:pack|deck|summary|update)|(?:pack|deck|summary) for (?:investors?|funders?|lenders?))\b", re.I)),
    ("launch_evidence_gaps", re.compile(r"\b(launch (?:evidence|gaps?|checklist)|what(?:'s| is) missing (?:for|before) (?:my |the |our )?launch|(?:am i|are we) ready to launch)\b", re.I)),
    ("readiness_refresh", re.compile(r"\b(?:refresh|re-?run|update|re-?check) (?:my |the |our )?(?:funding |launch )?readiness\b|\breadiness (?:check|score|refresh)\b", re.I)),
    ("registration_checklist", re.compile(r"\b(regist\w+ (?:my|a|the|our) (?:company|business)|incorporat\w+|companies house|registration checklist)\b", re.I)),
    ("price_test", re.compile(r"\b(price test|test (?:a|my|the|our) price|pric(?:e|ing) (?:my|our|a|the)\b.*|what (?:should|to) (?:i |we )?charge|how much (?:should|to) (?:i |we )?charge|(?:raise|increase|put up) (?:my|our) prices?)", re.I)),
    ("capacity_check", re.compile(r"\b(capacity|how many (?:jobs|clients|customers|orders|projects) can (?:i|we)|(?:can (?:i|we)|(?:i|we) can) take on more)\b", re.I)),
    ("offer_review", re.compile(r"\b(offer review|what sells|best[- ]sell\w*|review (?:my|our|the) (?:offers?|offering\w*|services|products|catalogue)|which (?:products|services) (?:sell|make))\b", re.I)),
    ("expansion_scenario", re.compile(r"\b(expan\w+|grow\w* (?:my|the|our) business|growth plan|scale (?:up|my|the|our)|open (?:a|another) (?:second |new )?(?:site|branch|location|shop|office))\b", re.I)),
]
# Capabilities in the inventory that have no workflow yet (s5). Recognised so the Agent
# can say plainly that they aren't available, instead of guessing at another workflow.
_FUTURE_RULES: list[tuple[str, re.Pattern]] = [
    ("marketplace_rfq", re.compile(r"\b(rfqs?|marketplace)\b", re.I)),
    ("proposal", re.compile(r"\b(proposals?|tenders?|rfps?|bids?|pitch(es)?)\b", re.I)),
    ("business_planning", re.compile(r"\bbusiness plans?\b", re.I)),
    ("funding_readiness", re.compile(r"\b(funding|investors?|raise (money|capital|funds)|loans?|grants?)\b", re.I)),
    ("launch", re.compile(r"\b(launch\w*|incorporat\w*|register (my|a|the|our) (company|business))\b", re.I)),
    ("growth", re.compile(r"\b(grow(th)? (plan|strategy)|expand\w* (my|the|our) business)\b", re.I)),
]

# Questions are answered by the Assistant; only requests to act start a workflow (s4).
_QUESTION = re.compile(r"^\s*(what|why|how|when|who|which|is|are|do|does|can|could|should|explain|tell me|show me)\b", re.I)
_ACTION = re.compile(r"\b(prepare|create|draft|write|send|remind|chase|follow[- ]?up|convert|generate|make|issue|help me|run|simulate|analyse|analyze|review|respond|reply"
                     r"|record|log|add|save|update|edit|change|correct|amend|bill|invoice|quote|credit|refund|list|unlist|publish|unpublish|order|propose|i need|i want|paid)\b", re.I)


_SPLIT = re.compile(r"\s*(?:;|\n+|,?\s*\band then\b|,?\s*\bafter that\b,?|,?\s*\bthen also\b|,?\s*\band also\b|,?\s*\balso\b|,\s*then\b|\bthen\b(?=\s+(?:run|send|check|chase|prepare|draft|remind|create|do|show)\b)|,\s*and\b|\.\s+(?=[A-Z])|(?:^|\s)\d{1,2}[.)]\s+)\s*", re.I)


def rule_capability(text: str, supported: list[str]) -> str | None:
    """The capability the fixed rules give for a request to act, without any model. None for a
    question, or when no rule fits."""
    body = (text or "").strip()
    if not body or (_QUESTION.search(body) and not _ACTION.search(body) and not re.search(r"\bwhat (happens )?if\b", body, re.I)):
        return None
    return next((c for c, pattern in _GOAL_RULES if c in supported and pattern.search(body)), None)


def split_requests(text: str | None, supported: list[str]) -> list[str]:
    """A message that asks for several things ("send the receipt for INV-3 and then chase INV-7").
    It is split only when every part is plainly a task by the fixed rules and the parts are for
    different tasks; anything less certain stays one message."""
    parts = [p.strip(" .") for p in _SPLIT.split(text or "") if p and p.strip(" .")]
    if not 2 <= len(parts) <= 5:
        return []
    found = [rule_capability(p, supported) for p in parts]
    return parts if all(found) and len(set(found)) == len(found) else []


async def classify_enquiry(text: str, classifier: Classifier, user_id: str) -> tuple[str, str]:
    """Returns (classification, method). Enquiry text is untrusted data."""
    body = text or ""
    if _COMPLAINT.search(body):
        return "complaint", "rules"
    if _PROPOSAL.search(body):
        return "proposal_request", "rules"
    if _QUOTE.search(body):
        return "quotation_request", "rules"
    if classifier.available:
        try:
            choice = await classifier.choose(
                task="Classify this customer enquiry sent to a small business.",
                text=body, options=ENQUIRY_CLASSES, user_id=user_id,
            )
            if choice:
                return choice, "llm"
        except Exception:
            pass      # LLM failure must never break the workflow (s22.1)
    return ("general_enquiry" if len(body.split()) >= 4 else "uncertain"), "rules"


async def resolve_capability(text: str, classifier: Classifier, user_id: str, supported: list[str]) -> str | None:
    """Map a user goal to a supported capability, to a planned-but-unavailable one (the
    caller says so plainly), or None when the Assistant should answer instead."""
    body = (text or "").strip()
    if not body:
        return None
    wants_action = bool(_ACTION.search(body))
    if _QUESTION.search(body) and not wants_action and not re.search(r"\bwhat (happens )?if\b", body, re.I):
        return None
    for capability, pattern in _GOAL_RULES:
        if capability in supported and pattern.search(body):
            return capability
    for capability, pattern in _FUTURE_RULES:
        if capability not in supported and pattern.search(body):
            return capability
    if wants_action and classifier.available:
        try:
            choice = await classifier.choose(
                task="Pick the business workflow that best matches the user's request, or 'none'.",
                text=body, options=[*supported, "none"], user_id=user_id,
            )
            return choice if choice in supported else None
        except Exception:
            return None
    return None


def match_items(text: str, products: list[dict]) -> list[dict]:
    """Find catalogue products named in the text, with any stated quantity. Deterministic."""
    found: list[dict] = []
    body = text or ""
    for p in sorted(products, key=lambda x: len(str(x.get("name") or "")), reverse=True):
        name = str(p.get("name") or "").strip()
        if len(name) < 3:
            continue
        m = re.search(re.escape(name), body, re.I)
        if not m:
            continue
        qty = 1
        before = body[max(0, m.start() - 24):m.start()]
        after = body[m.end():m.end() + 24]
        qm = re.search(r"(\d{1,5})\s*(?:x|×|units?|pcs?|months?|weeks?|days?|hours?|hrs?|sessions?|years?)?(?:\s*of)?\s*$", before, re.I) or re.search(r"^\s*(?:x|×|:|-)?\s*(\d{1,5})\b", after, re.I)
        if qm:
            qty = max(1, int(qm.group(1)))
        if not any(f["product_id"] == p.get("id") for f in found):
            found.append({"product_id": p.get("id"), "name": name, "quantity": qty, "provenance": "enquiry_text"})
    return found


def match_candidates(candidates: list[dict], products: list[dict]) -> tuple[list[dict], list[dict]]:
    """Map LLM-extracted item names to catalogue products. Unmatched names are returned
    as missing information: they are never priced by guesswork."""
    matched, unmatched = [], []
    for c in candidates:
        cname = str(c.get("name") or "").strip().lower()
        hit = next((p for p in products if str(p.get("name") or "").strip().lower() == cname), None) \
            or next((p for p in products if cname and (cname in str(p.get("name") or "").lower() or str(p.get("name") or "").lower() in cname)), None)
        if hit:
            if not any(m["product_id"] == hit.get("id") for m in matched):
                matched.append({"product_id": hit.get("id"), "name": hit["name"], "quantity": int(c.get("quantity") or 1), "provenance": "llm_extraction"})
        else:
            unmatched.append({"name": c.get("name"), "quantity": int(c.get("quantity") or 1)})
    return matched, unmatched


_COMPANY = r"[A-Z][\w&'.-]*(?:\s+(?:[A-Z][\w&'.-]*|&|and|of))*"
_PERSON = r"[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?"
_COMPANY_SUFFIX = re.compile(rf"\b({_COMPANY}\s+(?:Ltd|Limited|LLP|PLC|Plc|Inc|LLC|Co))\b\.?")
_FROM = re.compile(rf"\b(?:I'm|I am|this is|it's|my name is)?\s*({_PERSON})\s+(?:from|at|of|with)\s+({_COMPANY})")
_INTRO = re.compile(rf"\b(?:I'm|I am|this is|my name is)\s+({_PERSON})\b")
_SIGN_OFF = re.compile(rf"\b(?:regards|thanks|thank you|cheers|best|sincerely)[,!.]?\s*\n+\s*({_PERSON})\b", re.I)
_NOT_NAMES = {"Hi", "Hello", "Dear", "Please", "Thanks", "Thank", "Regards", "Could", "Can", "We", "I", "Our", "The"}


def extract_contact(text: str) -> dict[str, Any]:
    """Who sent an enquiry, as far as the text itself says (s15.4). Deterministic and
    only ever a suggestion: the user confirms it before it's used."""
    body = text or ""
    email = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", body)
    person = company = None
    m = _FROM.search(body)
    if m and m.group(1).split()[0] not in _NOT_NAMES:
        person, company = m.group(1).strip(), m.group(2).strip().rstrip(".,")
    if not company:
        c = _COMPANY_SUFFIX.search(body)
        company = c.group(1).strip() if c else None
    if not person:
        for pattern in (_INTRO, _SIGN_OFF):
            p = pattern.search(body)
            if p and p.group(1).split()[0] not in _NOT_NAMES:
                person = p.group(1).strip()
                break
    return {"email": email.group(0).rstrip(".") if email else None, "person": person, "company": company,
            # A business customer is quoted under the company; otherwise under the person.
            "name": company or person}
