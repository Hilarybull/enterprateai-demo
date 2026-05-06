from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr


class CreateInvitationRequest(BaseModel):
    email: Optional[EmailStr] = None
    permission_type: str  # "module" or "feature"
    permissions: Dict[str, Any]  # {"modules": [...]} or {"features": {...}}
    expires_in_days: Optional[int] = 7


class UpdateMemberRequest(BaseModel):
    permission_type: str
    permissions: Dict[str, Any]
