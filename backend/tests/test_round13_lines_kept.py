"""The owner, 25 Oct: a new amount never changes the use-of-funds lines; the case shows them against the new amount."""
from test_goal_onboarding import world, _funding, OWNER, run  # noqa: F401
from app.modules.readiness import rules
from app.modules.readiness.service import service_for

LINES = [{"category": "Equipment", "amount": "30000", "purpose": "A second van"}, {"category": "Operations", "amount": "20000", "purpose": "Hiring one cleaner"}]


def _case(env, client, who):
    who["user"] = OWNER
    svc = service_for(env.orch)
    _sid, made = _funding(client, use="a second van and hiring one cleaner")
    cid = made["handoff"]["subject_id"]
    row = run(svc.store.get("subjects", cid))
    run(svc.update_subject(OWNER, "A", rules.FUNDING, cid, row["revision"], {"use_of_funds": LINES}, OWNER))
    return svc, cid


def _lines(svc, cid):
    return [(x["purpose"], x["amount"]) for x in run(svc.store.get("subjects", cid))["data"].get("use_of_funds") or []]


def test_a_new_amount_for_the_same_purpose_keeps_the_lines(world):
    env, store, client, who = world
    svc, cid = _case(env, client, who)
    sid, asked = _funding(client, amount=45000, use="a second van and hiring one cleaner")
    client.post(f"/task-sessions/{sid}/inputs", json={"answers": {"subject_choice": asked["choose"]["default"]}})      # Replace, the default
    client.post(f"/task-sessions/{sid}/prepare")
    data = run(svc.store.get("subjects", cid))["data"]
    assert float(data["target_amount"]) == 45000
    assert _lines(svc, cid) == [("A second van", "30000"), ("Hiring one cleaner", "20000")]      # never rescaled for you


def test_a_different_purpose_still_sets_the_old_lines_aside(world):
    env, store, client, who = world
    svc, cid = _case(env, client, who)
    sid, asked = _funding(client, amount=80000, use="a second site")
    client.post(f"/task-sessions/{sid}/inputs", json={"answers": {"subject_choice": asked["choose"]["default"]}})
    client.post(f"/task-sessions/{sid}/prepare")
    data = run(svc.store.get("subjects", cid))["data"]
    assert ("A second van", "30000") not in _lines(svc, cid) and data["previous_needs"][0]["set_aside"]["use_of_funds"]


def test_a_new_purpose_offers_lines_named_for_it_never_changes_them(world):
    """The owner, 25 Oct: "N10m grant for new equipments" kept a line "Hiring staff". The lines stay; renamed ones are offered."""
    env, store, client, who = world
    svc, cid = _case(env, client, who)
    row = run(svc.store.get("subjects", cid))
    run(svc.update_subject(OWNER, "A", rules.FUNDING, cid, row["revision"], {"purpose": "new equipment",
                                                                             "use_of_funds": [{"id": "l1", "category": "Other", "amount": "50000", "purpose": "Hiring staff"}]}, OWNER))
    run(svc.get_subject(OWNER, "A", rules.FUNDING, cid, OWNER))      # opened
    data = run(svc.store.get("subjects", cid))["data"]
    assert [x["purpose"] for x in data["use_of_funds"]] == ["Hiring staff"]                      # never changed for the owner
    offered = data["agent_drafts"]["use_of_funds"]
    assert [(x["purpose"], x["amount"], x["category"]) for x in offered["value"]] == [("New equipment", "50000", "Equipment")]
    assert offered["replaces"][0]["purpose"] == "Hiring staff"
