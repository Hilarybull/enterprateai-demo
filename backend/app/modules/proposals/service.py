from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.supabase import sb_delete, sb_insert, sb_select, sb_update
from app.modules.proposals import state_machine as sm
from app.modules.proposals.schemas import (
    CoverLetterIn,
    ProposalPreferences,
    ProposalRequestIn,
    ProposalRequestPatch,
    ProposalReviseIn,
    ProposalSubmitIn,
)
from app.shared.email.resend import send_proposal_invite_email, send_proposal_received_email
from app.shared.llm.openai_client import get_user_plan_info, pick_llm_for_user

logger = logging.getLogger(__name__)

_FREE_PLAN_KEYS = {"free_trial", "explorer", "expired", ""}
_LEGACY_PLAN_KEYS = {"insight_starter": "starter_insight", "strategic_intelligence": "growth_navigator"}
_PAID_PLAN_RANK = {"starter_insight": 1, "decision_engine": 2, "growth_navigator": 3, "strategic_business_os": 4}


def _table_missing(exc: Exception) -> bool:
    """True when the error is 'the proposals tables have not been migrated yet'."""
    msg = str(exc).lower()
    return (
        ("does not exist" in msg or "could not find the table" in msg or "schema cache" in msg)
        and "proposal" in msg
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> date:
    return datetime.now(timezone.utc).date()


# ── Workspace helpers ──────────────────────────────────────────────────────
async def _workspace_row(workspace_id: str) -> dict | None:
    return await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)


async def _owner_workspace(user_id: str) -> dict:
    ws = await sb_select(
        "workspaces",
        filters=[("user_id", "eq", user_id)],
        order="updated_at",
        desc=True,
        limit=1,
        single=True,
    )
    if not ws:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Create a workspace before using proposals.",
        )
    return ws


def _company_name(ws: dict | None) -> str:
    data = (ws or {}).get("data") or {}
    profile = data.get("workspace_profile") or {}
    return profile.get("company_name") or (ws or {}).get("name") or "Business"


async def _can_submit_proposals(user_id: str) -> bool:
    """Submitting a proposal requires a paid plan (Starter and above)."""
    plan_key, plan_status = await get_user_plan_info(user_id)
    plan_key = _LEGACY_PLAN_KEYS.get(plan_key, plan_key)
    if plan_status in {"grandfathered"}:
        return True
    if plan_key in _FREE_PLAN_KEYS or plan_status in {"trial", "expired"}:
        try:
            from app.modules.credits.service import _has_platform_grant

            return await _has_platform_grant(user_id, "proposal_section")
        except Exception:
            return False
    return _PAID_PLAN_RANK.get(plan_key, 0) >= 1


# ── Preferences ────────────────────────────────────────────────────────────
_DEFAULT_PREFS = {
    "enabled": False,
    "accepted_modes": ["general"],
    "accepted_categories": None,
    "proposal_cap": None,
    "visibility": "marketplace",
}


async def get_preferences(*, user_id: str) -> dict:
    ws = await _owner_workspace(user_id)
    try:
        row = await sb_select(
            "proposal_preferences",
            filters=[("workspace_id", "eq", ws["id"])],
            single=True,
        )
    except Exception as exc:
        if _table_missing(exc):
            return {"workspace_id": ws["id"], **_DEFAULT_PREFS}
        raise
    if not row:
        return {"workspace_id": ws["id"], **_DEFAULT_PREFS}
    return {
        "workspace_id": ws["id"],
        "enabled": bool(row.get("enabled")),
        "accepted_modes": row.get("accepted_modes") or ["general"],
        "accepted_categories": row.get("accepted_categories"),
        "proposal_cap": row.get("proposal_cap"),
        "visibility": row.get("visibility") or "marketplace",
    }


