from __future__ import annotations

from enum import StrEnum
from typing import Any

from fastapi import HTTPException, status

from app.core.config import get_settings


class ProposalFeature(StrEnum):
    MARKETPLACE_EXPOSURE = "marketplace_exposure"
    REQUEST_PUBLISHING = "request_publishing"
    UPLOAD_SUBMISSION = "upload_submission"
    GENERATION = "generation"
    EVALUATION = "evaluation"
    INTELLIGENCE = "intelligence"
    AWARD_ORCHESTRATION = "award_orchestration"


_FLAG_SETTINGS: dict[ProposalFeature, str] = {
    ProposalFeature.MARKETPLACE_EXPOSURE: "proposal_marketplace_exposure",
    ProposalFeature.REQUEST_PUBLISHING: "proposal_request_publishing",
    ProposalFeature.UPLOAD_SUBMISSION: "proposal_upload_submission",
    ProposalFeature.GENERATION: "proposal_generation",
    ProposalFeature.EVALUATION: "proposal_evaluation",
    ProposalFeature.INTELLIGENCE: "proposal_intelligence",
    ProposalFeature.AWARD_ORCHESTRATION: "proposal_award_orchestration",
}


def _csv_values(value: str | None) -> frozenset[str]:
    return frozenset(item.strip() for item in (value or "").split(",") if item.strip())


def is_proposal_feature_enabled(
    feature: ProposalFeature,
    *,
    tenant_id: str | None = None,
    cohort: str | None = None,
    settings: Any | None = None,
) -> bool:
    """Resolve a proposal flag server-side for an optional tenant/cohort rollout.

    A tenant or cohort allowlist can narrow an enabled flag, but cannot enable one
    while its global setting is false.
    """
    settings = settings or get_settings()
    if not bool(getattr(settings, _FLAG_SETTINGS[feature])):
        return False

    allowed_tenants = _csv_values(getattr(settings, "proposal_feature_tenants", ""))
    allowed_cohorts = _csv_values(getattr(settings, "proposal_feature_cohorts", ""))
    if not allowed_tenants and not allowed_cohorts:
        return True
    return (tenant_id is not None and tenant_id in allowed_tenants) or (
        cohort is not None and cohort in allowed_cohorts
    )


def require_proposal_feature(
    feature: ProposalFeature,
    *,
    tenant_id: str | None = None,
    cohort: str | None = None,
    settings: Any | None = None,
) -> None:
    if not is_proposal_feature_enabled(
        feature,
        tenant_id=tenant_id,
        cohort=cohort,
        settings=settings,
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Proposal Intelligence feature is not available",
        )
