from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

STRIPE_API_BASE = "https://api.stripe.com/v1"
STRIPE_CONNECT_AUTH_URL = "https://connect.stripe.com/oauth/authorize"
STRIPE_CONNECT_TOKEN_URL = "https://connect.stripe.com/oauth/token"


def auth_url(client_id: str, redirect_uri: str, state: str) -> str:
    """Return the Stripe Connect OAuth authorization URL."""
    params = {
        "response_type": "code",
        "client_id": client_id,
        "scope": "read_only",
        "state": state,
        "redirect_uri": redirect_uri,
    }
    return f"{STRIPE_CONNECT_AUTH_URL}?{urlencode(params)}"


async def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str) -> dict:
    """Exchange an OAuth authorization code for an access token."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            STRIPE_CONNECT_TOKEN_URL,
            data={"grant_type": "authorization_code", "code": code},
            headers={"Authorization": f"Bearer {client_secret}"},
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "access_token": data.get("access_token", ""),
            "refresh_token": data.get("refresh_token", ""),
            "stripe_user_id": data.get("stripe_user_id", ""),
            "expires_in": 0,  # Stripe Connect tokens don't expire
        }


def _headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _ts(epoch: int | None) -> str | None:
    if not epoch:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


async def _list_all(client: httpx.AsyncClient, access_token: str, endpoint: str, params: dict | None = None) -> list[dict]:
    """Auto-paginate a Stripe list endpoint using cursor-based pagination."""
    items: list[dict] = []
    req_params = {**(params or {}), "limit": 100}
    while True:
        resp = await client.get(
            f"{STRIPE_API_BASE}/{endpoint}",
            headers=_headers(access_token),
            params=req_params,
        )
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("data", [])
        items.extend(batch)
        if not data.get("has_more") or not batch:
            break
        req_params["starting_after"] = batch[-1]["id"]
    return items


def _map_customer(row: dict, now: str) -> dict:
    name = _clean(row.get("name") or row.get("email") or "Stripe Customer")
    parts = name.split(" ", 1)
    return {
        "id": _clean(row.get("id")) or str(uuid4()),
        "name": name,
        "first_name": parts[0] if len(parts) > 1 else name,
        "last_name": parts[-1] if len(parts) > 1 else "",
        "email": _clean(row.get("email")),
        "phone_number": _clean(row.get("phone")),
        "address": _clean((row.get("address") or {}).get("line1")),
        "payment_terms": 30,
        "industry": "",
        "archived": row.get("deleted", False),
        "source_system": "stripe",
        "source_id": _clean(row.get("id")),
        "imported_at": now,
    }


def _map_product(row: dict, price_map: dict[str, float], now: str) -> dict:
    default_price_id = _clean(row.get("default_price") or "")
    return {
        "id": _clean(row.get("id")) or str(uuid4()),
        "name": _clean(row.get("name") or "Stripe Product"),
        "description": _clean(row.get("description")),
        "type": "product" if row.get("type") == "good" else "service",
        "base_price": price_map.get(default_price_id, 0.0),
        "archived": not row.get("active", True),
        "source_system": "stripe",
        "source_id": _clean(row.get("id")),
        "imported_at": now,
    }


def _map_invoice(row: dict, now: str) -> dict:
    currency = _clean(row.get("currency") or "usd").upper()
    total = (row.get("amount_paid") or row.get("amount_due") or 0) / 100.0
    subtotal = (row.get("subtotal") or 0) / 100.0
    tax = (row.get("tax") or 0) / 100.0
    inv_number = _clean(row.get("number") or row.get("id") or "")
    customer_name = _clean(
        row.get("customer_name") or row.get("customer_email") or "Stripe Customer"
    )
    status_map = {
        "paid": "paid", "open": "sent", "void": "cancelled",
        "draft": "draft", "uncollectible": "overdue",
    }
    status = status_map.get(row.get("status") or "open", "sent")
    line_items = []
    for li in (row.get("lines") or {}).get("data", []):
        li_amount = (li.get("amount") or 0) / 100.0
        qty = max(li.get("quantity") or 1, 1)
        line_items.append({
            "id": str(uuid4()),
            "description": _clean(li.get("description") or "Item"),
            "quantity": qty,
            "unit_price": round(li_amount / qty, 4),
            "subtotal": li_amount,
        })
    return {
        "id": _clean(row.get("id")) or str(uuid4()),
        "invoice_number": inv_number,
        "client_name": customer_name,
        "status": status,
        "total_amount": total,
        "subtotal_amount": subtotal,
        "vat_amount": tax,
        "currency": currency,
        "source_currency": currency,
        "issued_date": _ts(row.get("created")) or now,
        "due_date": _ts(row.get("due_date")) or _ts(row.get("period_end")),
        "items": line_items,
        "source_system": "stripe",
        "source_id": _clean(row.get("id")),
        "imported_at": now,
    }


async def import_from_stripe(meta: dict) -> tuple[dict, list[str]]:
    """Import products, customers, and invoices from a connected Stripe account."""
    access_token = meta.get("access_token", "")
    now = datetime.now(timezone.utc).isoformat()
    imported: dict[str, list] = {"products": [], "customers": [], "invoices": []}
    errors: list[str] = []

    async with httpx.AsyncClient(timeout=60) as client:
        # Products + prices
        try:
            raw_products = await _list_all(client, access_token, "products")
            raw_prices = await _list_all(client, access_token, "prices")
            price_map: dict[str, float] = {
                p["id"]: (p.get("unit_amount") or 0) / 100.0
                for p in raw_prices
                if p.get("id") and p.get("unit_amount") is not None
            }
            for row in raw_products:
                if not row.get("name"):
                    continue
                imported["products"].append(_map_product(row, price_map, now))
        except Exception as e:
            logger.warning("Stripe products import error: %s", e)
            errors.append(f"Products: {e}")

        # Customers
        try:
            raw_customers = await _list_all(client, access_token, "customers")
            for row in raw_customers:
                imported["customers"].append(_map_customer(row, now))
        except Exception as e:
            logger.warning("Stripe customers import error: %s", e)
            errors.append(f"Customers: {e}")

        # Invoices
        try:
            raw_invoices = await _list_all(
                client, access_token, "invoices", params={"expand[]": "data.lines"}
            )
            for row in raw_invoices:
                imported["invoices"].append(_map_invoice(row, now))
        except Exception as e:
            logger.warning("Stripe invoices import error: %s", e)
            errors.append(f"Invoices: {e}")

    return imported, errors
