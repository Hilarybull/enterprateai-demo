"""What the Agent prepares by itself for launch, funding and registration: it refreshes checks
that are out of date, lists the gaps in the launch evidence, drafts the funding pack and
prepares the registration checklist. The Agent card shows the outcome, never an instruction."""
import pytest

from app.modules.agent import autostart
from app.modules.agent import config as agent_config
from app.modules.agent import router as agent_router
from app.modules.readiness import rules as rr
from test_agent import OWNER, Env, run
from test_agent_owner_rule import chores
from test_readiness import L, _pre, _suggestion, assess, day, funding_case, launch

PREP = ("readiness_refresh", "launch_evidence_gaps", "funding_pack_draft", "registration_checklist")


def only(env, *keys):
    """Automatic starting on for just these items, so each test sees what it is about."""
    off = {k: False for k in autostart.ITEMS if k not in keys and k != "rfq_arrives"}
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "items": off}}, OWNER))


def started(env):
    return {r["workflow_key"]: r for r in run(autostart.sweep(env.orch, "A"))}


# ══ the four capabilities ═════════════════════════════════════════════════════

@pytest.mark.parametrize("capability", PREP)
@pytest.mark.parametrize("plan", agent_config.PLAN_ORDER)
def test_each_checks_the_plan_like_every_other_agent_task(plan, capability):
    env = Env(plan=plan)
    res = env.submit(capability=capability, channel="ui_action")
    if not agent_config.plan_allows(plan, capability):
        assert res["kind"] == "blocked" and res["reason_codes"] == ["plan_capability"] and run(env.store.list_runs("A")) == []
    else:
        assert res["kind"] == "workflow" and res["run"]["status"] == "succeeded"
        assert agent_router._public_run(res["run"])["credits_used"] == (2 if (res["run"].get("state") or {}).get("task_charged") else 0)      # the task price once, when it did something; nothing when there was nothing to do


def test_with_nothing_on_record_each_says_exactly_what_it_needs_and_prepares_nothing():
    env = Env()
    said = {c: env.submit(capability=c, channel="ui_action")["run"]["summary"] for c in PREP}
    assert said["readiness_refresh"] == "Your readiness checks are up to date: nothing has changed since the last check."
    assert said["launch_evidence_gaps"] == "Launch evidence is checked against a launch plan, and you haven't started one yet."
    assert said["funding_pack_draft"] == "I need a funding case before the funding pack can be drafted, and there isn't one on record yet."
    assert said["registration_checklist"].startswith("Registration checklist ready: 12 things to have in place. First: Confirm business name availability;")
    assert chores(said.values()) == []


def test_a_registered_business_gets_no_registration_checklist():
    env = Env()
    env.businesses["A"]["data"]["workspace_profile"]["registration_number"] = "12345678"
    r = env.submit(capability="registration_checklist", channel="ui_action")["run"]
    assert r["summary"] == "Your business is registered (company number 12345678), so there is no registration checklist to prepare."
    only(env, "registration_checklist")
    assert started(env) == {}


def test_the_launch_gaps_are_listed_from_the_check_and_the_first_check_is_run_by_the_agent():
    env = Env()
    svc, lid = launch(env, forecast=False)                                # a launch on record that has never been checked
    only(env, "launch_evidence_gaps")
    r = started(env)["launch_evidence_gaps"]
    assert r["status"] == "succeeded" and r["source_reference"] == f"launch:gaps:first:{lid}"
    out = r["state"]["outcome"]
    assert out["gaps"] and r["summary"].startswith(f"{len(out['gaps'])} thing") and out["gaps"][0] in r["summary"]
    assert out["links"][0]["to"] == f"/launch/{lid}?tab=evidence" and r["next_action"] == "I'll check again as soon as any of these is filled in."
    assert len(run(svc.history(OWNER, "A", rr.LAUNCH, lid))) == 1         # the Agent ran the check; the owner never pressed anything
    assert started(env) == {}                                             # listed once for that result
    # A launch with everything in place: nothing is missing, and nothing is started for it.
    ready = Env()
    svc2, lid2 = launch(ready)
    assess(svc2, lid2, L)
    only(ready, "launch_evidence_gaps")
    assert started(ready) == {}
    said = ready.submit(capability="launch_evidence_gaps", channel="ui_action")["run"]["summary"]
    assert said.startswith("Nothing is missing from the evidence for ") and "Ready" in said


