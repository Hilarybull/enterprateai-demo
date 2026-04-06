from __future__ import annotations

from datetime import datetime
from typing import Any, Dict

from pydantic import BaseModel


class WorkspaceDocument(BaseModel):
    id: str
    user_id: str
    name: str
    data: Dict[str, Any]
    created_at: datetime
    updated_at: datetime
