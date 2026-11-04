"""Everything an account owns, removed with it (the owner, 31 Oct: "I'm deleting users... it should clear everything he owns").

One routine for both ways an account is closed: by the person (Account settings) and by an admin (All Users). Each step is
best effort and logged: a table missing from a database, or a row another record still needs, never leaves the account half
open. Workspaces the account owns go with their business data; workspaces it was only a member of are left, without it.
Referral and payout records are kept: they are other people's earnings and the audit trail."""
from __future__ import annotations

import logging

from app.core.supabase import sb_delete, sb_select, sb_update

logger = logging.getLogger(__name__)

# A workspace's own records, by its id (business_id or workspace_id). Children before parents.
_BY_BUSINESS = ("agent_step_runs", "agent_approvals", "agent_events", "agent_audit_events", "agent_idempotency", "agent_receipts",
                "agent_next_receipt_seq", "agent_enquiries", "agent_plan_limits", "agent_policies", "agent_workflow_runs",
                "readiness_actions", "readiness_evidence", "readiness_assessments", "readiness_forecasts", "readiness_artifacts",
                "readiness_decisions", "readiness_subjects", "scenario_runs")
_BY_WORKSPACE = ("blueprint_documents", "idea_validation_results", "workspace_invitations", "workspace_members")
# The account's own records, by user_id. The credit history before its wallet.
_BY_USER = ("credit_transactions", "credit_wallets", "user_subscriptions", "user_platform_grants", "user_platform_restrictions",
            "integration_tokens", "blueprint_documents", "task_sessions", "workspace_members", "idea_validation_results",
            "idea_validation_usage")


async def _drop(table: str, column: str, value: str) -> None:
    try:
        await sb_delete(table, filters=[(column, "eq", value)])
    except Exception:      # noqa: BLE001 - a table not in this database, or a row still needed: said in the log, never fatal
        logger.warning("account purge: %s where %s=%s not cleared", table, column, value, exc_info=True)


async def purge_workspace(wid: str) -> None:
    """One workspace and its business data."""
    for table in _BY_BUSINESS:
        await _drop(table, "business_id", wid)
    for table in _BY_WORKSPACE:
        await _drop(table, "workspace_id", wid)
    await _drop("workspaces", "id", wid)
    try:      # its saved copies (Mongo), when that store is there
        from app.core.database import get_mongo_db
        await get_mongo_db()["workspace_snapshots"].delete_many({"workspace_id": wid})
    except Exception:      # noqa: BLE001
        pass


async def purge_account(user_id: str, email: str | None = None) -> None:
    """Remove the account's workspaces (with their business data), credits, plan, grants and documents. The account record
    itself is removed by the caller, after this."""
    try:
        owned = await sb_select("workspaces", filters=[("user_id", "eq", user_id)], columns="id") or []
    except Exception:      # noqa: BLE001
        owned = []
        logger.warning("account purge: workspaces of %s not read", user_id, exc_info=True)
    for ws in owned:
        wid = str(ws.get("id") or "")
        if not wid:
            continue
        await purge_workspace(wid)
    for table in _BY_USER:
        await _drop(table, "user_id", user_id)
    if email:
        await _drop("mailing_list", "email", email.lower())
    try:      # the one reference that doesn't follow the account
        await sb_update("workspace_invitations", payload={"accepted_by_user_id": None}, filters=[("accepted_by_user_id", "eq", user_id)])
    except Exception:      # noqa: BLE001
        pass
    logger.info("account purge: %s closed with %d workspace(s)", user_id, len(owned))
