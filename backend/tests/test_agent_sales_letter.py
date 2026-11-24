"""A sales letter asked of the Agent is drafted with Business Blueprints' own generator and saved there, charged as the
price list's Complete Sales Letter. "Sales letter" was read as a question about revenue ("No revenue is recorded yet")."""
from app.modules.agent import intent
from app.modules.credits.catalogue import default_config
from test_agent import OWNER, Env, run


def test_sales_letter_words_start_the_sales_letter_task():
    for text in ("write a sales letter for my bookkeeping service", "Create a sales-letter to cafe owners", "I need sales letters"):
        r = Env(plan="starter_insight", credits=50).submit(text=text)
        assert r["kind"] == "workflow" and r["run"]["workflow_key"] == "sales_letter_draft", text


def test_it_is_drafted_saved_in_blueprints_and_charged_at_its_own_price():
    env = Env(plan="starter_insight", credits=50)
    env.meter.costs["sales_letter_full"] = 10
    x = env.submit(text="write a sales letter for my bookkeeping service")["run"]
    for _ in range(3):
        q = x.get("pending_question")
        if not q:
            break
        x = run(env.orch.provide_input(x["id"], OWNER, {f["key"]: (f["options"][0]["value"] if f.get("options") else "Independent cafés in Leeds") for f in q["fields"]}))
    assert x["status"] == "succeeded" and x["summary"].startswith("Sales letter draft ready for review")
    assert x["state"]["outcome"]["links"] == [{"label": "Sales letter", "to": "/blueprint?tab=sales-docs"}]
    assert [c[0] for c in env.orch.rt.studio.calls] == ["draft_sales_letter"]
    assert env.meter.charges == [(OWNER, "sales_letter_full", 10)] and default_config("sales_letter_full")      # on the price list; no Agent charge on top
