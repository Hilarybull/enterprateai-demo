"""Durable state for workflows, steps, approvals, audit, idempotency and events (s13, s21).

`MemoryStore` backs the test-suite; `SupabaseStore` is production. Both implement
the same contract so the orchestrator never touches a database directly.
"""
from __future__ import annotations

import copy
import logging
import re
import logging
from datetime import datetime
from typing import Any

from app.modules.agent import config
from app.modules.agent.models import new_id, now_utc

logger = logging.getLogger(__name__)


def _iso(v: Any) -> Any:
    return v.isoformat() if isinstance(v, datetime) else v


class Store:
    # runs
    async def create_run(self, run: dict) -> dict: raise NotImplementedError
    async def get_run(self, run_id: str) -> dict | None: raise NotImplementedError
    async def update_run(self, run_id: str, patch: dict) -> dict: raise NotImplementedError
    async def list_runs(self, business_id: str, *, statuses: list[str] | None = None, limit: int = 200) -> list[dict]: raise NotImplementedError
    async def runs_for_reference(self, business_id: str, capability: str, source_reference: str) -> list[dict]: raise NotImplementedError
    async def release_dedupe(self, run_id: str) -> None: raise NotImplementedError
    async def transition_approval(self, approval_id: str, from_status: str, patch: dict) -> dict | None: raise NotImplementedError
    async def due_runs(self, now: datetime, limit: int = 50) -> list[dict]: raise NotImplementedError
    async def stalled_candidates(self, limit: int = 200) -> list[dict]: raise NotImplementedError      # runs mid-step, any business
    # steps
    async def add_step(self, step: dict) -> dict: raise NotImplementedError
    async def update_step(self, step_id: str, patch: dict) -> None: raise NotImplementedError
    async def list_steps(self, run_id: str) -> list[dict]: raise NotImplementedError
    # approvals
    async def create_approval(self, approval: dict) -> dict: raise NotImplementedError
    async def get_approval(self, approval_id: str) -> dict | None: raise NotImplementedError
    async def update_approval(self, approval_id: str, patch: dict) -> dict: raise NotImplementedError
    async def list_approvals(self, *, business_id: str | None = None, run_id: str | None = None, status: str | None = None) -> list[dict]: raise NotImplementedError
    # audit + events
    async def audit(self, event: dict) -> None: raise NotImplementedError
    async def list_audit(self, run_id: str) -> list[dict]: raise NotImplementedError
    async def list_audit_business(self, business_id: str, limit: int = 2000) -> list[dict]: raise NotImplementedError
    async def emit_event(self, event: dict) -> None: raise NotImplementedError
    # idempotency
    async def idem_begin(self, business_id: str, key: str, run_id: str, now: datetime | None = None) -> tuple[str, dict | None]: raise NotImplementedError
    async def idem_started_at(self, business_id: str, key: str) -> datetime | None:
        """When this action was first attempted."""
        raise NotImplementedError
    async def idem_complete(self, business_id: str, key: str, result: dict) -> None: raise NotImplementedError
    # enquiries
    async def next_invoice_number(self, business_id: str, now: datetime, taken: set[str]) -> str:
        """The next invoice number from the business's sequence, reserved for this caller."""
        raise NotImplementedError

    # Receipts: numbers are unique per business forever, and never derived from current rows.
    async def issue_receipt(self, business_id: str, invoice_id: str, payment_id: str, now: datetime, meta: dict | None = None,
                            replacing: str | None = None) -> dict:
        """The receipt for a payment: the one already issued for it, or a new number.
        Returns {"number", "created", "created_at", "sent_at", "sent_to", "message_id"}."""
        raise NotImplementedError
    async def mark_receipt_sent(self, business_id: str, number: str, invoice_id: str, payment_id: str, sent: dict) -> None: raise NotImplementedError
    async def receipt_history(self, business_id: str) -> list[dict]:
        """Every receipt ever issued or sent for the business, oldest first."""
        raise NotImplementedError

    async def create_enquiry(self, enquiry: dict) -> dict: raise NotImplementedError
    async def get_enquiry(self, enquiry_id: str) -> dict | None: raise NotImplementedError
    async def update_enquiry(self, enquiry_id: str, patch: dict) -> None: raise NotImplementedError
    async def list_enquiries(self, business_id: str, limit: int = 50) -> list[dict]: raise NotImplementedError
    # policy + plan limits
    async def get_policy(self, business_id: str) -> dict: raise NotImplementedError
    async def set_policy(self, business_id: str, policy: dict, actor_id: str) -> dict: raise NotImplementedError
    async def auto_start_businesses(self) -> list[str]: raise NotImplementedError      # those that switched automatic starting on
    async def plan_limits(self, plan_code: str) -> dict: raise NotImplementedError


