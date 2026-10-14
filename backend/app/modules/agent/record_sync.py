"""§1 (P3, R1, R2): an accepted value meets the business's own record.

When the owner accepts a figure in a review (a price, a cost per sale), the matching field of their own record (the
Catalogue item for the same offering) is looked at:
  - empty: it is filled, and said ("Saved to your Catalogue · Undo"); Undo puts the empty field back, and both are logged;
  - the same value: nothing to do;
  - a different value: nothing is written. The owner is asked: update the Catalogue (needs write permission), or use the
    accepted value for this launch or funding case only. Until then it is used for the case only.
Forecast figures (sales a month, fixed costs) are never written into the business's actual records."""
from __future__ import annotations

import uuid
from typing import Any

# Accepted value -> (where it lives on the business's own record, the field, words for it)
RECORD_FIELDS = {"price": ("Catalogue", "base_price", "price"), "cost": ("Catalogue", "cost_of_sales", "cost per sale")}


def _same_money(a: Any, b: Any) -> bool:
    try:
        return abs(float(a) - float(b)) < 0.005
    except (TypeError, ValueError):
        return False


def _blank(v: Any) -> bool:
    return v in (None, "") or (isinstance(v, (int, float)) and float(v) == 0)


def product_for(data: dict, offering: str) -> dict | None:
    """The Catalogue item the accepted figure is about: the one named like the offering, or the only one there is."""
    from app.modules.agent import answer_memory
    products = [p for p in (data.get("catalogue") or {}).get("products") or [] if isinstance(p, dict) and p.get("name")]
    named = [p for p in products if offering and answer_memory.same_offering(p.get("name"), offering)]
    if len(named) == 1:
        return named[0]
    return products[0] if len(products) == 1 and not named else None


def _log(data: dict, entry: dict) -> dict:
    entry = {"id": uuid.uuid4().hex, **entry}
    data.setdefault("record_changes", []).append(entry)
    return entry


def sync(data: dict, accepted: dict[str, float], offering: str, case: str, now: str, by: str, money=lambda v: f"{v:,.2f}") -> dict:
    """{"saved": [...], "conflicts": [...]}. Mutates `data` only to fill an empty field (with its Undo record)."""
    saved, conflicts = [], []
    product = product_for(data, offering)
    for field, value in (accepted or {}).items():
        where = RECORD_FIELDS.get(field)
        if not where or value is None or not product:
            continue
        record, column, words = where
        current = product.get(column)
        if _blank(current):
            product[column] = float(value)
            change = _log(data, {"record": record, "product_id": product.get("id"), "field": column, "before": current, "after": float(value),
                                 "at": now, "by": by, "source": f"accepted in your {case}", "undone": False})
            saved.append({"field": field, "record": record, "name": product.get("name"), "value": float(value), "undo_id": change["id"],
                          "message": f"Saved to your {record}: {product.get('name')} {words} {money(float(value))}."})
        elif not _same_money(current, value):
            conflicts.append({"field": field, "record": record, "name": product.get("name"), "product_id": product.get("id"), "column": column,
                              "current": float(current), "value": float(value), "choice": None,
                              "question": f"Update your {record} {words} for {product.get('name')} from {money(float(current))} to {money(float(value))}, "
                                          f"or use {money(float(value))} for this {case} only?"})
    return {"saved": saved, "conflicts": conflicts}


def choose(data: dict, conflict: dict, choice: str, now: str, by: str) -> dict:
    """The owner's answer to a conflict: "update" writes the record (logged, with Undo); "case_only" leaves it as it is."""
    if choice == "case_only":
        conflict.update({"choice": "case_only", "decided_at": now, "decided_by": by})
        return {"changed": False}
    if choice != "update":
        raise ValueError(choice)
    product = next((p for p in (data.get("catalogue") or {}).get("products") or [] if str(p.get("id")) == str(conflict.get("product_id"))), None)
    if not product:
        raise KeyError(conflict.get("product_id"))
    before = product.get(conflict["column"])
    product[conflict["column"]] = conflict["value"]
    change = _log(data, {"record": conflict["record"], "product_id": product.get("id"), "field": conflict["column"], "before": before, "after": conflict["value"],
                         "at": now, "by": by, "source": "updated by the owner from a review", "undone": False})
    conflict.update({"choice": "update", "decided_at": now, "decided_by": by, "undo_id": change["id"]})
    return {"changed": True, "undo_id": change["id"]}


def undo(data: dict, change_id: str, now: str, by: str) -> dict:
    """Put the field back as it was, unless it has been changed since (then nothing is overwritten). Logged either way."""
    change = next((c for c in data.get("record_changes") or [] if c.get("id") == change_id), None)
    if not change:
        raise KeyError(change_id)
    if change.get("undone"):
        return {"undone": False, "reason": "already undone"}
    product = next((p for p in (data.get("catalogue") or {}).get("products") or [] if str(p.get("id")) == str(change.get("product_id"))), None)
    if not product or not _same_money(product.get(change["field"]), change["after"]):
        return {"undone": False, "reason": "it has been changed since, so it was left as it is"}
    product[change["field"]] = change["before"]
    change.update({"undone": True, "undone_at": now, "undone_by": by})
    _log(data, {"record": change["record"], "product_id": change["product_id"], "field": change["field"], "before": change["after"], "after": change["before"],
                "at": now, "by": by, "source": f"undo of {change_id}", "undone": False})
    return {"undone": True}
