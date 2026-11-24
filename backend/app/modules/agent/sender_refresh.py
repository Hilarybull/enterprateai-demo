"""After a workspace rename (the owner's QA, 16 Oct): the unsent drafts still showing the old name are listed, and their
sender is updated only when the owner chooses to. Sent documents are never changed."""
from __future__ import annotations

from typing import Any

DOCUMENT_TOOLS = ("send_invoice", "send_quotation", "send_receipt", "send_contract", "send_proposal", "send_purchase_order",
                  "send_credit_note", "send_payment_reminder")


async def drafts_with_old_name(orch, business_id: str, new_name: str) -> list[dict[str, Any]]:
    """The drafts waiting for approval whose sender is not the workspace's name now: [{id, reference, kind, company}]."""
    out = []
    for a in await orch.rt.store.list_approvals(business_id=business_id, status="pending"):
        p = a.get("payload") or {}
        if a.get("tool_id") in DOCUMENT_TOOLS and p.get("company") and str(p["company"]).strip() != str(new_name).strip():
            out.append({"id": a["id"], "reference": p.get("reference") or p.get("invoice_number") or "", "kind": a["tool_id"].replace("send_", ""),
                        "company": p.get("company")})
    return out


async def refresh_sender(orch, business_id: str, approval_ids: list[str]) -> list[str]:
    """The sender on the chosen drafts (still waiting for approval, in this workspace) set to the workspace as it is now:
    its name, contact details and logo. Returns the references updated."""
    from app.modules.agent import business as bz
    data = await orch.rt.business.load(business_id) or {}
    company = bz.company_of(data)
    wanted = {str(i) for i in approval_ids or []}
    done = []
    for a in await orch.rt.store.list_approvals(business_id=business_id, status="pending"):
        if str(a["id"]) not in wanted or a.get("tool_id") not in DOCUMENT_TOOLS:
            continue
        p = dict(a.get("payload") or {})
        p["company"] = company.get("name") or p.get("company")
        if "reply_to" in p and company.get("email"):
            p["reply_to"] = company["email"]
        if "company_details" in p:
            p["company_details"] = {**(p.get("company_details") or {}),
                                    **{k: company.get(k) for k in ("email", "phone", "website", "address", "vat_number", "registration_number") if company.get(k)}}
        await orch.rt.store.update_approval(a["id"], {"payload": p})
        done.append(p.get("reference") or p.get("invoice_number") or a["id"][:8])
    return done