async def save_preferences(*, user_id: str, prefs: ProposalPreferences) -> dict:
    ws = await _owner_workspace(user_id)
    now = _now()
    payload = {
        "workspace_id": ws["id"],
        "user_id": user_id,
        "enabled": prefs.enabled,
        "accepted_modes": prefs.accepted_modes or ["general"],
        "accepted_categories": prefs.accepted_categories,
        "proposal_cap": prefs.proposal_cap,
        "visibility": prefs.visibility,
        "updated_at": now,
    }
    existing = await sb_select(
        "proposal_preferences", filters=[("workspace_id", "eq", ws["id"])], single=True
    )
    if existing:
        await sb_update(
            "proposal_preferences",
            filters=[("workspace_id", "eq", ws["id"])],
            payload=payload,
        )
    else:
        await sb_insert("proposal_preferences", {**payload, "created_at": now})

    # Discoverability side-effect: mirror the marketplace publish behaviour so an
    # opted-in workspace shows up in the marketplace query.
    await _sync_discoverability(ws, enabled=prefs.enabled, visibility=prefs.visibility)
    return await get_preferences(user_id=user_id)


async def _sync_discoverability(ws: dict, *, enabled: bool, visibility: str) -> None:
    data = dict(ws.get("data") or {})
    profile = dict(data.get("workspace_profile") or {})
    open_flag = bool(enabled and visibility == "marketplace")
    if profile.get("is_open_to_proposals") == open_flag:
        return
    profile["is_open_to_proposals"] = open_flag
    data["workspace_profile"] = profile
    try:
        await sb_update(
            "workspaces",
            filters=[("id", "eq", ws["id"])],
            payload={"data": data, "updated_at": _now()},
        )
    except Exception as exc:  # non-fatal
        logger.warning("proposal discoverability sync failed for ws=%s: %s", ws["id"], exc)


