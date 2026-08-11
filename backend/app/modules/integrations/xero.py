from __future__ import annotations

import base64
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

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


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _xero_date(value: Any) -> str | None:
    """Convert Xero /Date(ms+tz)/ or YYYY-MM-DD string to YYYY-MM-DD."""
    s = str(value or "").strip()
    if not s:
        return None
    if s.startswith("/Date("):
        try:
            ms = int(s[6:s.index("+")] if "+" in s else s[6:s.index(")")])
            return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            return None
    return s[:10] if len(s) >= 10 else None


async def _xero_get_pages(client: httpx.AsyncClient, path: str, key: str, access_token: str, tenant_id: str, params: dict | None = None) -> list[dict]:
    """Paginate through all pages of a Xero endpoint."""
    rows: list[dict] = []
    page = 1
    base_params = {**(params or {}), "page": page}
    while True:
        base_params["page"] = page
        resp = await client.get(
            f"{XERO_API_BASE}/{path}",
            params=base_params,
            headers=_headers(access_token, tenant_id),
        )
        resp.raise_for_status()
        batch = resp.json().get(key, [])
        rows.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return rows


def _map_xero_contact(row: dict, now: str) -> dict:
    phones = row.get("Phones") or []
    phone = ""
    for p in phones:
        if p.get("PhoneType") in ("DEFAULT", "MOBILE") and p.get("PhoneNumber"):
            phone = _clean(p["PhoneNumber"])
            break
    addresses = row.get("Addresses") or []
    address = ""
    for a in addresses:
        line1 = _clean(a.get("AddressLine1"))
        if line1:
            address = line1
            break
    name = _clean(row.get("Name") or "Imported Contact")
    parts = name.split(" ", 1)
    return {
        "id": _clean(row.get("ContactID")) or str(uuid4()),
        "name": name,
        "first_name": parts[0] if len(parts) > 1 else "",
        "last_name": parts[-1],
        "email": _clean(row.get("EmailAddress")),
        "phone_number": phone,
        "address": address,
        "payment_terms": 14,
        "industry": "",
        "archived": row.get("ContactStatus", "ACTIVE") != "ACTIVE",
        "source_system": "xero",
        "source_record_id": _clean(row.get("ContactID")),
        "created_at": now,
        "updated_at": now,
    }


def _map_xero_item(row: dict, now: str) -> dict | None:
    if not row.get("Name"):
        return None
    sales = row.get("SalesDetails") or {}
    purchase = row.get("PurchaseDetails") or {}
    price = float(sales.get("UnitPrice") or 0)
    cost = float(purchase.get("UnitPrice") or 0)
    return {
        "id": _clean(row.get("ItemID")) or str(uuid4()),
        "name": _clean(row.get("Name") or "Imported Item"),
        "type": "product",
        "product_type": "product",
        "category": "Imported from Xero",
        "base_price": price,
        "original_price": price,
        "source_currency": None,
        "cost_of_sales": cost,
        "discount": 0,
        "freight_cost": 0,
        "description": _clean(row.get("Description")),
        "archived": not row.get("IsTrackedAsInventory", True) and not price,
        "source_system": "xero",
        "source_record_id": _clean(row.get("ItemID")),
        "created_at": now,
        "updated_at": now,
    }


