from __future__ import annotations

import asyncio
import contextlib
import contextvars
import copy
import logging
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

import anyio
import httpx
from postgrest import SyncPostgrestClient
from supabase import Client, ClientOptions, create_client

from app.core.config import get_settings

def _make_client() -> Client:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase URL / service role key not configured")
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
        options=ClientOptions(postgrest_client_timeout=20),
    )


def get_supabase_client(reset: bool = False) -> Client:
    # The Supabase Python client is not safe for our threaded request wrapper
    # when shared globally. Return a fresh client per call so concurrent
    # requests do not race through the same underlying HTTP state.
    _ = reset
    return _make_client()


_RETRIABLE = frozenset({
    "RemoteProtocolError", "ConnectionError", "ConnectError",
    "ConnectionClosed", "RemoteDisconnected", "ProtocolError",
    "WriteError", "ReadError",  # httpx/httpcore SSL EOF on stale HTTP/2 connections
    "ConnectTimeout", "ReadTimeout", "WriteTimeout", "PoolTimeout",  # TLS handshake / slow response
})


def _is_retriable(exc: BaseException) -> bool:
    seen = set()
    node: BaseException | None = exc
    while node is not None and id(node) not in seen:
        seen.add(id(node))
        if type(node).__name__ in _RETRIABLE:
            return True
        node = getattr(node, "__cause__", None) or getattr(node, "__context__", None)
    return False


# ── Connection reuse ─────────────────────────────────────────────────────────
# Building a full Supabase client and opening its TLS connection costs well over a
# second, against a few hundred milliseconds for a query on a connection that is already
# open. So the sb_* helpers borrow a database client from this small pool and hand it
# back afterwards. A client is only ever used by one thread at a time, which keeps the
# reason for not sharing a single global client (see get_supabase_client) intact.
#
# The pool is deliberately small and fixed. Opening dozens of connections at once makes
# the database gateway refuse new ones for a while, so when every connection is busy a
# query waits its turn (a fraction of a second) instead of opening another.
_POOL_SIZE = 10          # connections kept open, and the most queries in flight at once
_POOL_WAIT = 15.0        # seconds a query waits for a free connection before using a one-off
_POOL_IDLE_MAX = 240.0   # seconds; a connection left idle longer is assumed closed by the server
# Oldest on the left, most recently used on the right. Requests take from the right, so
# the same few connections stay busy; the keep-warm task refreshes from the left.
_pool: "deque[tuple[SyncPostgrestClient, float]]" = deque()
_pool_lock = threading.Lock()
_slots = threading.BoundedSemaphore(_POOL_SIZE)
logger = logging.getLogger(__name__)

# Loading the certificate store is the expensive part of building a client (around a
# second of CPU, and the full Supabase client does it twice). It is the same for every
# connection, so it is loaded once and shared.
_ssl_context = None
_ssl_lock = threading.Lock()


def _shared_ssl_context():
    global _ssl_context
    with _ssl_lock:
        if _ssl_context is None:
            _ssl_context = httpx.create_ssl_context()
        return _ssl_context


def _make_pool_client() -> SyncPostgrestClient:
    """A database (PostgREST) client for the pool: the only part of Supabase the sb_* helpers use."""
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase URL / service role key not configured")
    key = settings.supabase_service_role_key
    return SyncPostgrestClient(
        f"{settings.supabase_url.rstrip('/')}/rest/v1",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        # Fail fast when a connection can't be opened, rather than holding the request for 20s.
        timeout=httpx.Timeout(20.0, connect=6.0),
        verify=_shared_ssl_context(),  # httpx accepts a ready-made context here
    )


def _close(client: SyncPostgrestClient) -> None:
    try:
        client.session.close()
    except Exception:
        pass


