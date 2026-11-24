"""New-User Test F1, F5, L1: a score is never more than what's in place."""
from decimal import Decimal

from app.modules.agent.converse import _NO_OTHER_SCORE
from app.modules.readiness import engine, rules

P = rules.PROFILES[rules.CURRENT[rules.LAUNCH]]
C2 = next(c for c in P["criteria"] if c["code"] == "C2")
DRAFT = "The Agent's draft (an estimate by the Agent; check it before you approve), accepted by you"


def _snapshot(prov, evidence=None):
    subject = {"id": "s1", "economics": {"price_per_unit": "60", "variable_cost_per_unit": "10"}, "provenance": prov}
    return {"subject": subject, "evidence": evidence or []}


def test_an_approved_estimate_counts_less_until_the_owner_changes_it_or_backs_it():
    both = {"economics.price_per_unit": {"source": DRAFT, "value": "60"}, "economics.variable_cost_per_unit": {"source": DRAFT, "value": "10"}}
    assert engine._estimated_share(P, C2, _snapshot(both)) == Decimal(1)
    # The owner typed their own cost: only the price is still an estimate
    changed = {**both, "economics.variable_cost_per_unit": {"source": DRAFT, "value": "9"}}
    assert engine._estimated_share(P, C2, _snapshot(changed)) == Decimal(1) / 2
    # Their own evidence backs the area; research doesn't
    link = [{"check": "C2.A", "subject_id": "s1"}]
    assert engine._estimated_share(P, C2, _snapshot(both, [{"id": "e", "type": "research", "links": link}])) == Decimal(1)
    assert engine._estimated_share(P, C2, _snapshot(both, [{"id": "e", "type": "document", "links": link}])) == Decimal(0)
    # What didn't come from an estimate never counts less
    records = {"economics.price_per_unit": {"source": "The Agent's draft (from your records), accepted by you", "value": "60"}}
    assert engine._estimated_share(P, C2, _snapshot(records)) == Decimal(0)


def test_estimates_count_for_half_in_the_score():
    checks = [{"state": "passed"}, {"state": "passed"}]
    criteria = [{"code": "C1", "weight": 50, "score": 100, "checks": checks}, {"code": "C2", "weight": 50, "score": 100, "checks": checks, "estimated": 1.0}]
    out = engine.classify(P, criteria, [])
    assert out["score"] == 75.0


def test_nothing_says_validated_about_what_nobody_checked():
    labels = " ".join(ch["label"] for c in P["criteria"] for ch in c["checks"])
    assert "validated" not in labels.lower()


def test_a_reply_says_one_score():
    said = "You're at 59/100 now. I saved your price. Next step: add your costs."
    assert "59" not in _NO_OTHER_SCORE.sub("", said) and "I saved your price" in _NO_OTHER_SCORE.sub("", said)
