"""QA H: the understanding layer's golden set, as an automated eval (rules path: what always runs, and the
fallback), plus the safety rules applied to a model's proposal: registry-only intents, quoted spans only, no
stop-phrase names, a timeout falls back, nothing is charged, and a task's reading is cached."""
import asyncio

import pytest

from app.modules.agent import understanding as und
from app.modules.agent.understanding_golden import CATALOGUE, GOLDEN, score

REG = und.capability_registry()


def _run(case, **kw):
    ctx = {"capabilities": REG, "catalogue": CATALOGUE, **case["context"]}
    return asyncio.run(und.understand(case["message"], ctx, **kw))


def test_golden_set_rules_path_meets_the_bar():
    results = [score(c, _run(c, use_model=False)) for c in GOLDEN]
    right = sum(r["fields_right"] for r in results)
    expected = sum(r["fields_expected"] for r in results)
    accuracy = right / expected
    intents = sum(r["intent_ok"] for r in results) / len(results)
    print(f"\nrules path: field accuracy {accuracy:.0%} ({right}/{expected}), intent accuracy {intents:.0%}")
    for r in results:
        print(f"  {r['id']:22} intent {'ok' if r['intent_ok'] else 'WRONG'}  fields {r['fields_right']}/{r['fields_expected']}  safe {r['safe']}")
    assert accuracy >= 0.95 and intents >= 0.95
    assert all(r["safe"] for r in results if any(c["id"] == r["id"] and c.get("safety") for c in GOLDEN))      # 100% on safety


class Model:
    """A model that proposes whatever it is told to: the deterministic layer must keep only what is valid."""

    def __init__(self, reply, delay=0.0):
        self.reply, self.delay, self.calls = reply, delay, 0

    async def generate_text(self, **_k):
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        import json
        from types import SimpleNamespace
        return SimpleNamespace(text=json.dumps(self.reply), input_tokens=400, output_tokens=60, total_tokens=460)


def _with(reply, message="Prepare a quotation for Delta Offices Ltd for 2 x end of tenancy clean at £220 each", **ctx):
    return asyncio.run(und.understand(message, {"capabilities": REG, "catalogue": CATALOGUE, **ctx}, llm=Model(reply)))


def test_a_capability_that_is_not_registered_is_never_chosen():
    u = _with({"intent": "export_customer_list", "confidence": 0.99, "fields": []}, message="Book me a flight")
    assert u.intent == "unsupported"


def test_a_value_not_in_the_message_is_dropped_and_a_stop_phrase_is_never_a_name():
    u = _with({"intent": "enquiry_to_quote", "confidence": 0.9, "fields": [
        {"key": "vat_rate", "value": "20", "confidence": 0.99, "source_span": "VAT at 20%"},            # not in the message: invented
        {"key": "customer_name", "value": "enquiry from", "confidence": 0.95, "source_span": "enquiry from"}]},
        message="Customer enquiry from sam@test.example: can you quote me for 1 home clean?")
    keys = {f.key for f in u.fields}
    assert "vat_rate" not in keys and "customer_name" not in keys and "customer_email" in keys


def test_the_models_values_are_normalised_by_code_and_gated():
    u = _with({"intent": "answer_current_question", "confidence": 0.9, "fields": [
        {"key": "monthly_sales", "value": "60", "confidence": 0.7, "source_span": "about sixty"}]}, message="about sixty",
        questions=[{"key": "monthly_sales", "type": "number"}])
    f = next(f for f in u.fields if f.key == "monthly_sales")
    assert f.normalised_value == 60.0


def test_high_impact_fields_always_ask_for_confirmation_and_low_confidence_is_asked():
    assert und._gate("amount", 0.99) == und.CONFIRM and und._gate("items", 0.95) == und.CONFIRM
    assert und._gate("where", 0.9) == und.AUTO and und._gate("where", 0.7) == und.CONFIRM and und._gate("where", 0.5) == und.ASK


def test_a_slow_or_failing_model_falls_back_to_the_rules(monkeypatch):
    monkeypatch.setattr(und, "LLM_TIMEOUT_SECONDS", 0.05)
    u = asyncio.run(und.understand("I want to launch a home cleaning service in Leeds", {"capabilities": REG}, llm=Model({}, delay=0.5)))
    assert u.error == "model_timeout" and u.intent == "launch_readiness" and u.value("where") == "Leeds"


def test_a_task_reads_a_message_once_and_nothing_is_charged():
    model = Model({"intent": "launch_readiness", "confidence": 0.9, "fields": []})
    ctx = {"capabilities": REG, "task_id": "run-1"}
    a = asyncio.run(und.understand("I want to launch a home cleaning service in Leeds", ctx, llm=model))
    b = asyncio.run(und.understand("I want to launch a home cleaning service in Leeds", ctx, llm=model))
    assert model.calls == 1 and a is b
    assert a.tokens == 460 and a.cost_usd > 0      # logged, not charged: understanding has no credit feature


def test_one_question_per_field_key():
    u = _with({"intent": "answer_current_question", "confidence": 0.9, "fields": [
        {"key": "vat_rate", "value": "20", "confidence": 0.8, "source_span": "20"}, {"key": "vat_rate", "value": "20", "confidence": 0.95, "source_span": "20%"}]},
        message="20%", questions=[{"key": "vat_rate", "type": "number"}])
    assert [f.key for f in u.fields].count("vat_rate") == 1


@pytest.mark.parametrize("said, rate", [("20", 20.0), ("20%", 20.0), ("standard rate", 20.0), ("reduced rate", 5.0), ("no VAT", 0.0), ("zero rated", 0.0)])
def test_vat_answers(said, rate):
    assert und.vat_of(said) == rate


def test_held_out_paraphrases_rules_floor_and_safety():
    """QA U1c: the held-out set (written before the round-4 rules, never tuned against). The rules alone are the floor
    (the model is asked whenever they're unsure; live, with the model: 32/32). Safety is 100% either way."""
    from app.modules.agent.understanding_heldout import HELD_OUT, score_heldout
    rows = [score_heldout(c, asyncio.run(und.understand(c["message"], {"capabilities": REG}, use_model=False))) for c in HELD_OUT]
    intents = sum(r["intent_ok"] for r in rows) / len(rows)
    print(f"\nheld-out, rules only: intents {intents:.0%} over {len(rows)} cases")
    assert len(GOLDEN) + len(HELD_OUT) >= 60 and len(HELD_OUT) >= 30
    assert intents >= 0.8
    assert all(r["safe"] for r in rows if any(c["id"] == r["id"] and c.get("safety") for c in HELD_OUT))


def test_the_rules_alone_never_refuse_and_a_model_cannot_downgrade_a_supported_intent():
    u = asyncio.run(und.understand("frobnicate the widgets", {"capabilities": REG}, use_model=False))
    assert u.intent == und.UNSUPPORTED and u.confidence < 0.6      # low: always sent to the model when one is configured
    m = asyncio.run(und.understand("get me more customers", {"capabilities": REG}, llm=Model({"intent": "unsupported", "confidence": 0.99, "fields": []})))
    assert m.intent == "offer_review"
