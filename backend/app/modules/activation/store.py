"""Where the activation journeys read and write: users (with their permission record), the
workspaces they own, the journey ledger and the event log. One in-memory version for tests and
one over Supabase."""
from __future__ import annotations

import copy
import uuid
from datetime import datetime
from typing import Any

USER_COLUMNS = ("id,email,name,auth_provider,email_verified,verified_at,created_at,timezone,marketing_email_status,marketing_permission_source,marketing_permission_at,"
                "marketing_unsubscribed_at,marketing_suppression_reason,marketing_permission_wording,marketing_last_change_source,marketing_prompt_answered_at")
LEDGER, EVENTS = "activation_ledger", "activation_events"


class Duplicate(Exception):
    """The row already exists (the same step for the same user, or the same delivery event)."""


class NotSetUp(Exception):
    """The tables or columns for this feature aren't there: migration 033 hasn't been run on this server."""


def _missing(e: Exception) -> bool:
    text = f"{getattr(e, 'code', '')} {e}"
    return any(code in text for code in ("PGRST205", "PGRST204", "42P01", "42703")) or "Could not find the" in text or "does not exist" in text


def _iso(v: Any) -> Any:
    return v.isoformat() if isinstance(v, datetime) else v


class Store:
    async def list_users(self) -> list[dict]: raise NotImplementedError
    async def get_user(self, user_id: str) -> dict | None: raise NotImplementedError
    async def update_user(self, user_id: str, patch: dict) -> None: raise NotImplementedError
    async def workspace_index(self) -> dict[str, list[dict]]: raise NotImplementedError      # user_id -> [{id, created_at, updated_at}], no content
    async def workspaces_of(self, user_id: str) -> list[dict]: raise NotImplementedError     # with data, for reading what has been done
    async def ledger(self, user_id: str | None = None) -> list[dict]: raise NotImplementedError
    async def ledger_by_message(self, message_id: str) -> dict | None: raise NotImplementedError
    async def insert_ledger(self, row: dict) -> dict: raise NotImplementedError
    async def update_ledger(self, row_id: str, patch: dict, *, expect_state: str | None = None) -> dict | None: raise NotImplementedError
    async def insert_event(self, row: dict) -> dict: raise NotImplementedError
    async def events(self, user_id: str | None = None) -> list[dict]: raise NotImplementedError


class MemoryStore(Store):
    def __init__(self, users: dict[str, dict] | None = None, workspaces: dict[str, dict] | None = None):
        self.users = users if users is not None else {}
        self.workspaces = workspaces if workspaces is not None else {}      # id -> {user_id, created_at, updated_at, data}
        self.ledger_rows: dict[str, dict] = {}
        self.event_rows: list[dict] = []

    async def list_users(self):
        return [copy.deepcopy(u) for u in self.users.values()]

    async def get_user(self, user_id):
        return copy.deepcopy(self.users.get(user_id))

    async def update_user(self, user_id, patch):
        if user_id in self.users:
            self.users[user_id].update({k: _iso(v) for k, v in patch.items()})

    async def workspace_index(self):
        out: dict[str, list[dict]] = {}
        for wid, w in self.workspaces.items():
            out.setdefault(w["user_id"], []).append({"id": wid, "created_at": _iso(w.get("created_at")), "updated_at": _iso(w.get("updated_at") or w.get("created_at"))})
        return out

    async def workspaces_of(self, user_id):
        return [{"id": wid, "created_at": _iso(w.get("created_at")), "updated_at": _iso(w.get("updated_at") or w.get("created_at")), "data": copy.deepcopy(w.get("data") or {})}
                for wid, w in self.workspaces.items() if w["user_id"] == user_id]

    async def ledger(self, user_id=None):
        return [copy.deepcopy(r) for r in self.ledger_rows.values() if user_id is None or r["user_id"] == user_id]

    async def ledger_by_message(self, message_id):
        return next((copy.deepcopy(r) for r in self.ledger_rows.values() if r.get("provider_message_id") == message_id), None)

    async def insert_ledger(self, row):
        row = {k: _iso(v) for k, v in row.items()}
        if any((r["user_id"], r["journey_key"], r["step_key"]) == (row["user_id"], row["journey_key"], row["step_key"]) for r in self.ledger_rows.values()):
            raise Duplicate()
        row.setdefault("id", str(uuid.uuid4()))
        self.ledger_rows[row["id"]] = row
        return copy.deepcopy(row)

    async def update_ledger(self, row_id, patch, *, expect_state=None):
        row = self.ledger_rows.get(row_id)
        if not row or (expect_state is not None and row.get("state") != expect_state):
            return None      # someone else got there first
        row.update({k: _iso(v) for k, v in patch.items()})
        return copy.deepcopy(row)

    async def insert_event(self, row):
        row = {k: _iso(v) for k, v in row.items()}
        if row.get("dedupe_key") and any(e.get("dedupe_key") == row["dedupe_key"] for e in self.event_rows):
            raise Duplicate()
        row.setdefault("id", str(uuid.uuid4()))
        self.event_rows.append(row)
        return copy.deepcopy(row)

    async def events(self, user_id=None):
        return [copy.deepcopy(e) for e in self.event_rows if user_id is None or e.get("user_id") == user_id]


