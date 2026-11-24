"""The services on the workspace profile, in Catalogue > Products too (the owner's QA, 15 Oct).

A service saved on the profile (the workspace form, sign-up, or filled by the Agent) is added to the catalogue once, as a
service with no price yet, so it can be priced and used on quotes and invoices. Never a duplicate (same name, any case);
never added again once synced, so one the owner deleted from the catalogue does not come back."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any


def _norm(text: Any) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(text or "").lower()))


def add_profile_services(data: dict, now: datetime | None = None) -> list[str]:
    """Adds the profile's services that are not in the catalogue yet. Returns the names added."""
    now = now or datetime.now(timezone.utc)
    services = (data.get("workspace_profile") or {}).get("services") or []
    cat = data.setdefault("catalogue", {})
    products = cat.setdefault("products", [])
    have = {_norm(p.get("name")) for p in products if isinstance(p, dict)}
    synced = set(data.get("catalogue_synced_services") or [])
    added = []
    for s in services:
        name = " ".join(str((s.get("service_name") or s.get("name")) if isinstance(s, dict) else s or "").split())[:120]
        key = _norm(name)
        if len(key) < 2 or key in have or key in synced:
            continue
        category = str(s.get("category") or "").strip() if isinstance(s, dict) else ""
        products.insert(0, {"id": str(uuid.uuid4()), "name": name, "type": "service", **({"category": category} if category and category.lower() != "other" else {}),
                            "description": str((s.get("service_description") or s.get("description") or "") if isinstance(s, dict) else "")[:600],
                            "base_price": 0, "cost_of_sales": None, "discount": 0, "freight_cost": 0, "marketplace_listed": False, "archived": False,
                            "created_at": now.isoformat(), "from_profile": True, "provenance": f"From your business profile, {now.day} {now.strftime('%b')}"})
        have.add(key)
        synced.add(key)
        added.append(name)
    for s in services:      # already in the catalogue under the same name: counted as synced
        key = _norm((s.get("service_name") or s.get("name")) if isinstance(s, dict) else s)
        if key:
            synced.add(key)
    data["catalogue_synced_services"] = sorted(synced)
    return added
