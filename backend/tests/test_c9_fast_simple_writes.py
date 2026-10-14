"""C9: a simple record (a customer, a catalogue item) is written in a few seconds even when the model is slow: past its
time budget the rules read the message, and the owner confirms what was read, as always."""
import asyncio
import time

from app.modules.agent import config, services
from test_agent import OWNER, Env, run


class _Slow(services.Classifier):
    available = True

    async def read_fields(self, *, system, prompt, user_id):
        await asyncio.sleep(30)      # a provider that hangs
        return "{}"


def test_add_customer_and_add_item_finish_quickly_with_a_hanging_model(monkeypatch):
    monkeypatch.setattr(config, "FIELD_READ_SECONDS_SIMPLE", 0.2)
    env = Env()
    env.orch.rt.classifier = _Slow()
    for text, answers in (("Add customer Nova Labs, dana@novalabs.test", None), ("add Oven deep clean to my catalogue at £65", None)):
        t0 = time.perf_counter()
        r = env.submit(text=text)["run"]
        if r.get("pending_question"):      # "Is this right?": what the rules read, to confirm
            r = run(env.orch.provide_input(r["id"], OWNER, {f["key"]: f.get("default") for f in r["pending_question"]["fields"]}))
        assert time.perf_counter() - t0 < 5 and r["status"] == "succeeded", r.get("summary")
        assert r["state"]["understood"]["by"] == "rules"
    assert [c["name"] for c in env.businesses["A"]["data"]["catalogue"]["customers"] if c["name"] == "Nova Labs"]


def test_every_simple_write_is_a_real_task():
    from app.modules.agent.workflows import WORKFLOWS
    assert config.SIMPLE_WRITES <= set(WORKFLOWS) and config.FIELD_READ_SECONDS_SIMPLE <= 5


SIMPLE = {"add_customer": "Add customer Nova Labs, dana@novalabs.test", "add_vendor": "add a supplier called Tools to Go, orders@toolstogo.test",
          "add_catalogue_item": "add Gutter clearing to my catalogue at £95", "record_expense": "Record an expense: £30 on parking today",
          "update_record": "change the price of Strategy Workshop to £1,600", "marketplace_offering": "list my Strategy Workshop on the marketplace"}


def test_when_the_rules_read_it_every_value_is_shown_to_confirm_before_anything_is_saved(monkeypatch):
    monkeypatch.setattr(config, "FIELD_READ_SECONDS_SIMPLE", 0.2)
    for capability, text in SIMPLE.items():
        env = Env()
        env.orch.rt.classifier = _Slow()                                    # the model too slow: the rules read it
        before = repr(env.businesses["A"]["data"])
        r = env.submit(text=text)["run"]
        assert r["workflow_key"] == capability and r["state"]["understood"]["by"] == "rules", capability
        assert r.get("pending_question") and r["pending_question"]["fields"], capability      # shown to confirm
        assert repr(env.businesses["A"]["data"]) == before, capability                       # nothing saved yet
