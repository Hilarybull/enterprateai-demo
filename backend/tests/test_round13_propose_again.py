"""The owner, 26 Oct: "why wasn't it filled? What sets you apart?": a proposal the first answer left out (or said "not stated")
is asked once more, on its own; facts are never asked again."""
import asyncio
import json

from app.modules.agent import research


class _Llm:
    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []

    async def generate_text(self, **kw):
        self.calls.append(kw)
        return type("R", (), {"text": json.dumps({"fields": self.answers.pop(0)})})()


FIELDS = {k: research.CASE_DRAFT_FIELDS["need_funding"][k] for k in ("market.differentiation", "traction.summary", "market.location")}


def test_a_hedged_proposal_is_asked_once_more():
    llm = _Llm({"market.differentiation": "Not stated in the facts.", "traction.summary": "Two paying clients so far.", "market.location": "Toronto, Canada"},
               {"market.differentiation": "Senior consultants on every project, with fixed monthly fees for small firms in Toronto."})
    out = asyncio.run(research.draft_case_fields(llm, "need_funding", {"offer": "consulting"}, only=FIELDS))
    assert out["market.differentiation"].startswith("Senior consultants") and out["traction.summary"] == "Two paying clients so far."
    assert len(llm.calls) == 2 and "Never say it is not stated" in llm.calls[1]["system"]
    assert "market.differentiation" in llm.calls[1]["prompt"] and "traction.summary" not in llm.calls[1]["prompt"]      # facts never asked again


def test_nothing_asked_again_when_all_is_filled():
    llm = _Llm({"market.differentiation": "Fixed monthly fees.", "traction.summary": "None yet.", "market.location": "Toronto"})
    asyncio.run(research.draft_case_fields(llm, "need_funding", {}, only=FIELDS))
    assert len(llm.calls) == 1
