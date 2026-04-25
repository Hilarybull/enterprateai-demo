from __future__ import annotations

from pydantic import BaseModel, Field


class BusinessAssistantMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=8000)


class BusinessAssistantChatRequest(BaseModel):
    messages: list[BusinessAssistantMessage] = Field(default_factory=list, min_length=1, max_length=12)


class BusinessAssistantChatResponse(BaseModel):
    answer: str
    provider: str
    model: str
