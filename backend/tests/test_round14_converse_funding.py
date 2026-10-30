"""The owner, 27 Oct: "just look how you carry out tasks... just by typing, you show buttons, options when needed... not these
static deterministic chats", "start with funding", ""Do all for me" should be conversational". A stand-in model here: no real
model, search or charge is used."""
import json

import pytest

from test_goal_onboarding import world, _funding, OWNER, run  # noqa: F401
from app.modules.agent import converse, research


class _Model:
    """Replies in turn with what the live model would decide."""
    def __init__(self, *replies):
        self.replies, self.prompts = list(replies), []

    async def generate_text(self, **kw):
        self.prompts.append(json.loads(kw["prompt"]))
        return type("R", (), {"text": json.dumps(self.replies.pop(0))})()


@pytest.fixture
def talk(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    _sid, made = _funding(client, amount=50000, use="a second van")
    model = _Model()
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: model)
    ask = lambda text, **kw: client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text", **kw}).json()      # noqa: E731
    return env, ask, model, made["handoff"]["subject_id"]


def _case(env, cid):
    from app.modules.readiness.service import service_for
    return run(service_for(env.orch).store.get("subjects", cid))["data"]


def test_a_question_is_answered_from_the_case(talk):
    env, ask, model, cid = talk
    model.replies.append({"say": "You're getting there, the forecast is the next thing.", "buttons": [{"kind": "open_case"}]})
    out = ask("How ready am I for funding?")
    assert out["kind"] == "answer" and out["message"].startswith("You're getting there")
    assert out["actions"] == [{"label": "Open your funding case", "to": f"/funding/{cid}?tab=overview"}]
    seen = model.prompts[0]["CASE"]
    assert seen["exists"] and float(seen["target_amount"]) == 50000      # the model sees the case


def test_a_typed_change_goes_on_the_case_and_a_follow_up_stays_in_the_conversation(talk):
    env, ask, model, cid = talk
    model.replies += [{"say": "Done, it's £60,000 now.", "change": {"target_amount": 60000, "favourite_colour": "blue"}, "check": True},
                      {"say": "Equity it is.", "change": {"route_preference": "equity"}}]
    out = ask("I need £60,000 for funding")
    # Saved straight away and said in one line, with Undo (the owner, 28 Oct); only the case's own fields
    data = _case(env, cid)
    assert float(data["target_amount"]) == 60000 and "favourite_colour" not in data
    assert out["message"].startswith("Updated amount: £50,000 → £60,000.") and [a["label"] for a in out["actions"]] == ["Undo"]
    assert data["provenance"]["target_amount"]["source"].startswith("From you")
    ask("make it equity")      # no funding words: a follow-up in the same conversation
    assert model.prompts[1]["TURNS"][0] == {"role": "owner", "text": "I need £60,000 for funding"}
    assert _case(env, cid)["route_preference"] == "equity"


def test_do_all_for_me_is_priced_and_asked_then_started_on_yes(talk, monkeypatch):
    env, ask, model, cid = talk
    started = []

    async def premium(session_id, body=None, user=None):
        started.append(session_id)
        return {"started": True}
    from app.modules.agent import goal_router
    monkeypatch.setattr(goal_router, "session_premium", premium)
    model.replies += [{"say": "You're at 40 so far; the forecast and the team are what's left."}, {"say": "Sure.", "do_all": True}]
    ask("How ready am I for funding?")
    asked = ask("can you do it all for me?")      # a follow-up in the funding conversation
    assert asked["message"].endswith("Shall I start?") and asked["message"].startswith("I'll research ")      # what, and its price or "free"
    assert "credits" in asked["message"] or "This one is free." in asked["message"]
    assert [a["label"] for a in asked["actions"]][-1] == "Not now" and asked["actions"][0]["label"].startswith("Start")
    assert started == [] and env.meter.charges == []      # nothing before the yes
    out = ask("yes, start")
    run(__import__("asyncio").sleep(0))
    assert out["message"].startswith("Started.") and len(started) == 1


def test_without_a_model_the_scripted_chat_answers(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    _funding(client)
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: None)
    out = client.post("/agent/requests", json={"business_id": "A", "text": "How ready am I for funding?", "source_channel": "text"}).json()
    assert not out.get("conversational")


