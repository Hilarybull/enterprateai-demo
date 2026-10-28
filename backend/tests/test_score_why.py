"""The owner, 28 Oct: "When the score changes, say why" (80 → 73 with no explanation)."""
from app.modules.readiness.service import ReadinessService


def _run(states, profile="p2"):
    return {"data": {"profile": profile, "result": {"criteria": [{"checks": [{"code": c, "label": f"Check {c}", "state": s} for c, s in states.items()]}]}}}


def test_the_checks_that_moved_are_named():
    why = ReadinessService.score_why(_run({"a": "passed", "b": "missing", "c": "passed"}), _run({"a": "missing", "b": "passed", "c": "passed"}))
    assert why == {"met": ["Check a"], "lost": ["Check b"], "checklist": False}
    assert ReadinessService.score_why(_run({"a": "passed"}), _run({"a": "passed"}, profile="p1"))["checklist"] is True


def test_waiting_drafts_follow_todays_rules_as_shown():
    """The owner, 28 Oct: old drafts showed invented figures, old chat answers and wrong tags; the owner should be the person
    the case names."""
    case = {"target_amount": 25000000, "market": {"acquisition_owner": "Hilary"},
            "agent_drafts": {"market.location": {"value": "Lekki", "source": "from your funding chat"},
                             "traction.summary": {"value": "About ₦1,200,000 a month from 40 sales", "source": "from your records and research"},
                             "market.target_segment": {"value": "Busy professionals", "source": "your research (not adopted yet)"},
                             "team.responsibilities": {"value": [{"area": "Sales", "owner": "You, as the owner"}], "source": "suggested by the Agent"},
                             "summary": {"value": "Assumed demand, not specified in FACTS", "source": "suggested by the Agent"}}}
    out = ReadinessService.drafts_now(case, {})
    assert set(out) == {"market.target_segment", "team.responsibilities"}      # the chat answer, the invented figure and the leak left out
    assert out["market.target_segment"]["source"] == "from external research"
    assert out["team.responsibilities"]["value"] == [{"area": "Sales", "owner": "Hilary"}]


def test_a_money_draft_the_plan_does_not_hold_is_left_out():
    """The owner, 28 Oct: launch drafts with a channel budget of ₦60,000 and a ₦4,000 price against the plan's ₦1,000."""
    plan = {"economics": {"price_per_unit": 1000},
            "agent_drafts": {"economics.price_per_unit": {"value": 4000, "source": "from external research"},
                             "market.budget": {"value": 60000, "source": "suggested by the Agent"},
                             "economics.fixed_costs_monthly": {"value": "40000.0", "source": "from external research"},
                             "delivery.notes": {"value": "Two staff on weekends", "source": "suggested by the Agent"}}}
    out = ReadinessService.drafts_now(plan, {})
    assert set(out) == {"economics.fixed_costs_monthly", "delivery.notes"}      # sourced research for an empty field stays


def test_existing_launch_drafts_with_figures_not_on_record_are_left_out_and_money_reads_as_money():
    """The owner, 28 Oct: still ₦60,000 channel budget, "4000 NGN" against a ₦1,000 plan price, "20,000 NGN revenue"."""
    plan = {"currency": "NGN", "economics": {"price_per_unit": 1000, "fixed_costs_monthly": 60000},
            "provenance": {"economics.fixed_costs_monthly": {"value": 60000, "source": "your research (not adopted yet)"}},
            "agent_drafts": {"market.channels": {"value": "Instagram ads with a ₦60,000 channel budget", "source": "suggested by the Agent"},
                             "economics.price_per_unit": {"value": "4000 NGN", "source": "from external research"},
                             "traction.summary": {"value": "About 20,000 NGN revenue in the first month", "source": "suggested by the Agent"},
                             "offer.summary": {"value": "Interior cleaning at 1000 NGN a car", "source": "suggested by the Agent"}}}
    out = ReadinessService.drafts_now(plan, {})
    assert set(out) == {"offer.summary"}      # research's own ₦60,000 on the plan is not a record
    assert out["offer.summary"]["value"] == "Interior cleaning at ₦1,000 a car"
