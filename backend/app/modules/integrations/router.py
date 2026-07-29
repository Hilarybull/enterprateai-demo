from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from app.core.config import get_settings
from app.core.supabase import sb_select, sb_upsert, sb_update
from app.shared.auth.deps import get_current_user
from app.shared.auth.security import create_access_token, decode_token
from app.modules.integrations import quickbooks as qb
from app.modules.integrations import xero as xero_mod
from app.modules.integrations import zoho as zoho_mod

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations", tags=["integrations"])

Provider = Literal["quickbooks", "xero", "zoho_crm"]

PROVIDERS: dict[str, dict] = {
    "quickbooks": {"label": "QuickBooks", "group": "financial"},
    "xero":       {"label": "Xero",       "group": "financial"},
    "zoho_crm":   {"label": "Zoho CRM",   "group": "catalogue"},
}


def _backend_url() -> str:
    settings = get_settings()
    # Prefer explicit BACKEND_URL (set in production on Render/etc.)
    if settings.backend_url:
        return str(settings.backend_url).rstrip("/")
    host = settings.api_host if settings.api_host != "0.0.0.0" else "localhost"
    port = settings.api_port
    return f"http://{host}:{port}"


def _frontend_url() -> str:
    settings = get_settings()
    url = settings.frontend_url
    if isinstance(url, list):
        url = url[0]
    return str(url).rstrip("/")


def _redirect_uri(provider: str) -> str:
    return f"{_backend_url()}/integrations/{provider}/callback"


_PROVIDER_ENV_NAMES: dict[str, tuple[str, str]] = {
    "quickbooks": ("QB_CLIENT_ID", "QB_CLIENT_SECRET"),
    "xero":       ("XERO_CLIENT_ID", "XERO_CLIENT_SECRET"),
    "zoho_crm":   ("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"),
}

def _get_credentials(provider: str) -> tuple[str, str]:
    settings = get_settings()
    if provider == "quickbooks":
        return settings.qb_client_id or "", settings.qb_client_secret or ""
    if provider == "xero":
        return settings.xero_client_id or "", settings.xero_client_secret or ""
    if provider == "zoho_crm":
        return settings.zoho_client_id or "", settings.zoho_client_secret or ""
    raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")


async def _load_token_row(user_id: str, provider: str) -> dict | None:
    try:
        return await sb_select("integration_tokens", filters=[("user_id", "eq", user_id), ("provider", "eq", provider)], single=True)
    except Exception:
        return None


async def _save_tokens(user_id: str, provider: str, tokens: dict, extra_meta: dict | None = None) -> None:
    now = datetime.now(timezone.utc)
    expires_in = tokens.get("expires_in", 3600)
    expiry = (now + timedelta(seconds=expires_in)).isoformat()
    meta = {**(extra_meta or {}), "tenant_id": tokens.get("tenant_id", ""), "realm_id": tokens.get("realmId", "")}
    await sb_upsert(
        "integration_tokens",
        payload={
            "user_id": user_id,
            "provider": provider,
            "access_token": tokens.get("access_token", ""),
            "refresh_token": tokens.get("refresh_token", ""),
            "token_expiry": expiry,
            "metadata": meta,
            "connected_at": now.isoformat(),
            "last_sync_at": None,
        },
        on_conflict="user_id,provider",
    )


# ── Connect — return the OAuth authorization URL ──────────────────────────────

@router.get("/{provider}/connect")
async def connect(provider: Provider, user=Depends(get_current_user)) -> dict:
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider.")
    client_id, client_secret = _get_credentials(provider)
    if not client_id or not client_secret:
        id_name, secret_name = _PROVIDER_ENV_NAMES.get(provider, (f"{provider.upper()}_CLIENT_ID", f"{provider.upper()}_CLIENT_SECRET"))
        raise HTTPException(status_code=503, detail=f"{PROVIDERS[provider]['label']} OAuth credentials not configured. Add {id_name} and {secret_name} to your environment.")

    # Embed user identity in state so we can identify them in the callback
    state = create_access_token(subject=user["id"], extra={"provider": provider, "type": "oauth_state"})
    redirect_uri = _redirect_uri(provider)

    if provider == "quickbooks":
        url = qb.auth_url(client_id, redirect_uri, state)
    elif provider == "xero":
        url = xero_mod.auth_url(client_id, redirect_uri, state)
    else:
        url = zoho_mod.auth_url(client_id, redirect_uri, state)

    return {"auth_url": url, "provider": provider}