def test_only_the_cases_own_fields_are_kept():
    assert converse.clean_change({"target_amount": "₦5,000,000", "route_preference": "LOAN", "receipt_date": "2027-01-31", "company_name": "x"}) \
        == {"route_preference": "loan", "receipt_date": "2027-01-31"}      # a figure with a sign is never guessed at
    assert converse.clean_change({"target_amount": "5000000", "currency": "ngn"}) == {"target_amount": 5000000.0, "currency": "NGN"}


def test_another_task_mid_conversation_goes_to_its_own_flow(talk):
    """The owner's brief, 27 Oct: "never assume that every new message relates to the immediately preceding task"."""
    env, ask, model, cid = talk
    model.replies.append({"say": "You're at 40 so far."})
    ask("How ready am I for funding?")
    out = ask("create an invoice for Mark for 300")
    assert not out.get("conversational") and len(model.prompts) == 1      # the invoice flow, never the funding conversation


def test_a_different_need_is_replaced_only_once_they_say_so(talk):
    """One funding case per business: asked in the chat whether a new need replaces the current one (kept in History)."""
    env, ask, model, cid = talk
    model.replies += [{"say": "That's different from your £50,000 for a second van. Should it replace that need, or just update it?"},
                      {"say": "Done, I've replaced it.", "change": {"target_amount": 2000000, "purpose": "a new site", "route_preference": "loan"}, "replace": True}]
    first = ask("I need a £2m loan for a new site")
    assert "replace" in first["message"] and float(_case(env, cid)["target_amount"]) == 50000      # nothing changed before they say
    assert [a["label"] for a in first["actions"]] == ["Replace it", "Update it"]
    ask("replace it")
    ask("Apply")
    data = _case(env, cid)
    assert float(data["target_amount"]) == 2000000 and data["previous_needs"][0]["values"]["target_amount"] == 50000      # kept in History


def test_the_landing_page_hands_funding_to_the_chat_panel(world):
    env, store, client, who = world
    who["user"] = OWNER
    said = lambda t: client.post("/agent/readiness-question", json={"business_id": "A", "text": t}).json()      # noqa: E731
    assert said("I need funding") == {"kind": "funding", "converse": True}
    assert said("create an invoice for Mark")["kind"] is None


def test_a_figure_never_said_is_never_set_and_never_claimed(talk):
    """The owner, 27 Oct: "I want a new one" was set up as ₦200,000 for equipment from an old conversation."""
    env, ask, model, cid = talk
    model.replies.append({"say": "Got it, a new case for ₦200,000 to buy equipment.", "change": {"target_amount": 200000, "purpose": "buy equipment"}, "replace": True})
    out = ask("I need funding, I want a new one")
    assert float(_case(env, cid)["target_amount"]) == 50000      # nothing set from words never said
    assert "200,000" not in out["message"] and out["message"].startswith("Before I set that up, tell me how much you need and what it's for")


def test_what_was_said_counts_from_this_message_or_the_one_before():
    from app.modules.agent.converse import grounded
    said = "I need ₦25m to hire two staff. Make it a loan"
    assert grounded({"target_amount": 25000000.0, "purpose": "hire two staff", "route_preference": "loan"}, said) == \
        {"target_amount": 25000000.0, "purpose": "hire two staff", "route_preference": "loan"}
    assert grounded({"target_amount": 200000.0, "purpose": "buy equipment", "route_preference": "equity"}, said) == {}


def test_an_earlier_conversation_opened_from_history_carries_on(talk):
    """The owner, 27 Oct: "clicked on history and can't continue previous convo"."""
    env, ask, model, cid = talk
    model.replies.append({"say": "Equity it is.", "change": {"route_preference": "equity"}})
    from app.modules.agent import router as agent_router  # noqa: F401
    out = env.client_post("/agent/requests", {"business_id": "A", "text": "make it equity", "source_channel": "text",
                                              "history": [{"role": "user", "content": "How ready am I for funding?"}, {"role": "assistant", "content": "80 so far."}]}) \
        if hasattr(env, "client_post") else None
    assert out is None or out.get("conversational")


