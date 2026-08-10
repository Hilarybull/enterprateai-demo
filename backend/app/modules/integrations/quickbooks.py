from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

QB_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2"
QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
QB_API_BASE = "https://quickbooks.api.intuit.com/v3/company"
QB_SCOPES = "com.intuit.quickbooks.accounting"


def _clean(value: Any) -> str:
    return str(value or "").strip()


async def _qb_query(client: httpx.AsyncClient, realm_id: str, access_token: str, entity: str) -> list[dict]:
    """Paginate a QB SQL query for a given entity and return all rows."""
    rows: list[dict] = []
    start = 1
    page_size = 100
    while True:
        query = f"SELECT * FROM {entity} STARTPOSITION {start} MAXRESULTS {page_size}"
        resp = await client.get(
            f"{QB_API_BASE}/{realm_id}/query",
            params={"query": query, "minorversion": "65"},
            headers=_headers(access_token),
        )
        resp.raise_for_status()
        batch = resp.json().get("QueryResponse", {}).get(entity, [])
        rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return rows


def _map_customer(row: dict, now: str) -> dict:
    email = _clean((row.get("PrimaryEmailAddr") or {}).get("Address"))
    phone = _clean((row.get("PrimaryPhone") or {}).get("FreeFormNumber"))
    addr = _clean((row.get("BillAddr") or {}).get("Line1"))
    name = _clean(row.get("DisplayName") or row.get("FullyQualifiedName") or "Imported Customer")
    parts = name.split(" ", 1)
    return {
        "id": _clean(row.get("Id")) or str(uuid4()),
        "name": name,
        "first_name": parts[0] if len(parts) > 1 else "",
        "last_name": parts[-1],
        "email": email,
        "phone_number": phone,
        "address": addr,
        "payment_terms": 14,
        "industry": "",
        "archived": not row.get("Active", True),
        "source_system": "quickbooks",
        "source_record_id": _clean(row.get("Id")),
        "created_at": now,
        "updated_at": now,
    }


def _map_vendor(row: dict, now: str) -> dict:
    email = _clean((row.get("PrimaryEmailAddr") or {}).get("Address"))
    phone = _clean((row.get("PrimaryPhone") or {}).get("FreeFormNumber"))
    addr = _clean((row.get("BillAddr") or {}).get("Line1"))
    name = _clean(row.get("DisplayName") or row.get("CompanyName") or "Imported Vendor")
    return {
        "id": _clean(row.get("Id")) or str(uuid4()),
        "name": name,
        "email": email,
        "phone_number": phone,
        "address": addr,
        "payment_terms": 14,
        "industry": "",
        "product_type": "product",
        "product_name": name,
        "price": 0,
        "archived": not row.get("Active", True),
        "source_system": "quickbooks",
        "source_record_id": _clean(row.get("Id")),
        "created_at": now,
        "updated_at": now,
    }


_QB_SELLABLE_TYPES = {"inventory", "noninventory", "service", "othercharge"}

def _map_item(row: dict, now: str) -> dict | None:
    item_type = _clean(row.get("Type") or "").lower()
    if item_type and item_type not in _QB_SELLABLE_TYPES:
        return None
    return {
        "id": _clean(row.get("Id")) or str(uuid4()),
        "name": _clean(row.get("Name") or "Imported Item"),
        "type": "product",
        "product_type": "service" if item_type == "service" else "product",
        "category": "Imported from QuickBooks",
        "base_price": float(row.get("UnitPrice") or 0),
        "cost_of_sales": float(row.get("PurchaseCost") or 0),
        "discount": 0,
        "freight_cost": 0,
        "description": _clean(row.get("Description")),
        "archived": not row.get("Active", True),
        "source_system": "quickbooks",
        "source_record_id": _clean(row.get("Id")),
        "created_at": now,
        "updated_at": now,
    }


