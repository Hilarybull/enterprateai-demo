from __future__ import annotations

from typing import Any
from pydantic import BaseModel


class ProposalPreferencesIn(BaseModel):
    enabled: bool = False
    accepted_modes: list[str] = ["general"]
    accepted_categories: list[str] | None = None
    proposal_cap: int | None = None
    visibility: str = "marketplace"


class ProposalPreferencesOut(BaseModel):
    enabled: bool
    accepted_modes: list[str]
    accepted_categories: list[str] | None
    proposal_cap: int | None
    visibility: str


class RequirementIn(BaseModel):
    text: str
    mandatory: bool = False
    weight: int = 1


class ProposalRequestIn(BaseModel):
    type: str = "general"
    title: str
    description: str | None = None
    budget_range: str | None = None
    budget_visible: bool = False
    deadline: str | None = None
    submission_cap: int | None = None
    requirements: list[RequirementIn] = []
    accepted_modes: list[str] = ["general"]
    accepted_categories: list[str] | None = None
    visibility: str = "marketplace"


class ProposalRequestPatch(BaseModel):
    type: str | None = None
    title: str | None = None
    description: str | None = None
    budget_range: str | None = None
    budget_visible: bool | None = None
    deadline: str | None = None
    submission_cap: int | None = None
    requirements: list[RequirementIn] | None = None
    accepted_modes: list[str] | None = None
    accepted_categories: list[str] | None = None
    visibility: str | None = None


class ProposalRequestOut(BaseModel):
    id: str
    workspace_id: str
    type: str
    title: str
    description: str | None
    budget_range: str | None
    budget_visible: bool
    deadline: str | None
    submission_cap: int | None
    requirements: list[dict]
    accepted_modes: list[str]
    accepted_categories: list[str] | None
    visibility: str
    status: str
    submission_count: int
    created_at: str
    updated_at: str


class StatusTransitionIn(BaseModel):
    status: str
    reason: str | None = None


class ProposalSubmitIn(BaseModel):
    request_id: str | None = None
    recipient_workspace_id: str
    title: str | None = None
    summary: str | None = None
    sections: list[dict] | None = None


class UploadSessionIn(BaseModel):
    request_id: str | None = None
    recipient_workspace_id: str | None = None