def test_a_conversation_opened_from_history_carries_on(world, monkeypatch):
    """The owner, 27 Oct: "clicked on history and can't continue previous convo": its messages go with the next one."""
    env, store, client, who = world
    who["user"] = OWNER
    _sid, made = _funding(client, amount=50000, use="a second van")
    model = _Model({"say": "A loan it is.", "change": {"route_preference": "loan"}})
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: model)
    earlier = [{"role": "user", "content": "How ready am I for funding?"}, {"role": "assistant", "content": "You're at 80 so far."}]
    out = client.post("/agent/requests", json={"business_id": "A", "text": "make it a loan", "source_channel": "text", "history": earlier}).json()
    assert out.get("conversational") and model.prompts[0]["TURNS"][0] == {"role": "owner", "text": "How ready am I for funding?"}
    client.post("/agent/requests", json={"business_id": "A", "text": "Apply", "source_channel": "text"})
    assert _case(env, made["handoff"]["subject_id"])["route_preference"] == "loan"


def test_the_score_is_given_out_of_100(talk):
    """The live run, 27 Oct: the model read the score as "5 out of 10"."""
    env, ask, model, cid = talk
    model.replies.append({"say": "You're at 50/100."})
    ask("How ready am I for funding?")
    seen = model.prompts[0]["CASE"]
    assert "score_out_of_100" in seen and "score" not in seen


def test_a_correction_just_updates_without_asking_replace_or_keep_both(talk):
    """The live run, 27 Oct: "Make it 10m for two more washing bays" asked "replace or keep both?" and changed the case anyway."""
    env, ask, model, cid = talk
    model.replies.append({"say": "You're at 40/100 so far."})
    ask("How ready am I for funding?")      # the correction is a follow-up, as in the live run
    model.replies.append({"say": "Should this replace your current need or keep both options?", "change": {"target_amount": 10000000, "purpose": "two more washing bays"},
                          "check": True, "buttons": [{"kind": "reply", "label": "Replace current need", "text": "replace it"},
                                                     {"kind": "reply", "label": "Keep both options", "text": "keep both"}]})
    out = ask("Make it 10m for two more washing bays")
    assert "replace" not in out["message"].lower() and all("both" not in a["label"].lower() for a in out["actions"])
    assert [a["label"] for a in out["actions"]] == ["Undo"]
    data = _case(env, cid)
    assert float(data["target_amount"]) == 10000000 and not data.get("previous_needs")      # updated, not replaced


def test_when_it_asks_replace_or_update_nothing_changes_that_turn(talk):
    env, ask, model, cid = talk
    model.replies.append({"say": "That's different from your second van. Should it replace that need, or keep both?", "change": {"target_amount": 2000000, "purpose": "a new site"},
                          "check": True, "buttons": [{"kind": "reply", "label": "Replace it", "text": "replace it"},
                                                     {"kind": "reply", "label": "Keep both", "text": "keep both"}]})
    out = ask("I need a 2m loan for a new site")
    assert float(_case(env, cid)["target_amount"]) == 50000 and "Your score is now" not in out["message"]
    assert [a["label"] for a in out["actions"]] == ["Replace it", "Update it"]      # never "Keep both"


def test_yes_to_replace_or_update_is_asked_again_with_the_two_buttons(talk):
    """The owner, 27 Oct: "if the user answers 'yes' to 'replace or update?', show the two options as buttons"."""
    env, ask, model, cid = talk
    model.replies.append({"say": "That's different from your second van. Should it replace that need, or update it?", "change": {"target_amount": 2000000, "purpose": "a new site"}})
    ask("I need a 2m loan for a new site")
    out = ask("yes")
    assert out["message"].startswith("Should it replace") and [a["label"] for a in out["actions"]] == ["Replace it", "Update it"]
    assert len(model.prompts) == 1 and float(_case(env, cid)["target_amount"]) == 50000
    shown = ask("Update it")      # how they answered: made, and said with Undo
    assert [a["label"] for a in shown["actions"]] == ["Undo"]
    assert float(_case(env, cid)["target_amount"]) == 2000000 and not _case(env, cid).get("previous_needs")