def _map_xero_invoice(row: dict, now: str) -> dict:
    total = float(row.get("Total") or 0)
    sub_total = float(row.get("SubTotal") or total)
    tax = float(row.get("TotalTax") or 0)
    source_currency = _clean(row.get("CurrencyCode") or "").upper() or None
    customer = _clean((row.get("Contact") or {}).get("Name"))
    inv_number = _clean(row.get("InvoiceNumber") or "")
    raw_status = _clean(row.get("Status") or "").upper()
    status_map = {"PAID": "paid", "VOIDED": "cancelled", "DELETED": "cancelled", "DRAFT": "pending", "SUBMITTED": "pending", "AUTHORISED": "pending"}
    status = status_map.get(raw_status, "pending")
    lines = row.get("LineItems") or []
    items = []
    for line in lines:
        name = _clean(line.get("Description") or line.get("ItemCode") or "Item")
        qty = float(line.get("Quantity") or 1)
        unit_price = float(line.get("UnitAmount") or 0)
        subtotal = float(line.get("LineAmount") or 0)
        if name and subtotal:
            items.append({"product_name": name, "quantity": qty, "unit_price": unit_price, "subtotal": subtotal})
    if not items:
        items = [{"product_name": f"Xero Invoice {inv_number}", "quantity": 1, "unit_price": sub_total, "subtotal": sub_total}]
    return {
        "id": _clean(row.get("InvoiceID")) or str(uuid4()),
        "invoice_id": inv_number or f"XERO-{_clean(row.get('InvoiceID', ''))[:8]}",
        "product_name": items[0]["product_name"] if items else "Xero Invoice",
        "product_names": [i["product_name"] for i in items],
        "items": items,
        "quantity": 1,
        "subtotal_amount": sub_total,
        "vat_amount": max(tax, 0),
        "vat_rate": round((tax / sub_total * 100) if sub_total else 0, 2),
        "total_amount": total,
        "original_amount": total,
        "source_currency": source_currency,
        "status": status,
        "customer_name": customer,
        "issued_at": _xero_date(row.get("Date") or row.get("DateString")) or now[:10],
        "due_date": _xero_date(row.get("DueDate") or row.get("DueDateString")),
        "source_system": "xero",
        "source_record_id": _clean(row.get("InvoiceID")),
        "created_at": now,
        "updated_at": now,
    }


def _map_xero_bill(row: dict, now: str) -> dict:
    total = float(row.get("Total") or 0)
    source_currency = _clean(row.get("CurrencyCode") or "").upper() or None
    vendor = _clean((row.get("Contact") or {}).get("Name"))
    lines = row.get("LineItems") or []
    description = ""
    for line in lines:
        desc = _clean(line.get("Description"))
        if desc:
            description = desc
            break
    return {
        "id": _clean(row.get("InvoiceID")) or str(uuid4()),
        "expense_id": f"XERO-BILL-{_clean(row.get('InvoiceID', ''))[:8]}",
        "item": description or vendor or "Xero Bill",
        "description": description,
        "vendor_name": vendor,
        "total_amount": total,
        "original_amount": total,
        "source_currency": source_currency,
        "price": total,
        "quantity": 1,
        "status": "paid" if _clean(row.get("Status") or "").upper() == "PAID" else "pending",
        "payment_method": "",
        "incurred_at": _xero_date(row.get("Date") or row.get("DateString")) or now[:10],
        "due_date": _xero_date(row.get("DueDate") or row.get("DueDateString")),
        "source_system": "xero",
        "source_record_id": _clean(row.get("InvoiceID")),
        "created_at": now,
        "updated_at": now,
    }


