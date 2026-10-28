"""What the owner says in the Agent chat is what the plan (and the sales letter) is written from: the messages before the
request, the request and the answers to its questions go to the generator first, ahead of the profile; for an idea that
isn't the business's own, nothing from the workspace's profile, services or figures is given to the model."""
from types import SimpleNamespace

from app.modules.blueprint import service as blueprint
from test_agent import OWNER, Env, run

EARLIER = "I'm planning weekend cookery classes for children in Bristol, mostly parents of 8 to 12 year olds book them"


def test_the_chat_before_the_request_and_the_request_reach_the_generator():
    env = Env()
    res = env.submit(text="draft a business plan for it", capability="business_plan_draft",
                     params={"answers": {"description": "Weekend cookery classes for children", "customer": "Parents of 8 to 12 year olds"}},
                     history=[{"role": "user", "content": EARLIER}, {"role": "assistant", "content": "That sounds good."}])
    calls = [c for c in env.orch.rt.studio.calls if c[0] == "draft_plan"]
    assert calls, res.get("message") or (res.get("run") or {}).get("pending_question")
    said = calls[0][1]["said"]
    assert EARLIER in said and "draft a business plan for it" in said and "That sounds good." not in said      # the owner's words only
    assert calls[0][1]["customer"] == "Parents of 8 to 12 year olds"


def _payload(**kw):
    return SimpleNamespace(owner_said=kw.get("said"), location=kw.get("location"), separate_idea=kw.get("separate", False))


def test_the_owners_words_come_first_and_override_the_profile():
    inputs = {"company_name": "Apex", "about_company": "Consulting for SMEs", "location": "London"}
    out = blueprint._owner_first(inputs, _payload(said="The request: a cookery school in Bristol", location="Bristol"))
    assert list(out)[0] == blueprint.OWNER_SAID_KEY and out[blueprint.OWNER_SAID_KEY].endswith("Bristol")
    assert out["location"] == "Bristol" and out["about_company"] == "Consulting for SMEs"      # the profile still fills the rest


def test_a_separate_idea_gets_nothing_from_the_workspace_profile():
    inputs = {"company_name": "Cookery school", "about_company": "Consulting for SMEs", "services": "Bookkeeping", "known_figures": "Revenue 4000",
              "target_customer_type": "b2b", "location": "London"}
    out = blueprint._owner_first(inputs, _payload(said="The request: a cookery school", separate=True))
    assert all(out[k] == "" for k in ("about_company", "services", "known_figures", "target_customer_type", "location"))
    assert out["company_name"] == "Cookery school"


def test_new_details_make_a_new_draft_and_the_same_request_twice_does_not():
    env = Env()
    first = {"description": "Weekend cookery classes for children", "customer": "Parents of 8 to 12 year olds"}
    env.submit(text="draft a business plan", capability="business_plan_draft", params={"answers": first})
    env.submit(text="draft a business plan", capability="business_plan_draft", params={"answers": first})
    assert [c[0] for c in env.orch.rt.studio.calls].count("draft_plan") == 1
    env.submit(text="draft a business plan", capability="business_plan_draft", params={"answers": {**first, "customer": "Schools in Bristol"}})
    calls = [c[1] for c in env.orch.rt.studio.calls if c[0] == "draft_plan"]
    assert len(calls) == 2 and calls[1]["customer"] == "Schools in Bristol"


def test_a_plan_for_another_offering_than_the_profiles_never_gets_the_profiles_offering():
    """The owner, 27 Oct: "Business Plan for Land Clearing" had an executive summary about balcony washing: the task took
    the idea as the business's own, so the profile describing another offering went to the writer."""
    env = Env()
    run(env.orch.rt.business.mutate("A", lambda d: d.setdefault("workspace_profile", {}).update({"about_company": "We offer balcony washing for flats in Lagos"})))
    env.submit(text="draft a business plan", capability="business_plan_draft", params={"answers": {"description": "Land clearing for farms", "customer": "Farm owners"}})
    calls = [c for c in env.orch.rt.studio.calls if c[0] == "draft_plan"]
    assert calls      # written, not asked about
    idea = calls[-1][1]
    from app.modules.agent.services import owner_words
    assert owner_words(idea)["separate_idea"] is True      # the writer is given nothing of the profile's balcony washing
    assert "balcony" not in str(idea.get("description", "")).lower()


def test_an_offering_sharing_only_a_kind_of_work_or_a_place_is_another_offering():
    """The owner, 27 Oct: the Drone Cleaning plan was about "car cleaning for busy office workers"."""
    from app.modules.agent.workflows import _shares_offering
    assert not _shares_offering("Drone cleaning", "Car washing and interior cleaning for busy office workers in Abuja")
    assert not _shares_offering("Balcony washing in Abuja", "Car wash and detailing in Abuja")
    assert _shares_offering("a mobile car wash in Abuja", "Car wash and detailing")
