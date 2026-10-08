"""Persistence for the shared readiness service (Blueprint s4-5).

Every record is business-scoped and has the same shape, so funding cases, launch initiatives,
forecasts, evidence, assessments, actions, artifacts and decisions share one small store:

    id, business_id, kind, subject_id, status, revision, key, data, created_by, created_at, updated_at

`revision` is the token for optimistic writes: an update that names a stale revision changes
nothing. `key` is unique per (business, subject) where it is set: an idempotency key for
assessments and artifacts, the criterion or blocker code for actions. Assessments are never
updated after they finish, so history stays reproducible.
"""
from __future__ import annotations

import copy
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

TABLES = {
    "subjects": "readiness_subjects",         # funding cases and launch initiatives
    "forecasts": "readiness_forecasts",
    "evidence": "readiness_evidence",
    "assessments": "readiness_assessments",
    "actions": "readiness_actions",
    "artifacts": "readiness_artifacts",
    "decisions": "readiness_decisions",       # launch decisions, actual launch, reviewer records
}
FILES_BUCKET = "readiness-evidence"           # private: every download goes through an access check


class Duplicate(Exception):
    """A record with this key already exists for the subject."""


class NotSetUp(Exception):
    """The readiness tables (migration 031) are not in this database yet."""


class Store:
    async def insert(self, coll: str, row: dict) -> dict: raise NotImplementedError
    async def get(self, coll: str, record_id: str) -> dict | None: raise NotImplementedError
    async def list(self, coll: str, business_id: str, *, subject_id: str | None = None, kind: str | None = None, limit: int = 200) -> list[dict]: raise NotImplementedError
    async def find_key(self, coll: str, business_id: str, subject_id: str | None, key: str) -> dict | None: raise NotImplementedError
    async def update(self, coll: str, record_id: str, patch: dict, *, expect_revision: int | None = None, bump: bool = True) -> dict | None: raise NotImplementedError
    async def put_file(self, path: str, content: bytes, content_type: str) -> None: raise NotImplementedError
    async def get_file(self, path: str) -> bytes | None: raise NotImplementedError


def _iso(v: Any) -> Any:
    return v.isoformat() if isinstance(v, datetime) else v


class MemoryStore(Store):
    def __init__(self, tables: dict[str, str] | None = None) -> None:
        self.rows: dict[str, dict[str, dict]] = {c: {} for c in (tables or TABLES)}
        self.files: dict[str, tuple[bytes, str]] = {}
        self._order: dict[str, int] = {}

    async def insert(self, coll, row):
        row = {k: _iso(v) for k, v in copy.deepcopy(row).items()}
        if row.get("key") and await self.find_key(coll, row["business_id"], row.get("subject_id"), row["key"]):
            raise Duplicate(row["key"])
        self.rows[coll][row["id"]] = row
        self._order[row["id"]] = len(self._order)
        return copy.deepcopy(row)

    async def get(self, coll, record_id):
        row = self.rows[coll].get(record_id)
        return copy.deepcopy(row) if row else None

    async def list(self, coll, business_id, *, subject_id=None, kind=None, limit=200):
        rows = [r for r in self.rows[coll].values() if r["business_id"] == business_id
                and (subject_id is None or r.get("subject_id") == subject_id) and (kind is None or r.get("kind") == kind)]
        rows.sort(key=lambda r: (str(r.get("created_at")), self._order.get(r["id"], 0)), reverse=True)
        return copy.deepcopy(rows[:limit])

    async def find_key(self, coll, business_id, subject_id, key):
        for r in self.rows[coll].values():
            if r["business_id"] == business_id and (subject_id is None or r.get("subject_id") == subject_id) and r.get("key") == key:
                return copy.deepcopy(r)
        return None

    async def update(self, coll, record_id, patch, *, expect_revision=None, bump=True):
        row = self.rows[coll].get(record_id)
        if not row or (expect_revision is not None and int(row.get("revision") or 0) != int(expect_revision)):
            return None
        row.update({k: _iso(v) for k, v in copy.deepcopy(patch).items()})
        if bump:
            row["revision"] = int(row.get("revision") or 0) + 1
        return copy.deepcopy(row)

    async def put_file(self, path, content, content_type):
        self.files[path] = (content, content_type)

    async def get_file(self, path):
        hit = self.files.get(path)
        return hit[0] if hit else None


