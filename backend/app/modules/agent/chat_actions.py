"""What the chat's buttons do inside the conversation (the owner, 27 Oct: "the action buttons should make the agent do the
work and show the result in the chat, not send the user to another page"): run a scenario on the business's own figures,
preview a draft, change it from what the owner typed, postpone it until a day they pick, and read a document they attach.
Nothing here sends, saves or shares anything outside the business: a changed draft waits for approval again."""
from __future__ import annotations

import asyncio
import io
import json
import logging
import re
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# ── Scenarios on the business's own figures ─────────────────────────────────

SCENARIOS = {
    # The main customer's orders down by about a third, as a revenue drop of their share times 30%
    "order_reduction": {"template": "tmpl_revenue_drop", "name": "Main customer orders down 30%"},
    # Customers paying two months late
    "payment_delay": {"template": "tmpl_payment_delay", "name": "Payments arriving 60 days late"},
}


async def scenario(user: dict, business_id: str, kind: str) -> dict:
    """The scenario run on the business's figures, as a card: revenue, profit and cash before and after, said in one line."""
    from fastapi import HTTPException
    from app.modules.agent import research
    from app.modules.agent.router import get_orchestrator
    from app.modules.scenario_intelligence import router as si
    from app.modules.scenario_intelligence import service as sis
    from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot
    spec = SCENARIOS[kind]
    state = await si.shared_state(user, business_id, BusinessStateSnapshot())
    enough = sis.sufficiency(state)
    if not enough["enough"]:
        return {"type": "scenario", "kind": kind, "title": spec["name"], "missing": enough["missing"],
                "summary": "There isn't enough on record to run this yet: " + " and ".join(m.lower() for m in enough["missing"]) + ". Nothing was run or charged."}
    try:
        await asyncio.wait_for(si._require_scenario(user["id"], spec["template"], spec["name"], business_id=business_id), 15)
    except asyncio.TimeoutError:
        return {"type": "scenario", "kind": kind, "title": spec["name"], "gate": {"message": "timeout"},
                "summary": "I couldn't check your plan just now, so nothing was run or charged. Please try again in a moment."}
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
        return {"type": "scenario", "kind": kind, "title": spec["name"], "gate": detail, "summary": detail.get("message") or "This scenario isn't on your plan yet."}
    template = si.resolve_template(spec["template"])
    share = float(state.top_client_share_pct or 0)
    # Customers paying late is the month's sales arriving later: the engine delays what is owed, so a month's revenue is what is
    # owed (the owner, 28 Oct: "cash after 6 months" came out the same, with no receivables on record)
    params = {"timeline_months": 6, **({"revenue_drop_pct": round(share * 0.3, 1) if share else 20.0} if kind == "order_reduction"
                                       else {"delay_months": 2, "selected_pending_receivable_amount": float(state.revenue_monthly or 0)})}
    # The figures worked out here, in a moment; the run is kept in the Simulation history after the answer is given
    # (the owner, 27 Oct: "Simulate order reduction timed out after about a minute"; the saving was the slow part).
    timeline, metrics = sis._timeline(state, template.scenario_type, params, 6)
    _keep(sis.create_scenario_run(tenant_id=user.get("email") or user["id"], business_id=business_id, state_version="state_v1.0", template_id=spec["template"],
                                  scenario_mode="manual", scenario_name=spec["name"], scenario_type=template.scenario_type, params=params, state=state))
    base, after = metrics.get("baseline_metrics") or {}, metrics.get("scenario_metrics") or {}
    months = len(timeline) or 6
    cash_base = round(float(state.starting_cash or 0) + months * float(base.get("net_profit") or 0), 2)
    cash_after = round(float((timeline[-1] if timeline else {}).get("cash_balance") or cash_base), 2)
    data = await get_orchestrator().rt.business.load(business_id) or {}
    ccy = research.task_currency(data)
    m = lambda n: research.money(n, ccy)      # noqa: E731
    rev_b, rev_a = float(base.get("monthly_revenue") or 0), float(after.get("monthly_revenue") or 0)
    net_b, net_a = float(base.get("net_profit") or 0), float(after.get("net_profit") or 0)
    if kind == "order_reduction":
        line = (f"If your main customer's orders fell by about 30%, monthly revenue would go from {m(rev_b)} to {m(rev_a)} and profit from {m(net_b)} to {m(net_a)}. "
                f"After {months} months you'd have about {m(cash_after)} in cash, against {m(cash_base)} as things are.")
    else:
        line = (f"If customers paid 60 days late, revenue stays at {m(rev_b)} a month but the cash arrives later: after {months} months you'd have about "
                f"{m(cash_after)}, against {m(cash_base)} as things are.")
    if cash_after < 0:
        line += " That would leave you short of cash."
    return {"type": "scenario", "kind": kind, "title": spec["name"], "currency": ccy, "months": months,
            "rows": [{"label": "Monthly revenue", "before": m(rev_b), "after": m(rev_a)}, {"label": "Monthly profit", "before": m(net_b), "after": m(net_a)},
                     {"label": f"Cash after {months} months", "before": m(cash_base), "after": m(cash_after)}],
            "worse": cash_after < cash_base or net_a < net_b, "summary": line, "to": "/simulation"}