# ── Requests (recipient side) ──────────────────────────────────────────────
def _request_out(row: dict) -> dict:
    return {
        "id": row["id"],
        "workspace_id": row["workspace_id"],
        "company_name": row.get("company_name"),
        "type": row.get("type") or "general",
        "title": row.get("title"),
        "description": row.get("description"),
        "budget_range": row.get("budget_range"),
        "budget_currency": row.get("budget_currency"),
        "budget_visible": bool(row.get("budget_visible")),
        "deadline": row.get("deadline"),
        "submission_cap": row.get("submission_cap"),
        "requirements": row.get("requirements") or [],
        "accepted_modes": row.get("accepted_modes") or ["general"],
        "accepted_categories": row.get("accepted_categories"),
        "visibility": row.get("visibility") or "marketplace",
        "status": row.get("status") or "DRAFT",
        "submission_count": int(row.get("submission_count") or 0),
        "invited_emails": row.get("invited_emails") or [],
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _public_request_out(row: dict, *, is_owner: bool = False) -> dict:
    out = _request_out(row)
    # Hide the owner's internal fields from the public view.
    out.pop("invited_emails", None)
    if not out.get("budget_visible"):
        out["budget_range"] = None
        out["budget_currency"] = None
    out["is_owner"] = is_owner
    return out


async def list_requests(*, user_id: str) -> dict:
    ws = await _owner_workspace(user_id)
    try:
        rows = await sb_select(
            "proposal_requests",
            filters=[("workspace_id", "eq", ws["id"])],
            order="created_at",
            desc=True,
        )
    except Exception as exc:
        if _table_missing(exc):
            return {"items": [], "total": 0}
        raise
    items = [_request_out(r) for r in (rows or [])]
    return {"items": items, "total": len(items)}


def _normalize_requirements(reqs) -> list[dict]:
    out = []
    for r in (reqs or []):
        d = r.model_dump() if hasattr(r, "model_dump") else dict(r)
        d["id"] = d.get("id") or f"req_{uuid4().hex[:8]}"
        out.append({
            "id": d["id"],
            "text": d.get("text") or "",
            "mandatory": bool(d.get("mandatory")),
            "weight": int(d.get("weight") or 1),
        })
    return out


async def create_request(*, user_id: str, payload: ProposalRequestIn) -> dict:
    ws = await _owner_workspace(user_id)
    now = _now()
    row = {
        "id": str(uuid4()),
        "workspace_id": ws["id"],
        "user_id": user_id,
        "company_name": _company_name(ws),
        "type": payload.type,
        "title": payload.title.strip(),
        "description": payload.description,
        "budget_range": payload.budget_range,
        "budget_currency": payload.budget_currency,
        "budget_visible": payload.budget_visible,
        "deadline": payload.deadline or None,
        "submission_cap": payload.submission_cap,
        "requirements": _normalize_requirements(payload.requirements),
        "accepted_modes": payload.accepted_modes or ["general"],
        "accepted_categories": payload.accepted_categories,
        "visibility": payload.visibility,
        "status": "DRAFT",
        "submission_count": 0,
        "invited_emails": [],
        "created_at": now,
        "updated_at": now,
    }
    await sb_insert("proposal_requests", row)
    return _request_out(row)


async def _get_own_request(user_id: str, request_id: str) -> dict:
    ws = await _owner_workspace(user_id)
    row = await sb_select(
        "proposal_requests",
        filters=[("id", "eq", request_id), ("workspace_id", "eq", ws["id"])],
        single=True,
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    return row


async def patch_request(*, user_id: str, request_id: str, payload: ProposalRequestPatch) -> dict:
    row = await _get_own_request(user_id, request_id)
    if row.get("status") != "DRAFT":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft requests can be edited. Close the request to make changes.",
        )
    updates: dict = {}
    for field in (
        "type", "title", "description", "budget_range", "budget_currency",
        "budget_visible", "deadline", "submission_cap", "accepted_modes",
        "accepted_categories", "visibility",
    ):
        val = getattr(payload, field)
        if val is not None:
            updates[field] = val
    if payload.requirements is not None:
        updates["requirements"] = _normalize_requirements(payload.requirements)
    if not updates:
        return _request_out(row)
    updates["updated_at"] = _now()
    await sb_update("proposal_requests", filters=[("id", "eq", request_id)], payload=updates)
    return _request_out({**row, **updates})


async def set_request_status(*, user_id: str, request_id: str, action: str) -> dict:
    row = await _get_own_request(user_id, request_id)
    current = row.get("status") or "DRAFT"
    transitions = {
        "publish": ("DRAFT", "PUBLISHED"),
        "close": ("PUBLISHED", "CLOSED"),
        "reopen": ("CLOSED", "PUBLISHED"),
    }
    expected, target = transitions[action]
    if current != expected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot {action} a request that is {current}.",
        )
    if action == "publish" and not (row.get("title") or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Add a title before publishing.")
    updates = {"status": target, "updated_at": _now()}
    await sb_update("proposal_requests", filters=[("id", "eq", request_id)], payload=updates)
    return _request_out({**row, **updates})


async def delete_request(*, user_id: str, request_id: str) -> None:
    row = await _get_own_request(user_id, request_id)
    if row.get("status") == "PUBLISHED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Close the request before deleting it.",
        )
    await sb_delete("proposal_requests", filters=[("id", "eq", request_id)])


async def invite_to_request(*, user_id: str, request_id: str, emails: list[str], invite_url: str | None) -> dict:
    row = await _get_own_request(user_id, request_id)
    ws = await _workspace_row(row["workspace_id"])
    sender = _company_name(ws)
    settings = get_settings()
    base = (settings.frontend_url or "").rstrip("/")
    url = invite_url or f"{base}/marketplace/request/{request_id}"

    clean: list[str] = []
    seen = set()
    for e in emails:
        e = str(e or "").strip()
        if e and "@" in e and e.lower() not in seen:
            seen.add(e.lower())
            clean.append(e)

    sent: list[str] = []
    failed: list[str] = []
    for email in clean:
        try:
            res = await send_proposal_invite_email(
                to_email=email,
                sender_name=sender,
                request_title=row.get("title") or "a proposal request",
                invite_url=url,
            )
            (sent if res.sent else failed).append(email)
        except Exception:
            failed.append(email)

    merged = list({*(row.get("invited_emails") or []), *sent})
    await sb_update(
        "proposal_requests",
        filters=[("id", "eq", request_id)],
        payload={"invited_emails": merged, "updated_at": _now()},
    )
    return {"sent": sent, "failed": failed}