_RECEIPT_NUMBER = re.compile(r"^REC-(\d+)(\d{6})$")


def receipt_day_key(now: datetime) -> str:
    return now.strftime("%d%m%y")


def _highest_seq(numbers, day_key: str) -> int:
    """The largest sequence already used on `day_key` among `numbers` (0 if none)."""
    best = 0
    for number in numbers:
        m = _RECEIPT_NUMBER.match(str(number or ""))
        if m and m.group(2) == day_key:
            best = max(best, int(m.group(1)))
    return best


def _missing_relation(exc: Exception) -> bool:
    """The receipt ledger (migration 029) isn't in this database yet."""
    text = str(exc)
    return any(code in text for code in ("PGRST205", "PGRST202", "42P01", "42883")) or "Could not find the" in text


class DuplicateRun(Exception):
    """A run with the same dedupe key already exists for this business (AC-12)."""


def _overlay(base: dict, patch: dict | None) -> dict:
    """`patch` over `base`, merging nested sections one level deep."""
    out = copy.deepcopy(base)
    for k, v in (patch or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = {**out[k], **v}
        else:
            out[k] = v
    return out


def merge_policy(stored: dict | None) -> dict:
    """Stored policy over defaults."""
    return _overlay(config.DEFAULT_POLICY, stored)


class MemoryStore(Store):
    def __init__(self) -> None:
        self.runs: dict[str, dict] = {}
        self.steps: dict[str, dict] = {}
        self.approvals: dict[str, dict] = {}
        self.audits: list[dict] = []
        self.events: list[dict] = []
        self.idem: dict[tuple[str, str], dict] = {}
        self.enquiries: dict[str, dict] = {}
        self.policies: dict[str, dict] = {}
        self.limits: dict[str, dict] = copy.deepcopy(config.DEFAULT_PLAN_LIMITS)
        self.receipts: list[dict] = []                              # the ledger: rows are never removed
        self.receipt_counters: dict[tuple[str, str], int] = {}
        self.invoice_counters: dict[tuple[str, str], int] = {}

    async def create_run(self, run):
        key = run.get("dedupe_key")
        if key and any(r["business_id"] == run["business_id"] and r.get("dedupe_key") == key for r in self.runs.values()):
            raise DuplicateRun(key)      # same rule as the unique index in migration 028
        self.runs[run["id"]] = copy.deepcopy(run)
        return copy.deepcopy(run)

    async def runs_for_reference(self, business_id, capability, source_reference):
        rows = [r for r in self.runs.values() if r["business_id"] == business_id and r["capability"] == capability
                and r.get("source_reference") == source_reference]
        rows.sort(key=lambda r: r.get("created_at") or "")
        return copy.deepcopy(rows)

    async def release_dedupe(self, run_id):
        if run_id in self.runs:
            self.runs[run_id]["dedupe_key"] = None

    async def get_run(self, run_id):
        r = self.runs.get(run_id)
        return copy.deepcopy(r) if r else None

    async def update_run(self, run_id, patch):
        self.runs[run_id].update(copy.deepcopy(patch))
        self.runs[run_id]["updated_at"] = now_utc().isoformat()
        return copy.deepcopy(self.runs[run_id])

    async def list_runs(self, business_id, *, statuses=None, limit=200):
        rows = [r for r in self.runs.values() if r["business_id"] == business_id and (not statuses or r["status"] in statuses)]
        rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return copy.deepcopy(rows[:limit])

    async def stalled_candidates(self, limit=200):
        return copy.deepcopy([r for r in self.runs.values() if r["status"] in ("created", "running", "failed")][:limit])

    async def due_runs(self, now, limit=50):
        rows = [r for r in self.runs.values() if r["status"] == "running" and r.get("wake_at") and r["wake_at"] <= now.isoformat()]
        return copy.deepcopy(rows[:limit])

    async def add_step(self, step):
        self.steps[step["id"]] = copy.deepcopy(step)
        return copy.deepcopy(step)

    async def update_step(self, step_id, patch):
        self.steps[step_id].update(copy.deepcopy(patch))

    async def list_steps(self, run_id):
        rows = [s for s in self.steps.values() if s["run_id"] == run_id]
        rows.sort(key=lambda s: s.get("seq") or 0)
        return copy.deepcopy(rows)

    async def create_approval(self, approval):
        self.approvals[approval["id"]] = copy.deepcopy(approval)
        return copy.deepcopy(approval)

    async def get_approval(self, approval_id):
        a = self.approvals.get(approval_id)
        return copy.deepcopy(a) if a else None

    async def update_approval(self, approval_id, patch):
        self.approvals[approval_id].update(copy.deepcopy(patch))
        return copy.deepcopy(self.approvals[approval_id])

    async def transition_approval(self, approval_id, from_status, patch):
        a = self.approvals.get(approval_id)
        if not a or a["status"] != from_status:
            return None
        a.update(copy.deepcopy(patch))
        return copy.deepcopy(a)

    async def list_approvals(self, *, business_id=None, run_id=None, status=None):
        rows = [a for a in self.approvals.values()
                if (business_id is None or a["business_id"] == business_id)
                and (run_id is None or a["run_id"] == run_id)
                and (status is None or a["status"] == status)]
        rows.sort(key=lambda a: a.get("created_at") or "", reverse=True)
        return copy.deepcopy(rows)

    async def audit(self, event):
        self.audits.append(copy.deepcopy(event))

    async def list_audit(self, run_id):
        return copy.deepcopy([a for a in self.audits if a.get("run_id") == run_id])

    async def list_audit_business(self, business_id, limit=2000):
        return copy.deepcopy([a for a in self.audits if a.get("business_id") == business_id][-limit:])

    async def emit_event(self, event):
        self.events.append(copy.deepcopy(event))

    async def idem_begin(self, business_id, key, run_id, now=None):
        row = self.idem.get((business_id, key))
        if row is None:
            self.idem[(business_id, key)] = {"status": "started", "run_id": run_id, "result": None, "created_at": now or now_utc()}
            return "new", None
        return row["status"], copy.deepcopy(row["result"])

    async def idem_started_at(self, business_id, key):
        return (self.idem.get((business_id, key)) or {}).get("created_at")

    async def idem_complete(self, business_id, key, result):
        self.idem[(business_id, key)] = {**self.idem.get((business_id, key), {}), "status": "completed", "result": copy.deepcopy(result)}

    async def next_invoice_number(self, business_id, now, taken):
        day = receipt_day_key(now)
        used = {str(t).strip().upper() for t in taken or ()}
        while True:
            n = self.invoice_counters.get((business_id, day), 0) + 1
            self.invoice_counters[(business_id, day)] = n
            if f"INV-{n}{day}" not in used:
                return f"INV-{n}{day}"

    async def receipt_history(self, business_id):
        return copy.deepcopy([r for r in self.receipts if r["business_id"] == business_id])

    async def issue_receipt(self, business_id, invoice_id, payment_id, now, meta=None, replacing=None):
        mine = [r for r in self.receipts if r["business_id"] == business_id]
        existing = next((r for r in mine if r["invoice_id"] == invoice_id and r["payment_id"] == payment_id and r["number"] != replacing), None)
        if existing:
            return {**copy.deepcopy(existing), "created": False}
        self.receipts[:] = [r for r in self.receipts if not (r["business_id"] == business_id and r["invoice_id"] == invoice_id and r["payment_id"] == payment_id)]
        day = receipt_day_key(now)
        used = {r["number"] for r in mine} | ({replacing} if replacing else set())
        while True:
            n = self.receipt_counters.get((business_id, day), 0) + 1
            self.receipt_counters[(business_id, day)] = n
            number = f"REC-{n}{day}"
            if number not in used:
                break
        row = {"business_id": business_id, "number": number, "invoice_id": invoice_id, "payment_id": payment_id,
               "created_at": now.isoformat(), "sent_at": None, "sent_to": None, "message_id": None, **(meta or {})}
        self.receipts.append(row)
        return {**copy.deepcopy(row), "created": True}

    async def mark_receipt_sent(self, business_id, number, invoice_id, payment_id, sent):
        for r in self.receipts:
            if r["business_id"] == business_id and r["invoice_id"] == invoice_id and r["payment_id"] == payment_id:
                r.update({k: sent.get(k) for k in ("sent_at", "sent_to", "message_id")})

    async def create_enquiry(self, enquiry):
        self.enquiries[enquiry["id"]] = copy.deepcopy(enquiry)
        return copy.deepcopy(enquiry)

    async def get_enquiry(self, enquiry_id):
        e = self.enquiries.get(enquiry_id)
        return copy.deepcopy(e) if e else None

    async def update_enquiry(self, enquiry_id, patch):
        self.enquiries[enquiry_id].update(copy.deepcopy(patch))

    async def list_enquiries(self, business_id, limit=50):
        rows = [e for e in self.enquiries.values() if e["business_id"] == business_id]
        rows.sort(key=lambda e: e.get("created_at") or "", reverse=True)
        return copy.deepcopy(rows[:limit])

    async def get_policy(self, business_id):
        return merge_policy(self.policies.get(business_id))

    async def set_policy(self, business_id, policy, actor_id):
        current = await self.get_policy(business_id)
        merged = _overlay(current, {k: v for k, v in policy.items() if k != "version"})
        merged["version"] = int(current.get("version") or 1) + 1
        self.policies[business_id] = merged
        return copy.deepcopy(merged)

    async def auto_start_businesses(self):
        return [b for b, p in self.policies.items() if ((p or {}).get("automation") or {}).get("auto_start")]

    async def plan_limits(self, plan_code):
        return copy.deepcopy(self.limits.get(plan_code) or self.limits["explorer"])


class SupabaseStore(Store):
    """Tables are created by migration 027_agentic_orchestration.sql."""

    def __init__(self) -> None:
        from app.core import supabase as sb
        self.sb = sb
        self._limits_cache: dict[str, tuple[float, dict]] = {}      # plan limits change rarely
        self._has_dedupe_column: bool | None = None                 # migration 028 applied?
        self._has_receipt_ledger: bool | None = None                # migration 029 applied?

    async def create_run(self, run):
        row = {k: _iso(v) for k, v in run.items()}
        if self._has_dedupe_column is False:
            row.pop("dedupe_key", None)
        try:
            rows = await self.sb.sb_insert("agent_workflow_runs", row)
        except Exception as e:      # noqa: BLE001
            text = f"{getattr(e, 'code', '')} {e}"
            if "23505" in text:
                raise DuplicateRun(run.get("dedupe_key")) from e      # the unique index caught a duplicate
            if "dedupe_key" in text and ("PGRST204" in text or "column" in text.lower()):
                # Migration 028 isn't applied yet: duplicates are still caught by the lookup
                # before creation, just not under perfectly simultaneous requests.
                logger.warning("agent_workflow_runs.dedupe_key missing; run migration 028 for full duplicate protection")
                self._has_dedupe_column = False
                row.pop("dedupe_key", None)
                rows = await self.sb.sb_insert("agent_workflow_runs", row)
            else:
                raise
        else:
            if "dedupe_key" in row:
                self._has_dedupe_column = True
        return (rows or [run])[0]

    async def runs_for_reference(self, business_id, capability, source_reference):
        return await self.sb.sb_select(
            "agent_workflow_runs",
            filters=[("business_id", "eq", business_id), ("capability", "eq", capability), ("source_reference", "eq", source_reference)],
            order="created_at", limit=50,
        ) or []

    async def release_dedupe(self, run_id):
        if self._has_dedupe_column is False:
            return
        try:
            await self.sb.sb_update("agent_workflow_runs", payload={"dedupe_key": None}, filters=[("id", "eq", run_id)])
        except Exception as e:      # noqa: BLE001 - column missing before migration 028
            logger.info("dedupe key not released for %s: %s", run_id, e)

    async def get_run(self, run_id):
        return await self.sb.sb_select("agent_workflow_runs", filters=[("id", "eq", run_id)], single=True)

    async def update_run(self, run_id, patch):
        patch = {**{k: _iso(v) for k, v in patch.items()}, "updated_at": now_utc().isoformat()}
        rows = await self.sb.sb_update("agent_workflow_runs", payload=patch, filters=[("id", "eq", run_id)])
        return (rows or [None])[0] or await self.get_run(run_id)

    async def stalled_candidates(self, limit=200):
        # Mid-step tasks, and stopped ones that may be due another attempt (newest first: old failures are settled).
        return await self.sb.sb_select("agent_workflow_runs", filters=[("status", "in", ["created", "running", "failed"])],
                                       order="updated_at", desc=True, limit=limit) or []

    async def list_runs(self, business_id, *, statuses=None, limit=200):
        filters: list = [("business_id", "eq", business_id)]
        if statuses:
            filters.append(("status", "in", statuses))
        return await self.sb.sb_select("agent_workflow_runs", filters=filters, order="created_at", desc=True, limit=limit) or []

    async def due_runs(self, now, limit=50):
        return await self.sb.sb_select(
            "agent_workflow_runs",
            filters=[("status", "eq", "running"), ("wake_at", "lte", now.isoformat())],
            order="wake_at", limit=limit,
        ) or []

    async def add_step(self, step):
        rows = await self.sb.sb_insert("agent_step_runs", {k: _iso(v) for k, v in step.items()})
        return (rows or [step])[0]

    async def update_step(self, step_id, patch):
        await self.sb.sb_update("agent_step_runs", payload={k: _iso(v) for k, v in patch.items()}, filters=[("id", "eq", step_id)])

    async def list_steps(self, run_id):
        return await self.sb.sb_select("agent_step_runs", filters=[("run_id", "eq", run_id)], order="seq") or []

    async def create_approval(self, approval):
        rows = await self.sb.sb_insert("agent_approvals", {k: _iso(v) for k, v in approval.items()})
        return (rows or [approval])[0]

    async def get_approval(self, approval_id):
        return await self.sb.sb_select("agent_approvals", filters=[("id", "eq", approval_id)], single=True)

    async def update_approval(self, approval_id, patch):
        rows = await self.sb.sb_update("agent_approvals", payload={k: _iso(v) for k, v in patch.items()}, filters=[("id", "eq", approval_id)])
        return (rows or [None])[0] or await self.get_approval(approval_id)

    async def transition_approval(self, approval_id, from_status, patch):
        """Conditional update: it only applies while the approval is still `from_status`, so of
        two simultaneous decisions exactly one succeeds (the database makes this atomic)."""
        rows = await self.sb.sb_update("agent_approvals", payload={k: _iso(v) for k, v in patch.items()},
                                       filters=[("id", "eq", approval_id), ("status", "eq", from_status)])
        return (rows or [None])[0]

    async def list_approvals(self, *, business_id=None, run_id=None, status=None):
        filters: list = []
        if business_id:
            filters.append(("business_id", "eq", business_id))
        if run_id:
            filters.append(("run_id", "eq", run_id))
        if status:
            filters.append(("status", "eq", status))
        return await self.sb.sb_select("agent_approvals", filters=filters, order="created_at", desc=True, limit=200) or []

    async def audit(self, event):
        await self.sb.sb_insert("agent_audit_events", {k: _iso(v) for k, v in event.items()})

    async def list_audit(self, run_id):
        return await self.sb.sb_select("agent_audit_events", filters=[("run_id", "eq", run_id)], order="created_at") or []

    async def list_audit_business(self, business_id, limit=2000):
        return await self.sb.sb_select("agent_audit_events", filters=[("business_id", "eq", business_id)],
                                       order="created_at", desc=True, limit=limit) or []

    async def emit_event(self, event):
        await self.sb.sb_insert("agent_events", {k: _iso(v) for k, v in event.items()})

    async def idem_started_at(self, business_id, key):
        row = await self.sb.sb_select("agent_idempotency", filters=[("business_id", "eq", business_id), ("key", "eq", key)], single=True)
        try:
            return datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00")) if row and row.get("created_at") else None
        except ValueError:
            return None

    async def idem_begin(self, business_id, key, run_id, now=None):
        existing = await self.sb.sb_select(
            "agent_idempotency", filters=[("business_id", "eq", business_id), ("key", "eq", key)], single=True,
        )
        if existing:
            return existing.get("status") or "started", existing.get("result")
        try:
            await self.sb.sb_insert("agent_idempotency", {
                "id": new_id(), "business_id": business_id, "key": key, "run_id": run_id,
                "status": "started", "created_at": (now or now_utc()).isoformat(),
            })
            return "new", None
        except Exception:
            # Unique (business_id, key) lost a race: another execution owns this action.
            row = await self.sb.sb_select(
                "agent_idempotency", filters=[("business_id", "eq", business_id), ("key", "eq", key)], single=True,
            )
            return (row or {}).get("status") or "started", (row or {}).get("result")

    async def idem_complete(self, business_id, key, result):
        await self.sb.sb_update(
            "agent_idempotency",
            payload={"status": "completed", "result": result, "completed_at": now_utc().isoformat()},
            filters=[("business_id", "eq", business_id), ("key", "eq", key)],
        )

    async def next_invoice_number(self, business_id, now, taken):
        from app.shared import invoice_numbers
        return await invoice_numbers.next_number(business_id, now, taken)

    # ── receipts ──────────────────────────────────────────────────────────────
    async def _ledger_rows(self, business_id):
        if self._has_receipt_ledger is False:
            return []
        try:
            rows = await self.sb.sb_select("agent_receipts", filters=[("business_id", "eq", business_id)],
                                           order="created_at", limit=5000) or []
            self._has_receipt_ledger = True
            return rows
        except Exception as exc:
            if not _missing_relation(exc):
                raise
            self._has_receipt_ledger = False
            logger.warning("receipt ledger not found: run migration 029_agent_receipt_ledger.sql. "
                           "Receipt numbers are being checked against the Agent's history instead.")
            return []

    async def receipt_history(self, business_id):
        """The ledger plus the Agent's own record of receipts created and sent. Workspace
        rows are deliberately not a source: they can be overwritten."""
        out: dict[tuple[str, str, str], dict] = {}
        ledgered: dict[tuple[str, str], str] = {}
        for r in await self._ledger_rows(business_id):
            ledgered[(r["invoice_id"], r["payment_id"])] = r["receipt_number"]
            out[(r["receipt_number"], r["invoice_id"], r["payment_id"])] = {
                "number": r["receipt_number"], "invoice_id": r["invoice_id"], "payment_id": r["payment_id"],
                "created_at": r.get("created_at"), "sent_at": r.get("sent_at"), "sent_to": r.get("sent_to"),
                "message_id": r.get("message_id"), "run_id": r.get("run_id")}

        async def keys(prefix: str) -> list[dict]:
            return await self.sb.sb_select(
                "agent_idempotency", order="created_at", limit=5000,
                filters=[("business_id", "eq", business_id), ("key", "like", prefix + ":%")]) or []

        sends: dict[tuple[str, str], dict] = {}
        for s in await keys("send_receipt"):
            parts = str(s.get("key") or "").split(":")
            if len(parts) >= 3 and s.get("status") == "completed" and (s.get("result") or {}).get("receipt_number"):
                sends.setdefault((parts[1], parts[2]), s)
        for c in await keys("receipt"):
            parts = str(c.get("key") or "").split(":")
            number = (c.get("result") or {}).get("receipt_number")
            if len(parts) < 3 or not number:
                continue
            s = sends.get((parts[1], parts[2])) or {}
            entry = out.setdefault((number, parts[1], parts[2]), {
                "number": number, "invoice_id": parts[1], "payment_id": parts[2],
                "created_at": c.get("completed_at") or c.get("created_at"), "sent_at": None, "sent_to": None,
                "message_id": None, "run_id": c.get("run_id")})
            if s and not entry.get("sent_at"):
                entry.update({"sent_at": s.get("completed_at"), "sent_to": (s.get("result") or {}).get("sent_to"),
                              "message_id": (s.get("result") or {}).get("message_id")})
        # Receipts that were sent, or put forward for sending: their numbers are taken too.
        for (invoice_id, payment_id), s in sends.items():
            result = s.get("result") or {}
            entry = out.setdefault((result["receipt_number"], invoice_id, payment_id), {
                "number": result["receipt_number"], "invoice_id": invoice_id, "payment_id": payment_id,
                "created_at": s.get("created_at"), "sent_at": None, "sent_to": None, "message_id": None, "run_id": s.get("run_id")})
            if not entry.get("sent_at"):
                entry.update({"sent_at": s.get("completed_at"), "sent_to": result.get("sent_to"), "message_id": result.get("message_id")})
        approvals = await self.sb.sb_select("agent_approvals", order="created_at", limit=5000,
                                            filters=[("business_id", "eq", business_id), ("tool_id", "eq", "send_receipt")]) or []
        for a in approvals:
            p = a.get("payload") or {}
            if p.get("receipt_number") and p.get("invoice_id") and p.get("payment_id"):
                out.setdefault((p["receipt_number"], p["invoice_id"], p["payment_id"]), {
                    "number": p["receipt_number"], "invoice_id": p["invoice_id"], "payment_id": p["payment_id"],
                    "created_at": a.get("created_at"), "sent_at": None, "sent_to": None, "message_id": None, "run_id": a.get("run_id")})
        # The ledger is the authority: where it gives a payment its number, an older number for that
        # payment found only in the Agent's history (one that was since replaced) is not its receipt.
        kept = [r for r in out.values() if ledgered.get((r["invoice_id"], r["payment_id"]), r["number"]) == r["number"]]
        return sorted(kept, key=lambda r: str(r.get("created_at") or ""))

    async def _next_receipt_seq(self, business_id, day, floor):
        """The next number for the day from the database counter (atomic). Without the
        ledger (migration 029 not applied), one past the highest number in the history."""
        if self._has_receipt_ledger is not False:
            try:
                n = await self.sb.sb_rpc("agent_next_receipt_seq", {"p_business": business_id, "p_day": day})
                self._has_receipt_ledger = True
                return int(n[0] if isinstance(n, list) else n)
            except Exception as exc:
                if not _missing_relation(exc):
                    raise
                self._has_receipt_ledger = False
                logger.warning("receipt counter not found: run migration 029_agent_receipt_ledger.sql")
        return floor + 1

    async def issue_receipt(self, business_id, invoice_id, payment_id, now, meta=None, replacing=None):
        history = await self.receipt_history(business_id)
        existing = next((h for h in history if h["invoice_id"] == invoice_id and h["payment_id"] == payment_id and h["number"] != replacing), None)
        if existing:
            return {**existing, "created": False}
        day = receipt_day_key(now)
        used = {h["number"] for h in history} | ({replacing} if replacing else set())
        floor = _highest_seq(used, day)
        for _ in range(50):
            n = await self._next_receipt_seq(business_id, day, floor)
            floor = max(floor, n)
            number = f"REC-{n}{day}"
            if number in used:
                continue      # already sent to someone: never handed out again
            row = {"number": number, "invoice_id": invoice_id, "payment_id": payment_id, "created_at": now.isoformat(),
                   "sent_at": None, "sent_to": None, "message_id": None}
            if self._has_receipt_ledger:
                try:
                    await self.sb.sb_insert("agent_receipts", {
                        "business_id": business_id, "receipt_number": number, "invoice_id": invoice_id,
                        "payment_id": payment_id, "created_at": now.isoformat(), **(meta or {})})
                except Exception:
                    # The unique constraints refused it: this payment was receipted a moment ago
                    # by another execution, or the number was taken. Use theirs, or try the next.
                    again = await self.sb.sb_select("agent_receipts", single=True, filters=[
                        ("business_id", "eq", business_id), ("invoice_id", "eq", invoice_id), ("payment_id", "eq", payment_id)])
                    if again:
                        return {"number": again["receipt_number"], "invoice_id": invoice_id, "payment_id": payment_id,
                                "created_at": again.get("created_at"), "sent_at": again.get("sent_at"),
                                "sent_to": again.get("sent_to"), "message_id": again.get("message_id"), "created": False}
                    used.add(number)
                    continue
            return {**row, "created": True}
        raise RuntimeError("Could not allocate a receipt number.")

    async def mark_receipt_sent(self, business_id, number, invoice_id, payment_id, sent):
        if not self._has_receipt_ledger:
            return
        await self.sb.sb_update("agent_receipts", payload={k: sent.get(k) for k in ("sent_at", "sent_to", "message_id")},
                                filters=[("business_id", "eq", business_id), ("invoice_id", "eq", invoice_id),
                                         ("payment_id", "eq", payment_id)])

    async def create_enquiry(self, enquiry):
        rows = await self.sb.sb_insert("agent_enquiries", {k: _iso(v) for k, v in enquiry.items()})
        return (rows or [enquiry])[0]

    async def get_enquiry(self, enquiry_id):
        return await self.sb.sb_select("agent_enquiries", filters=[("id", "eq", enquiry_id)], single=True)

    async def update_enquiry(self, enquiry_id, patch):
        await self.sb.sb_update("agent_enquiries", payload={k: _iso(v) for k, v in patch.items()}, filters=[("id", "eq", enquiry_id)])

    async def list_enquiries(self, business_id, limit=50):
        return await self.sb.sb_select("agent_enquiries", filters=[("business_id", "eq", business_id)], order="created_at", desc=True, limit=limit) or []

    async def get_policy(self, business_id):
        row = None
        try:
            row = await self.sb.sb_select("agent_policies", filters=[("business_id", "eq", business_id)], single=True)
        except Exception:
            row = None
        return merge_policy((row or {}).get("policy"))

    async def set_policy(self, business_id, policy, actor_id):
        current = await self.get_policy(business_id)
        merged = _overlay(current, {k: v for k, v in policy.items() if k != "version"})
        merged["version"] = int(current.get("version") or 1) + 1
        await self.sb.sb_upsert("agent_policies", payload={
            "business_id": business_id, "policy": merged, "version": merged["version"],
            "updated_by": actor_id, "updated_at": now_utc().isoformat(),
        }, on_conflict="business_id")
        return merged

    async def auto_start_businesses(self):
        try:
            rows = await self.sb.sb_select("agent_policies", columns="business_id,policy", limit=1000) or []
        except Exception:
            return []
        return [r["business_id"] for r in rows if (((r.get("policy") or {}).get("automation")) or {}).get("auto_start")]

    async def plan_limits(self, plan_code):
        import time
        cached = self._limits_cache.get(plan_code)
        if cached and time.monotonic() - cached[0] < 300:
            return dict(cached[1])
        try:
            row = await self.sb.sb_select("agent_plan_limits", filters=[("plan_code", "eq", plan_code)], single=True)
        except Exception:
            row = None
        if row and row.get("enabled", True):
            limits = {"monthly_runs": row["monthly_runs"], "max_active_runs": row["max_active_runs"], "max_autonomy": row["max_autonomy"]}
        else:
            limits = dict(config.DEFAULT_PLAN_LIMITS.get(plan_code) or config.DEFAULT_PLAN_LIMITS["explorer"])
        self._limits_cache[plan_code] = (time.monotonic(), limits)
        return dict(limits)
