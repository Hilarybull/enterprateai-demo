"""The Agent as one conversation that talks and does tasks (the owner, 11 Nov: "it should be able to chat and still carry out
tasks when a task is required"). The model (Claude, OpenAI as its backup: app/shared/llm/tool_chat.py) reads the thread with
the business's context and either answers, looks something up, or does the task with a tool. Tasks run through the workflows
that already exist, with their checks and approvals: nothing is sent, saved for real or charged here without the owner's
go-ahead, whatever the model asks for.

Tools: invoices and quotations, funding and launch readiness (through their own conversations), an idea, the Idea Validation and
the business plan. Anything else is handed over to the chat that handles it today. Behind the conductor's switch."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from types import SimpleNamespace
from typing import Any

logger = logging.getLogger(__name__)

STEPS = 5               # model calls in one reply, tool use included
MODEL_SECONDS = 60.0
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SOCIAL = re.compile(
    r"^(?:hi|hello|hey|hiya|howdy|good\s+(?:morning|afternoon|evening)|"
    r"how\s+are\s+you(?:\s+doing)?(?:\s+(?:today|first))?|how'?s\s+it\s+going|you\s+good|"
    r"thanks|thank\s+you|cheers|nice\s+to\s+meet\s+you)[!.?,\s]*$",
    re.I,
)


def social_reply(text: str, turns: list[dict]) -> str | None:
    """Handle unmistakable greetings and courtesies as conversation, never as tool input.

    This small deterministic boundary is deliberate: the model still handles open-ended chat and
    tasks, but a pending tool question cannot turn a greeting into a field value or repeat itself.
    """
    body = " ".join(str(text or "").split())
    if not body or not _SOCIAL.fullmatch(body):
        return None
    low = body.lower().strip(" !?.,")
    recent = next((str(t.get("text") or t.get("content") or "") for t in reversed(turns)
                   if t.get("role") in ("agent", "assistant")), "")
    continuity = " We can pick up where we left off whenever you're ready." if "?" in recent else ""
    if low.startswith(("how are you", "how's it going", "you good")):
        return "I'm doing well, thanks for asking. What can I help you with?" + continuity
    if low.startswith(("thanks", "thank you", "cheers")):
        return "You're welcome. What else can I help with?" + continuity
    if low == "nice to meet you":
        return "Nice to meet you too. What would you like to work on?" + continuity
    greeting = next((x for x in ("Good morning", "Good afternoon", "Good evening") if low.startswith(x.lower())), None)
    return f"{greeting}! What would you like to work on?" + continuity if greeting else "Hi! What would you like to work on?" + continuity

SYSTEM = """You are the EnterprateAI Agent, the one assistant a small business owner talks to. You chat with them, and when \
what they say needs a task done, you do it with your tools. Plain UK English, warm and direct, short paragraphs, under 120 \
words unless they ask for more. Never use dashes as punctuation.

How to work:
- Reply to the latest message. A greeting or small talk gets a friendly reply and an offer of help, never a task. Never start or pick up a task from earlier in the thread unless the latest message asks for it.
- Answer questions yourself. Look things up with find_customer or read_catalogue instead of asking what the records already say.
- Invoices and quotations: you need who it's for and each item's name, quantity and price. Use the catalogue price when the \
item is in it. Ask only for what is still missing, all in one short question. For an invoice the customer's email is \
optional: if they say "later", "skip", "no email" or similar, leave it empty. A quotation needs the email. Never ask about \
discounts, notes, due dates or VAT unless they bring them up or a tool result asks for them.
- When you have what a tool needs, call it. A message can also be a side question or a change while a task is in progress: \
answer it, then carry on with the task.
- Interpret the meaning of what the owner wrote, not a list of expected words or a command template. Different wording can express the same intent. Use the whole recent conversation and business records to resolve references and continue the right task. When the owner wants to approve, reject, send, or change something, first call list_pending_items and match the intended item from context and its details. If more than one item could fit, ask which one. Call decide_pending_item only when the latest message clearly authorizes that decision. Approval means carry out the approved action; approval without sending keeps it ready and sends nothing. For a requested edit, use revise_pending_item, show the changed draft, and leave it waiting for approval again. Never infer approval from an earlier message.
- A tool result is the truth: never say something was created, saved, started, sent or charged unless a tool result says so. \
Never invent figures, customers, prices or results. Never state a price for the app's own services yourself.
- If a tool says a price must be agreed first, tell them its price and ask; call it again with price_agreed true only after \
they say yes.
- Funding and launch readiness: use readiness_status to answer how ready they are, their score, what's left and what was found. For anything to do on a funding case or launch plan (change an amount or purpose, answer what's left, draft the rest, search for funding options, approve drafts, start one), call work_on_funding or work_on_launch with the owner's own words, exactly as they said them; a reply to what that module asked ("yes, start", "replace it") goes back to it the same way.
- Contracts, receipts, payments and other areas you have no tool for: call hand_over with the module, at once.
- End every reply with one line starting "Next step:" that says the one thing to do next.

