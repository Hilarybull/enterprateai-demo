from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from typing import Any

import httpx

logger = logging.getLogger(__name__)

ZOHO_SCOPES = "ZohoCRM.modules.ALL,ZohoCRM.settings.ALL"

_ZOHO_ENDPOINTS = {
    "com": ("accounts.zoho.com", "www.zohoapis.com"),
    "us": ("accounts.zoho.com", "www.zohoapis.com"),
    "eu": ("accounts.zoho.eu", "www.zohoapis.eu"),
    "in": ("accounts.zoho.in", "www.zohoapis.in"),
    "au": ("accounts.zoho.com.au", "www.zohoapis.com.au"),
    "com.au": ("accounts.zoho.com.au", "www.zohoapis.com.au"),
    "sg": ("accounts.zoho.sg", "www.zohoapis.sg"),
    "jp": ("accounts.zoho.jp", "www.zohoapis.jp"),
    "ca": ("accounts.zohocloud.ca", "www.zohoapis.ca"),
    "zohocloud.ca": ("accounts.zohocloud.ca", "www.zohoapis.ca"),
    "sa": ("accounts.zoho.sa", "www.zohoapis.sa"),
    "uk": ("accounts.zoho.uk", "www.zohoapis.uk"),
    "cn": ("accounts.zoho.com.cn", "www.zohoapis.com.cn"),
    "com.cn": ("accounts.zoho.com.cn", "www.zohoapis.com.cn"),
}


def _zoho_hosts() -> tuple[str, str]:
    from app.core.config import get_settings
    region = (get_settings().zoho_region or "com").lower().strip(".")
    return _ZOHO_ENDPOINTS.get(region, _ZOHO_ENDPOINTS["com"])


def _auth_base() -> str:
    accounts_host, _ = _zoho_hosts()
    return f"https://{accounts_host}/oauth/v2"


def _api_base() -> str:
    _, api_host = _zoho_hosts()
    return f"https://{api_host}/crm/v3"


def _api_base_v8() -> str:
    _, api_host = _zoho_hosts()
    return f"https://{api_host}/crm/v8"


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _casefold_key(value: Any) -> str:
    return _clean_text(value).casefold()


def _chunked(items: Sequence[dict], size: int) -> list[list[dict]]:
    return [list(items[i : i + size]) for i in range(0, len(items), size)]


def _display_name_parts(full_name: str) -> tuple[str, str]:
    parts = [part for part in _clean_text(full_name).split() if part]
    if not parts:
        return "", "Unknown"
    if len(parts) == 1:
        return "", parts[0]
    return " ".join(parts[:-1]), parts[-1]


def _dedupe_catalogue_items(items: list[dict], key_fn) -> list[dict]:
    seen: set[str] = set()
    deduped: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        key = key_fn(item)
        if not key:
            deduped.append(item)
            continue
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _product_key(item: dict) -> str:
    source_id = _source_record_id(item)
    if source_id:
        return f"zoho:{source_id}"
    return _casefold_key(item.get("name") or item.get("Product_Name"))


def _customer_key(item: dict) -> str:
    source_id = _source_record_id(item)
    if source_id:
        return f"zoho:{source_id}"
    return _casefold_key(item.get("email") or item.get("Email") or item.get("name") or item.get("First_Name"))


def _vendor_key(item: dict) -> str:
    source_id = _source_record_id(item)
    if source_id:
        return f"zoho:{source_id}"
    return _casefold_key(item.get("email") or item.get("Email") or item.get("name") or item.get("Vendor_Name"))


def _catalogue_key(kind: str, item: dict) -> str:
    if kind == "products":
        return _product_key(item)
    if kind == "customers":
        return _customer_key(item)
    return _vendor_key(item)


def _source_record_id(item: dict) -> str:
    return _clean_text(
        item.get("source_record_id")
        or item.get("external_id")
        or item.get("zoho_id")
        or item.get("integration_record_id")
    )


