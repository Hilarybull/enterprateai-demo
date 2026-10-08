from app.modules.addons.service import redact_rfqs, restore_locked_rfqs

RFQS = [
    {
        "id": "r1", "workspace_id": "w1", "customer_name": "Acme Ltd",
        "customer_email": "buyer@acme.test", "items": [{"name": "Widgets", "quantity": 40}],
        "message": "Need by Friday", "status": "pending", "created_at": "2026-09-01T00:00:00Z",
    },
    {
        "id": "r2", "workspace_id": "w1", "customer_name": "Beta Co",
        "customer_email": "ops@beta.test", "items": [], "message": None,
        "status": "rejected", "created_at": "2026-09-02T00:00:00Z",
    },
]


def test_redact_hides_buyer_and_request_details():
    out = redact_rfqs(RFQS)
    assert len(out) == 2
    for original, redacted in zip(RFQS, out):
        assert redacted["locked"] is True
        assert redacted["id"] == original["id"]
        assert redacted["status"] == original["status"]
        assert redacted["created_at"] == original["created_at"]
        assert redacted["customer_email"] == ""
        assert redacted["message"] is None
        assert original["customer_name"] not in str(redacted)
        assert "Widgets" not in str(redacted)


def test_restore_puts_back_originals_for_locked_entries():
    patch = redact_rfqs(RFQS)
    assert restore_locked_rfqs(patch, RFQS) == RFQS


def test_restore_keeps_unlocked_edits_and_new_entries():
    edited = {**RFQS[0], "status": "awarded"}
    new = {"id": "r3", "customer_name": "Gamma", "items": [], "status": "pending"}
    patch = [edited, redact_rfqs([RFQS[1]])[0], new]
    assert restore_locked_rfqs(patch, RFQS) == [edited, RFQS[1], new]


def test_restore_never_persists_orphan_placeholders():
    orphan = {"id": "gone", "locked": True}
    assert restore_locked_rfqs([orphan, RFQS[0]], RFQS) == [RFQS[0]]