How replies look: natural sentences, like a helpful person writing in a chat. Put the one or two phrases that matter most in **bold**. No headings. A short list only when you are listing several things. After the reply, add two or three quick actions the owner might tap next, written in their own voice as something they'd say to you, specific to this reply, and only things you can do or answer, like this:
<quick_actions>
Show me what's left on my funding case
Draft the invoice for Tosin Giwa
</quick_actions>"""

_ITEMS = {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["name", "quantity", "unit_price"],
                                      "properties": {"name": {"type": "string"}, "quantity": {"type": "number"},
                                                     "unit_price": {"type": "number", "description": "Price of one, in the business's currency"}}}}

TOOLS: list[dict] = [
    {"name": "find_customer", "description": "Look up customers on record by name. Returns their names and email addresses.",
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["name"], "properties": {"name": {"type": "string"}}}},
    {"name": "read_catalogue", "description": "The business's products and services with their prices.",
     "input_schema": {"type": "object", "additionalProperties": False, "properties": {}}},
    {"name": "create_invoice", "strict": True,
     "description": "Draft an invoice. It waits for the owner's approval before anything is sent. Leave customer_email, due_date "
                    "(YYYY-MM-DD), notes and vat_rate as empty strings when not said.",
     "input_schema": {"type": "object", "additionalProperties": False,
                      "required": ["customer_name", "customer_email", "items", "due_date", "notes", "vat_rate", "price_agreed"],
                      "properties": {"customer_name": {"type": "string"}, "customer_email": {"type": "string"}, "items": _ITEMS,
                                     "due_date": {"type": "string"}, "notes": {"type": "string"}, "vat_rate": {"type": "string"},
                                     "price_agreed": {"type": "boolean"}}}},
    {"name": "create_quote", "strict": True,
     "description": "Draft a quotation. It waits for the owner's approval before anything is sent. The customer's email is needed. "
                    "Leave notes and vat_rate as empty strings when not said.",
     "input_schema": {"type": "object", "additionalProperties": False,
                      "required": ["customer_name", "customer_email", "items", "notes", "vat_rate", "price_agreed"],
                      "properties": {"customer_name": {"type": "string"}, "customer_email": {"type": "string"}, "items": _ITEMS,
                                     "notes": {"type": "string"}, "vat_rate": {"type": "string"}, "price_agreed": {"type": "boolean"}}}},
    {"name": "readiness_status", "description": "The business's funding cases or launch plans: each one's score out of 100, how ready it is, "
                                                "the areas still unfinished, drafts waiting for approval and funding options found.",
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["kind"], "properties": {"kind": {"type": "string", "enum": ["funding", "launch"]}}}},
    {"name": "work_on_funding", "description": "Do something on the funding case (Funding Readiness) with the owner's request in their own words. Its reply, "
                                               "with its buttons and cards, goes to the owner as it is, prices said first.",
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["request"], "properties": {"request": {"type": "string"}}}},
    {"name": "work_on_launch", "description": "Do something on a launch plan (Launch Readiness) with the owner's request in their own words. Its reply, "
                                              "with its buttons and cards, goes to the owner as it is, prices said first.",
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["request"], "properties": {"request": {"type": "string"}}}},
    {"name": "save_idea", "description": "Keep what they said about a business idea (only the fields they said) and get its free viability check back.",
     "input_schema": {"type": "object", "additionalProperties": False, "properties": {
         k: {"type": "string"} for k in ("description", "customer", "where", "price", "cost", "monthly_sales", "capacity")}}},
    {"name": "run_idea_validation", "description": "The full Idea Validation of the saved idea. start false first: its price is said. start true only after their yes.",
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["start"], "properties": {"start": {"type": "boolean"}}}},
    {"name": "write_business_plan", "description": "Write the business plan. purpose is who reads it (investors, a bank or lender, a grant, my own planning): "
                                                   "ask if not said. start false first (its price is said), start true only after their yes.",
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["start"], "properties": {
         "description": {"type": "string"}, "customer": {"type": "string"}, "purpose": {"type": "string"}, "start": {"type": "boolean"}}}},
    {"name": "list_pending_items", "description": "Read the current live items in this business that need the owner's review. Use this before discussing or acting on an approval, rejection, or edit. Returns item IDs and short details so you can match natural references such as 'that invoice' against the conversation.",
     "input_schema": {"type": "object", "additionalProperties": False, "properties": {}}},
    {"name": "decide_pending_item", "description": "Carry out the owner's clearly stated decision on one exact item returned by list_pending_items. Approval can send or execute the prepared action. Rejection may remove a saved draft. Never call unless the latest user message explicitly requests the decision and the target is unambiguous.",
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["item_id", "decision"],
                      "properties": {"item_id": {"type": "string"}, "decision": {"type": "string", "enum": ["approve_and_send", "approve_without_sending", "reject"]}}}},
    {"name": "revise_pending_item", "description": "Edit one pending item using the owner's natural-language change request. The edited draft stays in review and is not sent. Use the item ID from list_pending_items, and describe only changes the owner actually requested.",
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["item_id", "instruction"],
                      "properties": {"item_id": {"type": "string"}, "instruction": {"type": "string"}}}},
    {"name": "hand_over", "description": "Pass the request to the module that runs its own flow.",
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["module"], "properties": {"module": {
         "type": "string", "enum": ["contract", "receipt", "payment", "purchase_order", "proposal", "customers",
                                    "risks", "pricing", "other"]}}}},
]


# ── The model ──────────────────────────────────────────────────────────────────────────────────────────────────────────

def available() -> bool:
    from app.shared.llm import tool_chat
    return bool(tool_chat.providers())


async def _ask(items: list[dict], user_id: str | None = None):
    """One model call through the provider layer: Claude first, OpenAI as the backup."""
    from app.shared.llm import tool_chat
    return await tool_chat.chat(system=SYSTEM, items=items, tools=TOOLS, user_id=user_id)


# ── What the tools do ──────────────────────────────────────────────────────────────────────────────────────────────────

def _catalogue(data: dict) -> dict:
    return data.get("catalogue") or {}


def _price(p: dict) -> float:
    try:
        return float(p.get("unit_price") if p.get("unit_price") not in (None, "") else p.get("base_price") or 0)
    except (TypeError, ValueError):
        return 0.0


def _same(a: Any, b: Any) -> bool:
    return " ".join(str(a or "").lower().split()) == " ".join(str(b or "").lower().split())


def find_customer(data: dict, name: str) -> dict:
    want = " ".join(str(name or "").lower().split())
    found = [{"name": c.get("name"), "email": c.get("email") or ""} for c in _catalogue(data).get("customers") or []
             if want and want in " ".join(str(c.get("name") or "").lower().split())]
    return {"customers": found[:10]} if found else {"customers": [], "note": "nobody on record by that name: a new customer"}


def read_catalogue(data: dict) -> dict:
    return {"items": [{"name": p.get("name"), "price": _price(p)} for p in _catalogue(data).get("products") or []][:60],
            "currency": (data.get("workspace_profile") or {}).get("currency") or data.get("currency")}


def _answers(data: dict, args: dict, *, quote: bool) -> tuple[dict, list[str]]:
    """The task's answers from the tool's arguments, matched to the records; and what is still missing."""
    missing = []
    name = str(args.get("customer_name") or "").strip()
    email = str(args.get("customer_email") or "").strip()
    if not name:
        missing.append("who it's for")
    if email and not _EMAIL.match(email):
        missing.append("a valid email address for the customer (or leave it for later)" if not quote else "the customer's email address")
        email = ""
    if quote and not email and "the customer's email address" not in missing:
        missing.append("the customer's email address")
    on_record = next((c for c in _catalogue(data).get("customers") or [] if _same(c.get("name"), name)), None) if name else None
    a: dict[str, Any] = {"customer_id": on_record["id"]} if on_record else {"customer_id": "new", "customer_name": name}
    if email:
        a["customer_email"] = email
    elif not quote and not (on_record or {}).get("email"):
        a["email_later"] = True      # drafted now; the address is asked for when it's sent
    products = _catalogue(data).get("products") or []
    items = []
    for it in args.get("items") or []:
        label = str(it.get("name") or "").strip()
        qty, price = it.get("quantity") or 0, it.get("unit_price")
        if not label or not qty or qty <= 0:
            continue
        if price in (None, "") or float(price) <= 0:
            missing.append(f"the price for {label}")
            continue
        p = next((p for p in products if _same(p.get("name"), label)), None)
        items.append({"product_id": p["id"] if p else None, "name": "" if p else label, "quantity": qty, "unit_price": float(price)})
    if not items and not any(m.startswith("the price for") for m in missing):
        missing.append("what it's for: each item's name, quantity and price")
    a["items"] = items
    if str(args.get("notes") or "").strip():
        a["notes"] = str(args["notes"]).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(args.get("due_date") or "")):
        a["due_date"] = args["due_date"]
    vat = str(args.get("vat_rate") or "").strip().rstrip("%")
    if vat:
        try:
            a["vat_rate"] = float(vat)
        except ValueError:
            pass
    return a, missing


async def _document(orch, user: dict, business_id: str, data: dict, args: dict, *, quote: bool) -> dict:
    """An invoice or quotation drafted through its workflow: straight to Needs Approval when everything is known, else what is
    still missing, and nothing left half-started."""
    from app.modules.agent.models import AgentRequest
    answers, missing = _answers(data, args, quote=quote)
    if missing:
        return {"created": False, "still_needed": missing}
    capability = "enquiry_to_quote" if quote else "new_invoice"
    what = "quotation" if quote else "invoice"
    name = answers.get("customer_name") or next((c.get("name") for c in _catalogue(data).get("customers") or [] if c.get("id") == answers.get("customer_id")), "")
    out = await orch.submit(AgentRequest(requesting_actor_id=user["id"], business_id=business_id, source_channel="text",
                                         raw_input=f"Create a {what} for {name}"[:500], requested_capability=capability, params={},
                                         confirmed=bool(args.get("price_agreed")), background=False), email=user.get("email"))
    kind = (out or {}).get("kind")
    if kind == "needs_confirmation":
        return {"created": False, "price_first": str(out.get("message") or "This task has a price.")}
    if kind == "blocked":
        return {"final": {**out, "actions": out.get("actions") or [{"label": "See plans", "to": "/pricing"}]}}
    run = (out or {}).get("run")
    if not run:
        return {"created": False, "error": str((out or {}).get("message") or "it couldn't be started")}
    for _ in range(2):      # the answers given to the questions it asks, never asked again in the chat
        if not run.get("pending_question"):
            break
        run = await orch.provide_input(run["id"], user["id"], answers, user.get("email"))
    if run.get("pending_question"):
        fields = [f for f in run["pending_question"].get("fields") or [] if f.get("required") and f.get("key") not in answers]
        try:
            await orch.cancel(run["id"], user["id"], user.get("email"))      # never a half-done task left waiting
        except Exception:      # noqa: BLE001
            logger.info("claude agent: run %s not cancelled", run.get("id"), exc_info=True)
        return {"created": False, "still_needed": [str(f.get("label") or f.get("key")) for f in fields] or ["more details"],
                "question": run["pending_question"].get("question")}
    if run.get("status") in ("failed", "cancelled"):
        return {"created": False, "error": str(run.get("error") or run.get("summary") or "it didn't go through")}
    return {"final": {"kind": "workflow", "capability": capability, "run": run}}


async def readiness_status(orch, user: dict, business_id: str, kind: str) -> dict:
    """Each funding case or launch plan in short: its score, how ready, what's unfinished, drafts waiting, options found."""
    from app.modules.agent import converse
    from app.modules.agent.router import _subjects_with_summary
    kind = "launch" if kind == "launch" else "funding"
    subjects = await _subjects_with_summary(user, business_id, kind)
    data = await orch.rt.business.load(business_id) or {}
    found = converse.option_cards(converse.options_found(data)) if kind == "funding" else []
    out = [{"title": s.get("title"), "score": (s.get("summary") or {}).get("score_display"), "how_ready": (s.get("summary") or {}).get("headline"),
            "blockers": (s.get("summary") or {}).get("blocker_count"), "unfinished": (s.get("summary") or {}).get("unfinished_areas") or [],
            "estimated": (s.get("summary") or {}).get("estimated_areas") or [],
            "drafts_waiting": len((s.get("data") or {}).get("agent_drafts") or {})} for s in subjects[:5]]
    return {kind: out or "none yet", **({"funding_options_found": [{"title": o["title"], "route": o.get("route"), "fit": o.get("fit")} for o in found]} if found else {})}