_IMPORT_FIELDS = {
    "Products": "Product_Name,Unit_Price,Product_Category,Description",
    "Contacts": "First_Name,Last_Name,Full_Name,Email,Phone,Mailing_Street,Industry",
    "Vendors": "Vendor_Name,Email,Phone,Street,Category",
    "Invoices": "Subject,Invoice_Number,Account_Name,Status,Grand_Total,Due_Date,Invoice_Date,Sub_Total,Tax",
    "Quotes": "Subject,Quote_Number,Account_Name,Quote_Stage,Grand_Total,Valid_Until,Quotation_Date,Sub_Total,Tax",
}


def _merge_non_empty(existing: dict, incoming: dict, *, keep_existing_keys: set[str] | None = None) -> dict:
    merged = dict(existing)
    keep_existing_keys = keep_existing_keys or set()
    for key, value in incoming.items():
        if key in keep_existing_keys:
            continue
        if value in (None, "", [], {}):
            continue
        merged[key] = value
    return merged


def _normalize_imported_product(item: dict, now_iso: str) -> dict:
    name = _clean_text(item.get("Product_Name") or item.get("name"))
    price = item.get("Unit_Price")
    category = _clean_text(item.get("Product_Category") or item.get("category") or item.get("type"))
    description = _clean_text(item.get("Description"))
    return {
        "id": item.get("id") or str(uuid4()),
        "name": name or "Unknown",
        "type": "product",
        "product_type": "product",
        "category": category or "Imported from Zoho",
        "base_price": float(price or 0),
        "cost_of_sales": 0,
        "discount": 0,
        "freight_cost": 0,
        "description": description,
        "archived": False,
        "source_system": "zoho_crm",
        "source_record_id": _clean_text(item.get("id")),
        "created_at": now_iso,
        "updated_at": now_iso,
    }


def _normalize_imported_contact(item: dict, now_iso: str) -> dict:
    first_name = _clean_text(item.get("First_Name"))
    last_name = _clean_text(item.get("Last_Name"))
    full_name = _clean_text(item.get("Full_Name") or item.get("Full Name") or item.get("name"))
    if not last_name:
        _, last_name = _display_name_parts(full_name)
    if not first_name and full_name:
        first_name, _ = _display_name_parts(full_name)
    email = _clean_text(
        item.get("Email")
        or item.get("Email_Address")
        or item.get("EmailAddress")
        or item.get("Secondary_Email")
        or item.get("mail")
    )
    return {
        "id": item.get("id") or str(uuid4()),
        "name": _clean_text(item.get("Full_Name") or item.get("name") or full_name) or "Imported Contact",
        "address": _clean_text(item.get("Mailing_Street") or item.get("Street") or item.get("Mailing Street")),
        "email": email,
        "phone_number": _clean_text(item.get("Phone")),
        "payment_terms": 14,
        "industry": _clean_text(item.get("Industry")),
        "first_name": first_name,
        "last_name": last_name or "Imported",
        "archived": False,
        "source_system": "zoho_crm",
        "source_record_id": _clean_text(item.get("id")),
        "created_at": now_iso,
        "updated_at": now_iso,
    }


def _normalize_imported_vendor(item: dict, now_iso: str) -> dict:
    name = _clean_text(item.get("Vendor_Name") or item.get("name"))
    email = _clean_text(item.get("Email") or item.get("Email_Address") or item.get("EmailAddress"))
    return {
        "id": item.get("id") or str(uuid4()),
        "name": name or "Imported Vendor",
        "address": _clean_text(item.get("Street")),
        "email": email,
        "phone_number": _clean_text(item.get("Phone")),
        "payment_terms": 14,
        "industry": _clean_text(item.get("Category")),
        "product_type": "product",
        "product_name": name or "Imported from Zoho",
        "price": 0,
        "archived": False,
        "source_system": "zoho_crm",
        "source_record_id": _clean_text(item.get("id")),
        "created_at": now_iso,
        "updated_at": now_iso,
    }


def _zoho_account_name(val: Any) -> str:
    if isinstance(val, dict):
        return _clean_text(val.get("name") or val.get("Name") or "")
    return _clean_text(val or "")


