from __future__ import annotations

import logging
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None


def get_mongo_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        settings = get_settings()
        _client = AsyncIOMotorClient(
            settings.mongo_uri,
            serverSelectionTimeoutMS=5000,
            tls=True,
            tlsAllowInvalidCertificates=True,
        )
    return _client


def get_mongo_db() -> AsyncIOMotorDatabase:
    settings = get_settings()
    return get_mongo_client()[settings.mongo_db]


async def connect_to_mongo() -> None:
    try:
        client = get_mongo_client()
        await client.admin.command("ping")
        logger.info("Connected to MongoDB.")
    except Exception as exc:
        logger.warning("MongoDB connection failed (snapshots will be skipped): %s", exc)


async def close_mongo_connection() -> None:
    global _client
    if _client:
        _client.close()
        _client = None
        logger.info("MongoDB connection closed.")