async def _readiness_turn(orch, user: dict, business_id: str, request: str, *, launch: bool) -> dict | None:
    """The funding or launch conversation, with the owner's own words: its reply (cards, buttons, prices first) as it is."""
    from app.modules.agent import converse, converse_launch
    module = converse_launch if launch else converse
    return await module.turn(orch=orch, user=user, business_id=business_id, text=request[:2000])


# ── One reply ──────────────────────────────────────────────────────────────────────────────────────────────────────────

def _items(turns: list[dict], text: str, context: dict, history: list[dict] | None = None) -> list[dict]:
    """The visible chat (when supplied), else the saved thread, then business context."""
    out: list[dict] = []
    # An explicitly empty history means this is a new chat. Do not silently pull an older
    # conversation into it; that can make an otherwise clear request act on the wrong item.
    source = ([{"role": "owner" if t.role == "user" else "agent", "text": t.content} for t in history]
              if history is not None else turns)
    for t in source:
        role = "user" if t.get("role") in ("owner", "user") else "assistant"
        said = str(t.get("text") or t.get("content") or "").strip()
        if not said:
            continue
        if out and out[-1]["role"] == role:
            out[-1]["text"] += "\n" + said
        else:
            out.append({"role": role, "text": said, **({"calls": []} if role == "assistant" else {})})
    while out and out[0]["role"] != "user":
        out.pop(0)
    if out and out[-1]["role"] == "user":
        out[-1]["text"] += "\n" + text
    else:
        out.append({"role": "user", "text": text})
    out.append({"role": "note", "text": "CONTEXT (what the business has on record): " + json.dumps(context, ensure_ascii=False, default=str)})
    return out


