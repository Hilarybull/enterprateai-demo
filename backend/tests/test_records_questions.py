"""The owner, 1 Nov: "how many invoices do i have" started a new invoice ("it can't answer simple questions"). A question about
the records is answered from them; asking for something new still starts the task."""
from test_agent_qa import env, client, call  # noqa: F401


def _ask(client, text):
    return call(client, "POST", "/agent/requests", {"business_id": "A", "text": text, "source_channel": "text"}).json()


def test_a_question_about_invoices_is_answered_from_the_records(env, client):  # noqa: F811
    d = env.businesses["A"]["data"]
    d.setdefault("financials", {})["invoices"] = [
        {"reference": "INV-1", "customer_name": "Joe", "currency": "GBP", "line_items": [{"quantity": 1, "unit_price": 200}], "created_at": "2026-10-30"},
        {"reference": "INV-2", "customer_name": "Laura", "currency": "GBP", "line_items": [{"quantity": 2, "unit_price": 50}], "created_at": "2026-10-31"}]
    for text in ("how many invoices do i have", "What invoices do I have?", "list my invoices", "show me my invoices"):
        out = _ask(client, text)
        assert out["kind"] == "answer" and out["message"].startswith("You have 2 invoices"), (text, out)
        assert "INV-2 for Laura" in out["message"] and not out.get("run")


def test_asking_for_one_still_starts_it(env, client):  # noqa: F811
    for text, key in (("create an invoice for Joe, 2 cakes at 50", "new_invoice"), ("draft an invoice", "new_invoice"), ("I need a quotation", "enquiry_to_quote")):
        out = _ask(client, text)
        assert out["kind"] == "workflow" and out["run"]["workflow_key"] == key, (text, out)


def test_any_question_is_answered_never_a_task_guessed_from_a_word_in_it(env, client):  # noqa: F811
    for text in ("which customers owe me money?", "do I have a business plan?", "when is my launch date?", "is my business registered?",
                 "what plan am I on?", "who paid?", "has Laura paid?"):
        out = _ask(client, text)
        assert out["kind"] in ("answer", "assistant") and not out.get("run"), (text, out)


def test_saying_someone_paid_records_it(env, client):  # noqa: F811
    for text in ("mark laura paid", "laura paid", "Laura has paid", "mark INV-1 as paid"):
        d = env.businesses["A"]["data"]
        d.setdefault("financials", {})["invoices"] = [{"id": "i1", "reference": "INV-1", "customer_name": "Laura", "currency": "GBP", "status": "sent",
                                                       "line_items": [{"quantity": 1, "unit_price": 200}]}]
        out = _ask(client, text)
        assert out["kind"] == "workflow" and out["run"]["workflow_key"] == "record_payment", (text, out)


def test_what_a_message_waits_on_survives_saving_and_a_reload():
    """The owner, 1 Nov: "no response", and "Done" said twice: a save kept only the words, so a price, a question, a run being
    followed and the mark that a result was already said were all lost on reload."""
    from app.modules.agent.router import _chat_message
    kept = _chat_message({"role": "assistant", "content": "It costs 40 credits.", "at": "2026-11-01T14:00:00Z", "announced": True,
                          "confirm": {"capability": "business_plan_draft", "params": {"idea": "designer scarfs"}},
                          "task": {"capability": "business_plan_draft", "params": {}, "fields": [{"key": "purpose", "label": "Who will read it?"}]},
                          "follow": {"run_id": "r1"}, "asks": {"key": "customer", "answers": {"goal": "20"}}, "answers": {"goal": "20"},
                          "prompts": [{"label": "Not sure", "prompt": "Not sure", "value": "unknown"}],
                          "cards": [{"type": "pending", "case_id": "c1"}, {"type": "check_card", "card": {"head": "1 thing to fix."}}], "secret": "dropped"})
    assert kept["confirm"]["params"]["idea"] == "designer scarfs" and kept["task"]["capability"] == "business_plan_draft"
    assert kept["follow"] == {"run_id": "r1"} and kept["announced"] is True and kept["asks"]["key"] == "customer" and kept["answers"] == {"goal": "20"}
    assert kept["prompts"][0]["value"] == "unknown" and "secret" not in kept
    assert [c["type"] for c in kept["cards"]] == ["pending", "check_card"] and kept["cards"][1]["card"]["head"] == "1 thing to fix."
    assert "confirm" not in _chat_message({"role": "user", "content": "hi", "confirm": {"big": "x" * 7000}})      # never a large blob


def test_a_research_question_the_case_already_answers_is_not_asked_again():
    """The owner, 1 Nov: "why bring fills that are already... approved for filling"."""
    from app.modules.agent.goal_router import _without_answered
    items = [{"id": "a", "kind": "question", "field": "team"}, {"id": "b", "kind": "question", "field": "contracts"}, {"id": "c", "kind": "question", "field": "monthly_sales"},
             {"id": "d", "kind": "question", "field": "customers", "decision": "answered"}, {"id": "e", "kind": "researched", "field": "team"}]
    case = {"team": {"responsibilities": [{"owner": "Ada"}]}, "traction": {"summary": ""}, "market": {"target_segment": "Brides"}}
    assert [x["id"] for x in _without_answered(items, case)] == ["b", "c", "d", "e"]


def test_a_draft_or_bookkeeping_never_makes_a_result_out_of_date():
    """The owner, 1 Nov: "The last result is out of date" after the Agent only added drafts, so the steps looked unmoved."""
    from app.modules.readiness.service import ReadinessService
    hash_of = lambda **extra: ReadinessService._hashes({"subject": {"id": "c", "target_amount": 400, **extra}, "forecast": None, "evidence": []})["all"]      # noqa: E731
    base = hash_of()
    assert base == hash_of(agent_drafts={"market.location": {"value": "Leeds"}}, rejected_drafts=["x"], last_person_revision=4, filled_from_records=["y"])
    assert base != hash_of(purpose="stock")      # a real answer still counts


def test_a_question_answered_from_the_records_costs_one_chat_reply(env, client):  # noqa: F811
    """The owner, 1 Nov: "2 credits... it's agentic": once per answer, the price never in the words."""
    chats = lambda: [c for c in env.meter.charges if c[1] == "chat_message"]      # noqa: E731
    before = len(chats())
    out = _ask(client, "how many invoices do i have")
    assert out["kind"] == "answer" and len(chats()) == before + 1 and "credit" not in out["message"].lower()
    assert _ask(client, "create an invoice for Joe, 2 cakes at 50")["kind"] == "workflow" and len(chats()) == before + 1      # a task is priced as a task
