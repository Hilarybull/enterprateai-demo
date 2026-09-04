from __future__ import annotations

import secrets
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.supabase import sb_select, sb_update
from app.modules.idea_validation.service import get_user_workspace, get_workspace


# ─── helpers ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _load_ws(user_id: str, workspace_id: str | None = None):
    if workspace_id:
        return await get_workspace(user_id=user_id, workspace_id=workspace_id)
    return await get_user_workspace(user_id=user_id)


def _ws_fields(ws) -> tuple[str, dict]:
    if isinstance(ws, dict):
        return str(ws.get("id", "")), ws.get("data") or {}
    return str(ws.id), ws.data or {}


async def _save_data(ws_id: str, user_id: str, data: dict) -> None:
    now = _now()
    updated = await sb_update(
        "workspaces",
        filters=[("id", "eq", ws_id), ("user_id", "eq", user_id)],
        payload={"data": data, "updated_at": now},
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save. Please try again.",
        )


async def _save_data_any_user(ws_id: str, data: dict) -> None:
    """Save workspace data without user_id filter (for cross-tenant writes like inbox delivery)."""
    now = _now()
    await sb_update(
        "workspaces",
        filters=[("id", "eq", ws_id)],
        payload={"data": data, "updated_at": now},
    )


# ─── Preferences ─────────────────────────────────────────────────────────────

async def get_preferences(user_id: str, workspace_id: str | None) -> dict:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    _, data = _ws_fields(ws)
    prefs = data.get("proposal_preferences") or {}
    return {
        "enabled": prefs.get("enabled", False),
        "accepted_modes": prefs.get("accepted_modes", ["general"]),
        "accepted_categories": prefs.get("accepted_categories"),
        "proposal_cap": prefs.get("proposal_cap"),
        "visibility": prefs.get("visibility", "marketplace"),
    }


async def save_preferences(user_id: str, workspace_id: str | None, payload: dict) -> dict:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    merged = dict(data)
    now = _now()
    existing = data.get("proposal_preferences") or {}
    merged["proposal_preferences"] = {
        **existing,
        "enabled": bool(payload.get("enabled", False)),
        "accepted_modes": payload.get("accepted_modes") or ["general"],
        "accepted_categories": payload.get("accepted_categories"),
        "proposal_cap": payload.get("proposal_cap"),
        "visibility": payload.get("visibility") or "marketplace",
        "updated_at": now,
    }
    # Sync open_for_proposals flag into the marketplace data block so the
    # Marketplace listing badge reads it directly.
    marketplace = dict(data.get("marketplace") or {})
    marketplace["open_for_proposals"] = bool(payload.get("enabled", False))
    merged["marketplace"] = marketplace
    await _save_data(ws_id, user_id, merged)
    return merged["proposal_preferences"]


# ─── Proposal Requests ────────────────────────────────────────────────────────

def _count_submissions(data: dict, request_id: str) -> int:
    inbox = data.get("proposal_inbox") or []
    return sum(1 for p in inbox if p.get("request_id") == request_id and p.get("status") not in ("WITHDRAWN", "DECLINED", "EXPIRED", "ARCHIVED"))


async def list_requests(user_id: str, workspace_id: str | None) -> list[dict]:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        return []
    _, data = _ws_fields(ws)
    requests = data.get("proposal_requests") or []
    inbox = data.get("proposal_inbox") or []
    counts: dict[str, int] = {}
    for p in inbox:
        rid = p.get("request_id")
        if rid and p.get("status") not in ("WITHDRAWN", "DECLINED", "EXPIRED", "ARCHIVED"):
            counts[rid] = counts.get(rid, 0) + 1
    def _fill_defaults(r):
        return {
            "accepted_modes": ["general"],
            "accepted_categories": None,
            "visibility": "marketplace",
            **r,
            "submission_count": counts.get(r.get("id", ""), 0),
        }
    return [_fill_defaults(r) for r in sorted(requests, key=lambda x: x.get("created_at", ""), reverse=True)]