_QUICK = re.compile(r"<quick_actions>(.*?)(?:</quick_actions>|$)", re.S | re.I)


def quick_actions(say: str) -> tuple[str, list[dict]]:
    """The reply without its quick actions block, and the actions as buttons that say them (at most three)."""
    found = _QUICK.search(say or "")
    if not found:
        return say, []
    lines = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", x).strip() for x in found.group(1).splitlines()]
    acts = [{"label": x[:80], "kind": "explain", "prompt": x[:300]} for x in lines if x][:3]
    return (say[:found.start()] + say[found.end():]).strip(), acts


def _tidy(say: str) -> str:
    return re.sub(r"\s*[—–]\s*", ", ", say).strip()


def _provider_unavailable(exc: Exception) -> str | None:
    """Turn a known provider quota failure into a useful reply instead of retrying the same empty account."""
    text = str(exc).lower()
    if "insufficient_quota" in text or "credit_balance_exhausted" in text or "you have no credits remaining" in text:
        return ("The OpenAI API account used by this local Agent has no API credits remaining. "
                "EnterprateAI credits are separate. Add API credits to that OpenAI account or configure another AI provider, "
                "then try again. Nothing was changed.")
    return None


async def turn(orch, user: dict, body, known: dict) -> dict | str | None:
    """The reply to one message: a response, conductor.PASS for a module that keeps its own flow, or None (no model: the chat
    that answers today answers instead)."""
    from app.modules.agent import conductor
    from app.modules.agent.converse import OutOfCredits, paid_reply
    business_id = body.business_id
    turns = conductor._thread(known, user["id"])
    text = str(body.text or "").strip()[:2000]
    last_agent_turn = next((str(t.get("text") or "") for t in reversed(turns) if t.get("role") == "agent"), "")
    social = social_reply(text, turns) if "?" in last_agent_turn else None
    if social:
        # Keep the turn in the same per-user/per-business memory so a task answer can continue
        # naturally on the next message. A scripted courtesy is not a written, credit-bearing answer.
        await conductor._keep(orch, business_id, user["id"], [*turns, {"role": "owner", "text": text[:600]},
                                                              {"role": "agent", "text": social[:600]}])
        return {"kind": "answer", "conversational": True, "message": social, "actions": []}
    if not available():
        return None
    items = _items(turns[-conductor.THREAD_TURNS:], text, conductor._context(known), getattr(body, "history", None))
    outcome: dict[str, Any] = {}

    async def run_turn():
        for _step in range(STEPS):
            res = await asyncio.wait_for(_ask(items, user["id"]), MODEL_SECONDS)
            if res.refused:
                outcome["say"] = "I can't help with that one. Next step: tell me what you'd like to do with your business, and I'll take it from there."
                return SimpleNamespace(text=outcome["say"])
            if not res.calls:
                outcome["say"] = _tidy(res.text)
                return SimpleNamespace(text=outcome["say"])
            items.append(res.as_item())
            results = []
            for call in res.calls:
                done = await _use(orch, user, business_id, known, body, call.name, dict(call.input or {}))
                if done.get("pass") or done.get("final"):
                    outcome.update(done)
                    # A hand-over or a drafted document isn't a written chat reply: nothing charged for it here (its own flow
                    # says its price); a funding or launch reply is one, charged once (its module doesn't charge it again)
                    return SimpleNamespace(text=str((done.get("final") or {}).get("message") or "") if done.get("written") else "")
                results.append({"id": call.id, "name": call.name, "content": json.dumps(done, ensure_ascii=False, default=str), "is_error": bool(done.get("error"))})
            items.append({"role": "tool", "results": results})
        outcome["say"] = "I couldn't finish that just now. Nothing was created or charged. Next step: try asking again."
        return SimpleNamespace(text=outcome["say"])

    try:
        await paid_reply(orch, user, run_turn)
    except OutOfCredits:
        raise
    except Exception as exc:      # noqa: BLE001 - the chat that answers today answers instead
        if not (outcome.get("pass") or outcome.get("final")):      # released, not failed: nothing written to charge for
            logger.warning("claude agent: no reply", exc_info=True)
            unavailable = _provider_unavailable(exc)
            if unavailable:
                # Returning a reply prevents the router from calling the same exhausted provider
                # again through the legacy chat fallback.
                return {"kind": "answer", "conversational": True, "message": unavailable, "actions": []}
            return None
    if outcome.get("pass"):
        await conductor._keep(orch, business_id, user["id"], [*turns, {"role": "owner", "text": text[:600]},
                                                              {"role": "agent", "text": f"(handed over to {outcome.get('module') or 'its module'})"}])
        return conductor.PASS
    if outcome.get("final"):
        final = dict(outcome["final"])
        run = final.get("run") or {}
        await conductor._keep(orch, business_id, user["id"], [*turns, {"role": "owner", "text": text[:600]},
                                                              {"role": "agent", "text": str(final.get("message") or run.get("title") or "Drafted it for your approval.")[:600]}])
        return final
    say, acts = quick_actions(outcome.get("say") or "")
    if not say:
        return None
    await conductor._keep(orch, business_id, user["id"], [*turns, {"role": "owner", "text": text[:600]}, {"role": "agent", "text": say[:600]}])
    return {"kind": "answer", "conversational": True, "message": say, "actions": acts, **({"quick": True} if acts else {})}


