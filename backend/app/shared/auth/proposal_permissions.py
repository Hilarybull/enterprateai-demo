from __future__ import annotations

from enum import StrEnum
from typing import Any, Mapping

from fastapi import HTTPException, status


class ProposalPermission(StrEnum):
    VIEW = "proposal.view"
    REQUEST_MANAGE = "request.manage"
    SUBMIT = "proposal.submit"
    REVIEW = "proposal.review"
    SHORTLIST = "proposal.shortlist"
    NEGOTIATE = "proposal.negotiate"
    AWARD = "proposal.award"
    CONTRACT_ACTIVATE = "contract.activate"
    MODERATION = "moderation"


def has_proposal_permission(
    *,
    user_id: str,
    workspace_id: str,
    permission: ProposalPermission,
    workspace: Mapping[str, Any] | None = None,
    membership: Mapping[str, Any] | None = None,
) -> bool:
    """Evaluate proposal access from server-resolved workspace records.

    Owners retain workspace access. Members require an explicit proposal action
    grant in the existing feature-permission payload. No browser-provided tenant
    or role value is accepted as authority by this policy function.
    """
    if not user_id or not workspace_id or not isinstance(permission, ProposalPermission):
        return False

    if workspace and str(workspace.get("id")) == workspace_id:
        if str(workspace.get("user_id")) == user_id:
            return True

    if not membership or str(membership.get("workspace_id")) != workspace_id:
        return False
    if str(membership.get("user_id")) != user_id:
        return False
    if str(membership.get("status", "active")).lower() in {"revoked", "inactive", "removed"}:
        return False
    if membership.get("permission_type") != "feature":
        return False

    permissions = membership.get("permissions")
    features = permissions.get("features") if isinstance(permissions, Mapping) else None
    if not isinstance(features, Mapping):
        return False

    granted = {
        str(value)
        for values in features.values()
        if isinstance(values, (list, tuple, set, frozenset))
        for value in values
    }
    return permission.value in granted


def require_proposal_permission(**kwargs: Any) -> None:
    if not has_proposal_permission(**kwargs):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Proposal permission denied",
        )