async def create_request(user_id: str, workspace_id: str | None, payload: dict) -> dict:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    now = _now()
    new_req = {
        "id": str(uuid4()),
        "workspace_id": ws_id,
        "type": payload.get("type") or "general",
        "title": (payload.get("title") or "").strip(),
        "description": payload.get("description"),
        "budget_range": payload.get("budget_range"),
        "budget_visible": bool(payload.get("budget_visible", False)),
        "deadline": payload.get("deadline"),
        "submission_cap": payload.get("submission_cap"),
        "requirements": [
            {"text": r.get("text", ""), "mandatory": bool(r.get("mandatory", False)), "weight": int(r.get("weight", 1))}
            for r in (payload.get("requirements") or [])
        ],
        "accepted_modes": payload.get("accepted_modes") or ["general"],
        "accepted_categories": payload.get("accepted_categories") or None,
        "specific_criteria": payload.get("specific_criteria") or None,
        "visibility": payload.get("visibility") or "marketplace",
        "status": "DRAFT",
        "created_at": now,
        "updated_at": now,
    }
    if not new_req["title"]:
        raise HTTPException(status_code=422, detail="Title is required")
    merged = dict(data)
    merged["proposal_requests"] = [new_req] + (data.get("proposal_requests") or [])
    await _save_data(ws_id, user_id, merged)
    return {**new_req, "submission_count": 0}


