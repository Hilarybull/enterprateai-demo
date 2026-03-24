from __future__ import annotations

from datetime import datetime
from typing import Any

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field


class PyObjectId(ObjectId):
    @classmethod
    def __get_pydantic_core_schema__(cls, _source_type: Any, _handler: Any) -> Any:
        from pydantic_core import core_schema

        return core_schema.no_info_plain_validator_function(cls.validate)

    @classmethod
    def validate(cls, v: Any) -> ObjectId:
        if isinstance(v, ObjectId):
            return v
        if isinstance(v, str) and ObjectId.is_valid(v):
            return ObjectId(v)
        raise ValueError("Invalid ObjectId")


class MongoModel(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)


class WorkspaceDocument(MongoModel):
    id: PyObjectId = Field(alias="_id")
    user_id: str
    name: str
    data: dict
    created_at: datetime
    updated_at: datetime

