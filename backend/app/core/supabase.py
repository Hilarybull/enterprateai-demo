from __future__ import annotations

from typing import Any, Iterable

import anyio
from supabase import Client, ClientOptions, create_client

from app.core.config import get_settings

_client: Client | None = None


def get_supabase_client() -> Client:
    global _client
    if _client is None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("Supabase URL / service role key not configured")
        try:
            options = ClientOptions(http2=False)
        except TypeError:
            # Older/newer supabase-py releases expose different ClientOptions signatures.
            options = ClientOptions()
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key, options=options)
    return _client


async def sb_select(
    table: str,
    *,
    filters: list[tuple[str, str, Any]] | None = None,
    columns: str = "*",
    order: str | None = None,
    desc: bool = False,
    limit: int | None = None,
    single: bool = False,
) -> Any:
    def _run():
        client = get_supabase_client()
        q = client.table(table).select(columns)
        for col, op, value in (filters or []):
            if op == "eq":
                q = q.eq(col, value)
            elif op == "neq":
                q = q.neq(col, value)
            elif op == "in":
                q = q.in_(col, value)
            elif op == "cs":
                q = q.contains(col, value)
        if order:
            q = q.order(order, desc=desc)
        if limit:
            q = q.limit(limit)
        res = q.execute()
        return res.data

    data = await anyio.to_thread.run_sync(_run)
    if single:
        return data[0] if data else None
    return data


async def sb_insert(table: str, payload: dict[str, Any] | list[dict[str, Any]]) -> Any:
    def _run():
        client = get_supabase_client()
        res = client.table(table).insert(payload).execute()
        return res.data

    return await anyio.to_thread.run_sync(_run)


async def sb_update(
    table: str,
    *,
    payload: dict[str, Any],
    filters: list[tuple[str, str, Any]],
) -> Any:
    def _run():
        client = get_supabase_client()
        q = client.table(table).update(payload)
        for col, op, value in filters:
            if op == "eq":
                q = q.eq(col, value)
            elif op == "neq":
                q = q.neq(col, value)
            elif op == "in":
                q = q.in_(col, value)
        res = q.execute()
        return res.data

    return await anyio.to_thread.run_sync(_run)


async def sb_delete(
    table: str,
    *,
    filters: list[tuple[str, str, Any]],
) -> Any:
    def _run():
        client = get_supabase_client()
        q = client.table(table).delete()
        for col, op, value in filters:
            if op == "eq":
                q = q.eq(col, value)
            elif op == "neq":
                q = q.neq(col, value)
            elif op == "in":
                q = q.in_(col, value)
        res = q.execute()
        return res.data

    return await anyio.to_thread.run_sync(_run)


async def sb_upsert(
    table: str,
    *,
    payload: dict[str, Any],
    on_conflict: str | None = None,
) -> Any:
    def _run():
        client = get_supabase_client()
        q = client.table(table).upsert(payload)
        if on_conflict:
            q = q.on_conflict(on_conflict)
        res = q.execute()
        return res.data

    return await anyio.to_thread.run_sync(_run)