def _normalize_imported_invoice(item: dict, now_iso: str) -> dict:
    status_map = {
        "draft": "pending", "sent": "pending", "awaiting payment": "pending",
        "paid": "paid", "void": "cancelled", "cancelled": "cancelled", "overdue": "pending",
    }
    raw_status = _clean_text(item.get("Status") or "").lower()
    status = status_map.get(raw_status, "pending")
    subject = _clean_text(item.get("Subject") or item.get("Invoice_Number") or "Imported Invoice")
    grand_total = float(item.get("Grand_Total") or 0)
    sub_total = float(item.get("Sub_Total") or grand_total)
    tax = float(item.get("Tax") or 0)
    invoice_number = _clean_text(item.get("Invoice_Number") or "")
    return {
        "id": item.get("id") or str(uuid4()),
        "invoice_id": invoice_number or f"ZOHO-{item.get('id', '')[:8]}",
        "product_name": subject,
        "product_names": [subject],
        "items": [{"product_name": subject, "quantity": 1, "unit_price": sub_total, "subtotal": sub_total}],
        "quantity": 1,
        "subtotal_amount": sub_total,
        "vat_amount": tax,
        "vat_rate": round((tax / sub_total * 100) if sub_total else 0, 2),
        "total_amount": grand_total,
        "status": status,
        "customer_name": _zoho_account_name(item.get("Account_Name")),
        "issued_at": _clean_text(item.get("Invoice_Date") or now_iso[:10]),
        "due_date": _clean_text(item.get("Due_Date") or "") or None,
        "source_system": "zoho_crm",
        "source_record_id": _clean_text(item.get("id")),
        "created_at": now_iso,
        "updated_at": now_iso,
    }


def _normalize_imported_quote(item: dict, now_iso: str) -> dict:
    stage_map = {
        "draft": "pending", "": "pending", "delivered": "delivered",
        "accepted": "accepted", "rejected": "rejected", "expired": "expired", "on hold": "pending",
    }
    raw_stage = _clean_text(item.get("Quote_Stage") or "").lower()
    status = stage_map.get(raw_stage, "pending")
    subject = _clean_text(item.get("Subject") or item.get("Quote_Number") or "Imported Quote")
    grand_total = float(item.get("Grand_Total") or 0)
    sub_total = float(item.get("Sub_Total") or grand_total)
    tax = float(item.get("Tax") or 0)
    quote_number = _clean_text(item.get("Quote_Number") or "")
    return {
        "id": item.get("id") or str(uuid4()),
        "quotation_id": quote_number or f"ZOHO-QTE-{item.get('id', '')[:8]}",
        "product_name": subject,
        "product_names": [subject],
        "items": [{"product_name": subject, "quantity": 1, "unit_price": sub_total, "subtotal": sub_total}],
        "quantity": 1,
        "subtotal_amount": sub_total,
        "vat_amount": tax,
        "vat_rate": round((tax / sub_total * 100) if sub_total else 0, 2),
        "total_amount": grand_total,
        "status": status,
        "customer_name": _zoho_account_name(item.get("Account_Name")),
        "issued_at": _clean_text(item.get("Quotation_Date") or now_iso[:10]),
        "due_date": _clean_text(item.get("Valid_Until") or "") or None,
        "validity_days": 30,
        "source_system": "zoho_crm",
        "source_record_id": _clean_text(item.get("id")),
        "created_at": now_iso,
        "updated_at": now_iso,
    }


def _merge_financials_list(existing: list[dict], imported: list[dict]) -> list[dict]:
    """Merge imported Zoho invoices/quotes into existing financials list, matching by source_record_id."""
    current = [dict(item) for item in existing if isinstance(item, dict)]
    index: dict[str, int] = {}
    for i, item in enumerate(current):
        src_id = _clean_text(item.get("source_record_id"))
        if src_id:
            index[src_id] = i
    merged = list(current)
    for item in imported:
        src_id = _clean_text(item.get("source_record_id"))
        if src_id and src_id in index:
            existing_idx = index[src_id]
            merged[existing_idx] = _merge_non_empty(merged[existing_idx], item, keep_existing_keys={"id", "created_at"})
            merged[existing_idx]["updated_at"] = item["updated_at"]
        else:
            merged.insert(0, item)
            if src_id:
                index[src_id] = 0
                for k in list(index.keys()):
                    if k != src_id and index[k] >= 0:
                        index[k] += 1
    return merged


