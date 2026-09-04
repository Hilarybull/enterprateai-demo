from types import SimpleNamespace
import unittest

from fastapi import HTTPException

from app.core.config import Settings
from app.core.feature_flags import ProposalFeature, is_proposal_feature_enabled, require_proposal_feature


class ProposalFeatureFlagTests(unittest.TestCase):
    def test_all_proposal_flags_are_disabled_by_default(self):
        settings = Settings()
        for feature in ProposalFeature:
            with self.subTest(feature=feature):
                self.assertFalse(is_proposal_feature_enabled(feature, settings=settings))

    def test_allowlist_narrows_enabled_feature(self):
        settings = SimpleNamespace(
            proposal_marketplace_exposure=False,
            proposal_request_publishing=False,
            proposal_upload_submission=False,
            proposal_generation=True,
            proposal_evaluation=False,
            proposal_intelligence=False,
            proposal_award_orchestration=False,
            proposal_feature_tenants="tenant-a",
            proposal_feature_cohorts="pilot",
        )
        self.assertTrue(is_proposal_feature_enabled(ProposalFeature.GENERATION, tenant_id="tenant-a", settings=settings))
        self.assertTrue(is_proposal_feature_enabled(ProposalFeature.GENERATION, cohort="pilot", settings=settings))
        self.assertFalse(is_proposal_feature_enabled(ProposalFeature.GENERATION, tenant_id="tenant-b", settings=settings))

    def test_allowlist_cannot_enable_disabled_feature(self):
        settings = SimpleNamespace(
            proposal_marketplace_exposure=False,
            proposal_request_publishing=False,
            proposal_upload_submission=False,
            proposal_generation=False,
            proposal_evaluation=False,
            proposal_intelligence=False,
            proposal_award_orchestration=False,
            proposal_feature_tenants="tenant-a",
            proposal_feature_cohorts="pilot",
        )
        self.assertFalse(is_proposal_feature_enabled(ProposalFeature.GENERATION, tenant_id="tenant-a", settings=settings))

    def test_disabled_feature_is_rejected_without_exposing_feature_state(self):
        with self.assertRaises(HTTPException) as context:
            require_proposal_feature(ProposalFeature.GENERATION, settings=Settings())
        self.assertEqual(context.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
