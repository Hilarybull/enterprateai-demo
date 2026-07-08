from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

QB_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2"
QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
QB_API_BASE = "https://quickbooks.api.intuit.com/v3/company"
QB_SCOPES = "com.intuit.quickbooks.accounting"


def auth_url(client_id: str, redirect_uri: str, state: str) -> str:
    from urllib.parse import urlencode
    params = {
        "client_id": client_id,
        "response_type": "code",
        "scope": QB_SCOPES,
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{QB_AUTH_URL}?{urlencode(params)}"


async def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            QB_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            auth=(client_id, client_secret),
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()


async def refresh_token(client_id: str, client_secret: str, token: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            QB_TOKEN_URL,
            data={"grant_type": "refresh_token", "refresh_token": token},
            auth=(client_id, client_secret),
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()


def _headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}", "Accept": "application/json", "Content-Type": "application/json"}


async def _ensure_fresh(meta: dict, client_id: str, client_secret: str) -> tuple[str, dict | None]:
    """Return (access_token, updated_meta_or_None). Refreshes if within 5 min of expiry."""
    expiry_str = meta.get("token_expiry")
    access = meta.get("access_token", "")
    refresh = meta.get("refresh_token", "")
    if expiry_str:
        try:
            expiry = datetime.fromisoformat(expiry_str)
            now = datetime.now(timezone.utc)
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            if (expiry - now).total_seconds() < 300 and refresh:
                new_tokens = await refresh_token(client_id, client_secret, refresh)
                from datetime import timedelta
                new_meta = {
                    **meta,
                    "access_token": new_tokens["access_token"],
                    "refresh_token": new_tokens.get("refresh_token", refresh),
                    "token_expiry": (now + timedelta(seconds=new_tokens.get("expires_in", 3600))).isoformat(),
                }
                return new_tokens["access_token"], new_meta
        except Exception as e:
            logger.warning("QB token refresh failed: %s", e)
    return access, None


async def sync_customers(meta: dict, customers: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    access, updated_meta = await _ensure_fresh(meta, client_id, client_secret)
    realm_id = meta.get("realm_id", "")
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for c in customers:
            if c.get("archived"):
                continue
            body = {
                "DisplayName": c.get("name", "Unknown"),
                "PrimaryEmailAddr": {"Address": c.get("email", "")} if c.get("email") else None,
                "PrimaryPhone": {"FreeFormNumber": c.get("phone_number", "")} if c.get("phone_number") else None,
                "BillAddr": {"Line1": c.get("address", "")} if c.get("address") else None,
                "Notes": c.get("industry", ""),
            }
            body = {k: v for k, v in body.items() if v is not None}
            try:
                resp = await client.post(
                    f"{QB_API_BASE}/{realm_id}/customer",
                    json=body,
                    headers=_headers(access),
                    params={"minorversion": "65"},
                )
                resp.raise_for_status()
                synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Customer '{c.get('name')}': {e.response.text[:120]}")
    return synced, errors


async def sync_vendors(meta: dict, vendors: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    realm_id = meta.get("realm_id", "")
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for v in vendors:
            if v.get("archived"):
                continue
            body = {
                "DisplayName": v.get("name", "Unknown"),
                "PrimaryEmailAddr": {"Address": v.get("email", "")} if v.get("email") else None,
                "PrimaryPhone": {"FreeFormNumber": v.get("phone_number", "")} if v.get("phone_number") else None,
                "BillAddr": {"Line1": v.get("address", "")} if v.get("address") else None,
            }
            body = {k: val for k, val in body.items() if val is not None}
            try:
                resp = await client.post(
                    f"{QB_API_BASE}/{realm_id}/vendor",
                    json=body,
                    headers=_headers(access),
                    params={"minorversion": "65"},
                )
                resp.raise_for_status()
                synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Vendor '{v.get('name')}': {e.response.text[:120]}")
    return synced, errors


async def sync_invoices(meta: dict, invoices: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    realm_id = meta.get("realm_id", "")
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for inv in invoices:
            if inv.get("archived"):
                continue
            items = inv.get("items") or []
            line_items: list[dict[str, Any]] = []
            for i, item in enumerate(items, start=1):
                line_items.append({
                    "Id": str(i),
                    "Amount": float(item.get("unit_price", 0)) * int(item.get("quantity", 1)),
                    "DetailType": "SalesItemLineDetail",
                    "SalesItemLineDetail": {
                        "ItemRef": {"value": "1", "name": item.get("product_name", "Service")},
                        "Qty": item.get("quantity", 1),
                        "UnitPrice": item.get("unit_price", 0),
                    },
                })
            if not line_items:
                line_items = [{
                    "Amount": float(inv.get("total_amount", 0)),
                    "DetailType": "SalesItemLineDetail",
                    "SalesItemLineDetail": {"ItemRef": {"value": "1", "name": "Service"}, "Qty": 1, "UnitPrice": inv.get("total_amount", 0)},
                }]
            body: dict[str, Any] = {"Line": line_items}
            if inv.get("customer_name"):
                body["CustomerRef"] = {"name": inv["customer_name"]}
            if inv.get("due_date"):
                body["DueDate"] = inv["due_date"][:10]
            if inv.get("issued_at"):
                body["TxnDate"] = inv["issued_at"][:10]
            try:
                resp = await client.post(
                    f"{QB_API_BASE}/{realm_id}/invoice",
                    json=body,
                    headers=_headers(access),
                    params={"minorversion": "65"},
                )
                resp.raise_for_status()
                synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Invoice '{inv.get('invoice_id', inv.get('id', ''))}': {e.response.text[:120]}")
    return synced, errors


async def sync_expenses(meta: dict, expenses: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    realm_id = meta.get("realm_id", "")
    synced, errors = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for exp in expenses:
            if exp.get("archived"):
                continue
            body: dict[str, Any] = {
                "PaymentType": "Cash",
                "AccountRef": {"value": "1"},
                "Line": [{
                    "Amount": float(exp.get("total_amount", exp.get("price", 0))),
                    "DetailType": "AccountBasedExpenseLineDetail",
                    "AccountBasedExpenseLineDetail": {
                        "AccountRef": {"value": "1"},
                        "BillableStatus": "NotBillable",
                    },
                    "Description": exp.get("description") or exp.get("item", ""),
                }],
            }
            if exp.get("vendor_name"):
                body["EntityRef"] = {"name": exp["vendor_name"], "type": "Vendor"}
            if exp.get("incurred_at"):
                body["TxnDate"] = exp["incurred_at"][:10]
            try:
                resp = await client.post(
                    f"{QB_API_BASE}/{realm_id}/purchase",
                    json=body,
                    headers=_headers(access),
                    params={"minorversion": "65"},
                )
                resp.raise_for_status()
                synced += 1
            except httpx.HTTPStatusError as e:
                errors.append(f"Expense '{exp.get('item', '')}': {e.response.text[:120]}")
    return synced, errors
