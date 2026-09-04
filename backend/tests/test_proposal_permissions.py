import unittest

from fastapi import HTTPException

from app.shared.auth.proposal_permissions import (
    ProposalPermission,
    has_proposal_permission,
    require_proposal_permission,
)


class ProposalPermissionTests(unittest.TestCase):
    def setUp(self):
        self.workspace = {"id": "ws-1", "user_id": "owner-1"}
        self.member = {
            "workspace_id": "ws-1",
            "user_id": "member-1",
            "permission_type": "feature",
            "permissions": {"features": {"proposals": ["proposal.review"]}},
        }

    def test_owner_has_proposal_permissions(self):
        self.assertTrue(has_proposal_permission(
            user_id="owner-1", workspace_id="ws-1",
            permission=ProposalPermission.AWARD, workspace=self.workspace,
        ))

    def test_member_needs_explicit_action_grant(self):
        self.assertTrue(has_proposal_permission(
            user_id="member-1", workspace_id="ws-1",
            permission=ProposalPermission.REVIEW, membership=self.member,
        ))
        self.assertFalse(has_proposal_permission(
            user_id="member-1", workspace_id="ws-1",
            permission=ProposalPermission.AWARD, membership=self.member,
        ))

    def test_mismatched_workspace_or_user_is_denied(self):
        self.assertFalse(has_proposal_permission(
            user_id="member-1", workspace_id="ws-2",
            permission=ProposalPermission.REVIEW, membership=self.member,
        ))
        self.assertFalse(has_proposal_permission(
            user_id="other-user", workspace_id="ws-1",
            permission=ProposalPermission.REVIEW, membership=self.member,
        ))

    def test_inactive_member_and_module_grant_are_denied(self):
        inactive = {**self.member, "status": "revoked"}
        module_grant = {**self.member, "permission_type": "module"}
        self.assertFalse(has_proposal_permission(
            user_id="member-1", workspace_id="ws-1",
            permission=ProposalPermission.REVIEW, membership=inactive,
        ))
        self.assertFalse(has_proposal_permission(
            user_id="member-1", workspace_id="ws-1",
            permission=ProposalPermission.REVIEW, membership=module_grant,
        ))

    def test_require_helper_returns_safe_forbidden(self):
        with self.assertRaises(HTTPException) as context:
            require_proposal_permission(
                user_id="member-1", workspace_id="ws-1",
                permission=ProposalPermission.AWARD, membership=self.member,
            )
        self.assertEqual(context.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()