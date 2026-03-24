from __future__ import annotations

import logging
from typing import AsyncGenerator

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


async def connect_to_mongo() -> None:
    global _client, _db
    settings = get_settings()
    _client = AsyncIOMotorClient(settings.mongo_uri, serverSelectionTimeoutMS=5000)
    _db = _client[settings.mongo_db]
    try:
        await _client.admin.command("ping")
    except Exception as e:
        # Fail fast with a clear startup error instead of hanging on first query.
        logger.error("MongoDB connection failed (check MONGO_URI/MONGO_URL, Atlas IP allowlist, credentials): %s", e)
        raise
    logger.info("Connected to MongoDB db=%s", settings.mongo_db)


async def close_mongo_connection() -> None:
    global _client, _db
    if _client is not None:
        _client.close()
    _client = None
    _db = None
    logger.info("Closed MongoDB connection")


async def get_db() -> AsyncGenerator[AsyncIOMotorDatabase, None]:
    if _db is None:
        await connect_to_mongo()
    assert _db is not None
    yield _db