def _take() -> tuple[SyncPostgrestClient, bool]:
    """A client to use, and whether it came from the pool (False = newly built)."""
    while True:
        with _pool_lock:
            entry = _pool.pop() if _pool else None
        if entry is None:
            return _make_pool_client(), False
        client, last_used = entry
        if time.monotonic() - last_used <= _POOL_IDLE_MAX:
            return client, True
        _close(client)


def _give_back(client: SyncPostgrestClient) -> None:
    with _pool_lock:
        if len(_pool) < _POOL_SIZE:
            _pool.append((client, time.monotonic()))
            return
    _close(client)


def _take_idle(older_than: float, limit: int) -> list[SyncPostgrestClient]:
    """Remove and return up to `limit` pooled clients not used for `older_than` seconds."""
    now = time.monotonic()
    taken: list[SyncPostgrestClient] = []
    with _pool_lock:
        while _pool and len(taken) < limit and now - _pool[0][1] > older_than:
            taken.append(_pool.popleft()[0])
    return taken


def _with_client(fn: Callable[[SyncPostgrestClient], Any], *, max_attempts: int = 3, base_delay: float = 1.0):
    """Run fn(client) on a pooled client, retrying transient connection errors."""
    # One of the pool's turns. If none comes free in time, carry on with a one-off
    # connection rather than fail the request.
    have_slot = _slots.acquire(timeout=_POOL_WAIT)
    if not have_slot:
        logger.warning("Supabase pool busy for %.0fs; using a one-off connection", _POOL_WAIT)
    try:
        last_exc: Exception | None = None
        attempt = 0
        while attempt < max_attempts:
            client, reused = _take() if have_slot else (_make_pool_client(), False)
            try:
                result = fn(client)
            except Exception as exc:
                if not _is_retriable(exc):
                    # The query was rejected; the connection itself is fine.
                    _give_back(client) if have_slot else _close(client)
                    raise
                _close(client)
                last_exc = exc
                if reused:
                    # The server closed this connection while it sat idle. Try the next one
                    # straight away; this doesn't count as an attempt, and can't loop for
                    # long because each failure removes a connection from the pool.
                    logger.info("Supabase pooled connection had gone stale (%s); retrying", type(exc).__name__)
                    continue
                attempt += 1
                if attempt < max_attempts:
                    time.sleep(base_delay * attempt)
                continue
            _give_back(client) if have_slot else _close(client)
            return result
        raise last_exc  # type: ignore[misc]
    finally:
        if have_slot:
            _slots.release()


def _refresh(client: SyncPostgrestClient | None) -> None:
    """Touch a pooled connection so the server keeps it open (or open a new one), then pool it."""
    try:
        client = client or _make_pool_client()
        client.table("users").select("id").limit(1).execute()
    except Exception:
        if client is not None:
            _close(client)
        return
    _give_back(client)


