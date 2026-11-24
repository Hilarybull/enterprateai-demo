from __future__ import annotations

from pydantic import BaseModel, Field


class BusinessAssistantMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=8000)


class BusinessAssistantChatRequest(BaseModel):
    messages: list[BusinessAssistantMessage] = Field(default_factory=list, min_length=1, max_length=40)
    workspace_id: str | None = Field(default=None, max_length=64)      # the business on screen; the user's own when omitted


class BusinessAssistantChatResponse(BaseModel):
    answer: str
    provider: str
    model: str
    credits_used: int = 0      # what this answer cost (0: it found nothing, declined, or only pointed at a task)
    action: str | None = None  # E2: the owner asked for something done: the task that does it (started by the Agent, never described)
