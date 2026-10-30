"""System fixes from the 30 Oct QA report, for every workspace."""
from app.modules.agent import answer_memory


def test_a_customer_from_another_offering_is_never_saved_again_under_this_one():
    # F1: a dog-grooming idea's customers carried onto a cleaning business's customer check
    data = {"shared_answers": {"customer": {"value": "Dog owners in Leeds", "offering": "Mobile dog grooming van", "goal": "test_idea"}}}
    answer_memory.remember(data, "more_customers", {"sell": "Home cleaning", "customer": "Dog owners in Leeds", "channel": "search"})
    kept = data["quick_check_answers"]["more_customers"]["answers"]
    assert "customer" not in kept and kept["sell"] == "Home cleaning"
    assert data["shared_answers"]["customer"]["offering"] == "Mobile dog grooming van"      # never relabelled as the cleaning one


def test_the_owners_own_customer_for_this_offering_is_kept():
    data = {}
    answer_memory.remember(data, "more_customers", {"sell": "Home cleaning", "customer": "Landlords in Leeds"})
    assert data["quick_check_answers"]["more_customers"]["answers"]["customer"] == "Landlords in Leeds"


def test_an_idea_being_tested_is_never_what_another_check_is_about():
    data = {"quick_check_answers": {"test_idea": {"offering": "Mobile dog grooming van", "at": "2026-10-30T02:00:00"},
                                    "price_offer": {"offering": "Home cleaning", "at": "2026-10-29T02:00:00"}}}
    assert answer_memory.current_offering("more_customers", data) == "Home cleaning"
    assert answer_memory.current_offering("test_idea", data) == "Mobile dog grooming van"


from test_goal_onboarding import world, run  # noqa: E402,F401
from test_round14_converse_funding import talk, _case  # noqa: E402,F401


def test_an_amount_in_another_currency_is_asked_never_saved(talk):
    # F2: "₦5m grant for stock" saved on a UK business's funding case
    env, ask, model, cid = talk
    model.replies.append({"say": "Done.", "change": {"target_amount": 5000000, "currency": "NGN"}})
    out = ask("Change my funding need to ₦5,000,000 for stock")
    assert "Your business works in GBP" in out["message"] and "Nothing has been changed" in out["message"]
    case = _case(env, cid)
    assert case.get("currency") in (None, "GBP") and float(case["target_amount"]) == 50000


def test_a_long_prerequisite_reads_as_its_obligation_never_cut_mid_word():
    # F10: "Required and not completed: In the UK, carpet cleaning businesses typically need to register… if trans."
    from app.modules.readiness.service import short_name
    long = "In the UK, carpet cleaning businesses typically need to register for a waste carrier licence if transporting waste."
    got = short_name(long)
    assert got and len(got) <= 60 and not got.endswith("trans") and "waste carrier licence" in got.lower()


def test_a_new_launch_plan_is_asked_for_then_made_even_with_no_model(world, monkeypatch):
    # QA 30 Oct: "a new plan" and Start a launch plan looped on the plan list; no plan was ever made
    from app.modules.agent import research
    from test_goal_onboarding import OWNER
    from test_round14_converse_launch import _plans
    env, store, client, who = world
    who["user"] = OWNER
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: None)
    ask = lambda text: client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text", "page": "launch"}).json()      # noqa: E731
    first = ask("I want to launch a new product or service")
    assert first["message"].startswith("What are you launching?")
    made = ask("window cleaning for offices")
    assert "created" in made.get("changed", [])
    assert any((p.get("data") or {}).get("name") == "window cleaning" for p in _plans(env))


def test_traction_is_what_the_records_show_never_an_earlier_claim():
    # QA 30 Oct: "4 regular customers, about £1,200 a month" in the funding recap beside one customer and £450 all time
    from app.modules.agent import first_value
    data = {"workspace_profile": {"country": "United Kingdom"}, "financials": {"invoices": [
        {"id": "i1", "invoice_number": "INV-1", "status": "paid", "total_amount": 450, "paid_at": "2026-10-20", "customer_name": "Delta Offices", "currency": "GBP"}]}}
    said = first_value.records_traction(data)
    assert said == "1 paying customer on record, £450 all time"
    assert first_value.records_traction({}) == ""


