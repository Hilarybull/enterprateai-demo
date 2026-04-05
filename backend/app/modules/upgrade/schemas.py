from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class UpgradeClickRequest(BaseModel):
    feature: str = Field(default="simulation", max_length=64)
    source: Optional[str] = Field(default=None, max_length=128)


class UpgradeClickResponse(BaseModel):
    status: str = "ok"