def _missing_relation(exc: Exception) -> bool:
    text = str(exc)
    return any(code in text for code in ("PGRST205", "42P01")) or "Could not find the table" in text


class SupabaseStore(Store):
    """Tables are created by migration 031_readiness.sql."""

    def __init__(self, tables: dict[str, str] | None = None, bucket: str = FILES_BUCKET) -> None:
        from app.core import supabase as sb
        self.sb = sb
        self.tables = tables or TABLES
        self.bucket = bucket

    async def _call(self, fn, *args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except Exception as e:      # noqa: BLE001
            if _missing_relation(e):
                raise NotSetUp() from e
            raise

    async def insert(self, coll, row):
        payload = {k: _iso(v) for k, v in row.items()}
        try:
            rows = await self._call(self.sb.sb_insert, self.tables[coll], payload)
        except NotSetUp:
            raise
        except Exception as e:      # noqa: BLE001
            if "23505" in f"{getattr(e, 'code', '')} {e}":
                raise Duplicate(row.get("key")) from e
            raise
        return (rows or [payload])[0]

    async def get(self, coll, record_id):
        return await self._call(self.sb.sb_select, self.tables[coll], filters=[("id", "eq", record_id)], single=True)

    async def list(self, coll, business_id, *, subject_id=None, kind=None, limit=200):
        filters = [("business_id", "eq", business_id)]
        if subject_id is not None:
            filters.append(("subject_id", "eq", subject_id))
        if kind is not None:
            filters.append(("kind", "eq", kind))
        return await self._call(self.sb.sb_select, self.tables[coll], filters=filters, order="created_at", desc=True, limit=limit) or []

    async def find_key(self, coll, business_id, subject_id, key):
        filters = [("business_id", "eq", business_id), ("key", "eq", key)]
        if subject_id is not None:
            filters.append(("subject_id", "eq", subject_id))
        return await self._call(self.sb.sb_select, self.tables[coll], filters=filters, single=True)

    async def update(self, coll, record_id, patch, *, expect_revision=None, bump=True):
        payload = {k: _iso(v) for k, v in patch.items()}
        filters = [("id", "eq", record_id)]
        if bump or expect_revision is not None:
            current = await self.get(coll, record_id)
            if not current:
                return None
            revision = int(current.get("revision") or 0)
            if expect_revision is not None and revision != int(expect_revision):
                return None
            filters.append(("revision", "eq", revision))      # compare-and-swap: a concurrent write wins and this one reports a conflict
            if bump:
                payload["revision"] = revision + 1
        rows = await self._call(self.sb.sb_update, self.tables[coll], payload=payload, filters=filters)
        return rows[0] if rows else None

    async def put_file(self, path, content, content_type):
        import anyio

        def _run():
            from app.core.supabase import get_supabase_client
            storage = get_supabase_client().storage
            try:
                storage.create_bucket(self.bucket, options={"public": False})
            except Exception:      # noqa: BLE001 - already there
                pass
            storage.from_(self.bucket).upload(path, content, {"content-type": content_type, "upsert": "true"})

        await anyio.to_thread.run_sync(_run)

    async def get_file(self, path):
        import anyio

        def _run():
            from app.core.supabase import get_supabase_client
            return get_supabase_client().storage.from_(self.bucket).download(path)

        try:
            return await anyio.to_thread.run_sync(_run)
        except Exception:      # noqa: BLE001
            logger.warning("readiness evidence file could not be read")
            return None
