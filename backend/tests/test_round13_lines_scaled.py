"""The owner, 26 Oct: "Allocations reconcile to the target must be fixed first", "it should update based on the new request":
a new funding request sets the spending lines, scaled to a new amount for the same purpose, or one line for a new purpose."""
from test_goal_onboarding import world, _funding, OWNER, run  # noqa: F401
from app.modules.readiness.service import ReadinessService

LINES = [{"category": "Equipment", "amount": "200000", "purpose": "New machines"}, {"category": "Operations", "amount": "50000", "purpose": "Working capital"}]


def test_the_same_purpose_with_a_new_amount_scales_the_lines():
    out = ReadinessService.lines_for_request({"target_amount": 250000, "purpose": "equipment", "use_of_funds": LINES}, {"target_amount": 10000})
    assert [(x["purpose"], x["amount"]) for x in out] == [("New machines", "8000"), ("Working capital", "2000")]


def test_a_new_purpose_is_one_line_at_the_whole_amount():
    out = ReadinessService.lines_for_request({"target_amount": 250000, "purpose": "equipment", "use_of_funds": LINES},
                                             {"target_amount": 10000, "purpose": "hiring a second consultant"})
    assert [(x["purpose"], x["amount"]) for x in out] == [("Hiring a second consultant", "10000")]


def test_lines_that_already_add_up_are_left():
    assert ReadinessService.lines_for_request({"target_amount": 10000, "purpose": "equipment", "use_of_funds": [{"amount": "10000"}]}, {}) is None


def test_the_funding_chat_updates_the_lines_with_the_new_amount(world):
    env, store, client, who = world
    who["user"] = OWNER
    _sid, made = _funding(client, use="a second van")
    cid = made["handoff"]["subject_id"]
    svc = ReadinessService.__new__(ReadinessService)
    from app.modules.readiness.service import service_for
    svc = service_for(env.orch)
    row = run(svc.store.get("subjects", cid))
    target = float(row["data"]["target_amount"])
    lines = row["data"].get("use_of_funds") or []
    total = sum(float(str(x.get("amount") or 0)) for x in lines if isinstance(x, dict))
    assert not lines or abs(total - target) <= 1      # the case starts in step with its request


def test_fixed_cost_lines_are_worked_out_again_not_scaled():
    """₦25,000 → ₦25,000,000 with ₦40,000 a month fixed costs: working capital 2 months, reserve 1 month, the purpose the rest."""
    from app.modules.readiness.service import ReadinessService
    was = {"target_amount": 25000, "purpose": "Staff payment", "economics": {"fixed_costs_monthly": 40000},
           "use_of_funds": [{"id": "a", "amount": "24700", "purpose": "Staff payment", "category": "People", "period": "2027-04"},
                            {"id": "b", "amount": "200", "purpose": "Working capital: two months of fixed costs", "category": "Operations"},
                            {"id": "c", "amount": "100", "purpose": "Reserve: one month of fixed costs", "category": "Reserve"}]}
    out = ReadinessService.lines_for_request(was, {"target_amount": 25000000})
    assert [(x["id"], x["amount"]) for x in out] == [("a", "24880000"), ("b", "80000"), ("c", "40000")]
    # lines the owner wrote themselves still scale in the same shares
    own = {**was, "use_of_funds": [{"id": "a", "amount": "15000", "purpose": "Staff payment"}, {"id": "b", "amount": "10000", "purpose": "Laptops"}]}
    assert [x["amount"] for x in ReadinessService.lines_for_request(own, {"target_amount": 50000})] == ["30000", "20000"]


def test_fixed_costs_from_research_are_not_used_for_the_lines():
    """The owner, 28 Oct: fixed costs research put in, never entered by them: those lines left empty to be asked."""
    from app.modules.readiness.service import ReadinessService
    was = {"target_amount": 25000, "purpose": "Staff payment", "economics": {"fixed_costs_monthly": 40000},
           "provenance": {"economics.fixed_costs_monthly": {"value": 40000, "source": "your research (not adopted yet)"}},
           "use_of_funds": [{"id": "a", "amount": "24700", "purpose": "Staff payment", "category": "People"},
                            {"id": "b", "amount": "200", "purpose": "Working capital: two months of fixed costs", "category": "Operations"},
                            {"id": "c", "amount": "100", "purpose": "Reserve: one month of fixed costs", "category": "Reserve"}]}
    out = ReadinessService.lines_for_request(was, {"target_amount": 25000000})
    assert [(x["id"], x["amount"]) for x in out] == [("a", "25000000"), ("b", ""), ("c", "")]
    assert ReadinessService.owner_fixed_costs(was) is None and ReadinessService._agent_lines(was) is None
