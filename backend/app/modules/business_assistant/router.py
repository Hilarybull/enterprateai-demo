from __future__ import annotations

from fastapi import APIRouter, Depends

from app.modules.business_assistant.schemas import BusinessAssistantChatRequest, BusinessAssistantChatResponse
from app.modules.business_assistant.service import chat_about_business
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/business-assistant", tags=["business_assistant"])


@router.post("/chat", response_model=BusinessAssistantChatResponse)
async def business_assistant_chat(
    payload: BusinessAssistantChatRequest,
    user=Depends(get_current_user),
) -> BusinessAssistantChatResponse:
    return await chat_about_business(user_id=user["id"], payload=payload)