class SupabaseStore(Store):
    @staticmethod
    def _dup(e: Exception) -> bool:
        return "23505" in f"{getattr(e, 'code', '')} {e}" or "duplicate key" in str(e).lower()

    @staticmethod
    async def _call(fn, *args, **kwargs):
        """A missing table or column means the migration hasn't been run: say exactly that."""
        try:
            return await fn(*args, **kwargs)
        except Exception as e:      # noqa: BLE001
            if _missing(e):
                raise NotSetUp() from e
            raise

    async def list_users(self):
        from app.core.supabase import sb_select
        return await self._call(sb_select, "users", columns=USER_COLUMNS, limit=20000) or []

    async def get_user(self, user_id):
        from app.core.supabase import sb_select
        return await self._call(sb_select, "users", filters=[("id", "eq", user_id)], columns=USER_COLUMNS, single=True)

    async def update_user(self, user_id, patch):
        from app.core.supabase import sb_update
        await self._call(sb_update, "users", filters=[("id", "eq", user_id)], payload={k: _iso(v) for k, v in patch.items()})

    async def workspace_index(self):
        from app.core.supabase import sb_select
        out: dict[str, list[dict]] = {}
        for w in await sb_select("workspaces", columns="id,user_id,created_at,updated_at", limit=50000) or []:
            out.setdefault(str(w["user_id"]), []).append({"id": str(w["id"]), "created_at": w.get("created_at"), "updated_at": w.get("updated_at") or w.get("created_at")})
        return out

    async def workspaces_of(self, user_id):
        from app.core.supabase import sb_select
        rows = await sb_select("workspaces", filters=[("user_id", "eq", user_id)], columns="id,created_at,updated_at,data") or []
        return [{"id": str(r["id"]), "created_at": r.get("created_at"), "updated_at": r.get("updated_at") or r.get("created_at"), "data": r.get("data") or {}} for r in rows]

    async def ledger(self, user_id=None):
        from app.core.supabase import sb_select
        return await self._call(sb_select, LEDGER, filters=[("user_id", "eq", user_id)] if user_id else None, limit=50000) or []

    async def ledger_by_message(self, message_id):
        from app.core.supabase import sb_select
        return await self._call(sb_select, LEDGER, filters=[("provider_message_id", "eq", message_id)], single=True)

    async def insert_ledger(self, row):
        from app.core.supabase import sb_insert
        payload = {"id": str(uuid.uuid4()), **{k: _iso(v) for k, v in row.items()}}
        try:
            rows = await sb_insert(LEDGER, payload)
        except Exception as e:      # noqa: BLE001
            if self._dup(e):
                raise Duplicate() from e
            if _missing(e):
                raise NotSetUp() from e
            raise
        return (rows[0] if isinstance(rows, list) and rows else rows) or payload

    async def update_ledger(self, row_id, patch, *, expect_state=None):
        from app.core.supabase import sb_update
        filters = [("id", "eq", row_id)] + ([("state", "eq", expect_state)] if expect_state is not None else [])
        rows = await self._call(sb_update, LEDGER, filters=filters, payload={k: _iso(v) for k, v in patch.items()})
        return rows[0] if rows else None      # no row: the state had already moved on

    async def insert_event(self, row):
        from app.core.supabase import sb_insert
        payload = {"id": str(uuid.uuid4()), **{k: _iso(v) for k, v in row.items()}}
        try:
            await sb_insert(EVENTS, payload)
        except Exception as e:      # noqa: BLE001
            if self._dup(e):
                raise Duplicate() from e
            if _missing(e):
                raise NotSetUp() from e
            raise
        return payload

    async def events(self, user_id=None):
        from app.core.supabase import sb_select
        return await self._call(sb_select, EVENTS, filters=[("user_id", "eq", user_id)] if user_id else None, limit=50000) or []