# ── Callback — exchange code, store tokens, redirect to frontend ───────────────

@router.get("/{provider}/callback", include_in_schema=False)
async def callback(provider: Provider, code: str = "", state: str = "", error: str = ""):
    frontend = _frontend_url()

    if error or not code or not state:
        return RedirectResponse(f"{frontend}/integrations/callback?provider={provider}&status=error&reason={error or 'missing_code'}")

    # Decode state to get user_id
    try:
        payload = decode_token(state)
        user_id: str = payload["sub"]
        if payload.get("provider") != provider or payload.get("type") != "oauth_state":
            raise ValueError("Invalid state")
    except Exception:
        return RedirectResponse(f"{frontend}/integrations/callback?provider={provider}&status=error&reason=invalid_state")

    client_id, client_secret = _get_credentials(provider)
    redirect_uri = _redirect_uri(provider)

    try:
        if provider == "quickbooks":
            # QB also sends realmId in the callback query string — we receive it via **kwargs
            # It's accessible via the request; for now store it from the token response
            tokens = await qb.exchange_code(client_id, client_secret, code, redirect_uri)
        elif provider == "xero":
            tokens = await xero_mod.exchange_code(client_id, client_secret, code, redirect_uri)
        else:
            tokens = await zoho_mod.exchange_code(client_id, client_secret, code, redirect_uri)
    except Exception as e:
        logger.error("OAuth exchange failed for %s: %s", provider, e)
        return RedirectResponse(f"{frontend}/integrations/callback?provider={provider}&status=error&reason=exchange_failed")

    try:
        await _save_tokens(user_id, provider, tokens)
    except Exception as e:
        logger.error("Failed to store tokens for %s/%s: %s", provider, user_id, e)
        return RedirectResponse(f"{frontend}/integrations/callback?provider={provider}&status=error&reason=storage_failed")

    return RedirectResponse(f"{frontend}/integrations/callback?provider={provider}&status=connected")


# QB sends realmId as a query param — add it to the callback route
@router.get("/quickbooks/callback", include_in_schema=False)
async def qb_callback(code: str = "", state: str = "", realmId: str = "", error: str = ""):
    frontend = _frontend_url()

    if error or not code or not state:
        return RedirectResponse(f"{frontend}/integrations/callback?provider=quickbooks&status=error&reason={error or 'missing_code'}")

    try:
        payload = decode_token(state)
        user_id: str = payload["sub"]
        if payload.get("provider") != "quickbooks" or payload.get("type") != "oauth_state":
            raise ValueError("Invalid state")
    except Exception:
        return RedirectResponse(f"{frontend}/integrations/callback?provider=quickbooks&status=error&reason=invalid_state")

    client_id, client_secret = _get_credentials("quickbooks")
    redirect_uri = _redirect_uri("quickbooks")

    try:
        tokens = await qb.exchange_code(client_id, client_secret, code, redirect_uri)
        tokens["realmId"] = realmId
    except Exception as e:
        logger.error("QB OAuth exchange failed: %s", e)
        return RedirectResponse(f"{frontend}/integrations/callback?provider=quickbooks&status=error&reason=exchange_failed")

    try:
        await _save_tokens(user_id, "quickbooks", tokens, extra_meta={"realm_id": realmId})
    except Exception as e:
        logger.error("Failed to store QB tokens: %s", e)
        import urllib.parse
        detail = urllib.parse.quote(str(e)[:200])
        return RedirectResponse(f"{frontend}/integrations/callback?provider=quickbooks&status=error&reason=storage_failed&detail={detail}")

    return RedirectResponse(f"{frontend}/integrations/callback?provider=quickbooks&status=connected")


# ── Status — which providers are connected ────────────────────────────────────

@router.get("/status")
async def status(user=Depends(get_current_user)) -> dict:
    result = {}
    for provider in PROVIDERS:
        row = await _load_token_row(user["id"], provider)
        result[provider] = {
            "connected": bool(row and row.get("access_token")),
            "connected_at": (row or {}).get("connected_at"),
            "last_sync_at": (row or {}).get("last_sync_at"),
        }
    return result