def _map_invoice(row: dict, now: str) -> dict:
    total = float(row.get("TotalAmt") or 0)
    balance = float(row.get("Balance") or 0)
    sub_total = float(row.get("SubTotalAmt") or total)
    tax = round(total - sub_total, 2)
    customer = _clean((row.get("CustomerRef") or {}).get("name"))
    doc_number = _clean(row.get("DocNumber") or "")
    source_currency = _clean((row.get("CurrencyRef") or {}).get("value") or "").upper() or None
    status_map = {"": "pending", "Paid": "paid", "Voided": "cancelled"}
    raw_status = "Paid" if balance == 0 and total > 0 else ""
    status = status_map.get(raw_status, "pending")
    lines = row.get("Line") or []
    items = []
    for line in lines:
        detail = (line.get("SalesItemLineDetail") or {})
        item_name = _clean((detail.get("ItemRef") or {}).get("name") or line.get("Description") or "Item")
        qty = float(detail.get("Qty") or line.get("Amount") and 1 or 1)
        unit_price = float(detail.get("UnitPrice") or 0)
        subtotal = float(line.get("Amount") or 0)
        if item_name and subtotal:
            items.append({"product_name": item_name, "quantity": qty, "unit_price": unit_price, "subtotal": subtotal})
    if not items:
        items = [{"product_name": f"QB Invoice {doc_number}", "quantity": 1, "unit_price": sub_total, "subtotal": sub_total}]
    return {
        "id": _clean(row.get("Id")) or str(uuid4()),
        "invoice_id": doc_number or f"QB-{_clean(row.get('Id', ''))[:8]}",
        "product_name": items[0]["product_name"] if items else "QB Invoice",
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
        "issued_at": _clean(row.get("TxnDate") or now[:10]),
        "due_date": _clean(row.get("DueDate") or "") or None,
        "source_system": "quickbooks",
        "source_record_id": _clean(row.get("Id")),
        "created_at": now,
        "updated_at": now,
    }


def _map_expense(row: dict, now: str) -> dict:
    total = float(row.get("TotalAmt") or 0)
    entity_ref = row.get("EntityRef") or {}
    vendor_name = _clean(entity_ref.get("name"))
    doc_number = _clean(row.get("DocNumber") or "")
    source_currency = _clean((row.get("CurrencyRef") or {}).get("value") or "").upper() or None
    lines = row.get("Line") or []
    description = ""
    for line in lines:
        desc = _clean(line.get("Description"))
        detail = line.get("AccountBasedExpenseLineDetail") or {}
        if not desc:
            desc = _clean((detail.get("AccountRef") or {}).get("name"))
        if desc:
            description = desc
            break
    return {
        "id": _clean(row.get("Id")) or str(uuid4()),
        "expense_id": doc_number or f"QB-EXP-{_clean(row.get('Id', ''))[:8]}",
        "item": description or "QB Expense",
        "description": description,
        "vendor_name": vendor_name,
        "total_amount": total,
        "original_amount": total,
        "source_currency": source_currency,
        "price": total,
        "quantity": 1,
        "status": "paid",
        "payment_method": _clean(row.get("PaymentType") or ""),
        "incurred_at": _clean(row.get("TxnDate") or now[:10]),
        "source_system": "quickbooks",
        "source_record_id": _clean(row.get("Id")),
        "created_at": now,
        "updated_at": now,
    }


async def import_from_quickbooks(meta: dict, client_id: str, client_secret: str) -> tuple[dict, list[str], dict | None]:
    """Fetch all data from QuickBooks and return normalized records."""
    access, updated_meta = await _ensure_fresh(meta, client_id, client_secret)
    realm_id = _clean(meta.get("realm_id") or meta.get("tenant_id"))
    now = datetime.now(timezone.utc).isoformat()
    errors: list[str] = []
    result: dict[str, list] = {"customers": [], "vendors": [], "products": [], "invoices": [], "expenses": []}

    async with httpx.AsyncClient(timeout=30) as client:
        for entity, key, mapper in [
            ("Customer", "customers", _map_customer),
            ("Vendor", "vendors", _map_vendor),
            ("Item", "products", _map_item),
            ("Invoice", "invoices", _map_invoice),
            ("Purchase", "expenses", _map_expense),
        ]:
            try:
                rows = await _qb_query(client, realm_id, access, entity)
                mapped = [mapper(r, now) for r in rows]
                result[key] = [m for m in mapped if m is not None]
            except Exception as e:
                logger.warning("QB import %s failed: %s", entity, e)
                errors.append(f"{entity}: {str(e)[:120]}")

    return result, errors, updated_meta


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
    return {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
    }


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