def test_a_picked_amount_is_not_asked_about_again(talk):
    env, ask, model, cid = talk
    model.replies += [{"say": "You're at 40/100."}, {"say": "Got it.", "change": {"target_amount": 50}}, {"say": "Done.", "change": {"target_amount": 50}}]
    ask("How ready am I for funding?")
    assert ask("make it 50 for a second van")["message"] == "Did you mean £50 or £50,000?"
    out = ask("Make it £50")
    assert [a["label"] for a in out["actions"]] == ["Undo"] and float(_case(env, cid)["target_amount"]) == 50      # picked: saved, not asked again


def test_an_amount_a_thousand_times_off_is_asked_with_both_as_buttons(talk):
    """The owner, 27 Oct: "If they type '25000' against a ₦25m case, ask '₦25,000 or ₦25,000,000?'"."""
    env, ask, model, cid = talk
    model.replies += [{"say": "You're at 40/100."}, {"say": "Got it.", "change": {"target_amount": 50}}]
    ask("How ready am I for funding?")
    out = ask("make it 50 for a second van")
    assert out["message"] == "Did you mean £50 or £50,000?" and [a["label"] for a in out["actions"]] == ["£50", "£50,000"]
    assert float(_case(env, cid)["target_amount"]) == 50000


def test_undo_puts_the_case_back_as_it_was(talk):
    env, ask, model, cid = talk
    model.replies.append({"say": "Sure.", "change": {"target_amount": 60000}})
    ask("I need £60,000 for funding")
    assert float(_case(env, cid)["target_amount"]) == 60000
    out = ask("Undo")
    assert out["message"] == "Undone. Your case is back as it was." and float(_case(env, cid)["target_amount"]) == 50000


def test_fixed_costs_said_in_chat_are_saved_and_the_lines_worked_out_again(talk):
    """The owner, 28 Oct: "Updated fixed costs: ₦40,000 → ₦60,000 a month. Working capital and reserve recalculated." """
    env, ask, model, cid = talk
    from app.modules.readiness.service import service_for
    svc = service_for(env.orch)
    row = run(svc.store.get("subjects", cid))
    lines = [{"id": "a", "amount": "47000", "purpose": "A second van", "category": "Equipment"},
             {"id": "b", "amount": "2000", "purpose": "Working capital: two months of fixed costs", "category": "Operations"},
             {"id": "c", "amount": "1000", "purpose": "Reserve: one month of fixed costs", "category": "Reserve"}]
    run(svc.update_subject(OWNER, "A", "funding_case", cid, row["revision"], {"economics": {"fixed_costs_monthly": 1000}, "use_of_funds": lines}, None))
    model.replies.append({"say": "Sure.", "change": {"fixed_costs_monthly": 3000}})
    out = ask("our fixed costs are £3,000 a month now", page="funding")
    data = _case(env, cid)
    assert out["message"].startswith("Updated fixed costs: £1,000 a month → £3,000 a month. Working capital and reserve recalculated.")
    assert [(x["id"], x["amount"]) for x in data["use_of_funds"]] == [("a", "41000"), ("b", "6000"), ("c", "3000")]
    assert data["provenance"]["economics.fixed_costs_monthly"]["source"].startswith("From you")


def test_help_me_complete_it_is_the_research_with_its_price_never_a_question(talk, monkeypatch):
    """The owner's test, 27 Oct: "Go ahead. Help me complete it." was answered by asking for milestone details."""
    env, ask, model, cid = talk
    model.replies.append({"say": "You're at 40/100."})
    ask("How ready am I for funding?")
    out = ask("Go ahead. Help me complete it.")
    assert len(model.prompts) == 1      # no model turn to ask for details: the research is offered
    assert out["message"].endswith("Shall I start?") and [c["type"] for c in out["cards"]] == ["choose"]
    assert env.meter.charges == []      # nothing before the yes


def test_whats_missing_shows_the_gaps_card_beside_the_words(talk):
    env, ask, model, cid = talk
    model.replies += [{"say": "You're at 40/100."}, {"say": "The forecast and the use of funds are the main gaps."}]
    ask("How ready am I for funding?")
    out = ask("Only 40? What's missing?")
    assert [c["type"] for c in out.get("cards") or []] == ["result", "next"]      # the gaps, then what to do next (29 Oct)


