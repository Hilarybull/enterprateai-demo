"""Launch "Do all for me", the owner's brief 25 Oct: drafts to accept, edit or reject; no boxes that contradict the plan;
short prerequisite names from official sources; plain wording."""
from datetime import date, datetime, timezone

from test_goal_onboarding import world, _launch, OWNER, run  # noqa: F401
from app.modules.agent import credibility, research
from app.modules.readiness import rules
from app.modules.readiness.service import ReadinessService, service_for, short_name


def test_the_agent_s_launch_suggestions_wait_as_drafts_and_the_owner_s_answers_are_written(world):
    env, store, client, who = world
    who["user"] = OWNER
    _sid, made = _launch(client)
    svc = service_for(env.orch)
    cid = made["handoff"]["subject_id"]
    run(svc.get_subject(OWNER, "A", rules.LAUNCH, cid, OWNER))      # opened: what the records and research give is offered
    data = run(svc.store.get("subjects", cid))["data"]
    prov = data.get("provenance") or {}
    units = {"operations.process_version", "delivery.capacity_unit", "planned_volume.unit"}      # how things are counted, not answers
    agent_written = [p for p, e in prov.items() if str((e or {}).get("source") or "").startswith("Suggested by the Agent") and p not in units]
    assert not agent_written, agent_written                      # never written into the owner's answers
    assert data.get("agent_drafts"), "the Agent's suggestions wait beside their fields"
    assert (data.get("customers") or {}).get("target_segment") == "Office workers in Abuja"      # what the owner said: written


def test_boxes_that_contradict_the_plan_never_stand():
    svc = ReadinessService.__new__(ReadinessService)
    d = svc._validate(rules.LAUNCH, {"name": "Carpet cleaning", "operations": {"dry_run": {"failures_resolved": True}}}, {})
    assert not d["operations"]["dry_run"].get("failures_resolved")                     # no failed test run: nothing to resolve
    before = {"no_prerequisites": True, "prerequisites": []}
    d = svc._validate(rules.LAUNCH, {"name": "Carpet cleaning", "no_prerequisites": True, "prerequisites": [{"name": "Public liability insurance", "applicable": "yes"}]}, before)
    assert d["no_prerequisites"] is False                                              # a prerequisite added: unticked
    d = svc._validate(rules.LAUNCH, {"name": "Carpet cleaning", "no_prerequisites": True, "prerequisites": [{"name": "Public liability insurance", "applicable": "yes"}]},
                      {"no_prerequisites": False, "prerequisites": [{"name": "Public liability insurance", "applicable": "yes"}]})
    assert d["no_prerequisites"] is True and d["prerequisites"][0]["applicable"] == "no"      # just ticked: the listed one doesn't apply


def test_prerequisites_have_short_names_and_official_sources():
    assert short_name("You will need public liability insurance, which covers damage to a client's property.") == "Public liability insurance"
    assert short_name("In the UK, carpet cleaners must have a waste carrier licence from the Environment Agency if they remove waste.") == "Waste carrier licence"
    page = {"ok": True, "title": "Do I need a licence to clean carpets?", "text": "You need public liability insurance."}
    out = credibility.judge({"topic": "prerequisites", "label": "Licences"}, [{"url": "https://www.somecleaningco.co.uk/blog/licence", "quote": "You need public liability insurance.",
                                                                               "region": "United Kingdom"}],
                            {"https://www.somecleaningco.co.uk/blog/licence": page}, {"country": "United Kingdom"}, datetime.now(timezone.utc), figure=False)
    assert out["kind"] == "missing" and "official" in out["dropped_sources"][0]["why"]


def test_launch_wording_is_plain():
    assert research.context_of({"workspace_profile": {"company_size": "2-5", "country": "United Kingdom"}}, {})["size"] == "2 to 5 person"
    assert "economics.price_per_unit" in research.CASE_DRAFT_FIELDS["launch"] and "economics.fixed_costs_monthly" in research.NUMBER_DRAFTS