_SAVING: set = set()      # the runs being kept, held until they finish
_JOBS: dict[str, tuple[str, asyncio.Task]] = {}      # a scenario still running after the first wait: id → (who, task)
FIRST_WAIT = 20      # seconds the request waits before saying it is still working


def _keep(coro) -> None:
    async def run():
        try:
            await coro
        except Exception:      # noqa: BLE001 - the answer was given; only the history entry is missing
            logger.info("scenario run not saved", exc_info=True)
    task = asyncio.create_task(run())
    _SAVING.add(task)
    task.add_done_callback(_SAVING.discard)


async def start_scenario(user: dict, business_id: str, kind: str, wait: float | None = None) -> dict:
    """The scenario's card, or, if it is still working after the first wait, a job the chat asks after until it is done."""
    import uuid
    task = asyncio.create_task(scenario(user, business_id, kind))
    try:
        return await asyncio.wait_for(asyncio.shield(task), FIRST_WAIT if wait is None else wait)
    except asyncio.TimeoutError:
        job = uuid.uuid4().hex
        _JOBS[job] = (str(user["id"]), task)
        return {"type": "scenario", "kind": kind, "title": SCENARIOS[kind]["name"], "pending": True, "job_id": job}


def scenario_job(user: dict, job: str) -> dict | None:
    """The job's card when done, {"pending": True} while it runs, None if it isn't this person's."""
    who, task = _JOBS.get(job, (None, None))
    if task is None or who != str(user["id"]):
        return None
    if not task.done():
        return {"pending": True, "job_id": job}
    _JOBS.pop(job, None)
    if task.exception():
        return {"type": "scenario", "summary": "I couldn't finish that scenario. Nothing was saved or charged.", "failed": True}
    return task.result()


# ── Postponed until a day the owner picks ───────────────────────────────────

def postponed(data: dict | None, user_id: str, now: datetime) -> set[str]:
    """What the owner postponed and is not due back yet."""
    out = set()
    for key, until in (((data or {}).get("agent_postponed") or {}).get(str(user_id)) or {}).items():
        try:
            if datetime.fromisoformat(str(until)) > now:
                out.add(str(key))
        except ValueError:
            continue
    return out


def until_of(when: str, now: datetime) -> datetime:
    """Tomorrow (9am) or next week (Monday 9am), from now."""
    day = now + (timedelta(days=1) if when == "tomorrow" else timedelta(days=7 - now.weekday() if now.weekday() < 7 else 7))
    return day.replace(hour=9, minute=0, second=0, microsecond=0)


def card_key(card: dict) -> str:
    return str(card.get("approval_id") or card.get("draft_id") or card.get("run_id") or card.get("title") or "")


# ── A draft, previewed and changed in the chat ──────────────────────────────

