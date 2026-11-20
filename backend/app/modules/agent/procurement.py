"""Procurement specialist behind the existing Agent conversation."""
from __future__ import annotations

import logging
import re
from time import perf_counter
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.agent import conductor
from app.modules.proposals import evaluation, sourcing

logger = logging.getLogger(__name__)

TOOL = {
    "name": "work_on_procurement",
    "description": "Route buyer sourcing, RFQ/RFP drafts, supplier matching, proposal evaluation and tender discovery to Procurement. Draft and review only.",
    "input_schema": {
        "type": "object", "additionalProperties": False,
        "properties": {
            "action": {"type": "string", "enum": ["draft", "match", "evaluation", "tenders", "tender_evaluation"]},
            "service": {"type": "string"}, "location": {"type": "string"},
            "query": {"type": "string"}, "stage": {"type": "string"},
            "tender_id": {"type": "string"}, "request_id": {"type": "string"}, "proposal_id": {"type": "string"},
        },
    },
}
_INTENT = re.compile(r"\b(rfqs?|rfps?|request for (?:quotation|proposal)|procurement|sourc(?:e|ing) suppliers|find (?:me )?(?:a |some )?(?:suppliers?|vendors?)|supplier match(?:ing|es)?|(?:public |uk )?tenders?|evaluate (?:the |these )?proposals?)\b", re.I)
_OTHER = re.compile(r"\b(?:business plan|funding readiness|launch readiness|idea validation|create (?:an? )?invoice)\b", re.I)
_ACTION = re.compile(r"\b(?:send|publish|invite|submit|award|sign)\b", re.I)
_DOCUMENT = re.compile(r"\b(rfq|rfp|request for quotation|request for proposal)\b", re.I)
_MATCH = re.compile(r"\b(?:find|match|shortlist|search|source)\b", re.I)
_EVAL = re.compile(r"\b(?:evaluate|compare|review)\b.*\bproposals?\b", re.I)


def recent_state(turns: list[dict], reference: str | None = None, action: str | None = None) -> dict:
    for turn in reversed(turns):
        if turn.get("role") != "agent":
            continue
        state = turn.get("procurement") or {}
        if reference is None or (state.get("id") == reference and (not action or state.get("action") == action)):
            return state
    return {}


def should_route(body, turns: list[dict]) -> bool:
    if body.page == "procurement":
        return True
    if body.page or body.capability:
        return False
    text = body.text or ""
    return bool(_INTENT.search(text) or _EVAL.search(text) or (recent_state(turns).get("pending") and not _OTHER.search(text)))


def _reply(message: str, **payload) -> dict:
    return {"kind": "answer", "conversational": True, "message": message, "actions": [],
            "procurement": {"specialist": "procurement", **payload}}


def _request_id(reference: str | None) -> str:
    try:
        return str(UUID(reference or ""))
    except ValueError:
        return str(uuid4())