def test_a_check_that_goes_out_of_date_is_run_again_without_being_asked():
    env = Env()
    svc, lid = launch(env)
    assess(svc, lid, L)
    only(env, "readiness_refresh")
    assert started(env) == {}                                             # up to date: nothing to do
    row = run(svc.get_subject(OWNER, "A", rr.LAUNCH, lid))
    run(svc.update_subject(OWNER, "A", rr.LAUNCH, lid, row["revision"], {"target_date": day(env, 75)}))      # the details change
    r = started(env)["readiness_refresh"]
    assert r["status"] == "succeeded" and r["summary"].startswith("The details changed, so I ran the check again. ")
    assert r["state"]["outcome"]["refreshed"] == ["launch"] and r["state"]["outcome"]["links"][0]["to"] == f"/launch/{lid}?tab=results"
    assert len(run(svc.history(OWNER, "A", rr.LAUNCH, lid))) == 2 and started(env) == {}


def test_a_funding_case_gets_its_pack_drafted_and_nothing_is_sent():
    env = Env()
    svc, cid = funding_case(env)
    only(env, "funding_pack_draft")
    r = started(env)["funding_pack_draft"]
    assert r["status"] == "succeeded" and env.comms.sent == []
    assert r["summary"] == ("Funding pack draft ready for review: Funding readiness report, Executive summary draft, Pitch content outline. "
                            "Nothing has been sent to anyone.")
    assert r["state"]["outcome"]["links"] == [{"label": "Funding pack", "to": f"/funding/{cid}?tab=documents"}]
    made = run(svc.list_materials(OWNER, "A", rr.FUNDING, cid))["items"]
    assert {m["kind"] for m in made} == {"readiness_report", "executive_summary", "pitch_outline"}
    assert started(env) == {}                                             # drafted once for that state of the case


# ══ the Agent card: outcomes, questions and status ════════════════════════════

def test_the_tiles_say_what_the_agent_needs_is_doing_or_has_done():
    env = Env()
    d = _pre(env)
    assert _suggestion(d, "stage_funding")["text"] == "I need a funding case before the funding pack can be drafted."      # only the owner can supply that
    assert _suggestion(d, "stage_register")["text"] == "I'm preparing your registration checklist."
    _, lid = launch(env, forecast=False)
    _, cid = funding_case(env)
    only(env, "launch_evidence_gaps", "funding_pack_draft", "registration_checklist")      # the idea-stage work has its own tests
    d = _pre(env)
    assert (_suggestion(d, "stage_funding")["text"], _suggestion(d, "stage_blockers")["text"]) == ("I'm drafting your funding pack.", "I'm checking your launch evidence for gaps.")
    done = started(env)                                                   # the Agent does all of it
    assert {"launch_evidence_gaps", "funding_pack_draft", "registration_checklist"} <= set(done)
    d = _pre(env)
    funding, register, gaps = (_suggestion(d, k) for k in ("stage_funding", "stage_register", "stage_blockers"))
    assert (funding["text"], funding["action"]) == ("Funding pack draft ready for review.", {"to": f"/agent/runs/{done['funding_pack_draft']['id']}"})
    assert (register["text"], register["action"]) == ("Registration checklist ready.", {"to": f"/agent/runs/{done['registration_checklist']['id']}"})
    assert gaps["text"].endswith("in your launch evidence: I've listed them.") or gaps["text"].endswith("I've listed it.")
    texts = [s["text"] for s in d["agent"]["suggestions"]]
    assert chores(texts) == [] and not [t for t in texts if t.startswith(("Prepare ", "Register ", "Fill ", "Clear "))]


def test_a_tile_for_work_the_owner_switched_off_is_not_shown_as_an_instruction_instead():
    env = Env()
    funding_case(env)
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "items": {"funding_pack_draft": False, "registration_checklist": False}}}, OWNER))
    d = _pre(env)
    # No tile is hidden: each says why nothing is happening, and nothing is started.
    assert _suggestion(d, "stage_funding")["text"] == "Funding pack drafting is switched off in Agent settings."
    assert _suggestion(d, "stage_register")["text"] == "The registration checklist is switched off in Agent settings."
    assert "funding_pack_draft" not in started(env)


def test_each_new_item_has_its_own_switch_and_the_plan_it_needs():
    env = Env()
    rows = {e["key"]: e for e in autostart.events(run(env.store.get_policy("A")), run(env.orch.entitlement("A"))) if e["key"]}
    for key in PREP:
        assert rows[key]["switchable"] and rows[key]["on"] and rows[key]["starts"] == "automatic" and rows[key]["minimum_plan_label"] in ("Explorer", "Starter")
    assert "never automatic" in rows["registration_checklist"]["approval"] and "never sent" in rows["funding_pack_draft"]["approval"]
    only(env)                                                             # every one switched off
    off = {e["key"]: e for e in autostart.events(run(env.store.get_policy("A")), run(env.orch.entitlement("A"))) if e["key"]}
    assert all(off[k]["on"] is False and off[k]["starts"] == "suggested" for k in PREP) and started(env) == {}