# ── Public request discovery (proposer side) ───────────────────────────────
async def list_public_requests(*, search: str | None = None, type_filter: str | None = None) -> dict:
    try:
        rows = await sb_select(
            "proposal_requests",
            filters=[("status", "eq", "PUBLISHED"), ("visibility", "eq", "marketplace")],
            order="created_at",
            desc=True,
            limit=200,
        )
    except Exception as exc:
        if _table_missing(exc):
            return {"items": [], "total": 0}
        raise
    today = _today()
    items = []
    for r in (rows or []):
        deadline = r.get("deadline")
        if deadline:
            try:
                if date.fromisoformat(str(deadline)[:10]) < today:
                    continue
            except Exception:
                pass
        if type_filter and (r.get("type") or "general") != type_filter:
            continue
        if search:
            q = search.strip().lower()
            hay = " ".join([
                r.get("title") or "", r.get("description") or "",
                r.get("company_name") or "", r.get("type") or "",
            ]).lower()
            if q not in hay:
                continue
        items.append(_public_request_out(r))
    return {"items": items, "total": len(items)}


async def get_public_request(*, request_id: str, user_id: str | None) -> dict:
    row = await sb_select("proposal_requests", filters=[("id", "eq", request_id)], single=True)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    is_owner = False
    if user_id:
        owner_ws = await sb_select(
            "workspaces", filters=[("user_id", "eq", user_id)], order="updated_at",
            desc=True, limit=1, single=True,
        )
        is_owner = bool(owner_ws and owner_ws["id"] == row["workspace_id"])
    if row.get("status") != "PUBLISHED" and not is_owner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    return _public_request_out(row, is_owner=is_owner)


# ── Proposals: submission ─────────────────────────────────────────────────
def _proposal_out(row: dict, *, viewer: str) -> dict:
    """viewer: 'recipient' | 'proposer' | 'public'"""
    base = {
        "id": row["id"],
        "request_id": row.get("request_id"),
        "request_title": row.get("request_title"),
        "status": row.get("status"),
        "version": int(row.get("version") or 1),
        "title": row.get("title"),
        "summary": row.get("summary"),
        "sections": row.get("sections") or [],
        "requirement_responses": row.get("requirement_responses") or [],
        "attachments": row.get("attachments") or [],
        "events": row.get("events") or [],
        "submitted_at": row.get("submitted_at"),
        "updated_at": row.get("updated_at"),
        "viewed_at": row.get("viewed_at"),
        "proposer_name": row.get("proposer_name"),
        "proposer_workspace_id": row.get("proposer_workspace_id"),
        "recipient_name": row.get("recipient_name"),
        "recipient_workspace_id": row.get("recipient_workspace_id"),
    }
    if viewer == "recipient":
        base["proposer_email"] = row.get("proposer_email")
    return base


async def _load_proposal(proposal_id: str) -> dict:
    row = await sb_select("proposals", filters=[("id", "eq", proposal_id)], single=True)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found")
    return row


async def _resolve_actor(user_id: str, proposal: dict) -> str:
    """Return 'recipient' or 'proposer' for the calling user, else 403."""
    if user_id and user_id == proposal.get("recipient_user_id"):
        return "recipient"
    if user_id and user_id == proposal.get("proposer_user_id"):
        return "proposer"
    owner_ws = await sb_select(
        "workspaces", filters=[("user_id", "eq", user_id)], order="updated_at",
        desc=True, limit=1, single=True,
    )
    if owner_ws:
        if owner_ws["id"] == proposal.get("recipient_workspace_id"):
            return "recipient"
        if owner_ws["id"] == proposal.get("proposer_workspace_id"):
            return "proposer"
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot access this proposal.")


