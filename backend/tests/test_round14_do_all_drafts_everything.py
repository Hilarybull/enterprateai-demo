"""Do all is paid for: it drafts every field the checklist asks for, estimates included, for the owner to approve
(the owner, 29 Oct: "you can't charge me credits and still expect me to fill manually")."""
import asyncio

from app.modules.agent import research


class Model:
    def __init__(self):
        self.calls = []

    async def generate_text(self, system, prompt, feature, max_tokens):
        self.calls.append(system)
        estimate = "ESTIMATE" in system

        class R:
            text = ('{"fields": {"economics.price_per_unit": "1500", "market.owner": "The owner", "target_date": "2026-12-24",'
                    ' "control.review_date": "2027-01-21", "operations.process": "Orders by WhatsApp, delivered next day, paid on delivery.",'
                    ' "control.milestones": [{"outcome": "First batch made", "due_date": "2026-12-10", "owner": "The owner"}]}}'
                    if estimate else '{"fields": {"market.owner": "The owner"}}')
        return R()


def test_every_checklist_field_is_drafted_with_estimates_in_a_second_pass():
    m = Model()
    out = asyncio.run(research.draft_case_fields(m, "launch", {"currency": "NGN"}))
    assert len(m.calls) == 2 and "ESTIMATE" in m.calls[1]
    assert out["economics.price_per_unit"] == "1500" and out["target_date"] == "2026-12-24"
    assert out["control.review_date"] == "2027-01-21" and out["operations.process"].startswith("Orders by WhatsApp")
    assert out["control.milestones"][0]["due_date"] == "2026-12-10"
    for k in ("target_date", "operations.process", "market.owner", "control.review_date", "control.milestones",
              "delivery.capacity_available", "delivery.capacity_committed"):
        assert k in research.CASE_DRAFT_FIELDS["launch"]


def test_no_model_drafts_nothing():
    assert asyncio.run(research.draft_case_fields(None, "launch", {})) == {}
