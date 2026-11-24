"""What Business Operations and the business profile already prove for a launch plan (the owner, 29 Oct: "it can fetch
these from the business operations"): dated sales and quotations of the offering as demand evidence, a paid sale of it as
the end-to-end test run, and the business's registration as the permit to operate. Only real records: nothing is made up.
The evidence goes on the plan unreviewed (the owner still confirms they reviewed it); the test run and the permit wait as
drafts to approve."""
from __future__ import annotations

import logging
import re
from datetime import date

logger = logging.getLogger(__name__)

_STOP = {"making", "make", "service", "services", "launch", "product", "products", "new", "business", "plan", "with", "from", "your",
         "this", "that", "for", "and", "the", "sale", "sales"}
_PERMIT = re.compile(r"\b(?:operat\w*|regist\w*|incorporat\w*|business name|cac|company)\b", re.I)


def _words(plan: dict) -> set[str]:
    """The offering's own words ("Soap Making": soap), to find its records."""
    text = " ".join(str(plan.get(k) or "") for k in ("name",)) + " " + str(((plan.get("offer") or {}).get("launch_scope")) or "")
    out = set()
    for w in re.findall(r"[a-z]{4,}", text.lower()):
        if w in _STOP:
            continue
        out.add(w[:-1] if w.endswith("s") and len(w) > 4 else w)      # "soaps" is soap
    return out


def _text(doc: dict) -> str:
    items = doc.get("items") or doc.get("line_items") or []
    parts = [str(doc.get(k) or "") for k in ("description", "title", "notes", "service", "product_name")]
    parts += [str((i or {}).get(k) or "") for i in items if isinstance(i, dict) for k in ("name", "description", "item_name", "product_name")]
    return " ".join(parts).lower()


def _ref(doc: dict, kind: str) -> str:
    return str(doc.get("invoice_number") or doc.get("quote_number") or doc.get("number") or doc.get("reference") or doc.get("id") or kind)


def records_for(data: dict, plan: dict, today: date) -> dict:
    """The offering's dated sales and quotations, and the business's registration, from the records."""
    from app.modules.agent import business as bz
    from app.modules.agent.research import _paid_on, paid_invoices
    words = _words(plan)
    hit = lambda doc: bool(words) and any(re.search(rf"\b{re.escape(w)}", _text(doc)) for w in words)      # noqa: E731
    sales = [(i, d) for i, d, _v in paid_invoices(data, today) if hit(i) and d <= today]
    fin = data.get("financials") or {}
    quotes = []
    for q in fin.get("quotes") or fin.get("quotations") or []:
        if isinstance(q, dict) and not q.get("archived") and bz.status_of(q) not in ("", "draft", "void", "cancelled") and hit(q):
            d = bz.parse_day(q.get("sent_at") or q.get("issue_date") or q.get("date") or q.get("created_at"))
            if d and d <= today:
                quotes.append((q, d))
    wp = data.get("workspace_profile") or {}
    reg = data.get("registration") or {}
    number = str(wp.get("registration_number") or wp.get("company_number") or reg.get("company_number") or reg.get("registration_number") or "").strip()
    since = bz.parse_day(wp.get("registration_date") or wp.get("incorporation_date") or reg.get("registration_date") or reg.get("incorporated_on"))
    return {"sales": sorted(sales, key=lambda x: x[1], reverse=True)[:3], "quotes": sorted(quotes, key=lambda x: x[1], reverse=True)[:3],
            "registration": {"number": number, "since": since} if number else None, "words": words}


