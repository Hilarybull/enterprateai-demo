from __future__ import annotations

import json
import re

from fastapi import HTTPException, status

from app.core.supabase import sb_select
from app.modules.idea_validation.service import get_user_workspace
from app.modules.business_assistant.schemas import BusinessAssistantChatRequest, BusinessAssistantChatResponse
from app.shared.llm.openai_client import AutoLLMClient, NoopLLMClient


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


async def chat_about_business(*, user_id: str, payload: BusinessAssistantChatRequest) -> BusinessAssistantChatResponse:
    llm = AutoLLMClient()
    if isinstance(llm, NoopLLMClient):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LLM provider not configured for the business assistant.",
        )

    workspace = await get_user_workspace(user_id=user_id)
    if not workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    workspace_data = workspace.data or {}
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

    system = (
        "You are a business assistant for the user's company, not a product support bot. "
        "Answer only from the business context supplied. This includes workspace profile, registration details, and simulation history when available. "
        "Be practical, concise, and helpful. "
        "If the answer is not supported by the available business data, say that clearly and state what is missing. "
        "Do not claim knowledge about EnterprateAI beyond the supplied workspace data. "
        "Return plain text only. Do not use markdown, bold markers, bullet lists, numbered lists, or hyphen-led list formatting."
    )
    prompt = (
        f"Workspace name: {workspace.name}\n\n"
        f"Workspace data:\n{_compact_json(workspace_data)}\n\n"
        f"Registration context:\n{_compact_json(registration_context, limit=6000)}\n\n"
        f"Recent simulation runs:\n{_compact_json(simulation_context, limit=12000)}\n\n"
        f"Recent blueprint documents:\n{_compact_json(document_context, limit=12000)}\n\n"
        f"Conversation:\n" + "\n".join(conversation)
    )

    result = await llm.generate_text(system=system, prompt=prompt)
    answer = _clean_assistant_answer(result.text or "")
    if not answer:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Business assistant returned an empty response.")
    return BusinessAssistantChatResponse(answer=answer, provider=result.provider, model=result.model)
