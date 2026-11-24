"""A2: validating a second idea from chat leaves the business's own idea, profile and validation byte-identical; the new
idea gets its own record (merged, never replaced), and nothing about it is borrowed from the business or another plan."""
import copy
import json

from test_agent import OWNER, Env, run

IDEA_A = {"workspace_profile": {"description": "Office deep cleaning for small businesses in Leeds", "target_customer": "Small offices in Leeds",
                                "problem": "Offices are cleaned badly by agencies", "city": "Leeds", "country": "United Kingdom"},
          "validation": {"overall_score": 72, "classification": "promising", "source": "wizard"},
          "launch_plans": [{"id": "lp1", "offering": "Office deep cleaning", "target_customer": "Small offices in Leeds"}]}


def _env():
    env = Env(plan="starter_insight", credits=50)
    env.businesses["A"]["data"].update(copy.deepcopy(IDEA_A))
    return env


def _answer_all(env, r):
    for _ in range(4):
        q = r.get("pending_question")
        if not q:
            return r
        asked = {f["key"] for f in q["fields"]}
        r = run(env.orch.provide_input(r["id"], OWNER, {k: {"customer": "Busy dog owners in Leeds", "problem": "Dogs hate the salon trip"}.get(k, "x") for k in asked}))
        r["_asked"] = sorted(asked | set(r.get("_asked") or []))
    return r


def test_a_second_idea_leaves_the_first_byte_identical_and_gets_its_own_record():
    env = _env()
    data = env.businesses["A"]["data"]
    before = {k: json.dumps(data.get(k), sort_keys=True) for k in ("workspace_profile", "validation", "launch_plans")}
    r = env.submit(text="Validate my idea: a mobile dog grooming van")["run"]
    q = r.get("pending_question") or {}
    # Nothing about it is taken from the business or its launch plan ("Is this your customer?" from another idea).
    assert "Small offices" not in json.dumps(q) and "Office deep cleaning" not in json.dumps(q)
    r = _answer_all(env, r)
    assert r["status"] == "succeeded"
    after = {k: json.dumps(data.get(k), sort_keys=True) for k in ("workspace_profile", "validation", "launch_plans")}
    assert after == before
    [record] = data["agent_ideas"].values()
    assert record["description"] == "Mobile dog grooming van" and len(record["results"]) == 1 and record["results"][0]["score"] == 68
    [call] = [c for c in env.orch.rt.studio.calls if c[0] == "validate_idea"]
    assert call[1]["description"] == "Mobile dog grooming van" and call[1]["customer"] == "Busy dog owners in Leeds"


def test_validating_the_same_idea_again_adds_a_result_and_replaces_nothing():
    env = _env()
    data = env.businesses["A"]["data"]
    for _ in range(2):
        _answer_all(env, env.submit(text="Validate my idea: a mobile dog grooming van")["run"])
    [record] = data["agent_ideas"].values()
    assert len(record["results"]) == 2 and data["validation"]["overall_score"] == 72


def test_the_business_s_own_offer_is_still_validated_as_the_business():
    env = _env()
    data = env.businesses["A"]["data"]
    _answer_all(env, env.submit(text="Validate my idea: office deep cleaning for small businesses in Leeds")["run"])
    assert "agent_ideas" not in data and data["validation"]["overall_score"] == 72      # merged: the existing score is kept