async def keep_pool_warm(interval: float = 30.0, idle_after: float = 90.0) -> None:
    """Open the pool's connections at startup and keep them alive, so a request never
    pays the connection set-up cost. Runs until cancelled; never raises."""
    first = True
    while True:
        try:
            if first:
                first = False
                await asyncio.gather(
                    *[anyio.to_thread.run_sync(_refresh, None) for _ in range(_POOL_SIZE)],
                    return_exceptions=True,
                )
            # Refresh idle connections two at a time, so the pool is never emptied while
            # requests are being served. Refreshed ones go back as "just used", which ends the loop.
            while True:
                idle = _take_idle(idle_after, limit=2)
                if not idle:
                    break
                await asyncio.gather(*[anyio.to_thread.run_sync(_refresh, client) for client in idle], return_exceptions=True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("Supabase pool warm-up skipped: %s", exc)
        await asyncio.sleep(interval)


def _run_with_retry(fn, *, max_attempts: int = 3, base_delay: float = 1.0):
    """Execute fn() retrying up to max_attempts times on transient connection errors."""
    last_exc: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as exc:
            if _is_retriable(exc):
                last_exc = exc
                if attempt < max_attempts - 1:
                    time.sleep(base_delay * (attempt + 1))
                continue
            raise
    raise last_exc  # type: ignore[misc]


# ── Reads shared within one piece of work ────────────────────────────────────
# Handling one request often asks for the same row several times (the business record for the
# permission check, again for its details, again for each step). Inside `read_cache()` an
# identical select is answered from the first one, including one still on its way. Any write
# through these helpers to a table forgets that table's reads, and nothing is kept for longer
# than a few seconds, so work that runs on for a while still sees what others have changed.
_reads: "contextvars.ContextVar[dict | None]" = contextvars.ContextVar("sb_reads", default=None)
_READ_TTL = 3.0


@contextlib.contextmanager
def read_cache():
    if _reads.get() is not None:      # already inside one: share it
        yield
        return
    token = _reads.set({})
    try:
        yield
    finally:
        _reads.reset(token)


def _forget_reads(table: str | None = None) -> None:
    cache = _reads.get()
    if not cache:
        return
    if table is None:
        cache.clear()
        return
    for key in [k for k in cache if k[0] == table]:
        cache.pop(key, None)


async def sb_select(table: str, **kwargs: Any) -> Any:
    cache = _reads.get()
    if cache is None:
        return await _sb_select(table, **kwargs)
    key = (table, repr(sorted(kwargs.items(), key=lambda kv: kv[0])))
    hit = cache.get(key)
    if hit and time.monotonic() - hit[0] < _READ_TTL:
        return copy.deepcopy(await hit[1])
    if len(cache) > 400:
        cache.clear()
    pending = asyncio.ensure_future(_sb_select(table, **kwargs))
    cache[key] = (time.monotonic(), pending)
    try:
        data = await pending
    except BaseException:
        cache.pop(key, None)
        raise
    return copy.deepcopy(data)      # the caller may change what it is given; the kept copy stays as read


async def _sb_select(
    table: str,
    *,
    filters: list[tuple[str, str, Any]] | None = None,
    columns: str = "*",
    order: str | None = None,
    desc: bool = False,
    limit: int | None = None,
    single: bool = False,
) -> Any:
    def _run(client: SyncPostgrestClient):
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
            elif op == "gt":
                q = q.gt(col, value)
            elif op == "gte":
                q = q.gte(col, value)
            elif op == "lt":
                q = q.lt(col, value)
            elif op == "lte":
                q = q.lte(col, value)
            elif op == "like":
                q = q.like(col, value)
        if order:
            q = q.order(order, desc=desc)
        if limit:
            q = q.limit(limit)
        res = q.execute()
        return res.data

    data = await anyio.to_thread.run_sync(lambda: _with_client(_run))
    if single:
        return data[0] if data else None
    return data


async def sb_rpc(function: str, params: dict[str, Any] | None = None) -> Any:
    """Call a SQL function (for work that must be one atomic statement, such as a counter)."""
    def _run(client: SyncPostgrestClient):
        return client.rpc(function, params or {}).execute().data

    try:
        return await anyio.to_thread.run_sync(lambda: _with_client(_run))
    finally:
        _forget_reads()


async def sb_insert(table: str, payload: dict[str, Any] | list[dict[str, Any]]) -> Any:
    def _run(client: SyncPostgrestClient):
        res = client.table(table).insert(payload).execute()
        return res.data

    try:
        return await anyio.to_thread.run_sync(lambda: _with_client(_run))
    finally:
        _forget_reads(table)


async def sb_update(
    table: str,
    *,
    payload: dict[str, Any],
    filters: list[tuple[str, str, Any]],
) -> Any:
    def _run(client: SyncPostgrestClient):
        # Workspace features share one JSON document. A request that started
        # earlier can otherwise write its stale copy after the master profile
        # was saved, making the profile appear to revert or disappear.
        workspace_id = next(
            (value for col, op, value in filters if col == "id" and op == "eq"),
            None,
        )
        if table == "workspaces" and workspace_id and isinstance(payload.get("data"), dict):
            for _attempt in range(5):
                current_rows = (
                    client.table("workspaces")
                    .select("id,data,updated_at")
                    .eq("id", workspace_id)
                    .limit(1)
                    .execute()
                    .data
                )
                if not current_rows:
                    return []

                current = current_rows[0]
                current_data = dict(current.get("data") or {})
                incoming_data = dict(payload["data"])
                # Receipts, reminders and customer responses written by the server since the
                # client loaded its copy are never erased by that client's save.
                from app.shared.workspace_merge import preserve_server_fields
                incoming_data = preserve_server_fields(incoming_data, current_data)
                current_profile = current_data.get("workspace_profile")
                incoming_revision = incoming_data.get("workspace_profile_updated_at")
                current_revision = current_data.get("workspace_profile_updated_at")

                # Only the dedicated profile endpoint supplies a revision.
                # All other whole-document writes must retain the current
                # master profile, including legacy profiles without a stamp.
                if current_profile and (
                    not incoming_revision
                    or (current_revision and str(current_revision) > str(incoming_revision))
                ):
                    incoming_data["workspace_profile"] = current_profile
                    if current_revision:
                        incoming_data["workspace_profile_updated_at"] = current_revision

                guarded_payload = dict(payload)
                guarded_payload["data"] = incoming_data
                guarded_payload["updated_at"] = datetime.now(timezone.utc).isoformat()

                q = client.table(table).update(guarded_payload)
                for col, op, value in filters:
                    if op == "eq":
                        q = q.eq(col, value)
                    elif op == "neq":
                        q = q.neq(col, value)
                    elif op == "in":
                        q = q.in_(col, value)
                if current.get("updated_at"):
                    q = q.eq("updated_at", current["updated_at"])
                rows = q.execute().data
                if rows:
                    return rows
            raise RuntimeError("Workspace changed repeatedly while saving; please retry")

        q = client.table(table).update(payload)
        for col, op, value in filters:
            if op == "eq":
                q = q.eq(col, value)
            elif op == "neq":
                q = q.neq(col, value)
            elif op == "in":
                q = q.in_(col, value)
        return q.execute().data

    try:
        return await anyio.to_thread.run_sync(lambda: _with_client(_run))
    finally:
        _forget_reads(table)


async def sb_delete(
    table: str,
    *,
    filters: list[tuple[str, str, Any]],
) -> Any:
    def _run(client: SyncPostgrestClient):
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

    try:
        return await anyio.to_thread.run_sync(lambda: _with_client(_run))
    finally:
        _forget_reads(table)


async def sb_upsert(
    table: str,
    *,
    payload: dict[str, Any],
    on_conflict: str | None = None,
) -> Any:
    def _run(client: SyncPostgrestClient):
        kwargs = {"on_conflict": on_conflict} if on_conflict else {}
        res = client.table(table).upsert(payload, **kwargs).execute()
        return res.data

    try:
        return await anyio.to_thread.run_sync(lambda: _with_client(_run))
    finally:
        _forget_reads(table)


async def sb_upload_file(
    bucket: str,
    path: str,
    file_bytes: bytes,
    content_type: str = "application/octet-stream",
) -> str:
    """Upload a file to Supabase Storage and return its public URL."""
    def _run():
        import httpx
        settings = get_settings()
        from supabase import create_client, ClientOptions
        client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
            options=ClientOptions(postgrest_client_timeout=120),
        )
        # Patch the storage _client timeout so large uploads don't time out
        try:
            client.storage._client.timeout = httpx.Timeout(120.0)
        except Exception:
            pass
        # Ensure bucket exists (no-op if already created)
        try:
            client.storage.create_bucket(bucket, {"public": True})
        except Exception:
            pass
        client.storage.from_(bucket).upload(
            path,
            file_bytes,
            {"content-type": content_type, "upsert": "true"},
        )
        return client.storage.from_(bucket).get_public_url(path)

    return await anyio.to_thread.run_sync(lambda: _run_with_retry(_run))
