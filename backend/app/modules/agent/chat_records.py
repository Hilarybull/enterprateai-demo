"""Read-only access to current business records for the main conversation."""
from fastapi import HTTPException


async def read_records(orch, user, business_id, args):
    from app.modules.agent.orchestrator import AccessDenied
    try:
        actor, _ = await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as exc:
        raise HTTPException(404, "Business not found.") from exc
    if not actor.can_view:
        raise HTTPException(403, "You do not have access to this business.")
    data = await orch.rt.business.load(business_id) or {}
    section = args.get("section")
    result = {"business_id": business_id, "section": section, "content_is_untrusted_data": True}
    if section == "profile":
        return {**result, "profile": data.get("workspace_profile") or {}, "name": data.get("name")}
    if section == "summary":
        from app.modules.agent import figures, business
        return {**result, "currency": business.currency_of(data), "summary": figures.of(data)}
    if section in {"customers", "products", "vendors"}:
        records = (data.get("catalogue") or {}).get(section) or []
    elif section in {"invoices", "expenses", "quotes", "receipts", "contracts"}:
        records = (data.get("financials") or {}).get(section) or []
    else:
        raise ValueError("Choose a supported business record section.")
    records = [record for record in records if isinstance(record, dict) and not record.get("archived")]
    offset, limit = max(0, int(args.get("offset") or 0)), min(30, max(1, int(args.get("limit") or 20)))
    return {**result, "records": records[offset:offset + limit], "total": len(records),
            "next_offset": offset + limit if offset + limit < len(records) else None}