# ── Disconnect ────────────────────────────────────────────────────────────────

@router.delete("/{provider}")
async def disconnect(provider: Provider, user=Depends(get_current_user)) -> dict:
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider.")
    try:
        from app.core.supabase import sb_delete
        await sb_delete("integration_tokens", filters=[("user_id", "eq", user["id"]), ("provider", "eq", provider)])
    except Exception as e:
        logger.warning("Disconnect %s failed: %s", provider, e)
    return {"disconnected": True, "provider": provider}


# ── Sync ──────────────────────────────────────────────────────────────────────

@router.post("/{provider}/sync")
async def sync(provider: Provider, user=Depends(get_current_user)) -> dict:
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider.")

    row = await _load_token_row(user["id"], provider)
    if not row or not row.get("access_token"):
        raise HTTPException(status_code=400, detail=f"{PROVIDERS[provider]['label']} is not connected.")

    client_id, client_secret = _get_credentials(provider)
    meta = {
        "access_token": row["access_token"],
        "refresh_token": row.get("refresh_token", ""),
        "token_expiry": row.get("token_expiry", ""),
        "tenant_id": (row.get("metadata") or {}).get("tenant_id", ""),
        "realm_id": (row.get("metadata") or {}).get("realm_id", ""),
    }

    # Load workspace data
    from app.modules.idea_validation.service import get_user_workspace
    ws = await get_user_workspace(user_id=user["id"])
    ws_data = (ws.data or {}) if ws else {}
    financials = ws_data.get("financials", {})
    catalogue = ws_data.get("catalogue", {})

    total_synced = 0
    all_errors: list[str] = []

    if provider == "quickbooks":
        customers = catalogue.get("customers", [])
        vendors = catalogue.get("vendors", [])
        invoices = financials.get("invoices", [])
        expenses = financials.get("expenses", [])

        s, e = await qb.sync_customers(meta, customers, client_id, client_secret)
        total_synced += s; all_errors += e

        s, e = await qb.sync_vendors(meta, vendors, client_id, client_secret)
        total_synced += s; all_errors += e

        s, e = await qb.sync_invoices(meta, invoices, client_id, client_secret)
        total_synced += s; all_errors += e

        s, e = await qb.sync_expenses(meta, expenses, client_id, client_secret)
        total_synced += s; all_errors += e

    elif provider == "xero":
        customers = catalogue.get("customers", [])
        vendors = catalogue.get("vendors", [])
        invoices = financials.get("invoices", [])
        expenses = financials.get("expenses", [])

        s, e = await xero_mod.sync_contacts(meta, customers, "CUSTOMER", client_id, client_secret)
        total_synced += s; all_errors += e

        s, e = await xero_mod.sync_contacts(meta, vendors, "SUPPLIER", client_id, client_secret)
        total_synced += s; all_errors += e

        s, e = await xero_mod.sync_invoices(meta, invoices, client_id, client_secret)
        total_synced += s; all_errors += e

        s, e = await xero_mod.sync_expenses(meta, expenses, client_id, client_secret)
        total_synced += s; all_errors += e

    elif provider == "zoho_crm":
        products = catalogue.get("products", [])
        customers = catalogue.get("customers", [])
        vendors = catalogue.get("vendors", [])

        s, e = await zoho_mod.sync_products(meta, products, client_id, client_secret)
        total_synced += s; all_errors += e

        s, e = await zoho_mod.sync_contacts(meta, customers, client_id, client_secret)
        total_synced += s; all_errors += e

        s, e = await zoho_mod.sync_vendors(meta, vendors, client_id, client_secret)
        total_synced += s; all_errors += e

    # Update last_sync_at
    try:
        await sb_update(
            "integration_tokens",
            payload={"last_sync_at": datetime.now(timezone.utc).isoformat()},
            filters=[("user_id", "eq", user["id"]), ("provider", "eq", provider)],
        )
    except Exception:
        pass

    return {
        "synced": total_synced,
        "errors": all_errors,
        "provider": provider,
    }
