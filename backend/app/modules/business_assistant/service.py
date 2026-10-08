from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from app.core.supabase import sb_select
from app.modules.idea_validation.service import get_user_workspace
from app.modules.business_assistant.schemas import BusinessAssistantChatRequest, BusinessAssistantChatResponse
from app.shared.llm.openai_client import AutoLLMClient, NoopLLMClient, pick_llm_for_user


def _distinct_month_count(items: list[dict]) -> int:
    """Count distinct calendar months with activity — avoids revenue drops when old invoices are marked paid."""
    months: set[str] = set()
    for item in items:
        for key in ("created_at", "updated_at", "issued_at"):
            val = item.get(key)
            if val:
                try:
                    dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
                    months.add(f"{dt.year}-{dt.month}")
                    break
                except Exception:
                    pass
    return max(1, len(months))


def _compute_financial_baseline(workspace_data: dict) -> dict[str, Any]:
    """Compute the same monthly run-rate figures the simulation frontend uses."""
    financials = workspace_data.get("financials") or {}
    invoices = [i for i in (financials.get("invoices") or []) if not i.get("archived")]
    expenses = [e for e in (financials.get("expenses") or []) if not e.get("archived")]

    paid_invoices = [i for i in invoices if str(i.get("status") or "").lower() == "paid"]
    pending_invoices = [i for i in invoices if str(i.get("status") or "").lower() != "paid"]
    paid_expenses = [e for e in expenses if str(e.get("status") or "").lower() == "paid"]

    invoice_months = _distinct_month_count(paid_invoices)
    expense_months = _distinct_month_count(paid_expenses)

    total_invoice_revenue = sum(float(i.get("total_amount") or 0) for i in paid_invoices)
    total_invoice_cos = sum(float(i.get("cost_of_sales") or 0) for i in paid_invoices)
    total_expenses = sum(float(e.get("price") or 0) for e in paid_expenses)

    monthly_revenue = round(total_invoice_revenue / invoice_months, 2) if total_invoice_revenue else 0.0
    monthly_cos = round(total_invoice_cos / invoice_months, 2) if total_invoice_cos else 0.0
    monthly_expenses = round(total_expenses / expense_months, 2) if total_expenses else 0.0
    monthly_costs = round(monthly_cos + monthly_expenses, 2)
    monthly_profit = round(monthly_revenue - monthly_costs, 2)

    pending_total = sum(float(i.get("total_amount") or 0) for i in pending_invoices)

    return {
        "monthly_revenue": monthly_revenue,
        "monthly_cost_of_sales": monthly_cos,
        "monthly_expenses": monthly_expenses,
        "monthly_total_costs": monthly_costs,
        "monthly_profit": monthly_profit,
        "accruals_outstanding": round(pending_total, 2),
        "paid_invoice_count": len(paid_invoices),
        "pending_invoice_count": len(pending_invoices),
        "observed_months": invoice_months,
        "note": (
            "These figures are computed from paid invoices divided by the observed trading period "
            f"({invoice_months} month(s)). They match the figures shown in the Simulation baseline table. "
            "Always use these numbers when answering financial questions — do not re-sum raw invoices."
        ),
    }


def _compact_json(value, limit: int = 18000) -> str:
    text = json.dumps(value or {}, ensure_ascii=False, default=str, indent=2)
    if len(text) <= limit:
        return text
    return text[:limit] + "\n...[truncated]"


def _clean_assistant_answer(text: str) -> str:
    cleaned = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not cleaned:
        return ""

    cleaned = re.sub(r"\*\*(.*?)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"__(.*?)__", r"\1", cleaned)
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)

    lines = []
    for raw_line in cleaned.split("\n"):
        line = raw_line.strip()
        if not line:
            if lines and lines[-1] != "":
                lines.append("")
            continue
        line = re.sub(r"^#{1,6}\s*", "", line)
        line = re.sub(r"^>\s*", "", line)
        line = re.sub(r"^(?:[-*•]\s+|\d+\.\s+)", "", line)
        lines.append(line)

    cleaned = "\n".join(lines).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


