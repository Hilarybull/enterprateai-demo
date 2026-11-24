"""The owner, 26 Oct: the funding title still said "grant" after the route became equity; the launch title was the whole
company description."""
from test_readiness import Env, funding_case, run, OWNER, F
from app.modules.agent.goals import launch_title, need_title


def test_the_launch_title_is_short():
    said = {"sell": "We produce and sell bottled organic red palm oil to shops, restaurants and households in Lagos, Nigeria.", "where": "Lagos, Nigeria"}
    assert launch_title(said) == "Bottled organic red palm oil, Lagos, Nigeria"
    assert launch_title({"sell": "Car wash subscription", "where": "Abuja"}) == "Car wash subscription, Abuja"


def test_the_funding_title_follows_a_new_route_and_a_written_one_is_kept():
    env = Env()
    svc, cid = funding_case(env)
    case = run(svc.get_subject(OWNER, "A", F, cid))
    auto = need_title({**case["data"], "route_preference": "grant"})      # named as the Agent names a grant need
    run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"title": auto, "route_preference": "grant"}))
    case = run(svc.get_subject(OWNER, "A", F, cid))
    out = run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"route_preference": "equity"}))
    assert "equity" in out["data"]["title"] and "grant" not in out["data"]["title"]
    case = run(svc.get_subject(OWNER, "A", F, cid))
    run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"title": "My own name for it"}))
    case = run(svc.get_subject(OWNER, "A", F, cid))
    out = run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"route_preference": "loan"}))
    assert out["data"]["title"] == "My own name for it"