async def gather(svc, user: dict, business_id: str, plan_id: str, plan: dict, data: dict, today: date) -> dict:
    """{"drafts": {path: draft}, "found": [what was found, in words], "none": [what the records don't hold]}. Demand evidence
    is attached to the plan (once per record); the test run and the permit are returned as drafts."""
    from app.modules.readiness import engine, rules
    got = records_for(data, plan, today)
    email = user.get("email")
    try:
        have = {str(((e.get("source") or {}).get("reference")) or "") for e in await svc.list_evidence(user["id"], business_id, email)}
    except Exception:      # noqa: BLE001
        have = set()
    found, none, drafts = [], [], {}
    at = today.isoformat()

    async def attach(title: str, etype: str, claim: str, ref: str, day: date, check: str) -> str | None:
        if ref in have:
            return None
        try:
            made = await svc.add_evidence(user["id"], business_id, {"title": title[:200], "type": etype, "claim": claim[:1000],
                                                                    "source": {"kind": "record", "reference": ref}, "effective_date": day.isoformat(),
                                                                    "links": [{"subject_id": plan_id, "check": check}]}, email, feature=rules.LAUNCH)
            have.add(ref)
            return (made or {}).get("id")
        except Exception:      # noqa: BLE001 - one record that can't be added never stops the rest
            logger.info("record not added as evidence: %s", ref, exc_info=True)
            return None

    # Demand: each dated sale or quotation of this offering
    n = 0
    for doc, day in got["sales"]:
        ref = f"Invoice {_ref(doc, 'invoice')}"
        if await attach(f"Sale: {ref}", "sale", f"Paid by {doc.get('customer_name') or 'a customer'} on {day.isoformat()}.", ref, day, "C1.A"):
            n += 1
    for doc, day in got["quotes"]:
        ref = f"Quotation {_ref(doc, 'quote')}"
        if await attach(f"Quotation: {ref}", "enquiry", f"Quoted to {doc.get('customer_name') or 'a customer'} on {day.isoformat()}.", ref, day, "C1.A"):
            n += 1
    if n:
        found.append(f"{n} dated sale{'s' if n != 1 else ''} or quotation{'s' if n != 1 else ''} from Business Operations, attached as demand evidence")
    elif not (got["sales"] or got["quotes"]):
        none.append("For demand evidence, send a quotation or invoice for it from Business Operations, or attach customer messages or preorders")

    # The test run: a paid sale of this offering went from order to delivery to payment
    run = engine.get(plan, "operations.dry_run") or {}
    if got["sales"] and run.get("outcome") not in ("passed", "failed"):
        doc, day = got["sales"][0]
        drafts["operations.dry_run"] = {"value": {"date": day.isoformat(), "outcome": "passed",
                                                  "process_version": str(engine.get(plan, "operations.process_version") or "1"),
                                                  "notes": f"Invoice {_ref(doc, 'invoice')}: ordered, delivered and paid on {day.isoformat()}."},
                                        "source": "from your business records", "at": at}
        found.append(f"a paid sale (Invoice {_ref(doc, 'invoice')}) as your test run")
    elif not got["sales"] and run.get("outcome") not in ("passed", "failed"):
        none.append("For the test run, record your first paid sale of it in Business Operations, or note a trial order on Inputs")

    # The permit: the business's registration, where the plan needs one to operate
    prereqs = [p for p in (plan.get("prerequisites") or []) if isinstance(p, dict)]
    need = [p for p in prereqs if p.get("status") != "completed" and _PERMIT.search(str(p.get("name") or ""))]
    reg = got["registration"]
    if need and reg:
        ref = f"Registration {reg['number']}"
        eid = await attach(f"Business registration {reg['number']}", "permission", f"The business is registered, number {reg['number']}.", ref,
                           reg["since"] if reg["since"] and reg["since"] <= today else today, "C6.B")
        if eid:
            done = {str(p.get("id")) for p in need}
            drafts["prerequisites"] = {"value": [{**p, "status": "completed", "evidence_id": eid} if str(p.get("id")) in done else p for p in prereqs],
                                       "source": "your business registration, from your business profile", "at": at, "replaces": prereqs}
            found.append(f"your business registration ({reg['number']}) for: {', '.join(str(p.get('name')) for p in need)}")
    elif need:
        none.append("For the permit, add your registration number to your business profile (Business Registration can help you get one)")
    return {"drafts": drafts, "found": found, "none": none}


def said(out: dict) -> str:
    """One line on what the records gave and what they don't hold."""
    parts = []
    if out.get("found"):
        parts.append("From your records I added " + "; ".join(out["found"]) + ".")
    if out.get("none"):
        # What the records don't hold, each with how to add it, so the owner always knows the next step (30 Oct)
        parts.append("Your records don't show these yet, so I'll pick them up once they're there: " + " ".join(f"{x}." for x in out["none"]))
    return " ".join(parts)
