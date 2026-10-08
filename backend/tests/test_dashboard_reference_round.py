"""Dashboard vs reference: a question about the business is not asked when the profile answers
it, a guess is confirmed, tiles say it short, and pre-launch has five key figures."""
from app.modules.agent import autostart
from app.modules.agent.summary import build_summary, short_question
from app.modules.agent.workflows import idea_of
from test_agent import OWNER, Env, run
from test_readiness import L, _pre, assess, launch

ABOUT = "bookkeeping and invoicing support for small UK service firms"


def _fresh(env):
    env.businesses["A"]["data"].pop("validation", None)
    p = env.businesses["A"]["data"]["workspace_profile"]
    for k in ("about_company", "description", "business_description", "problem", "target_customer", "target_market", "target_customer_type"):
        p.pop(k, None)
    env.businesses["A"]["data"]["catalogue"]["products"] = []
    return p


# ══ D-2 ═══════════════════════════════════════════════════════════════════════

def test_what_the_business_does_is_never_asked_when_the_profile_or_the_marketplace_says_it():
    for where in ("profile", "marketplace", "marketplace_profile"):
        env = Env()
        p = _fresh(env)
        if where == "profile":
            p["about_company"] = ABOUT
        elif where == "marketplace":
            env.businesses["A"]["data"]["marketplace"] = {"is_active": True, "description": ABOUT}
        else:
            env.businesses["A"]["data"]["marketplace"] = {"is_active": True, "profile": {"about": ABOUT}}
        r = env.submit(capability="idea_validation", channel="ui_action")["run"]
        asked = r["pending_question"]["question"]
        assert not asked.startswith("What does your business do") and not asked.startswith("Is this right"), (where, asked)
        assert asked == "Is this your customer? “Small UK service firms”"      # E-2: worked out from the description, and confirmed
        assert idea_of(env.businesses["A"]["data"])["description"] == ABOUT


def test_a_task_already_waiting_on_that_question_carries_on_once_the_profile_has_the_answer():
    env = Env()
    p = _fresh(env)
    r = env.submit(capability="idea_validation", channel="ui_action")["run"]
    assert r["pending_question"]["question"] == "What does your business do? (1 to 2 sentences)"      # nothing on record yet
    p.update({"about_company": ABOUT, "target_customer": "Small UK service firms", "problem": "Owners lose evenings to paperwork"})
    run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))      # even with automatic starting off
    run(autostart.answer_from_profile(env.orch, "A", env.businesses["A"]["data"], run(env.store.list_runs("A"))))
    after = run(env.store.get_run(r["id"]))
    assert after["status"] == "succeeded" and after["summary"].startswith("Idea scored 68/100")      # it read the profile and finished
    assert env.orch.rt.studio.calls[0][1]["description"] == ABOUT
    # And through the ordinary look the Agent takes when the app is opened.
    other = Env()
    q = _fresh(other)
    waiting = other.submit(capability="idea_validation", channel="ui_action")["run"]
    q["about_company"] = ABOUT
    run(autostart.sweep(other.orch, "A"))
    assert run(other.store.get_run(waiting["id"]))["pending_question"]["question"] == "Is this your customer? “Small UK service firms”"


def test_a_description_put_together_from_the_services_is_confirmed_not_assumed():
    env = Env()
    p = _fresh(env)
    p["services"] = [{"service_name": "Monthly bookkeeping"}, {"service_name": "Invoicing support"}]
    r = env.submit(capability="idea_validation", channel="ui_action")["run"]
    q = r["pending_question"]
    assert q["question"] == "Using your profile: Offers Monthly bookkeeping, Invoicing support. Is this the idea?"
    field = q["fields"][0]
    assert (field["key"], field["default"], field["confirm"]) == ("description", "Offers Monthly bookkeeping, Invoicing support", True)
    # A confirmation is the owner's to give: the Agent does not answer it for them.
    assert run(autostart.answer_from_profile(env.orch, "A", env.businesses["A"]["data"], run(env.store.list_runs("A")))) == 0
    r = run(env.orch.provide_input(r["id"], OWNER, {"description": "Bookkeeping and invoicing for small firms"}))      # edited, then confirmed
    assert r["pending_question"]["question"] == "Is this your customer? “Small firms”"
    assert idea_of(env.businesses["A"]["data"], {"description": "Bookkeeping and invoicing for small firms"})["description_guessed"] is False


# ══ D-3 ═══════════════════════════════════════════════════════════════════════

def test_a_question_is_short_on_its_tile_and_whole_when_opened():
    long = "QA Buyer Three wrote from buyer@example.test that is on record for QA Round Six Ltd. Use QA Round Six Ltd, or create QA Buyer Three?"
    assert short_question({"question": long, "fields": [{"key": "customer_id"}]}) == "Which customer is QA Buyer Three's request for?"
    assert short_question({"question": "Is Nova Labs one of your existing customers?", "fields": [{"key": "customer_id"}]}) == "Which customer is this for?"
    assert short_question({"question": "I couldn't find an approved price for: Audit. Choose the items and quantities to quote.", "fields": [{"key": "items"}]}) == \
        "Which items and prices should I quote?"
    assert short_question({"question": "What VAT rate should this quotation use?", "fields": [{"key": "vat_rate"}]}) == "What VAT rate should I use?"
    assert short_question({"question": "What does your business do? (1 to 2 sentences)", "fields": [{"key": "description"}]}) == "What does your business do?"
    env = Env()
    env.fin["rfq_requests"] = [{"id": "r1", "status": "pending", "customer_name": "QA Buyer Three", "customer_email": "buyer@brighttech.test",
                                "items": [{"name": "Strategy Workshop", "quantity": 1}]}]
    r = env.submit(capability="enquiry_to_quote", params={"rfq_id": "r1"}, channel="ui_action")["run"]
    tile = run(build_summary(env.orch, OWNER, "A"))["suggestions"][0]
    assert tile["text"] == "Quotation for QA Buyer Three. Which customer?" and len(tile["text"]) < 60
    assert tile["question"]["question"] == r["pending_question"]["question"] and "that is on record for BrightTech Ltd" in tile["question"]["question"]


# ══ R-1 ═══════════════════════════════════════════════════════════════════════

def test_pre_launch_has_five_key_figures_ending_with_active_risks():
    env = Env()
    d = _pre(env)
    assert [k["label"] for k in d["kpis"]] == ["Launch Readiness", "Runway", "Planned Costs", "Funding Secured", "Active Risks"]
    risks = d["kpis"][-1]
    assert risks["state"] == "insufficient_data" and risks["good_when_up"] is False and risks["hint"] == "Appears once a launch or funding check has been done"
    svc, lid = launch(env, prerequisite="not_completed")
    assess(svc, lid, L)
    risks = _pre(env)["kpis"][-1]
    assert (risks["value"], risks["tone"], risks["state"]) == ("1", "rose", "available") and risks["hint"] == "1 launch blocker"
    ready = Env()
    svc2, lid2 = launch(ready)
    assess(svc2, lid2, L)
    none = _pre(ready)["kpis"][-1]
    assert (none["value"], none["tone"]) == ("0", "emerald") and none["hint"] == "Nothing found by your checks or in your records"