def _merge_catalogue_lists(existing: list[dict], imported: list[dict], *, kind: str, now_iso: str) -> list[dict]:
    current = [dict(item) for item in existing if isinstance(item, dict)]
    index: dict[str, int] = {}
    for i, item in enumerate(current):
        key = _catalogue_key(kind, item)
        if key:
            index[key] = i

    normalizer = {
        "products": _normalize_imported_product,
        "customers": _normalize_imported_contact,
        "vendors": _normalize_imported_vendor,
    }[kind]

    merged = list(current)
    for raw_item in imported:
        item = normalizer(raw_item, now_iso)
        key = _catalogue_key(kind, item)
        if key and key in index:
            existing_idx = index[key]
            merged[existing_idx] = _merge_non_empty(merged[existing_idx], item, keep_existing_keys={"id", "created_at"})
            merged[existing_idx]["archived"] = False
            merged[existing_idx]["updated_at"] = now_iso
        else:
            merged.insert(0, item)
            if key:
                index[key] = 0
                for k in list(index.keys()):
                    if k != key and index[k] >= 0:
                        index[k] += 1
    return _dedupe_catalogue_items(merged, lambda row: _catalogue_key(kind, row))


async def _upsert_records(
    *,
    module: str,
    records: list[dict],
    duplicate_check_fields: list[str],
    access_token: str,
) -> tuple[int, list[str], list[dict]]:
    if not records:
        return 0, [], []

    synced = 0
    errors: list[str] = []
    results: list[dict] = []
    async with httpx.AsyncClient(timeout=30) as client:
        for batch in _chunked(records, 100):
            payload: dict[str, Any] = {"data": batch}
            if duplicate_check_fields:
                payload["duplicate_check_fields"] = duplicate_check_fields
            resp = await client.post(
                f"{_api_base_v8()}/{module}/upsert",
                json=payload,
                headers=_headers(access_token),
            )
            resp.raise_for_status()
            data = resp.json().get("data") or []
            results.extend(data)
            for idx, result in enumerate(data):
                item = batch[idx] if idx < len(batch) else {}
                label = _clean_text(item.get("Product_Name") or item.get("Vendor_Name") or item.get("Email") or item.get("Last_Name") or item.get("name") or "Record")
                if result.get("status") == "success":
                    synced += 1
                else:
                    message = result.get("message") or result.get("code") or "Unknown error"
                    errors.append(f"{label}: {message}")
    return synced, errors, results


async def _fetch_records(module: str, access_token: str) -> list[dict]:
    records: list[dict] = []
    async with httpx.AsyncClient(timeout=30) as client:
        page = 1
        while True:
            params = {"page": page, "per_page": 200}
            fields = _IMPORT_FIELDS.get(module)
            if fields:
                params["fields"] = fields
            resp = await client.get(
                f"{_api_base_v8()}/{module}",
                params=params,
                headers=_headers(access_token),
            )
            resp.raise_for_status()
            if resp.status_code == 204 or not resp.text.strip():
                break
            try:
                payload = resp.json()
            except ValueError as exc:
                body = resp.text.strip()
                if not body:
                    break
                raise ValueError(f"{module}: invalid response from Zoho: {body[:120]}") from exc
            batch = payload.get("data") or []
            if not batch:
                break
            records.extend(batch)
            info = payload.get("info") or {}
            if not info.get("more_records") or len(batch) < 200:
                break
            page += 1
    return records


