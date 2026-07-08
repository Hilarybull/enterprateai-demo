from __future__ import annotations

import base64
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize"
XERO_TOKEN_URL = "https://identity.xero.com/connect/token"
XERO_CONNECTIONS_URL = "https://api.xero.com/connections"
XERO_API_BASE = "https://api.xero.com/api.xro/2.0"
XERO_SCOPES = "openid profile email accounting.transactions accounting.contacts offline_access"


def auth_url(client_id: str, redirect_uri: str, state: str) -> str:
    from urllib.parse import urlencode
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": XERO_SCOPES,
        "state": state,
    }
    return f"{XERO_AUTH_URL}?{urlencode(params)}"


async def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str) -> dict:
    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            XERO_TOKEN_URL,
            data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
            headers={"Authorization": f"Basic {credentials}", "Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        tokens = resp.json()
    # Fetch the first tenant (organisation)
    tenant_id = ""
    try:
        async with httpx.AsyncClient() as client:
            conn_resp = await client.get(
                XERO_CONNECTIONS_URL,
                headers={"Authorization": f"Bearer {tokens['access_token']}", "Content-Type": "application/json"},
            )
            conn_resp.raise_for_status()
            conns = conn_resp.json()
            if conns:
                tenant_id = conns[0].get("tenantId", "")
    except Exception as e:
        logger.warning("Xero: failed to get tenant: %s", e)
    tokens["tenant_id"] = tenant_id
    return tokens


async def _refresh(client_id: str, client_secret: str, token: str) -> dict:
    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            XERO_TOKEN_URL,
            data={"grant_type": "refresh_token", "refresh_token": token},
            headers={"Authorization": f"Basic {credentials}", "Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        return resp.json()


async def _ensure_fresh(meta: dict, client_id: str, client_secret: str) -> tuple[str, dict | None]:
    expiry_str = meta.get("token_expiry")
    access = meta.get("access_token", "")
    refresh = meta.get("refresh_token", "")
    if expiry_str and refresh:
        try:
            expiry = datetime.fromisoformat(expiry_str)
            now = datetime.now(timezone.utc)
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            if (expiry - now).total_seconds() < 300:
                new_tokens = await _refresh(client_id, client_secret, refresh)
                new_meta = {
                    **meta,
                    "access_token": new_tokens["access_token"],
                    "refresh_token": new_tokens.get("refresh_token", refresh),
                    "token_expiry": (now + timedelta(seconds=new_tokens.get("expires_in", 1800))).isoformat(),
                }
                return new_tokens["access_token"], new_meta
        except Exception as e:
            logger.warning("Xero token refresh failed: %s", e)
    return access, None


def _headers(access_token: str, tenant_id: str) -> dict:
    return {
        "Authorization": f"Bearer {access_token}",
        "Xero-tenant-id": tenant_id,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


async def sync_contacts(meta: dict, entities: list[dict], contact_type: str, client_id: str, client_secret: str) -> tuple[int, list[str]]:
    """Sync customers (contact_type='CUSTOMER') or vendors ('SUPPLIER') to Xero Contacts."""
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    tenant_id = meta.get("tenant_id", "")
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for entity in entities:
            if entity.get("archived"):
                continue
            contact: dict[str, Any] = {"Name": entity.get("name", "Unknown"), "ContactStatus": "ACTIVE"}
            if entity.get("email"):
                contact["EmailAddress"] = entity["email"]
            if entity.get("phone_number"):
                contact["Phones"] = [{"PhoneType": "DEFAULT", "PhoneNumber": entity["phone_number"]}]
            if entity.get("address"):
                contact["Addresses"] = [{"AddressType": "POBOX", "AddressLine1": entity["address"]}]
            if contact_type == "CUSTOMER":
                contact["IsCustomer"] = True
            else:
                contact["IsSupplier"] = True
            try:
                resp = await client.post(
                    f"{XERO_API_BASE}/Contacts",
                    json={"Contacts": [contact]},
                    headers=_headers(access, tenant_id),
                )
                resp.raise_for_status()
                synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"{contact_type} '{entity.get('name')}': {e.response.text[:120]}")
    return synced, errors


async def sync_invoices(meta: dict, invoices: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    tenant_id = meta.get("tenant_id", "")
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for inv in invoices:
            if inv.get("archived"):
                continue
            items = inv.get("items") or []
            line_items = []
            for item in items:
                line_items.append({
                    "Description": item.get("product_name", "Service"),
                    "Quantity": item.get("quantity", 1),
                    "UnitAmount": item.get("unit_price", 0),
                    "AccountCode": "200",
                })
            if not line_items:
                line_items = [{"Description": "Invoice", "Quantity": 1, "UnitAmount": inv.get("total_amount", 0), "AccountCode": "200"}]
            xero_inv: dict[str, Any] = {
                "Type": "ACCREC",
                "Status": "DRAFT",
                "LineItems": line_items,
            }
            if inv.get("customer_name"):
                xero_inv["Contact"] = {"Name": inv["customer_name"]}
            if inv.get("due_date"):
                xero_inv["DueDate"] = f"/Date({int(datetime.fromisoformat(inv['due_date'][:10]).timestamp() * 1000)})/"
            if inv.get("issued_at"):
                xero_inv["Date"] = f"/Date({int(datetime.fromisoformat(inv['issued_at'][:10]).timestamp() * 1000)})/"
            if inv.get("invoice_id"):
                xero_inv["InvoiceNumber"] = inv["invoice_id"]
            try:
                resp = await client.post(
                    f"{XERO_API_BASE}/Invoices",
                    json={"Invoices": [xero_inv]},
                    headers=_headers(access, tenant_id),
                )
                resp.raise_for_status()
                synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Invoice '{inv.get('invoice_id', '')}': {e.response.text[:120]}")
    return synced, errors


async def sync_expenses(meta: dict, expenses: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    """Sync expenses as Xero ACCPAY invoices (bills)."""
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    tenant_id = meta.get("tenant_id", "")
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for exp in expenses:
            if exp.get("archived"):
                continue
            xero_bill: dict[str, Any] = {
                "Type": "ACCPAY",
                "Status": "DRAFT",
                "LineItems": [{
                    "Description": exp.get("description") or exp.get("item", "Expense"),
                    "Quantity": 1,
                    "UnitAmount": float(exp.get("total_amount", exp.get("price", 0))),
                    "AccountCode": "400",
                }],
            }
            if exp.get("vendor_name"):
                xero_bill["Contact"] = {"Name": exp["vendor_name"]}
            if exp.get("incurred_at"):
                xero_bill["Date"] = f"/Date({int(datetime.fromisoformat(exp['incurred_at'][:10]).timestamp() * 1000)})/"
            if exp.get("due_date"):
                xero_bill["DueDate"] = f"/Date({int(datetime.fromisoformat(exp['due_date'][:10]).timestamp() * 1000)})/"
            try:
                resp = await client.post(
                    f"{XERO_API_BASE}/Invoices",
                    json={"Invoices": [xero_bill]},
                    headers=_headers(access, tenant_id),
                )
                resp.raise_for_status()
                synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Expense '{exp.get('item', '')}': {e.response.text[:120]}")
    return synced, errors