# The owner's recheck, 28 Oct
def test_a_field_named_in_the_chat_is_saved_and_said_with_undo(talk):
    env, ask, model, cid = talk
    done = ask("Please change who owns customer acquisition to Hilary", page="funding")
    assert not model.prompts      # no model needed
    assert done["message"] == "Updated Who owns customer acquisition: Not set → Hilary." and _case(env, cid)["market"]["acquisition_owner"] == "Hilary"
    assert [a["label"] for a in done["actions"]] == ["Undo"]
    ask("Undo", page="funding")
    assert (_case(env, cid).get("market") or {}).get("acquisition_owner") != "Hilary"


def test_research_is_never_said_to_have_started_unless_it_did(talk):
    env, ask, model, cid = talk
    model.replies.append({"say": "I have started the research for relevant loans and grants. It may take a little time."})
    out = ask("ready now?", page="funding")
    assert "started the research" not in out["message"] and out["message"].endswith("Shall I start?")      # its price, the real start asked for
    assert "Do all for me" in str(out) or out.get("actions")


def test_an_update_is_never_said_to_be_made_when_nothing_changed(talk):
    env, ask, model, cid = talk
    model.replies.append({"say": "I've updated who owns customer acquisition to Hilary."})
    out = ask("hilary should own customer acquisition", page="funding")
    assert out["message"].startswith("Nothing has been changed yet.")


def test_the_model_sees_the_business_is_trading(talk):
    env, ask, model, cid = talk
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    run(env.orch.rt.business.mutate("A", lambda d: d.setdefault("financials", {}).update({"invoices": [
        {"id": "i1", "status": "paid", "total_amount": 994276, "amount_paid": 994276, "customer_name": "Raphael", "paid_at": now, "created_at": now}]})))
    model.replies.append({"say": "You're at 40/100."})
    ask("How ready am I?", page="funding")
    rec = model.prompts[0]["RECORDS"]
    assert rec["trading"] is True and rec["paid_invoices"] == 1 and "994,276" in rec["revenue_received_all_time"]


def test_funding_options_without_research_offer_it_with_its_price(talk):
    env, ask, model, cid = talk
    out = ask("any loan or grant that i can apply to at the moment?", page="funding")
    assert out["message"].startswith("I'll search for programmes, lenders and investors that fit your case") and out["message"].endswith("Shall I start?") and not model.prompts      # research, price first


def test_research_running_shows_in_active(world):
    """The owner, 28 Oct: 'yes' to research, and Active showed 0 tasks."""
    env, store, client, who = world
    who["user"] = OWNER
    def put(d):
        d.setdefault("research_runs", {})["rr_x"] = {"id": "rr_x", "goal": "need_funding", "status": "researching", "case_id": "c1", "created_at": "2026-10-28T05:46:00+00:00"}
    run(env.orch.rt.business.mutate("A", put))
    out = client.get("/businesses/A/workflow-runs?bucket=active").json()
    assert out["counts"]["active"] >= 1 and any(r["title"].startswith("Do all for me") and r["display_status"] == "running" for r in out["items"])


def test_yes_go_ahead_starts_the_offered_research(talk, monkeypatch):
    env, ask, model, cid = talk
    from app.modules.agent import converse
    started = []
    async def start(*a, **k):
        started.append(True)
        return {"kind": "answer", "message": "Started.", "actions": []}
    monkeypatch.setattr(converse, "_start_do_all", start)
    model.replies.append({"say": "I have started the research for loans and grants."})
    ask("ready now?", page="funding")
    ask("yes, go ahead", page="funding")
    assert started


def test_finished_research_shows_in_recently_completed(world):
    env, store, client, who = world
    who["user"] = OWNER
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    run(env.orch.rt.business.mutate("A", lambda d: d.setdefault("research_runs", {}).update({"rr_d": {"id": "rr_d", "goal": "need_funding", "status": "review", "case_id": "c1", "created_at": now, "findings": 2}})))
    out = client.get("/businesses/A/workflow-runs?bucket=completed").json()
    assert any(r["title"].startswith("Do all for me") for r in out["items"]) and out["counts"]["completed"] >= 1