def test_who_the_customers_are_is_never_read_as_how_they_find_you():
    # QA 30 Oct: "landlords and letting agents" assumed as "customers find you through partners"
    from app.modules.agent import goals
    assert "channel" not in goals._extract("I clean homes for landlords and letting agents in Leeds", "more_customers")
    assert goals._extract("I clean homes in Leeds and most customers find me through Instagram", "more_customers")["channel"] == "social"


def test_a_provider_with_a_bad_key_is_skipped_for_a_while_never_retried_every_call():
    # QA 30 Oct: each AI step waited for a rejected key and an empty balance, 20 to 70 seconds a message
    import asyncio
    from app.shared.llm import openai_client as oc

    class Bad(oc.LLMClient):
        calls = 0
        async def generate_text(self, **kw):
            Bad.calls += 1
            raise RuntimeError('Anthropic API error 401: {"type":"authentication_error","message":"invalid x-api-key"}')

    class Good(oc.LLMClient):
        async def generate_text(self, **kw):
            return oc.LLMTextResult(text="ok", provider="good", model="m")

    oc._DOWN_UNTIL.clear()
    chain = oc.ChainLLMClient([Bad(), Good()])
    assert asyncio.run(chain.generate_text(system="s", prompt="p")).text == "ok"
    assert asyncio.run(chain.generate_text(system="s", prompt="p")).text == "ok"
    assert Bad.calls == 1      # skipped the second time
    oc._DOWN_UNTIL.clear()


def test_funding_options_come_as_cards_never_a_block_of_text(talk, monkeypatch):
    # QA 30 Oct: four options as one long block of scraped text with raw links
    from app.modules.agent import converse
    env, ask, model, cid = talk
    found = {"at": "2026-10-30", "options": [{"title": "Start Up Loans", "route": "loan", "text": "Government-backed loans of up to £25,000 for new businesses.",
                                              "fits": {"fit": "Likely", "why": "UK business, under 3 years"}, "source": {"url": "https://www.startuploans.co.uk", "publisher": "startuploans.co.uk"}}]}
    monkeypatch.setattr(converse, "options_found", lambda data: found)
    out = ask("Which loans or grants fit my case?")
    card = next(c for c in out["cards"] if c["type"] == "options")["options"][0]
    assert card["title"] == "Start Up Loans" and card["fit"] == "Likely" and card["amount"] == 25000 and card["url"].startswith("https://")
    assert "https://" not in out["message"] and "Next step:" in out["message"]


def test_the_team_size_is_the_profiles_never_an_older_saved_answer():
    # QA 30 Oct: "Team: 22 people" in the funding drafts beside a 2-5 profile
    from app.modules.agent import research
    data = {"workspace_profile": {"company_size": "2-5"}, "shared_answers": {"team_size": {"value": 22}}}
    got = research.inputs_of("need_funding", {}, data)
    assert got["team_size"] == 2 and "profile" in got["_from"]["team_size"]
    assert research.inputs_of("need_funding", {"team_size": 3}, data)["team_size"] == 3      # said in this check


def test_the_first_idea_result_offers_the_idea_validation_as_a_button(world, monkeypatch):
    # The owner, 30 Oct: "expecting to type it is not cool, most of them don't even know"; the validation is the main flow
    from test_round14_converse_idea import ANSWERS
    from test_round14_converse_funding import _Model
    from test_goal_onboarding import OWNER
    from app.modules.agent import research
    env, store, client, who = world
    who["user"] = OWNER
    client.post("/businesses/A/quick-check/test_idea", json={"answers": ANSWERS})
    model = _Model()
    model.replies.append({"say": "You're in the Fair range."})
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: model)
    out = client.post("/agent/requests", json={"business_id": "A", "text": "Is my service idea worth it?", "source_channel": "text", "page": "idea"}).json()
    types = [c["type"] for c in out["cards"]]
    assert types[:2] == ["idea_inputs", "viability"] and "choose" not in types
    assert out["actions"][0] == {"label": "Run the idea validation", "kind": "explain", "prompt": "Run the idea validation"}
    assert out["message"].startswith("You're in the Fair range.") and "Run the idea validation" in out["message"]
    # pressed: its price first, with Start or Not now, then the validation itself
    pressed = client.post("/agent/requests", json={"business_id": "A", "text": out["actions"][0]["prompt"], "source_channel": "text", "page": "idea"}).json()
    labels = [a["label"] for a in pressed.get("actions") or []]
    assert labels == ["Start", "Not now"] or "Open the Idea Validation form" in labels


