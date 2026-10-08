"""Marketplace requests for a quotation, handed to the Agent (Enquiry to Quote).

A buyer's request becomes an enquiry and one `enquiry_to_quote` task for the seller's
business. The task prepares a draft quotation from the catalogue and waits for approval;
nothing is sent without it. The request and its task stay in step: answering or declining
the request by hand stops the task, and a quotation the Agent sends marks the request as
responded, so it can't be answered twice.
"""
from __future__ import annotations

import logging
from typing import Any

from app.modules.agent import intent
from app.modules.agent.models import (
    RUN_AWAITING_APPROVAL, RUN_CANCELLED, RUN_FAILED, RUN_SUCCEEDED, SUB_WAITING_INFO, AgentRequest,
)

logger = logging.getLogger(__name__)

CHANNEL = "marketplace_rfq"
CAPABILITY = "enquiry_to_quote"

LABELS = {
    "drafting": "Agent drafting",
    "needs_answer": "Agent needs an answer",
    "awaiting_approval": "Waiting for your approval",
    "sent": "Sent",
    "needs_attention": "Agent needs attention",
    "not_quoted": "Agent did not quote",
}


def reference(rfq_id: str) -> str:
    return f"rfq:{rfq_id}"


def find(data: dict, rfq_id: str) -> dict | None:
    rows = (data.get("financials") or {}).get("rfq_requests") or []
    return next((r for r in rows if isinstance(r, dict) and str(r.get("id")) == str(rfq_id)), None)


def status_of(row: dict | None) -> str:
    return str((row or {}).get("status") or "").strip().lower()


def items_of(row: dict) -> list[dict]:
    """What was asked for: a name and a whole quantity of at least one."""
    out = []
    for it in row.get("items") or []:
        name = str((it or {}).get("name") or "").strip()
        if not name:
            continue
        try:
            qty = max(1, int(float(it.get("quantity") or 1)))
        except (TypeError, ValueError):
            qty = 1
        out.append({"name": name[:200], "quantity": qty, "notes": str(it.get("notes") or "").strip()[:500]})
    return out


def brief(row: dict) -> dict:
    """The parts of a request the task works from. The buyer's own words stay in the enquiry."""
    person = str(row.get("customer_name") or "").strip()
    company = str(row.get("customer_company") or "").strip()
    return {"rfq_id": str(row["id"]), "items": items_of(row), "company": company,
            "contact_name": person if company else "", "needed_by": str(row.get("needed_by") or "").strip(),
            "listing": str(row.get("listing") or "").strip()}


def enquiry_text(row: dict) -> str:
    """The request written out as an enquiry, for the record and for the person approving."""
    lines = ["Request for a quotation, sent through the Marketplace."]
    if row.get("listing"):
        lines.append(f"Listing: {row['listing']}")
    lines.append("Asked for:")
    lines += [f"- {i['quantity']} x {i['name']}" + (f" ({i['notes']})" if i["notes"] else "") for i in items_of(row)] or ["- (nothing listed)"]
    if row.get("needed_by"):
        lines.append(f"Needed by: {row['needed_by']}")
    if str(row.get("message") or "").strip():
        lines.append("Message from the buyer:")
        lines.append(str(row["message"]).strip())
    return "\n".join(lines)[:8000]


def doubt(message: Any) -> str | None:
    """A marketplace request is a request for a quotation by definition. The only doubt is a
    message that plainly says something else; then the owner is asked, not second-guessed."""
    text = str(message or "")
    if intent._COMPLAINT.search(text):
        return "complaint"
    if intent._PROPOSAL.search(text) and not intent._QUOTE.search(text):
        return "proposal_request"
    return None


def state_of(run: dict | None) -> dict | None:
    """Where the Agent has got to with a request, in the words shown on its row."""
    if not run or run.get("status") == RUN_CANCELLED:
        return None
    status = run.get("status")
    if status == RUN_AWAITING_APPROVAL:
        key = "awaiting_approval"
    elif status == RUN_SUCCEEDED:
        key = "sent" if ((run.get("state") or {}).get("outcome") or {}).get("sent_to") else "not_quoted"
    elif status == RUN_FAILED:
        key = "needs_attention"
    elif run.get("substatus") == SUB_WAITING_INFO:
        key = "needs_answer"
    else:
        key = "drafting"
    return {"run_id": run["id"], "status": key, "label": LABELS[key], "to": f"/agent/runs/{run['id']}"}


async def runs_for(orch, business_id: str, rfq_id: str) -> list[dict]:
    """Tasks for one request that haven't been cancelled, newest first."""
    rows = await orch.rt.store.runs_for_reference(business_id, CAPABILITY, reference(rfq_id))
    live = [r for r in rows if r.get("status") != RUN_CANCELLED]
    return sorted(live, key=lambda r: r.get("created_at") or "", reverse=True)


async def states(orch, business_id: str) -> dict[str, dict]:
    """rfq id -> where the Agent has got to, for every request of this business that has a task."""
    out: dict[str, dict] = {}
    runs = await orch.rt.store.list_runs(business_id, limit=500)
    for run in sorted(runs, key=lambda r: r.get("created_at") or ""):      # the newest task wins
        rfq_id = (run.get("state") or {}).get("rfq_id")
        shown = state_of(run) if rfq_id and run.get("workflow_key") == CAPABILITY else None
        if shown:
            out[str(rfq_id)] = shown
    return out


def auto_start(policy: dict) -> bool:
    return bool((policy.get("marketplace_rfq") or {}).get("auto_start", True))


async def received(orch, business_id: str, rfq_id: str) -> dict | None:
    """A request has just arrived. If the business lets the Agent start on its own, start one
    task for it, in the owner's name. Safe to call again for the same request: there is still one task.
    Returns None when nothing was started (the setting is off, or requests are locked on this plan)."""
    policy = await orch.rt.store.get_policy(business_id)
    if not auto_start(policy):
        return None
    ent = await orch.entitlement(business_id)
    if not await orch.rt.meter.rfq_unlocked(ent["owner_id"]):
        return None      # requests are locked on the free plan; nothing is read or drafted from them
    from app.modules.agent import autostart
    if autostart.budget(policy, await orch.rt.store.list_runs(business_id, limit=500), orch.rt.clock())["paused"]:
        return None      # the month's automatic budget is used: the request waits on its row until the owner raises it
    return await orch.submit(AgentRequest(
        requesting_actor_id=ent["owner_id"], business_id=business_id, source_channel=CHANNEL,
        source_reference=reference(rfq_id), requested_capability=CAPABILITY, params={"rfq_id": rfq_id},
        resolved_goal="Reply to a marketplace request for a quotation"))


async def stop(orch, business_id: str, rfq_id: str, actor_id: str, reason: str) -> int:
    """The request was answered, declined or removed by a person: its task has nothing left to do.
    Pending approvals are withdrawn and an unsent draft is closed. Returns how many tasks stopped."""
    summary = {
        "rfq_answered_manually": "Stopped: you replied to this request yourself. Nothing was sent by the Agent.",
        "rfq_rejected": "Stopped: this request was declined. Nothing was sent.",
        "rfq_deleted": "Stopped: this request was removed. Nothing was sent.",
    }.get(reason, "Stopped: this request has been dealt with.")
    stopped = 0
    for run in await runs_for(orch, business_id, rfq_id):
        if run.get("status") == RUN_SUCCEEDED:
            continue
        await orch.stop_run(run, actor_id, reason, summary)
        stopped += 1
    return stopped