async def submit_proposal(*, user_id: str, user_email: str, payload: ProposalSubmitIn) -> dict:
    # Plan gate — submitting requires a paid plan.
    if not await _can_submit_proposals(user_id):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Submitting proposals requires a Starter plan or above.",
        )

    proposer_ws = await _owner_workspace(user_id)
    recipient_ws = await _workspace_row(payload.recipient_workspace_id)
    if not recipient_ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient business not found.")
    if recipient_ws["id"] == proposer_ws["id"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot submit a proposal to your own business.")

    # Recipient must be accepting proposals.
    rprefs = await sb_select(
        "proposal_preferences", filters=[("workspace_id", "eq", recipient_ws["id"])], single=True
    )
    if not (rprefs and rprefs.get("enabled")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This business is not accepting proposals right now.")

    # Duplicate-active guard.
    existing = await sb_select(
        "proposals",
        filters=[
            ("proposer_workspace_id", "eq", proposer_ws["id"]),
            ("recipient_workspace_id", "eq", recipient_ws["id"]),
        ],
        columns="id,status",
    )
    if any((e.get("status") in sm.ACTIVE_STATUSES) for e in (existing or [])):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have an active proposal with this business.",
        )

    request_row = None
    request_title = None
    if payload.request_id:
        request_row = await sb_select(
            "proposal_requests", filters=[("id", "eq", payload.request_id)], single=True
        )
        if not request_row or request_row.get("workspace_id") != recipient_ws["id"]:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal request not found.")
        if request_row.get("status") != "PUBLISHED":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This request is no longer accepting submissions.")
        deadline = request_row.get("deadline")
        if deadline:
            try:
                if date.fromisoformat(str(deadline)[:10]) < _today():
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The deadline for this request has passed.")
            except HTTPException:
                raise
            except Exception:
                pass
        cap = request_row.get("submission_cap")
        if cap is not None and int(request_row.get("submission_count") or 0) >= int(cap):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This request has reached its submission limit.")
        request_title = request_row.get("title")

    now = _now()
    proposer_name = _company_name(proposer_ws)
    recipient_name = _company_name(recipient_ws)
    proposal_id = str(uuid4())
    initial_event = {"status": sm.SUBMITTED, "timestamp": now, "actor": "proposer", "reason": "Submitted"}
    row = {
        "id": proposal_id,
        "request_id": payload.request_id or None,
        "request_title": request_title,
        "proposer_workspace_id": proposer_ws["id"],
        "proposer_user_id": user_id,
        "proposer_name": proposer_name,
        "proposer_email": user_email,
        "recipient_workspace_id": recipient_ws["id"],
        "recipient_user_id": recipient_ws.get("user_id"),
        "recipient_name": recipient_name,
        "title": (payload.title or "").strip() or None,
        "summary": payload.summary,
        "sections": [s.model_dump() for s in (payload.sections or [])] or None,
        "requirement_responses": [r.model_dump() for r in (payload.requirement_responses or [])] or None,
        "attachments": [a.model_dump() for a in (payload.attachments or [])] or None,
        "events": [initial_event],
        "status": sm.SUBMITTED,
        "version": 1,
        "inbox_hidden": False,
        "submitted_at": now,
        "updated_at": now,
        "viewed_at": None,
    }
    await sb_insert("proposals", row)

    if request_row is not None:
        await sb_update(
            "proposal_requests",
            filters=[("id", "eq", request_row["id"])],
            payload={
                "submission_count": int(request_row.get("submission_count") or 0) + 1,
                "updated_at": now,
            },
        )

    # Notify the recipient (best-effort — never blocks submission).
    try:
        recipient_owner = await sb_select(
            "users", filters=[("id", "eq", recipient_ws.get("user_id"))], single=True
        )
        to_email = (recipient_owner or {}).get("email") or recipient_ws.get("user_id")
        if to_email and "@" in str(to_email):
            settings = get_settings()
            base = (settings.frontend_url or "").rstrip("/")
            await send_proposal_received_email(
                to_email=str(to_email),
                recipient_name=recipient_name,
                proposer_name=proposer_name,
                request_title=request_title,
                inbox_url=f"{base}/proposals",
            )
    except Exception as exc:
        logger.warning("proposal received-email failed: %s", exc)

    return _proposal_out(row, viewer="proposer")


async def revise_proposal(*, user_id: str, proposal_id: str, payload: ProposalReviseIn) -> dict:
    proposal = await _load_proposal(proposal_id)
    actor = await _resolve_actor(user_id, proposal)
    if actor != "proposer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the proposer can revise this proposal.")
    if proposal.get("status") != sm.CLARIFICATION_REQUESTED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You can only revise a proposal when the recipient has requested clarification.",
        )
    now = _now()
    updates: dict = {
        "status": sm.REVISION_REQUESTED,
        "version": int(proposal.get("version") or 1) + 1,
        "updated_at": now,
    }
    if payload.summary is not None:
        updates["summary"] = payload.summary
    if payload.sections is not None:
        updates["sections"] = [s.model_dump() for s in payload.sections] or None
    if payload.requirement_responses is not None:
        updates["requirement_responses"] = [r.model_dump() for r in payload.requirement_responses] or None
    if payload.attachments is not None:
        updates["attachments"] = [a.model_dump() for a in payload.attachments] or None
    events = list(proposal.get("events") or [])
    events.append({
        "status": sm.REVISION_REQUESTED, "timestamp": now, "actor": "proposer",
        "reason": (payload.note or "Revision submitted"),
    })
    updates["events"] = events
    await sb_update("proposals", filters=[("id", "eq", proposal_id)], payload=updates)
    return _proposal_out({**proposal, **updates}, viewer="proposer")