def _asked_back(done: dict) -> dict:
    """A task that still needs details tells the model what to ask, for it to ask in its own words: never its form put in front
    of the owner instead of a reply (the owner, 12 Nov: "Hello" answered with "Who will read it?")."""
    final = done.get("final") or {}
    if final.get("kind") != "needs_input":
        return done
    asks = [{"question": f.get("question") or f.get("label"), "choices": [o.get("label") for o in f.get("options") or []]}
            for f in final.get("fields") or [] if f.get("required", True)]
    return {"started": False, "still_needed": asks or [str(final.get("message") or "more details")]}


async def _pending_items(orch, user: dict, business_id: str) -> list[dict]:
    """A current, permission-checked list used by the model to resolve conversational references."""
    from app.modules.agent import drafts, summary
    actor, _policy = await orch.actor_for(user["id"], business_id, user.get("email"))
    if not (actor.can_send or actor.can_prepare):
        return []
    now = orch.rt.clock()
    approvals = await summary.pending_approvals(orch.rt.store, business_id, now)
    data = await orch.rt.business.load(business_id) or {}
    items = []
    if actor.can_send:
        for a in approvals:
            card = summary.approval_card(a, now)
            payload = a.get("payload") or {}
            items.append({"id": a["id"], "item_type": "approval", "run_id": a["run_id"], "kind": card.get("kind"),
                          "title": card.get("title"), "customer": payload.get("customer_name"), "reference": payload.get("reference"),
                          "total": payload.get("total") or payload.get("amount") or payload.get("total_amount"),
                          "created_at": card.get("created_at")})
    for d in drafts.pending(data):
        card = drafts.card(d)
        items.append({"id": d["id"], "item_type": "draft", "kind": d.get("kind"), "title": card.get("title"),
                      "reference": d.get("ref"), "created_at": d.get("created_at")})
    return items