async def preview(user: dict, business_id: str, *, run_id: str | None = None, draft_id: str | None = None) -> dict:
    """What a waiting item says, to read in the chat: a document's text, or a quote, invoice or reminder's lines."""
    from app.modules.agent.router import get_orchestrator
    orch = get_orchestrator()
    data = await orch.rt.business.load(business_id) or {}
    drafts_ = [x for x in data.get("agent_drafts") or [] if isinstance(x, dict) and x.get("status") not in ("accepted", "rejected", "replaced")]
    # A document the task made is a draft, not an approval (the owner, 30 Oct: a business plan made, its card "This isn't waiting
    # any more"): found by its id, else by the task that made it
    d = next((x for x in drafts_ if draft_id and x.get("id") == draft_id), None) or next((x for x in drafts_ if run_id and x.get("run_id") == run_id), None)
    if draft_id and not d:
        return {"found": False}
    if d:
        text = await _document_text(user, d)
        return {"found": True, "kind": d.get("kind"), "title": d.get("title"), "text": text[:12000], "to": d.get("to"), "editable": bool(d.get("ref")) and bool(text)}
    run = await orch.rt.store.get_run(run_id) if run_id else None
    if not run or str(run.get("business_id")) != str(business_id):
        return {"found": False}
    approvals = await orch.rt.store.list_approvals(business_id=business_id, status="pending")
    a = next((x for x in approvals if x.get("run_id") == run_id), None)
    p = (a or {}).get("payload") or {}
    # The quantity as either name holds it, and the VAT said, never added silently (QA F8, 30 Oct)
    lines = [{"name": str(i.get("name") or i.get("description") or "Item"), "quantity": i.get("quantity") if i.get("quantity") is not None else i.get("qty"),
              "unit_price": i.get("unit_price")}
             for i in p.get("items") or [] if isinstance(i, dict)]
    return {"found": True, "kind": (a or {}).get("tool_id"), "approval_id": (a or {}).get("id") or (a or {}).get("approval_id"),
            "title": (a or {}).get("title") or run.get("title"), "customer": p.get("customer_name"), "to_email": p.get("to_email"),
            "lines": lines, "total": p.get("total") or p.get("amount") or p.get("total_amount"), "currency": p.get("currency"), "message": p.get("message") or p.get("body"),
            "due_date": p.get("due_date"), "valid_until": p.get("valid_until"), "notes": p.get("notes"), "editable": True,
            "vat_rate": p.get("vat_rate"), "vat_amount": p.get("vat_amount")}


async def _document_text(user: dict, d: dict) -> str:
    if not d.get("ref"):
        return ""
    try:
        from app.modules.blueprint import repository
        doc = await repository.get_document(user_id=user["id"], document_id=str(d["ref"]))
    except Exception:      # noqa: BLE001 - no text to show: the full document opens from its page
        logger.info("draft %s: document not read", d.get("id"), exc_info=True)
        return ""
    return str(getattr(doc, "document_markdown", None) or "") if doc else ""


_EDIT_FIELDS = ("items", "vat_rate", "notes", "customer_email", "valid_until", "payment_terms_days", "discount", "due_date", "description", "message", "amount_requested")


