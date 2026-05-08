from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, EmailStr, Field, model_validator


class CreateInvitationRequest(BaseModel):
    access_mode: str = "link"  # "link" or "email"
    email: Optional[EmailStr] = None
    permission_type: str  # "module" or "feature"
    permissions: Dict[str, Any]  # {"modules": [...]} or {"features": {...}}
    expires_in_days: int = Field(default=7, ge=1, le=30)

    @model_validator(mode="after")
    def validate_access_mode(self):
        if self.access_mode not in {"link", "email"}:
            raise ValueError("access_mode must be either 'link' or 'email'")
        if self.access_mode == "email" and not self.email:
            raise ValueError("Email is required for email-only invites")
        if self.access_mode == "link":
            self.email = None
        return self


class UpdateMemberRequest(BaseModel):
    permission_type: str
    permissions: Dict[str, Any]