async def run(orch, user: dict, body, known: dict, args: dict | None = None) -> dict:
    user_id, workspace_id = user["id"], body.business_id
    text = (body.text or "").strip()
    reference = getattr(body, "source_reference", None) if body.page == "procurement" else None
    args = args or {}
    explicit = body.params if body.page == "procurement" else {}
    # Each service repeats its own authorisation. Check before using any stored turn.
    await sourcing._owned_workspace(user_id, workspace_id)
    turns = conductor._thread(known, user_id)
    previous = recent_state(turns, reference, explicit.get("action"))
    pending = previous.get("pending")
    request_id = _request_id(reference or (previous.get("id") if pending else None))
    action = explicit.get("action") or (pending and previous.get("action")) or args.get("action")
    if _INTENT.search(text) and not explicit.get("action") and not args.get("action") and _DOCUMENT.search(text):
        action = "draft"
    if not action:
        action = ("tender_evaluation" if re.search(r"\b(?:evaluate|assess|review|fit|alignment)\b.*\btender", text, re.I) else "tenders" if re.search(r"\b(?:public |uk )?tenders?\b", text, re.I)
                  else "evaluation" if _EVAL.search(text)
                  else "match" if _MATCH.search(text) and not _DOCUMENT.search(text) else "draft")
    prior_brief = previous.get("brief") if pending or (reference and action == "draft") else None
    brief = "\n".join(filter(None, [prior_brief, text if not prior_brief or prior_brief.rsplit("\n", 1)[-1] != text else None]))[-5000:]
    state = {"id": request_id, "action": action, "brief": brief, "pending": False}
    link = "/marketplace/sourcing?sourcingDraft=" + request_id
    try:
        if action != "tenders" and not explicit.get("action") and _ACTION.search(text) and _INTENT.search(text):
            reply = _reply("Open Procurement to review and approve that action.", status="approval_required")
            reply["actions"] = [{"label": "Open Procurement", "to": "/operations?tab=Procurement"}]
        elif action == "tender_evaluation":
            from app.modules.tenders import evaluation as tender_evaluation
            tender_id = explicit.get("tender_id") or args.get("tender_id") or previous.get("tender_id")
            if not isinstance(tender_id, str) or not tender_id.strip():
                reply = _reply("Open the tender you want to assess and choose Evaluate This Tender for Me.", status="clarification")
                reply["actions"] = [{"label": "Open Public Tenders", "to": "/marketplace?tab=tenders"}]
            else:
                result = await tender_evaluation.evaluate(user_id, workspace_id, tender_id)
                state["tender_id"] = tender_id
                steps = result.get("next_steps") or [finding["next_step"] for finding in result["findings"]]
                explanation = "\n\n".join(item["heading"] + ": " + item["explanation"] for item in result.get("overview", []))
                reply = _reply((explanation + "\n\n" if explanation else "") + result["verdict"] + "\n\nWhat to do next:\n" + "\n".join("• " + step for step in steps),
                               status="tender_evaluation", tender_evaluation=result)
                reply["actions"] = [{"label": "Review tender evaluation", "to": "/marketplace?tab=tenders&tender=" + quote(tender_id, safe="")}]
        elif action == "tenders":
            from app.modules.tenders import service as tenders

            query, stage = tenders.conversation_filters(text, args.get("query"), args.get("stage"))
            result = await tenders.search(query, stage, limit=5)
            items = result["items"]
            lines = [f'{item["title"]} ({item["buyer"] or "buyer not published"}, {item["status"]})'
                     + (f', deadline {item["deadline"]}' if item.get("deadline") else ", deadline not published")
                     + (f', {item["currency"]} {item["amount"]}' if item.get("amount") is not None else ", value not disclosed")
                     + f' - {item["url"]}' for item in items]
            message = "Find a Tender listings:\n" + "\n".join(lines) if lines else "No UK notices match that search."
            if result["stale"]:
                message += "\nThe index may be out of date. Check the official notice."
            reply = _reply(message, status="tenders", tenders=items)
            page = "/marketplace?tab=tenders&stage=" + stage + "&q=" + quote(query, safe="")
            reply["actions"] = [{"label": "Open Public Tenders", "to": page},
                                *({"label": "View tender: " + item["title"][:64],
                                   "to": "/marketplace?tab=tenders&tender=" + quote(item["id"], safe="")} for item in items if item.get("id"))]
        elif action == "evaluation":
            request = explicit.get("request_id") or args.get("request_id")
            proposal = explicit.get("proposal_id") or args.get("proposal_id")
            if not isinstance(request, str) or not isinstance(proposal, str):
                reply = _reply("Which proposal should I review? Open it from the request in Procurement Evaluations.", status="clarification")
                reply["actions"] = [{"label": "Open Evaluations", "to": "/operations?tab=Procurement&sub=Evaluations"}]
            else:
                result = await evaluation.generate(user_id, workspace_id, request, proposal)
                reply = _reply("The evidence review is ready in Procurement. You can confirm or override the suggested scores there.",
                               status="evaluation", request_id=request, evaluation=result)
                reply["actions"] = [{"label": "Open evaluation", "to": "/operations?tab=Procurement&sub=Evaluations&evaluationRequest=" + quote(request, safe="")}]
        elif action == "match":
            raw = explicit.get("criteria") or {key: args[key] for key in ("service", "location") if key in args}
            if not raw.get("service"):
                match = re.search(r"(?:suppliers?|vendors?)\s+(?:for|of|who provide)\s+(.+)", brief, re.I)
                service = match[1].strip(" .?") if match else text.strip(" .?") if pending else ""
                service, _, location = service.partition(" in ")
                raw = {"service": service, "location": location}
            if not str(raw.get("service") or "").strip():
                state["pending"] = True
                reply = _reply("What product or service do you want to source, and where do you need it?", status="clarification")
            else:
                criteria = sourcing.MatchInput.model_validate(raw)
                result = await sourcing.match_suppliers(user_id, workspace_id, criteria)
                matches = result["matches"]
                lines = [f'{item["name"]}: {", ".join(item["service_evidence"])}' for item in matches[:5]]
                message = "Here are the strongest matches and why they fit:\n" + "\n".join(lines) if lines else "I found no suppliers with listed evidence that meets those requirements."
                reply = _reply(message, status="matches", matches=matches)
        elif action == "draft":
            if not brief:
                state["pending"] = True
                reply = _reply("What would you like to buy?", status="clarification")
            else:
                result = await sourcing.generate_for_request(
                    user_id, workspace_id, request_id,
                    sourcing.SourcingBrief(brief=brief, latest_message=text, previous_response=previous.get("reply"), previous_question=previous.get("question") if pending else None,
                                          current_request=explicit.get("current_request")),
                )
                if getattr(result, "turn_intent", "requirements") in ("question", "aside"):
                    state.update(brief=prior_brief or "", pending=bool(pending), question=previous.get("question"))
                    reply = _reply(result.message, status="answer")
                elif result.questions:
                    state.update(pending=True, question=result.questions[0])
                    reply = _reply(result.questions[0], status="clarification")
                else:
                    reply = _reply(f"{result.recommendation} suggested. {result.rationale}", status="draft",
                                   request_id=request_id, draft=result.model_dump())
                    reply["actions"] = [{"label": "Review editable draft", "to": link}]
        else:
            reply = _reply("Choose whether to draft a request, find suppliers or evaluate a proposal.", status="clarification")
    except ValidationError:
        reply = _reply("Check the sourcing details and try again.", status="unavailable")
    except HTTPException as error:
        if error.status_code not in (409, 422, 502, 503):
            raise
        if action == "draft":
            state.update(pending=True, question=previous.get("question"))
        reply = _reply(str(error.detail), status="unavailable")
    state["reply"] = reply["message"][:3000]
    before_keep = perf_counter()
    await conductor._keep(orch, workspace_id, user_id, [*turns,
        {"role": "owner", "text": text[:600]}, {"role": "agent", "text": reply["message"][:600], "procurement": state}])
    if action == "draft":
        logger.info("Sourcing thread persistence_ms=%.0f outcome=%s",
                    (perf_counter() - before_keep) * 1000, reply["procurement"]["status"])
    return reply