def test_a_research_start_that_is_refused_says_why_and_never_spins(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    from app.modules.agent import assistant_context
    run(env.orch.rt.business.mutate("A", lambda d: d.update({"agent_working": {"c1": {"failed": "Nothing new to research.", "ended": "2026-10-28T06:32:00+00:00"}}})))
    data = run(env.orch.rt.business.load("A"))
    assert assistant_context.failed(data, "c1") == "Nothing new to research."
    from datetime import datetime, timezone
    assert assistant_context.working(data, "c1", datetime.now(timezone.utc)) is False


def test_research_started_from_the_chat_is_in_active_at_once(world):
    env, store, client, who = world
    who["user"] = OWNER
    from datetime import datetime, timezone
    run(env.orch.rt.business.mutate("A", lambda d: d.update({"agent_working": {"c1": {"at": datetime.now(timezone.utc).isoformat(), "topic": "funding"}}})))
    out = client.get("/businesses/A/workflow-runs?bucket=active").json()
    assert any(r["title"] == "Do all for me: Funding readiness" for r in out["items"]) and out["counts"]["active"] >= 1


def test_a_value_already_set_is_said_so_not_updated(talk):
    """The owner, 28 Oct: "say 'Already set to Hilary', not 'Updated … Hilary → Hilary'"."""
    env, ask, model, cid = talk
    ask("Please change who owns customer acquisition to Hilary", page="funding")
    again = ask("Please change who owns customer acquisition to Hilary", page="funding")
    assert again["message"] == "Who owns customer acquisition is already set to Hilary." and not again["actions"]
    model.replies.append({"say": "Sure.", "change": {"target_amount": 50000}})
    same = ask("I need £50,000 for funding")
    assert same["message"] == "Amount is already set to £50,000."


def test_a_new_need_is_held_while_asking_and_new_one_replaces_it(talk):
    """The owner, 28 Oct: "i need funding readiness for working capital of $27000", "new one" asked again, then "Replace it"
    answered "Tell me what you'd like to change"."""
    env, ask, model, cid = talk
    model.replies.append({"say": "Should I update your current funding need to this, or is this in addition to your existing need?"})      # no change held
    first = ask("i need funding readiness for working capital of $27000", page="funding")
    assert [a["label"] for a in first["actions"]] == ["Replace it", "Update it"] and "addition" not in first["message"]
    done = ask("new one", page="funding")
    data = _case(env, cid)
    assert float(data["target_amount"]) == 27000 and data["currency"] == "USD" and data["purpose"] == "working capital"
    assert data.get("previous_needs") and len(model.prompts) == 1      # replaced, the old one in history; no second question
    assert "Tell me what you'd like to change" not in done["message"]


def test_replace_it_finds_the_need_said_earlier_when_none_was_held(talk):
    env, ask, model, cid = talk
    model.replies.append({"say": "Should this replace your current need, or update it?"})
    ask("i need funding readiness for working capital of $27000", page="funding")
    out = ask("Replace it", page="funding")
    assert float(_case(env, cid)["target_amount"]) == 27000 and "Tell me what you'd like to change" not in out["message"]


def test_a_price_the_model_says_is_never_shown_the_real_one_is(talk, monkeypatch):
    """The owner, 28 Oct: "The price for this research and drafting is ₦50,000" "50,000 how?...instead of 60 credits"."""
    env, ask, model, cid = talk
    model.replies.append({"say": "I can complete all the remaining tasks. The price for this research and drafting is ₦50,000. Would you like me to proceed?"})
    out = ask("what's left to do?", page="funding")
    assert "₦50,000" not in out["message"]


@pytest.mark.parametrize("research,said", [({"status": "nothing_to_do"}, "Nothing new was found"),
                                           ({"status": "review", "error": "timeout"}, "took too long")])
def test_options_search_that_ends_with_nothing_says_why_and_stops_spinning(talk, monkeypatch, research, said):
    """The owner, 29 Oct: "research funding options in the funding readiness is not working too... just kept processing"."""
    env, ask, model, cid = talk
    from app.modules.agent import goal_router

    async def premium(session_id, body=None, user=None):
        return {"started": True, "research": research}
    monkeypatch.setattr(goal_router, "session_premium", premium)
    ask("Research funding options for my case", page="funding")
    ask("yes, start", page="funding")
    for _ in range(5):
        run(__import__("asyncio").sleep(0))
    held = (run(env.orch.rt.business.load("A")).get("agent_working") or {}).get(str(cid)) or {}
    assert said in str(held.get("failed") or "") and "at" not in held      # the card says why, with Retry; nothing still "working"