def auth_url(client_id: str, redirect_uri: str, state: str) -> str:
    from urllib.parse import urlencode
    params = {
        "scope": ZOHO_SCOPES,
        "client_id": client_id,
        "response_type": "code",
        "access_type": "offline",
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{_auth_base()}/auth?{urlencode(params)}"


async def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{_auth_base()}/token",
            params={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "code": code,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def _refresh(client_id: str, client_secret: str, token: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{_auth_base()}/token",
            params={
                "grant_type": "refresh_token",
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": token,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def _ensure_fresh(meta: dict, client_id: str, client_secret: str) -> tuple[str, dict | None]:
    expiry_str = meta.get("token_expiry")
    access = meta.get("access_token", "")
    refresh = meta.get("refresh_token", "")
    if not refresh:
        # No refresh token — nothing we can do; caller will hit 401 if access is expired
        return access, None
    now = datetime.now(timezone.utc)
    already_expired = False
    if expiry_str:
        try:
            expiry = datetime.fromisoformat(expiry_str)
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            already_expired = (expiry - now).total_seconds() < 0
            needs_refresh = (expiry - now).total_seconds() < 300
        except ValueError:
            needs_refresh = True
            already_expired = True
    else:
        # No expiry stored — always attempt a refresh
        needs_refresh = True
        already_expired = True
    if needs_refresh:
        try:
            new_tokens = await _refresh(client_id, client_secret, refresh)
            new_meta = {
                **meta,
                "access_token": new_tokens["access_token"],
                "refresh_token": new_tokens.get("refresh_token", refresh),
                "token_expiry": (now + timedelta(seconds=new_tokens.get("expires_in", 3600))).isoformat(),
            }
            return new_tokens["access_token"], new_meta
        except Exception as e:
            logger.warning("Zoho token refresh failed: %s", e)
            if already_expired:
                # Token is already expired and refresh failed — raise so the caller
                # can surface a useful "please reconnect" error instead of a silent 401
                raise RuntimeError(
                    "Zoho CRM access token has expired and could not be refreshed. "
                    "Please disconnect and reconnect Zoho CRM to generate a new token."
                ) from e
    return access, None


def _headers(access_token: str) -> dict:
    return {"Authorization": f"Zoho-oauthtoken {access_token}", "Content-Type": "application/json"}


async def sync_products(meta: dict, products: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str], dict[str, str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    outgoing = _dedupe_catalogue_items(
        [p for p in products if not p.get("archived")],
        _product_key,
    )
    records: list[dict[str, Any]] = []
    for p in outgoing:
        name = _clean_text(p.get("name"))
        if not name:
            continue
        records.append({
            "Product_Name": name,
            "Unit_Price": float(p.get("base_price", 0) or 0),
            "Product_Category": _clean_text(p.get("category") or p.get("type")) or "product",
            "Description": _clean_text(p.get("description")) or f"Cost of sales: {p.get('cost_of_sales', 0)}",
            **({"id": _source_record_id(p)} if _source_record_id(p) else {}),
        })
    synced, errors, results = await _upsert_records(module="Products", records=records, duplicate_check_fields=["Product_Name"], access_token=access)
    source_updates = {}
    for item, result in zip(outgoing, results):
        if result.get("status") != "success":
            continue
        zoho_id = _clean_text((result.get("details") or {}).get("id"))
        if zoho_id:
            source_updates[_catalogue_key("products", item)] = zoho_id
    return synced, errors, source_updates


async def sync_contacts(meta: dict, customers: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str], dict[str, str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    outgoing = _dedupe_catalogue_items(
        [c for c in customers if not c.get("archived")],
        _customer_key,
    )
    records: list[dict[str, Any]] = []
    for c in outgoing:
        name = _clean_text(c.get("name"))
        if not name and not _clean_text(c.get("email")):
            continue
        first_name, last_name = _display_name_parts(name or _clean_text(c.get("email")) or "Imported Contact")
        records.append({
            "First_Name": _clean_text(c.get("first_name")) or first_name,
            "Last_Name": _clean_text(c.get("last_name")) or last_name,
            "Email": _clean_text(c.get("email")),
            "Phone": _clean_text(c.get("phone_number")),
            "Mailing_Street": _clean_text(c.get("address")),
            "Industry": _clean_text(c.get("industry")),
            **({"id": _source_record_id(c)} if _source_record_id(c) else {}),
        })
    synced, errors, results = await _upsert_records(module="Contacts", records=records, duplicate_check_fields=["Email", "Phone"], access_token=access)
    source_updates = {}
    for item, result in zip(outgoing, results):
        if result.get("status") != "success":
            continue
        zoho_id = _clean_text((result.get("details") or {}).get("id"))
        if zoho_id:
            source_updates[_catalogue_key("customers", item)] = zoho_id
    return synced, errors, source_updates


async def sync_vendors(meta: dict, vendors: list[dict], client_id: str, client_secret: str) -> tuple[int, list[str], dict[str, str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    outgoing = _dedupe_catalogue_items(
        [v for v in vendors if not v.get("archived")],
        _vendor_key,
    )
    records: list[dict[str, Any]] = []
    for v in outgoing:
        name = _clean_text(v.get("name"))
        if not name:
            continue
        records.append({
            "Vendor_Name": name,
            "Email": _clean_text(v.get("email")),
            "Phone": _clean_text(v.get("phone_number")),
            "Street": _clean_text(v.get("address")),
            "Category": _clean_text(v.get("industry")),
            **({"id": _source_record_id(v)} if _source_record_id(v) else {}),
        })
    synced, errors, results = await _upsert_records(module="Vendors", records=records, duplicate_check_fields=["Email", "Phone", "Vendor_Name"], access_token=access)
    source_updates = {}
    for item, result in zip(outgoing, results):
        if result.get("status") != "success":
            continue
        zoho_id = _clean_text((result.get("details") or {}).get("id"))
        if zoho_id:
            source_updates[_catalogue_key("vendors", item)] = zoho_id
    return synced, errors, source_updates


def _apply_source_record_ids(items: list[dict], *, kind: str, source_updates: dict[str, str]) -> list[dict]:
    if not source_updates:
        return [dict(item) for item in items if isinstance(item, dict)]

    patched: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        key = _catalogue_key(kind, row)
        source_id = _clean_text(source_updates.get(key) or _source_record_id(row))
        if source_id:
            row["source_system"] = row.get("source_system") or "zoho_crm"
            row["source_record_id"] = source_id
        patched.append(row)
    return patched


async def import_catalogue(meta: dict, client_id: str, client_secret: str) -> tuple[dict[str, list[dict]], list[str]]:
    access, _ = await _ensure_fresh(meta, client_id, client_secret)
    errors: list[str] = []
    now = datetime.now(timezone.utc).isoformat()
    imported: dict[str, list[dict]] = {"products": [], "customers": [], "vendors": [], "invoices": [], "quotes": []}

    try:
        products = await _fetch_records("Products", access)
        imported["products"] = [_normalize_imported_product(row, now) for row in products]
    except Exception as e:
        errors.append(f"Products: {str(e)[:160]}")

    try:
        customers = await _fetch_records("Contacts", access)
        imported["customers"] = [_normalize_imported_contact(row, now) for row in customers]
    except Exception as e:
        errors.append(f"Contacts: {str(e)[:160]}")

    try:
        vendors = await _fetch_records("Vendors", access)
        imported["vendors"] = [_normalize_imported_vendor(row, now) for row in vendors]
    except Exception as e:
        errors.append(f"Vendors: {str(e)[:160]}")

    try:
        invoices = await _fetch_records("Invoices", access)
        imported["invoices"] = [_normalize_imported_invoice(row, now) for row in invoices]
    except Exception as e:
        errors.append(f"Invoices: {str(e)[:160]}")

    try:
        quotes = await _fetch_records("Quotes", access)
        imported["quotes"] = [_normalize_imported_quote(row, now) for row in quotes]
    except Exception as e:
        errors.append(f"Quotes: {str(e)[:160]}")

    return imported, errors
