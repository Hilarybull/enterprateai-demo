from __future__ import annotations

import logging
from typing import AsyncGenerator, Any

logger = logging.getLogger(__name__)


async def connect_to_mongo() -> None:
    logger.warning("MongoDB is disabled. Supabase is the active datastore.")


async def close_mongo_connection() -> None:
    logger.info("MongoDB is disabled. No connection to close.")


async def get_db() -> AsyncGenerator[Any, None]:
    raise RuntimeError("MongoDB is disabled. Use Supabase access helpers instead.")