async def _use(orch, user: dict, business_id: str, known: dict, body, name: str, args: dict) -> dict:
    """One tool: its result for the model, or {"final": ...} / {"pass": True} to end the reply there."""
    from app.modules.agent import conductor
    try:
        if name == "find_customer":
            return find_customer(known, args.get("name"))
        if name == "read_catalogue":
            return read_catalogue(known)
        if name in ("create_invoice", "create_quote"):
            data = await orch.rt.business.load(business_id) or known
            return await _document(orch, user, business_id, data, args, quote=name == "create_quote")
        if name == "readiness_status":
            return await readiness_status(orch, user, business_id, args.get("kind") or "funding")
        if name in ("work_on_funding", "work_on_launch"):
            got = await _readiness_turn(orch, user, business_id, str(args.get("request") or getattr(body, "text", "") or ""), launch=name == "work_on_launch")
            return {"final": got, "written": True} if got else {"pass": True, "module": "launch" if name == "work_on_launch" else "funding"}
        if name == "hand_over":
            return {"pass": True, "module": args.get("module")}
        if name == "save_idea":
            return await conductor._save_idea(orch, business_id, args)
        if name == "run_idea_validation":
            return _asked_back(await conductor._idea_validation(user, business_id, args, getattr(body, "locale", None), known))
        if name == "write_business_plan":
            return _asked_back(await conductor._business_plan(orch, user, business_id, args))
        if name == "list_pending_items":
            return {"items": await _pending_items(orch, user, business_id)}
        if name in ("decide_pending_item", "revise_pending_item"):
            items = await _pending_items(orch, user, business_id)
            item = next((x for x in items if str(x.get("id")) == str(args.get("item_id") or "")), None)
            if not item:
                return {"error": "That item is no longer waiting for review, or it is not available to this account. Refresh the list and ask again."}
            from app.modules.agent import chat_actions
            if name == "revise_pending_item":
                revised = await chat_actions.revise(user, business_id, str(args.get("instruction") or ""),
                                                    run_id=item.get("run_id") if item["item_type"] == "approval" else None,
                                                    draft_id=item["id"] if item["item_type"] == "draft" else None)
                return revised
            decision = str(args.get("decision") or "")
            if item["item_type"] == "draft":
                from app.modules.agent.goal_router import DraftDecisionIn, decide_draft
                result = await decide_draft(business_id, item["id"], DraftDecisionIn(decision="accept" if decision.startswith("approve") else "reject"), user)
                return {"completed": True, "item": item.get("title"), "decision": decision, "message": result.get("message")}
            if decision == "approve_without_sending":
                result = await orch.approve_without_sending(item["run_id"], args["item_id"], user["id"], user.get("email"))
            elif decision == "approve_and_send":
                result = await orch.decide_approval(item["run_id"], args["item_id"], user["id"], True, None, user.get("email"))
            elif decision == "reject":
                result = await orch.decide_approval(item["run_id"], args["item_id"], user["id"], False, None, user.get("email"))
            else:
                return {"error": "Choose whether to approve and send, approve without sending, or reject."}
            return {"completed": True, "item": item.get("title"), "decision": decision, "message": result.get("message")}
        return {"error": f"there is no tool called {name}"}
    except Exception:      # noqa: BLE001 - said plainly, never a half-done claim
        logger.warning("claude agent: %s failed", name, exc_info=True)
        return {"error": "it couldn't be done just now; nothing was changed"}
