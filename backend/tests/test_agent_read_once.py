"""Reading an enquiry costs once per task (QA P0-4): answering the questions that follow must not
charge "Reading the enquiry" again, however many times the task carries on."""
from app.modules.agent.services import Classifier
from test_agent import OWNER, Env, run


class Model(Classifier):
    available = True

    def __init__(self):
        self.calls = 0

    async def choose(self, *, task, text, options, user_id):
        self.calls += 1
        return "quote_request" if "quote_request" in options else options[0]

    async def extract_items(self, *, text, user_id):
        self.calls += 1
        return [{"name": "Office deep clean", "quantity": 3}]


def test_reading_the_same_enquiry_again_is_not_charged_again():
    from app.modules.agent.orchestrator import Ctx
    from app.modules.agent.workflows import WORKFLOWS
    env = Env(plan="starter_insight", credits=50)
    model = Model()
    env.orch.rt.classifier = model
    r = env.submit(text="Prepare a quotation for ABC Ltd for 3 deep cleans of their office")["run"]
    text = "Hello, could you help us with something for our offices next month?"
    for _ in range(3):      # the task carries on three times after three answers: each time it reads the enquiry again
        ctx = Ctx(orch=env.orch, run=r, wf=WORKFLOWS["enquiry_to_quote"], actor=env.actor() if hasattr(env, "actor") else None,
                  policy={}, limits={}, owner_id=OWNER)
        ctx.actor = ctx.actor or type("A", (), {"user_id": OWNER})()
        run(ctx.classify_enquiry(text))
        assert run(ctx.extract_items(text)) == [{"name": "Office deep clean", "quantity": 3}]
    # QA E7: for a quotation the reading is part of its advertised price, so it is never charged on top...
    assert [c for c in env.meter.charges if c[1] == "agent_classify"] == []
    assert model.calls == 2                                                 # ...and it is still read once: sorted once and its items read once, then reused
    run(ctx.extract_items("A different enquiry about a kitchen refit"))      # different words are a new reading, still not charged
    assert model.calls == 3 and [c for c in env.meter.charges if c[1] == "agent_classify"] == []


def test_e7_a_quotation_from_a_pasted_enquiry_costs_what_it_said():
    env = Env(plan="starter_insight", credits=50)
    env.orch.rt.classifier = Model()
    res = env.submit(text="Customer enquiry from sam@test.example: Hi, can you quote me for 1 home clean? Thanks")
    r = res["run"]
    spent = sum(c[2] for c in env.meter.charges)
    advertised = 2                                                          # "2 credits to prepare the quotation" (then 2 when sent)
    assert spent <= advertised, env.meter.charges
    assert all(c[1] != "agent_classify" for c in env.meter.charges)
    assert r["workflow_key"] == "enquiry_to_quote"
