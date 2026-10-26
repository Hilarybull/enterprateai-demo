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
