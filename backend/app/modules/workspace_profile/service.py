from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from app.modules.idea_validation.service import create_workspace, get_workspace, get_user_workspace, update_workspace
from app.modules.workspace_profile.schemas import WorkspaceProfile


async def _load_workspace(user_id: str, workspace_id: str | None):
    if workspace_id:
        return await get_workspace(user_id=user_id, workspace_id=workspace_id)
    # Do NOT silently fall back to most-recently-updated — that causes profile
    # saves to land on the wrong workspace when the caller forgets the ID.
    # Return the most-recent one only for read (GET) operations; callers that
    # write must pass workspace_id explicitly.
    return await get_user_workspace(user_id=user_id)


async def get_profile(*, user_id: str, workspace_id: str | None = None):
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    data = ws.data or {}
    profile = data.get("workspace_profile")
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace profile not found")
    _OPERATING_STAGE_MAP = {"growth": "growing"}
    _DELIVERY_MODEL_MAP = {"manual_only": "manual", "fully_automated": "automated"}
    normalized = dict(profile)
    if normalized.get("operating_stage") in _OPERATING_STAGE_MAP:
        normalized["operating_stage"] = _OPERATING_STAGE_MAP[normalized["operating_stage"]]
    if normalized.get("delivery_model") in _DELIVERY_MODEL_MAP:
        normalized["delivery_model"] = _DELIVERY_MODEL_MAP[normalized["delivery_model"]]
    try:
        parsed: WorkspaceProfile | dict = WorkspaceProfile.model_validate(normalized)
        profile_out = parsed.model_dump()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning(
            "Workspace profile validation failed for workspace %s: %s", ws.id, exc
        )
        # Return raw data so the user can still view and fix their profile — never 422 on a read
        profile_out = normalized
    return {"workspace_id": str(ws.id), "profile": profile_out, "updated_at": ws.updated_at}


async def upsert_profile(*, user_id: str, workspace_id: str | None, profile: WorkspaceProfile):
    ws = await _load_workspace(user_id, workspace_id)
    now = datetime.now(timezone.utc).isoformat()

    if ws:
        # Merge incoming profile on top of existing so previously-saved required fields
        # (services, country, city, etc.) are preserved when not re-submitted.
        existing = ws.data.get("workspace_profile") if isinstance(ws.data, dict) else {}
        base = dict(existing or {})
        incoming = profile.model_dump()
        for k, v in incoming.items():
            # Only overwrite with incoming value when it's non-empty; keep existing otherwise
            if isinstance(v, list):
                if v:
                    base[k] = v
            elif v is not None and v != "":
                base[k] = v
        try:
            merged_profile = WorkspaceProfile.model_validate(base)
        except Exception as e:
            raise HTTPException(status_code=422, detail=str(e))
        await update_workspace(
            user_id=user_id,
            workspace_id=str(ws.id),
            data_patch={
                "workspace_profile": merged_profile.model_dump(),
                "workspace_profile_updated_at": now,
            },
        )
        ws = await get_workspace(user_id=user_id, workspace_id=str(ws.id))
        return {"workspace_id": str(ws.id), "profile": merged_profile, "updated_at": ws.updated_at}

    # Create a workspace if none exists yet
    payload = {
        "workspace_profile": profile.model_dump(),
        "workspace_profile_updated_at": now,
    }
    ws_id = await create_workspace(user_id=user_id, name=profile.company_name, data=payload)
    ws = await get_workspace(user_id=user_id, workspace_id=ws_id)
    return {"workspace_id": str(ws.id), "profile": profile, "updated_at": ws.updated_at}