def _map_xero_quote(row: dict, now: str) -> dict:
    total = float(row.get("Total") or 0)
    sub_total = float(row.get("SubTotal") or total)
    tax = float(row.get("TotalTax") or 0)
    source_currency = _clean(row.get("CurrencyCode") or "").upper() or None
    customer = _clean((row.get("Contact") or {}).get("Name"))
    quote_number = _clean(row.get("QuoteNumber") or "")
    raw_status = _clean(row.get("Status") or "").upper()
    status_map = {"ACCEPTED": "accepted", "DECLINED": "declined", "INVOICED": "accepted", "DELETED": "cancelled"}
    status = status_map.get(raw_status, "draft")
    lines = row.get("LineItems") or []
    items = []
    for line in lines:
        name = _clean(line.get("Description") or line.get("ItemCode") or "Item")
        qty = float(line.get("Quantity") or 1)
        unit_price = float(line.get("UnitAmount") or 0)
        subtotal = float(line.get("LineAmount") or 0)
        if name and subtotal:
            items.append({"product_name": name, "quantity": qty, "unit_price": unit_price, "subtotal": subtotal})
    if not items:
        items = [{"product_name": f"Xero Quote {quote_number}", "quantity": 1, "unit_price": sub_total, "subtotal": sub_total}]
    return {
        "id": _clean(row.get("QuoteID")) or str(uuid4()),
        "quote_id": quote_number or f"XERO-Q-{_clean(row.get('QuoteID', ''))[:8]}",
        "product_name": items[0]["product_name"] if items else "Xero Quote",
        "product_names": [i["product_name"] for i in items],
        "items": items,
        "quantity": 1,
        "subtotal_amount": sub_total,
        "vat_amount": max(tax, 0),
        "vat_rate": round((tax / sub_total * 100) if sub_total else 0, 2),
        "total_amount": total,
        "original_amount": total,
        "source_currency": source_currency,
        "status": status,
        "customer_name": customer,
        "issued_at": _xero_date(row.get("DateString") or row.get("Date")) or now[:10],
        "expiry_date": _xero_date(row.get("ExpiryDateString") or row.get("ExpiryDate")),
        "source_system": "xero",
        "source_record_id": _clean(row.get("QuoteID")),
        "created_at": now,
        "updated_at": now,
    }


async def import_from_xero(meta: dict, client_id: str, client_secret: str) -> tuple[dict, list[str]]:
    """Fetch all importable data from Xero and return normalized records."""
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    tenant_id = meta.get("tenant_id", "")
    now = datetime.now(timezone.utc).isoformat()
    errors: list[str] = []
    result: dict[str, list] = {"customers": [], "vendors": [], "products": [], "invoices": [], "expenses": [], "quotes": []}

    async with httpx.AsyncClient(timeout=30) as client:
        # Contacts → split into customers and vendors
        try:
            contacts = await _xero_get_pages(client, "Contacts", "Contacts", access, tenant_id, {"where": 'ContactStatus=="ACTIVE"'})
            for c in contacts:
                mapped = _map_xero_contact(c, now)
                if c.get("IsSupplier") and not c.get("IsCustomer"):
                    result["vendors"].append(mapped)
                else:
                    result["customers"].append(mapped)
        except Exception as e:
            logger.warning("Xero import Contacts failed: %s", e)
            errors.append(f"Contacts: {str(e)[:120]}")

        # Items → products
        try:
            items = await _xero_get_pages(client, "Items", "Items", access, tenant_id)
            for item in items:
                mapped = _map_xero_item(item, now)
                if mapped:
                    result["products"].append(mapped)
        except Exception as e:
            logger.warning("Xero import Items failed: %s", e)
            errors.append(f"Items: {str(e)[:120]}")

        # Invoices (ACCREC = sales)
        try:
            invoices = await _xero_get_pages(client, "Invoices", "Invoices", access, tenant_id, {"Type": "ACCREC", "Statuses": "DRAFT,SUBMITTED,AUTHORISED,PAID,VOIDED"})
            result["invoices"] = [_map_xero_invoice(r, now) for r in invoices]
        except Exception as e:
            logger.warning("Xero import Invoices failed: %s", e)
            errors.append(f"Invoices: {str(e)[:120]}")

        # Bills (ACCPAY = expenses/purchases)
        try:
            bills = await _xero_get_pages(client, "Invoices", "Invoices", access, tenant_id, {"Type": "ACCPAY", "Statuses": "DRAFT,SUBMITTED,AUTHORISED,PAID,VOIDED"})
            result["expenses"] = [_map_xero_bill(r, now) for r in bills]
        except Exception as e:
            logger.warning("Xero import Bills failed: %s", e)
            errors.append(f"Bills: {str(e)[:120]}")

        # Quotes
        try:
            quotes = await _xero_get_pages(client, "Quotes", "Quotes", access, tenant_id)
            result["quotes"] = [_map_xero_quote(r, now) for r in quotes]
        except Exception as e:
            logger.warning("Xero import Quotes failed: %s", e)
            errors.append(f"Quotes: {str(e)[:120]}")

    return result, errors


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