# ── Inbox / Activity reads ────────────────────────────────────────────────
async def list_inbox(*, user_id: str) -> dict:
    ws = await _owner_workspace(user_id)
    try:
        rows = await sb_select(
            "proposals",
            filters=[("recipient_workspace_id", "eq", ws["id"])],
            order="submitted_at",
            desc=True,
        )
    except Exception as exc:
        if _table_missing(exc):
            return {"items": [], "total": 0, "unread": 0}
        raise
    items = [
        _proposal_out(r, viewer="recipient")
        for r in (rows or [])
        if not r.get("inbox_hidden")
    ]
    unread = sum(1 for r in (rows or []) if r.get("status") == sm.SUBMITTED and not r.get("viewed_at") and not r.get("inbox_hidden"))
    return {"items": items, "total": len(items), "unread": unread}


async def list_activity(*, user_id: str) -> dict:
    ws = await _owner_workspace(user_id)
    try:
        rows = await sb_select(
            "proposals",
            filters=[("proposer_workspace_id", "eq", ws["id"])],
            order="submitted_at",
            desc=True,
        )
    except Exception as exc:
        if _table_missing(exc):
            return {"items": [], "total": 0}
        raise
    items = [_proposal_out(r, viewer="proposer") for r in (rows or [])]
    return {"items": items, "total": len(items)}


async def get_proposal(*, user_id: str, proposal_id: str) -> dict:
    proposal = await _load_proposal(proposal_id)
    actor = await _resolve_actor(user_id, proposal)
    # First open by the recipient marks it viewed.
    if actor == "recipient" and proposal.get("status") == sm.SUBMITTED and not proposal.get("viewed_at"):
        now = _now()
        events = list(proposal.get("events") or [])
        events.append({"status": sm.VIEWED, "timestamp": now, "actor": "recipient", "reason": "Opened"})
        updates = {"status": sm.VIEWED, "viewed_at": now, "events": events, "updated_at": now}
        await sb_update("proposals", filters=[("id", "eq", proposal_id)], payload=updates)
        proposal = {**proposal, **updates}
    return _proposal_out(proposal, viewer=actor)


async def hide_from_inbox(*, user_id: str, proposal_id: str) -> None:
    proposal = await _load_proposal(proposal_id)
    actor = await _resolve_actor(user_id, proposal)
    if actor != "recipient":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the recipient can remove this from the inbox.")
    await sb_update(
        "proposals",
        filters=[("id", "eq", proposal_id)],
        payload={"inbox_hidden": True, "updated_at": _now()},
    )