def test_an_idea_with_details_missing_is_offered_to_fill_them_first(world, monkeypatch):
    # The owner, 30 Oct: "it should offer to fill these first as usual, then run the idea validation"
    from test_round14_converse_funding import _Model
    from test_goal_onboarding import OWNER
    from app.modules.agent import research
    env, store, client, who = world
    who["user"] = OWNER
    client.post("/businesses/A/quick-check/test_idea", json={"answers": {"description": "Branded workwear printing"}})
    model = _Model()
    model.replies.append({"say": "It's early days for this idea."})
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: model)
    out = client.post("/agent/requests", json={"business_id": "A", "text": "Is my service idea worth it?", "source_channel": "text", "page": "idea"}).json()
    assert "choose" in [c["type"] for c in out["cards"]]
    assert "fill them in for you first" in out["message"] and "then run the idea validation" in out["message"]
    assert not any(a.get("label") == "Run the idea validation" for a in out.get("actions") or [])


def test_a_running_validation_is_still_followed_after_the_chat_is_saved():
    # The owner, 30 Oct: back from the validation output, the chat had stopped checking for its result
    from app.modules.agent.router import _chat_message
    m = _chat_message({"role": "assistant", "content": "Your idea validation has started.", "wait": {"kind": "idea_validation", "history_id": "agent-abc", "since": "2026-10-30T21:15:00+00:00"},
                       "cards": [{"type": "steps", "case_id": "c1"}]})
    assert m["wait"] == {"kind": "idea_validation", "history_id": "agent-abc", "since": "2026-10-30T21:15:00+00:00"}
    assert m["cards"] == [{"type": "steps", "case_id": "c1"}]


def test_an_older_chat_save_arriving_late_never_overwrites_a_newer_one(world):
    # The owner, 30 Oct: the validation result posted in the chat, then gone after visiting its page (a late, retried save)
    from test_goal_onboarding import OWNER
    env, store, client, who = world
    who["user"] = OWNER
    newer = [{"role": "user", "content": "Run the idea validation"}, {"role": "assistant", "content": "Your idea validation is done: 62/100."}]
    older = newer[:1]
    client.put("/businesses/A/agent/chats/idea-check", json={"messages": newer, "client_at": 2000})
    client.put("/businesses/A/agent/chats/idea-check", json={"messages": older, "client_at": 1000})
    kept = client.get("/businesses/A/agent/chats/idea-check").json()
    assert [m["content"] for m in kept["messages"]] == ["Run the idea validation", "Your idea validation is done: 62/100."]


def test_a_new_ideas_plan_is_named_from_the_idea_not_the_whole_sentence():
    # The owner, 30 Oct: "Business Plan for a new my corporate wears product": "what kind of naming is this?"
    from app.modules.agent.workflows import idea_name
    assert idea_name("a new my corporate wears product") == "Corporate wears"
    assert idea_name("window cleaning for offices") == "Window cleaning for offices"
    assert idea_name("a new service") == "Service"


def test_a_plan_the_task_made_is_previewed_from_its_draft(world):
    # The owner, 30 Oct: a business plan made, its chat card "This isn't waiting any more" with no way to it
    import asyncio
    from test_goal_onboarding import OWNER, run
    from app.modules.agent import chat_actions, drafts
    env, store, client, who = world
    run(env.orch.rt.business.mutate("A", lambda d: drafts.add(d, kind="business_plan", title="Business plan", to="/blueprint?tab=business-plans", run_id="run-1")))
    got = asyncio.run(chat_actions.preview(OWNER, "A", run_id="run-1"))
    assert got["found"] and got["kind"] == "business_plan" and got["to"].startswith("/blueprint")


def test_a_replaced_need_names_its_things_to_do_with_do_all_for_me(talk):
    # The owner, 30 Oct: "Your score is now 48/100 so far, with 10 things to do": why didn't it bring them out, with Do all for me?
    env, ask, model, cid = talk
    model.replies += [{"say": "Should it replace that need, or just update it?"},
                      {"say": "Done.", "change": {"target_amount": 2000000, "purpose": "a new site", "route_preference": "loan"}, "replace": True}]
    ask("I need a £2m loan for a new site")
    out = ask("replace it")
    assert out["message"].startswith("Done. I've replaced your funding need")
    assert "First:" in out["message"]
    labels = [a["label"] for a in out["actions"]]
    assert "Do all for me" in labels and any(l.startswith("See ") for l in labels)
    assert {"result", "steps"} <= {c["type"] for c in out["cards"]}