async def revise(user: dict, business_id: str, instruction: str, *, run_id: str | None = None, draft_id: str | None = None) -> dict:
    """The owner's change, typed in the chat, made to the draft: a quote's or invoice's fields through the same edit as its
    page (its approval is asked for again), a document's text rewritten where they asked. Never sent or shared."""
    from app.modules.agent import research
    from app.modules.agent.router import get_orchestrator
    llm = research._default_llm(user["id"])
    if llm is None:
        return {"ok": False, "message": "I can't make changes from the chat just now. Open the draft to edit it."}
    before = await preview(user, business_id, run_id=run_id, draft_id=draft_id)
    if not before.get("found"):
        return {"ok": False, "message": "That draft isn't waiting any more."}
    if run_id:
        prompt = json.dumps({"DRAFT": {k: before.get(k) for k in ("kind", "customer", "to_email", "lines", "total", "message", "due_date", "valid_until", "notes")},
                             "CHANGE": instruction[:1000]}, ensure_ascii=False, default=str)
        system = ("You change a business document waiting for approval, as the owner asked. Reply with JSON only: the fields to change, from "
                  + ", ".join(_EDIT_FIELDS) + ". items is the whole list [{name, quantity, unit_price}]. Change only what they asked; never invent a figure.")
        try:
            res = await llm.generate_text(system=system, prompt=prompt, feature="agent_conversation", max_tokens=600)
            m = re.search(r"\{.*\}", getattr(res, "text", "") or "", re.S)
            changes = {k: v for k, v in (json.loads(m.group(0)) if m else {}).items() if k in _EDIT_FIELDS}
        except Exception:      # noqa: BLE001
            changes = {}
        if not changes:
            return {"ok": False, "message": "I couldn't tell what to change. Say it another way, for example \"make the total ₦150,000\"."}
        await get_orchestrator().edit_draft(run_id, user["id"], changes, user.get("email"))
        return {"ok": True, "message": "Done. Here's the updated draft. It waits for your approval again; nothing has been sent.",
                "preview": await preview(user, business_id, run_id=run_id)}
    text = before.get("text") or ""
    if not text:
        return {"ok": False, "message": "This draft can only be changed on its own page."}
    system = ("You edit a business document in Markdown as the owner asked. Change only what they asked, keep everything else word for word, and "
              "never add figures they didn't give. Reply with the whole revised document in Markdown, nothing else.")
    try:
        res = await llm.generate_text(system=system, prompt=f"CHANGE: {instruction[:1000]}\n\nDOCUMENT:\n{text[:12000]}", feature="agent_conversation", max_tokens=4000)
        revised = (getattr(res, "text", "") or "").strip()
    except Exception:      # noqa: BLE001
        revised = ""
    if len(revised) < max(200, len(text) // 3):
        return {"ok": False, "message": "I couldn't make that change safely. Open the full document to edit it."}
    d = next((x for x in (await get_orchestrator().rt.business.load(business_id) or {}).get("agent_drafts") or [] if x.get("id") == draft_id), {})
    from app.modules.blueprint import repository
    from app.modules.blueprint.schemas import BlueprintDocumentUpdateRequest
    saved = await repository.update_document(user_id=user["id"], document_id=str(d.get("ref")), patch=BlueprintDocumentUpdateRequest(document_markdown=revised))
    if not saved:
        return {"ok": False, "message": "I couldn't save that change. Open the full document to edit it."}
    return {"ok": True, "message": "Done. Here's the updated draft. It still waits for your approval.", "preview": await preview(user, business_id, draft_id=draft_id)}


# ── A document attached in the chat ─────────────────────────────────────────

def text_of(name: str, content_type: str, content: bytes) -> str:
    """The words in a document, for a short reading: plain text, CSV and Markdown as they are, a PDF's text where it has any."""
    n = (name or "").lower()
    if content_type.startswith("text/") or n.endswith((".txt", ".csv", ".md")):
        return content.decode("utf-8", "ignore")[:8000]
    if n.endswith(".pdf") or content_type == "application/pdf":
        try:
            from pypdf import PdfReader
            return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(content)).pages[:10])[:8000]
        except Exception:      # noqa: BLE001 - kept, read on its own page
            return ""
    return ""


async def attach(user: dict, business_id: str, name: str, content_type: str, content: bytes) -> dict:
    """The file kept with the business's evidence (where the funding and launch checks read it), and what it seems to be."""
    from app.modules.agent import research
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for
    from app.modules.agent.router import get_orchestrator
    from app.modules.readiness.service import FILE_TYPES, MAX_FILE_BYTES
    svc = service_for(get_orchestrator())
    if content_type not in FILE_TYPES:
        # Named by its extension when the browser labels it oddly (Windows sends a CSV as Excel, or no type at all)
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        content_type = next((t for t, e in FILE_TYPES.items() if e == ext or (ext == "jpeg" and e == "jpg")), content_type)
    if content_type not in FILE_TYPES:
        raise ValueError("Attach a PDF, image, Word, Excel, CSV or text file.")
    if not content or len(content) > MAX_FILE_BYTES:
        raise ValueError("The file is empty or larger than 10 MB.")      # checked first: nothing is saved for a file that can't be kept
    today = get_orchestrator().rt.clock().date().isoformat()
    item = await svc.add_evidence(user["id"], business_id, {"title": name[:200], "type": "document", "claim": "", "effective_date": today,
                                                            "source": {"kind": "file", "reference": name[:200]}, "links": []}, user.get("email"), rules.FUNDING)
    await svc.attach_file(user["id"], business_id, item["id"], name, content_type, content, user.get("email"), rules.FUNDING)
    words = text_of(name, content_type, content)
    found = ""
    llm = research._default_llm(user["id"]) if words else None
    if llm:
        try:
            res = await llm.generate_text(system=("Say in two short plain sentences what this business document is and what in it matters for the business "
                                                  "(figures, customers, dates). Never invent; if it is unclear, say so. No dashes."),
                                          prompt=words[:6000], feature="agent_conversation", max_tokens=160)
            found = " ".join(str(getattr(res, "text", "") or "").split()).replace("—", ", ").replace("–", " to ")
        except Exception:      # noqa: BLE001
            found = ""
    return {"evidence_id": item["id"], "name": name,
            "message": (f"{found} " if found else ("I couldn't read the text in it, " if not words else "")) +
                       f"I've saved {name} with your business evidence, where your funding and launch checks can use it. Nothing was shared."}