CHAT_FEATURE = {"feature_code": "chat_message", "feature_name": "Business Assistant Chat", "credit_cost": 2, "enabled": True,
                "minimum_plan": "explorer", "refundable_on_failure": True, "credit_controlled": True}
_chat_price_checked = False


async def _ensure_chat_price() -> None:
    """The chat's entry in the price list. It was missing from some databases (the migration
    that added it was never run there), which made every answer fail as "feature not found".
    If it is missing it is added at the standard price; an existing entry, and whatever an
    admin has set it to, is never touched."""
    global _chat_price_checked
    if _chat_price_checked:
        return
    try:
        from app.core.supabase import sb_insert
        from app.modules.credits.service import get_feature_config
        if not await get_feature_config("chat_message"):
            await sb_insert("credit_feature_config", dict(CHAT_FEATURE))
        _chat_price_checked = True
    except Exception:      # noqa: BLE001 - the charge itself reports what is wrong
        pass


async def _agent_context(business_id: str) -> tuple[list[dict], dict]:
    """This business's recent Agent tasks and its Agent settings. Missing is fine: the answer just has less to go on."""
    try:
        from app.modules.agent.router import get_orchestrator
        store = get_orchestrator().rt.store
        return await store.list_runs(business_id, limit=20), await store.get_policy(business_id)
    except Exception:      # noqa: BLE001
        return [], {}