async def link_proposal_to_request(*, user_id: str, proposal_id: str, request_id: str) -> dict:
    proposal = await _load_proposal(proposal_id)
    actor = await _resolve_actor(user_id, proposal)
    if actor != "recipient":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the recipient can link a proposal to a request.")
    if proposal.get("request_id"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This proposal is already linked to a request.")
    request_row = await sb_select("proposal_requests", filters=[("id", "eq", request_id)], single=True)
    if not request_row or request_row.get("workspace_id") != proposal.get("recipient_workspace_id"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found.")
    updates = {
        "request_id": request_id,
        "request_title": request_row.get("title"),
        "updated_at": _now(),
    }
    await sb_update("proposals", filters=[("id", "eq", proposal_id)], payload=updates)
    return _proposal_out({**proposal, **updates}, viewer="recipient")


# ── Status transitions ────────────────────────────────────────────────────
async def transition_status(*, user_id: str, proposal_id: str, target: str, reason: str | None) -> dict:
    target = (target or "").strip().upper()
    if target not in sm.ALL_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown status '{target}'.")
    proposal = await _load_proposal(proposal_id)
    actor = await _resolve_actor(user_id, proposal)
    current = proposal.get("status") or sm.SUBMITTED

    if not sm.can_transition(current, target, actor):
        allowed = sorted(sm.allowed_transitions(current, actor))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Cannot move from {current} to {target}."
                + (f" Allowed: {', '.join(allowed)}." if allowed else " No transitions available.")
            ),
        )

    now = _now()
    events = list(proposal.get("events") or [])
    events.append({"status": target, "timestamp": now, "actor": actor, "reason": reason or None})
    updates = {"status": target, "events": events, "updated_at": now}
    if target == sm.VIEWED and not proposal.get("viewed_at"):
        updates["viewed_at"] = now
    await sb_update("proposals", filters=[("id", "eq", proposal_id)], payload=updates)
    return _proposal_out({**proposal, **updates}, viewer=actor)


# ── AI authoring ─────────────────────────────────────────────────────────
def _clean_ai_text(text: str) -> str:
    text = (text or "").strip()
    text = text.replace("—", ", ").replace("–", "-")
    # Drop bracketed placeholders the model sometimes leaves in.
    import re

    text = re.sub(r"\[[^\]\n]{0,80}\]", "", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


async def generate_cover_letter(*, user_id: str, payload: CoverLetterIn) -> str:
    proposer_ws = await _owner_workspace(user_id)
    profile = (proposer_ws.get("data") or {}).get("workspace_profile") or {}
    proposer_name = _company_name(proposer_ws)
    industry = profile.get("primary_industry") or ""

    recipient_name = payload.recipient_name or ""
    if not recipient_name and payload.recipient_workspace_id:
        recipient_ws = await _workspace_row(payload.recipient_workspace_id)
        recipient_name = _company_name(recipient_ws) if recipient_ws else ""

    from app.modules.credits.service import credit_guard

    async with credit_guard(user_id, "proposal_section", payload.generation_id):
        llm = await pick_llm_for_user(user_id)
        system = (
            "You write concise, professional B2B proposal cover letters. "
            "Return 3 to 4 sentences of plain prose. No greeting, no sign-off, no placeholders, "
            "no markdown, no em dashes."
        )
        prompt = (
            f"Company submitting the proposal: {proposer_name}"
            + (f" (industry: {industry})" if industry else "")
            + f".\nRecipient company: {recipient_name or 'the client'}."
            + (f"\nRequest title: {payload.request_title}" if payload.request_title else "")
            + (f"\nRequest details: {payload.request_description}" if payload.request_description else "")
            + "\n\nWrite the cover letter now."
        )
        result = await asyncio.wait_for(
            llm.generate_text(system=system, prompt=prompt, feature="proposals.cover_letter"),
            timeout=45,
        )
    return _clean_ai_text(getattr(result, "text", "") or "")


async def generate_description(*, user_id: str, title: str) -> str:
    """Not credit-gated. Returns "" on any failure — never raises, never hangs.

    A slow LLM provider must not hold the request open until the platform proxy
    (Render) times it out with a 503, so the call is capped with a hard timeout.
    """
    system = (
        "You help a business describe what they are looking for in a proposal request. "
        "Return 2 to 4 sentences of plain prose. No markdown, no placeholders, no em dashes."
    )
    prompt = f"Proposal request title: {title}\n\nWrite a short description of what the requester is looking for."
    try:
        llm = await pick_llm_for_user(user_id)
        result = await asyncio.wait_for(
            llm.generate_text(system=system, prompt=prompt, feature="proposals.description"),
            timeout=25,
        )
        return _clean_ai_text(getattr(result, "text", "") or "")
    except Exception as exc:
        logger.info("proposal description generation failed: %s", exc)
        return ""