async def update_request(user_id: str, workspace_id: str | None, request_id: str, payload: dict) -> dict:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    requests = list(data.get("proposal_requests") or [])
    idx = next((i for i, r in enumerate(requests) if r.get("id") == request_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Request not found")
    req = dict(requests[idx])
    if req.get("status") not in ("DRAFT", "PAUSED", "PUBLISHED"):
        raise HTTPException(status_code=400, detail="Only DRAFT, PAUSED, or PUBLISHED requests can be edited")
    now = _now()
    for key in ("type", "title", "description", "budget_range", "budget_visible", "deadline", "submission_cap", "accepted_modes", "accepted_categories", "visibility", "specific_criteria"):
        if payload.get(key) is not None:
            req[key] = payload[key]
    if payload.get("requirements") is not None:
        req["requirements"] = [
            {"text": r.get("text", ""), "mandatory": bool(r.get("mandatory", False)), "weight": int(r.get("weight", 1))}
            for r in payload["requirements"]
        ]
    req["updated_at"] = now
    requests[idx] = req
    merged = dict(data)
    merged["proposal_requests"] = requests
    await _save_data(ws_id, user_id, merged)
    return {**req, "submission_count": _count_submissions(data, request_id)}


async def publish_request(user_id: str, workspace_id: str | None, request_id: str) -> dict:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    requests = list(data.get("proposal_requests") or [])
    idx = next((i for i, r in enumerate(requests) if r.get("id") == request_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if requests[idx].get("status") != "DRAFT":
        raise HTTPException(status_code=400, detail="Only DRAFT requests can be published")
    now = _now()
    requests[idx] = {**requests[idx], "status": "PUBLISHED", "published_at": now, "updated_at": now}
    merged = dict(data)
    merged["proposal_requests"] = requests
    await _save_data(ws_id, user_id, merged)
    return requests[idx]


async def close_request(user_id: str, workspace_id: str | None, request_id: str) -> dict:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    requests = list(data.get("proposal_requests") or [])
    idx = next((i for i, r in enumerate(requests) if r.get("id") == request_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if requests[idx].get("status") not in ("PUBLISHED", "PAUSED"):
        raise HTTPException(status_code=400, detail="Only PUBLISHED or PAUSED requests can be closed")
    now = _now()
    requests[idx] = {**requests[idx], "status": "CLOSED", "closed_at": now, "updated_at": now}
    merged = dict(data)
    merged["proposal_requests"] = requests
    await _save_data(ws_id, user_id, merged)
    return requests[idx]


async def reopen_request(user_id: str, workspace_id: str | None, request_id: str) -> dict:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    requests = list(data.get("proposal_requests") or [])
    idx = next((i for i, r in enumerate(requests) if r.get("id") == request_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if requests[idx].get("status") != "CLOSED":
        raise HTTPException(status_code=400, detail="Only CLOSED requests can be reopened")
    now = _now()
    requests[idx] = {**requests[idx], "status": "PUBLISHED", "reopened_at": now, "updated_at": now}
    merged = dict(data)
    merged["proposal_requests"] = requests
    await _save_data(ws_id, user_id, merged)
    return requests[idx]


async def delete_request(user_id: str, workspace_id: str | None, request_id: str) -> None:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    requests = list(data.get("proposal_requests") or [])
    idx = next((i for i, r in enumerate(requests) if r.get("id") == request_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if requests[idx].get("status") not in ("DRAFT", "CLOSED"):
        raise HTTPException(status_code=400, detail="Only DRAFT or CLOSED requests can be deleted")
    requests.pop(idx)
    merged = dict(data)
    merged["proposal_requests"] = requests
    await _save_data(ws_id, user_id, merged)


# ─── Inbox (received proposals) ──────────────────────────────────────────────

async def get_inbox(user_id: str, workspace_id: str | None) -> dict:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        return {"items": [], "total": 0}
    _, data = _ws_fields(ws)
    items = sorted(
        data.get("proposal_inbox") or [],
        key=lambda p: p.get("submitted_at") or p.get("updated_at") or "",
        reverse=True,
    )
    return {"items": items, "total": len(items)}


async def link_inbox_to_request(user_id: str, workspace_id: str | None, proposal_id: str, request_id: str | None) -> dict:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    inbox = list(data.get("proposal_inbox") or [])
    idx = next((i for i, p in enumerate(inbox) if p.get("id") == proposal_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Proposal not found in inbox")
    inbox[idx] = {**inbox[idx], "request_id": request_id, "updated_at": _now()}
    merged = dict(data)
    merged["proposal_inbox"] = inbox
    await _save_data(ws_id, user_id, merged)
    return inbox[idx]


# ─── Activity (submitted proposals) ──────────────────────────────────────────

async def get_activity(user_id: str, workspace_id: str | None) -> dict:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        return {"items": [], "total": 0}
    _, data = _ws_fields(ws)
    items = sorted(
        data.get("proposal_activity") or [],
        key=lambda p: p.get("submitted_at") or p.get("updated_at") or "",
        reverse=True,
    )
    return {"items": items, "total": len(items)}


# ─── Status transition ─────────────────────────────────────────────────────────

# Valid transitions per actor role
_RECIPIENT_TRANSITIONS = {
    "SUBMITTED": ["UNDER_REVIEW", "DECLINED"],
    "VIEWED": ["UNDER_REVIEW", "DECLINED"],
    "UNDER_REVIEW": ["SHORTLISTED", "CLARIFICATION_REQUESTED", "DECLINED"],
    "CLARIFICATION_REQUESTED": ["UNDER_REVIEW"],
    "SHORTLISTED": ["PREFERRED", "DECLINED"],
    "PREFERRED": ["NEGOTIATION", "DECLINED"],
    "NEGOTIATION": ["AWARDED", "DECLINED"],
    "AWARDED": ["CONTRACT_DRAFTED"],
    "CONTRACT_DRAFTED": ["CONTRACTED"],
}
_PROPOSER_TRANSITIONS = {
    "SUBMITTED": ["WITHDRAWN"],
    "VIEWED": ["WITHDRAWN"],
    "UNDER_REVIEW": ["WITHDRAWN"],
    "CLARIFICATION_REQUESTED": ["REVISION_REQUESTED", "WITHDRAWN"],
    "SHORTLISTED": ["WITHDRAWN"],
    "PREFERRED": ["WITHDRAWN"],
    "NEGOTIATION": ["WITHDRAWN"],
}


async def transition_status(
    user_id: str, workspace_id: str | None, proposal_id: str, new_status: str, reason: str | None
) -> dict:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    now = _now()

    # Try inbox first (recipient action)
    inbox = list(data.get("proposal_inbox") or [])
    inbox_idx = next((i for i, p in enumerate(inbox) if p.get("id") == proposal_id), None)

    if inbox_idx is not None:
        proposal = dict(inbox[inbox_idx])
        current = proposal.get("status", "SUBMITTED")
        allowed = _RECIPIENT_TRANSITIONS.get(current, [])
        if new_status not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot transition from {current} to {new_status}",
            )
        proposal["status"] = new_status
        proposal["updated_at"] = now
        if reason:
            proposal["last_reason"] = reason
        event = {"event_type": new_status.lower(), "actor": "recipient", "reason": reason, "created_at": now}
        proposal.setdefault("events", []).append(event)
        inbox[inbox_idx] = proposal
        merged = dict(data)
        merged["proposal_inbox"] = inbox
        await _save_data(ws_id, user_id, merged)
        # Also update proposer's activity record (best-effort)
        proposer_ws_id = proposal.get("proposer_workspace_id")
        if proposer_ws_id and proposer_ws_id != ws_id:
            try:
                proposer_ws = await sb_select("workspaces", filters=[("id", "eq", proposer_ws_id)], single=True)
                if proposer_ws:
                    p_data = dict(proposer_ws.get("data") or {})
                    activity = list(p_data.get("proposal_activity") or [])
                    a_idx = next((i for i, p in enumerate(activity) if p.get("id") == proposal_id), None)
                    if a_idx is not None:
                        activity[a_idx] = {**activity[a_idx], "status": new_status, "updated_at": now}
                        p_data["proposal_activity"] = activity
                        await _save_data_any_user(proposer_ws_id, p_data)
            except Exception:
                pass  # best-effort cross-workspace sync
        return proposal

    # Try activity (proposer action)
    activity = list(data.get("proposal_activity") or [])
    act_idx = next((i for i, p in enumerate(activity) if p.get("id") == proposal_id), None)
    if act_idx is not None:
        proposal = dict(activity[act_idx])
        current = proposal.get("status", "SUBMITTED")
        allowed = _PROPOSER_TRANSITIONS.get(current, [])
        if new_status not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot transition from {current} to {new_status}",
            )
        proposal["status"] = new_status
        proposal["updated_at"] = now
        if reason:
            proposal["last_reason"] = reason
        event = {"event_type": new_status.lower(), "actor": "proposer", "reason": reason, "created_at": now}
        proposal.setdefault("events", []).append(event)
        activity[act_idx] = proposal
        merged = dict(data)
        merged["proposal_activity"] = activity
        await _save_data(ws_id, user_id, merged)
        # Update recipient inbox (best-effort)
        recipient_ws_id = proposal.get("recipient_workspace_id")
        if recipient_ws_id and recipient_ws_id != ws_id:
            try:
                rec_ws = await sb_select("workspaces", filters=[("id", "eq", recipient_ws_id)], single=True)
                if rec_ws:
                    r_data = dict(rec_ws.get("data") or {})
                    r_inbox = list(r_data.get("proposal_inbox") or [])
                    r_idx = next((i for i, p in enumerate(r_inbox) if p.get("id") == proposal_id), None)
                    if r_idx is not None:
                        r_inbox[r_idx] = {**r_inbox[r_idx], "status": new_status, "updated_at": now}
                        r_data["proposal_inbox"] = r_inbox
                        await _save_data_any_user(recipient_ws_id, r_data)
            except Exception:
                pass
        return proposal

    raise HTTPException(status_code=404, detail="Proposal not found")


# ─── Submit proposal ──────────────────────────────────────────────────────────

async def submit_proposal(user_id: str, workspace_id: str | None, payload: dict) -> dict:
    """Submit a proposal from the proposer's workspace to the recipient's workspace."""
    # Load proposer workspace
    proposer_ws = await _load_ws(user_id, workspace_id)
    if not proposer_ws:
        raise HTTPException(status_code=404, detail="Your workspace not found")
    proposer_id, proposer_data = _ws_fields(proposer_ws)

    recipient_ws_id = payload.get("recipient_workspace_id")
    if not recipient_ws_id:
        raise HTTPException(status_code=422, detail="recipient_workspace_id is required")

    # Load recipient workspace
    rec_ws = await sb_select("workspaces", filters=[("id", "eq", recipient_ws_id)], single=True)
    if not rec_ws:
        raise HTTPException(status_code=404, detail="Recipient workspace not found")
    rec_data = dict(rec_ws.get("data") or {})

    # Check recipient preferences
    prefs = rec_data.get("proposal_preferences") or {}
    if not prefs.get("enabled", False):
        raise HTTPException(status_code=400, detail="This business is not currently accepting proposals")

    # Check for existing active submission (one-active rule)
    existing_activity = proposer_data.get("proposal_activity") or []
    active_statuses = {"SUBMITTED", "VIEWED", "UNDER_REVIEW", "CLARIFICATION_REQUESTED", "REVISION_REQUESTED", "SHORTLISTED", "PREFERRED", "NEGOTIATION"}
    request_id = payload.get("request_id")
    for p in existing_activity:
        if p.get("recipient_workspace_id") == recipient_ws_id:
            if request_id and p.get("request_id") != request_id:
                continue
            if p.get("status") in active_statuses:
                raise HTTPException(status_code=409, detail="You already have an active proposal with this business")

    # Get proposer profile for display
    proposer_profile = proposer_data.get("workspace_profile") or {}
    proposer_name = proposer_profile.get("company_name") or "Unknown Business"
    proposer_email = payload.get("proposer_email")
    recipient_profile = rec_data.get("workspace_profile") or {}
    recipient_name = recipient_profile.get("company_name") or "Unknown Business"

    # Get request title if applicable
    request_title = None
    if request_id:
        reqs = rec_data.get("proposal_requests") or []
        req = next((r for r in reqs if r.get("id") == request_id), None)
        if req:
            request_title = req.get("title")
            if req.get("status") not in ("PUBLISHED",):
                raise HTTPException(status_code=400, detail="This request is not open for submissions")
            # Check deadline
            deadline = req.get("deadline")
            if deadline:
                try:
                    dl = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
                    if dl < datetime.now(timezone.utc):
                        raise HTTPException(status_code=400, detail="The deadline for this request has passed")
                except ValueError:
                    pass
            # Check submission cap
            cap = req.get("submission_cap")
            if cap:
                count = sum(1 for p in (rec_data.get("proposal_inbox") or []) if p.get("request_id") == request_id and p.get("status") not in ("WITHDRAWN", "DECLINED", "EXPIRED", "ARCHIVED"))
                if count >= cap:
                    raise HTTPException(status_code=400, detail="This request has reached its submission cap")

    now = _now()
    proposal_id = str(uuid4())
    submission = {
        "id": proposal_id,
        "status": "SUBMITTED",
        "version": 1,
        "request_id": request_id,
        "request_title": request_title,
        "proposer_workspace_id": proposer_id,
        "proposer_name": proposer_name,
        "proposer_email": proposer_email,
        "recipient_workspace_id": recipient_ws_id,
        "recipient_name": recipient_name,
        "title": payload.get("title"),
        "summary": payload.get("summary"),
        "sections": payload.get("sections") or [],
        "requirement_responses": payload.get("requirement_responses") or [],
        "attachments": payload.get("attachments") or [],
        "events": [{"event_type": "submitted", "actor": "proposer", "created_at": now}],
        "submitted_at": now,
        "updated_at": now,
        "viewed_at": None,
    }

    # Write to proposer's activity
    proposer_merged = dict(proposer_data)
    proposer_merged["proposal_activity"] = [submission] + (proposer_data.get("proposal_activity") or [])
    await _save_data(proposer_id, user_id, proposer_merged)

    # Write to recipient's inbox (best-effort)
    try:
        rec_merged = dict(rec_data)
        rec_merged["proposal_inbox"] = [submission] + (rec_data.get("proposal_inbox") or [])
        await _save_data_any_user(recipient_ws_id, rec_merged)
    except Exception:
        pass

    return submission


# ─── Upload session ────────────────────────────────────────────────────────────

async def create_upload_session(user_id: str, workspace_id: str | None, payload: dict) -> dict:
    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    now = _now()
    session_token = secrets.token_urlsafe(32)
    session = {
        "token": session_token,
        "workspace_id": ws_id,
        "request_id": payload.get("request_id"),
        "recipient_workspace_id": payload.get("recipient_workspace_id"),
        "status": "PENDING",
        "created_at": now,
        "expires_at": None,  # expiry enforced server-side if needed
    }
    merged = dict(data)
    merged["upload_sessions"] = [session] + (data.get("upload_sessions") or [])
    await _save_data(ws_id, user_id, merged)
    return session


# ─── Invite by email ──────────────────────────────────────────────────────────

async def invite_to_request(
    user_id: str,
    workspace_id: str | None,
    request_id: str,
    emails: list[str],
    invite_url: str,
    sender_name: str,
    sender_email: str,
) -> dict:
    from app.shared.email.resend import send_proposal_request_invite_email

    ws = await _load_ws(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    _, data = _ws_fields(ws)
    requests_list = list(data.get("proposal_requests") or [])
    req = next((r for r in requests_list if r.get("id") == request_id), None)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    sent: list[str] = []
    failed: list[str] = []
    for email in emails:
        email = email.strip().lower()
        if not email:
            continue
        result = await send_proposal_request_invite_email(
            to_email=email,
            sender_name=sender_name,
            sender_email=sender_email,
            request_title=req.get("title", "Proposal Request"),
            invite_url=invite_url,
            requirements=req.get("requirements") or [],
            request_description=req.get("description") or None,
        )
        if result.sent:
            sent.append(email)
        else:
            failed.append(email)

    return {"sent": sent, "failed": failed}


# ─── Extract brief (no AI) ────────────────────────────────────────────────────

async def extract_brief_text(content: bytes, filename: str) -> dict:
    import io
    import zipfile
    import xml.etree.ElementTree as ET

    ext = (filename or "").rsplit(".", 1)[-1].lower()
    raw = ""

    if ext in ("txt", "md"):
        raw = content.decode("utf-8", errors="replace")

    elif ext == "pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            pages = [page.extract_text() or "" for page in reader.pages]
            raw = "\n\n".join(p for p in pages if p.strip())
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not read PDF: {exc}")

    elif ext == "docx":
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as z:
                xml_bytes = z.read("word/document.xml")
            root = ET.fromstring(xml_bytes)
            ns_t = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"
            texts = [el.text or "" for el in root.iter(ns_t)]
            raw = " ".join(t for t in texts if t.strip())
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not read Word document: {exc}")

    else:
        raise HTTPException(
            status_code=415,
            detail="Unsupported file type. Upload a PDF, Word (.docx), or plain-text (.txt) file.",
        )

    raw = raw.strip()
    if not raw:
        raise HTTPException(status_code=422, detail="No text could be extracted from the uploaded file.")

    # Derive a title hint from the first non-empty line (≤120 chars)
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    title_hint = lines[0][:120] if lines else ""

    return {"text": raw, "title_hint": title_hint}