async def chat_about_business(*, user_id: str, payload: BusinessAssistantChatRequest) -> BusinessAssistantChatResponse:
    from app.shared.privacy import REFUSAL, is_bulk_contact_request

    # Server-side rule, not a prompt: bulk exports of contact details are refused before
    # any model sees the request (and before any credits are used).
    latest = next((m.content for m in reversed(payload.messages) if m.role == "user"), "")
    if is_bulk_contact_request(latest):
        return BusinessAssistantChatResponse(answer=REFUSAL, provider="policy", model="contact-export-guard")

    llm = await pick_llm_for_user(user_id)
    if isinstance(llm, NoopLLMClient):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LLM provider not configured for the business assistant.",
        )

    if payload.workspace_id:
        # The business the user has open, checked against their access to it. One business per
        # conversation: nothing from any other business is read.
        from app.modules.idea_validation.service import _get_accessible_workspace
        workspace, _owner = await _get_accessible_workspace(user_id=user_id, workspace_id=payload.workspace_id)
    else:
        workspace = await get_user_workspace(user_id=user_id)
    if not workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    # What a plan locks in the product stays locked in the conversation: on the free plan the
    # assistant is given requests for quotation the same way the pages show them, with the buyer hidden.
    from app.modules.addons.service import redact_workspace_data_for_owner
    workspace_data = await redact_workspace_data_for_owner(workspace.data or {}, str(getattr(workspace, "user_id", None) or user_id))
    readiness_context: dict = {}
    try:
        from app.modules.agent import modules as agent_modules
        from app.modules.agent.router import get_orchestrator
        readiness_context = await agent_modules.readiness_for(get_orchestrator(), user_id, str(getattr(workspace, "id", None) or payload.workspace_id or ""))
    except Exception:      # noqa: BLE001 - the answer just has less to go on
        readiness_context = {}
    registration_context = {
        "registration": workspace_data.get("registration") or {},
        "registration_status": workspace_data.get("registration_status") or {},
    }

    docs = await sb_select(
        "blueprint_documents",
        filters=[("user_id", "eq", user_id)],
        columns="type,title,company_name,updated_at,document_markdown",
        order="updated_at",
        desc=True,
        limit=6,
    )
    document_context = []
    for doc in docs or []:
        excerpt = str(doc.get("document_markdown") or "").strip()
        if excerpt:
            excerpt = excerpt[:2500]
        document_context.append(
            {
                "type": doc.get("type"),
                "title": doc.get("title"),
                "company_name": doc.get("company_name"),
                "updated_at": doc.get("updated_at"),
                "excerpt": excerpt,
            }
        )

    try:
        simulation_runs = await sb_select(
            "scenario_runs",
            filters=[("business_id", "eq", str(workspace.id))],
            columns="scenario_run_id,scenario_name,scenario_type,scenario_mode,state_result,baseline_metrics,scenario_metrics,deltas,created_at,completed_at",
            order="created_at",
            desc=True,
            limit=8,
        )
    except Exception:
        simulation_runs = []
    simulation_context = []
    for run in simulation_runs or []:
        simulation_context.append(
            {
                "scenario_run_id": run.get("scenario_run_id"),
                "scenario_name": run.get("scenario_name"),
                "scenario_type": run.get("scenario_type"),
                "scenario_mode": run.get("scenario_mode"),
                "state_result": run.get("state_result"),
                "baseline_metrics": run.get("baseline_metrics") or {},
                "scenario_metrics": run.get("scenario_metrics") or {},
                "deltas": run.get("deltas") or {},
                "created_at": run.get("created_at"),
                "completed_at": run.get("completed_at"),
            }
        )

    conversation = []
    for message in payload.messages[-10:]:
        role = "User" if message.role == "user" else "Assistant"
        conversation.append(f"{role}: {message.content.strip()}")

    financial_baseline = _compute_financial_baseline(workspace_data)

    # The records as separate labelled sources, plus what the Agent has done lately for this business.
    from app.modules.agent import memory
    runs, policy = await _agent_context(str(workspace.id))
    labelled = memory.sources(workspace_data, runs, policy, datetime.now(timezone.utc))
    business_name = (workspace_data.get("workspace_profile") or {}).get("company_name") or workspace.name

    system = (
        "You are a business assistant for the user's company, not a product support bot. "
        "Answer only from the business context supplied. "
        "CRITICAL: When answering any question about revenue, costs, profit, or financial performance, "
        "you MUST use the figures in COMPUTED FINANCIAL BASELINE — not raw invoice totals from workspace data "
        "and not figures from old simulation runs. The computed baseline matches exactly what the Simulation "
        "page shows. Old simulation runs may have stale baseline_metrics from a different point in time; "
        "treat them only as scenario outcome history, not as the current financial state. "
        "Be practical, concise, and helpful. "
        "If the answer is not supported by the available business data, say that clearly and state what is missing. "
        "Do not claim knowledge about EnterprateAI beyond the supplied workspace data. "
        + memory.RULES + " "
        "Return plain text only. Do not use markdown, bold markers, bullet lists, numbered lists, or hyphen-led list formatting."
    )
    prompt = (
        f"Business name: {business_name}\n\n"
        f"COMPUTED FINANCIAL BASELINE (authoritative — always use these figures for financial questions):\n"
        f"{_compact_json(financial_baseline, limit=2000)}\n\n"
        + "".join(f"{label}:\n{_compact_json(value, limit=6000)}\n\n" for label, value in labelled.items())
        + f"OTHER WORKSPACE DATA (profile, settings, plans):\n{_compact_json(memory.without_sourced(workspace_data), limit=12000)}\n\n"
        + (f"LAUNCH READINESS AND FUNDING READINESS (the user's launch plans and funding cases, with their latest check):\n"
           f"{_compact_json(readiness_context, limit=6000)}\n\n" if readiness_context else "")
        + f"Registration context:\n{_compact_json(registration_context, limit=6000)}\n\n"
        f"Recent simulation runs (scenario outcomes only — do not use baseline_metrics for current state):\n"
        f"{_compact_json(simulation_context, limit=12000)}\n\n"
        f"Recent blueprint documents:\n{_compact_json(document_context, limit=12000)}\n\n"
        f"Conversation:\n" + "\n".join(conversation)
    )

    # The "Business Assistant Chat" charge (credit_feature_config: chat_message). Reserved before
    # the model is called, kept only if an answer comes back, released if it fails.
    from app.modules.credits.service import credit_guard
    await _ensure_chat_price()
    async with credit_guard(user_id, "chat_message"):
        result = await llm.generate_text(system=system, prompt=prompt, feature="business_assistant.chat")
        answer = _clean_assistant_answer(result.text or "")
        if not answer:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Business assistant returned an empty response.")
    from app.shared.privacy import redact_bulk_contacts
    answer, _redacted = redact_bulk_contacts(answer)      # whatever the model produced, no contact lists leave
    return BusinessAssistantChatResponse(answer=answer, provider=result.provider, model=result.model)
