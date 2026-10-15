"""P2.17: the credit history, one friendly line per action: a hold and its commit are one line; a research refund is
netted into its run ("Funding research · 5 findings · 50 credits"); no codes, run ids, "held" or "committed"."""
import re

from app.modules.credits import ledger
from app.modules.credits.service import generation_uuid

G = generation_uuid("rr_42d519c09b84ac80")
TX = [
    {"id": "1", "transaction_type": "hold", "feature_code": "research_funding_readiness", "credits": -60, "generation_id": G, "created_at": "2026-10-15T07:19:03", "description": "Credits held for research_funding_readiness"},
    {"id": "2", "transaction_type": "deduction", "feature_code": "research_funding_readiness", "credits": -60, "generation_id": G, "created_at": "2026-10-15T07:19:04", "description": "Credits committed for research_funding_readiness"},
    {"id": "3", "transaction_type": "refund", "feature_code": None, "credits": 10, "generation_id": None, "created_at": "2026-10-15T07:19:04", "description": "Only 5 findings found [rr_42d519c09b84ac80:unused]"},
    {"id": "4", "transaction_type": "hold", "feature_code": "business_plan_full", "credits": -40, "generation_id": "g2", "created_at": "2026-10-15T08:00:00", "description": "Credits held for business_plan_full"},
    {"id": "5", "transaction_type": "deduction", "feature_code": "business_plan_full", "credits": -40, "generation_id": "g2", "created_at": "2026-10-15T08:00:01", "description": "Credits committed for business_plan_full"},
    {"id": "6", "transaction_type": "refund", "feature_code": None, "credits": 60, "created_at": "2026-10-15T09:00:00", "description": "Refunded: research found nothing"},
    {"id": "7", "transaction_type": "hold", "feature_code": "agent_quote_draft", "credits": -2, "generation_id": "g3", "created_at": "2026-10-15T10:00:00", "description": "Credits held for agent_quote_draft"},
]


def test_one_line_per_action_in_plain_words():
    lines = [ledger.line(a) for a in ledger.actions(TX)]
    assert lines == ["Quotation draft · 2 credits · Reserved", "Refunded: research found nothing · +60",
                     "Business plan · 40 credits · Used", "Funding research · 5 findings · 50 credits · Used"]
    said = " ".join(lines)
    assert not re.search(r"\bheld\b|\bcommitted\b|_full|agent_task|research_funding|rr_[0-9a-f]+|\bfield", said)


def test_who_did_it_is_said():
    by = {a["label"]: a["source"] for a in ledger.actions(TX)}
    assert by["Quotation draft"] == "by the Agent" and by["Business plan"] == "by you"