async def patch_profile(*, user_id: str, workspace_id: str | None, profile_patch: dict[str, Any]):
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    existing = ws.data.get("workspace_profile") if isinstance(ws.data, dict) else None
    merged = dict(existing or {})
    for k, v in (profile_patch or {}).items():
        merged[k] = v

    try:
        validated = WorkspaceProfile.model_validate(merged)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

    await update_workspace(
        user_id=user_id,
        workspace_id=str(ws.id),
        data_patch={
            "workspace_profile": validated.model_dump(),
            "workspace_profile_updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    ws = await get_workspace(user_id=user_id, workspace_id=str(ws.id))
    return {"workspace_id": str(ws.id), "profile": validated, "updated_at": ws.updated_at}


# ── Sign-up onboarding ────────────────────────────────────────────────────────

DEFAULT_WORKSPACE_NAME = "My workspace"

# Fields the stepped sign-up form may send. Anything else is ignored.
ONBOARDING_FIELDS = {
    "company_name", "business_type", "primary_industry", "tagline", "about_company",
    "operating_stage", "company_size", "country", "city", "phone_number", "website", "services",
}


def _clean_answers(answers: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in (answers or {}).items():
        if key not in ONBOARDING_FIELDS:
            continue
        if key == "services":
            services = []
            for s in value or []:
                name = str((s or {}).get("service_name") if isinstance(s, dict) else s or "").strip()
                if len(name) >= 2:
                    services.append({"service_name": name[:120]})
            if services:
                cleaned["services"] = services[:5]
            continue
        text = str(value or "").strip()
        if text:
            cleaned[key] = text
    return cleaned


def _defaults(*, email: str, company_name: str) -> dict[str, Any]:
    """Values for required profile fields the user skipped. Kept neutral so a
    skipped field reads as unset rather than invented."""
    return {
        "company_name": company_name,
        "business_type": "startup",
        "primary_industry": "other",
        "about_company": f"{company_name} is building its business with EnterprateAI.",
        "services": [],
        "country": "Not specified",
        "city": "Not specified",
        "email": email,
        "operating_stage": "idea",
        "delivery_model": "manual",
    }


async def complete_onboarding(*, user_id: str, email: str, answers: dict[str, Any]) -> dict:
    """Apply the sign-up workspace answers. Skipped fields keep their current
    value (or a default for a first-time profile). Always marks onboarding done
    so the form is only shown once."""
    from app.modules.idea_validation.service import upsert_user_workspace

    cleaned = _clean_answers(answers)
    ws = await get_user_workspace(user_id=user_id)
    if not ws:
        ws = await upsert_user_workspace(
            user_id=user_id,
            data_patch={},
            name=cleaned.get("company_name") or DEFAULT_WORKSPACE_NAME,
        )

    data = ws.data or {}
    existing = data.get("workspace_profile") or None
    now = datetime.now(timezone.utc).isoformat()
    patch: dict[str, Any] = {}
    defaulted: list[str] = []

    if cleaned:
        if existing:
            merged = {**existing, **cleaned}
        else:
            company = cleaned.get("company_name") or (ws.name if ws.name and ws.name != "Unnamed" else DEFAULT_WORKSPACE_NAME)
            base = _defaults(email=email, company_name=company)
            defaulted = [k for k in base if k not in cleaned]
            merged = {**base, **cleaned}
        category = merged.get("primary_industry") or "other"
        merged["services"] = [
            {"service_category": s.get("service_category") or category, **s} for s in merged.get("services") or []
        ]
        try:
            validated = WorkspaceProfile.model_validate(merged)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Please check your answers: {e}")
        patch["workspace_profile"] = validated.model_dump()
        patch["workspace_profile_updated_at"] = now

    patch["onboarding"] = {
        **(data.get("onboarding") or {}),
        "completed_at": now,
        "skipped": not cleaned,
        "defaulted_fields": defaulted,
    }
    rename = cleaned.get("company_name") if cleaned.get("company_name") and (not ws.name or ws.name in (DEFAULT_WORKSPACE_NAME, "Unnamed")) else None
    await update_workspace(user_id=user_id, workspace_id=str(ws.id), data_patch=patch, name=rename)
    ws = await get_workspace(user_id=user_id, workspace_id=str(ws.id))
    profile = (ws.data or {}).get("workspace_profile") or {}
    return {
        "workspace_id": str(ws.id),
        "workspace_name": ws.name,
        "company_name": profile.get("company_name"),
        "logo_data_url": profile.get("logo_data_url"),
    }
