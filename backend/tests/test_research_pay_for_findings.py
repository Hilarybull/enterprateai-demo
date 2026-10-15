"""Research is paid for by what it finds, up to the check's price (credit allocation v2): nothing found leaves the
balance as it was; some found is charged per finding, the rest of the maximum given straight back; the quote's maximum,
the confirm and the most charged are one figure."""
import asyncio
import copy

from test_premium_research import OWNER, WORKSPACES, Model, Pages, Search, _orch, answers_for
from app.modules.agent import research


def _run(ws, goal, search, balance=200):
    data = copy.deepcopy(WORKSPACES[ws]["data"])
    orch, meter = _orch(data, balance)
    r = asyncio.run(research.start(orch, user={"id": OWNER}, business_id="W", goal=goal, answers=answers_for(ws, goal, data), data=data,
                                   search=search, llm=Model(), fetcher=Pages()))
    return r, meter


def test_nothing_found_leaves_the_balance_unchanged():
    r, meter = _run("uk_cafe_idea", "need_funding", Search(empty=True))
    assert r["charged"] == 0 and meter.balances[OWNER] == 200 and meter.charges == []
    assert r["counts"]["sources"] == 0


class Some(Search):
    """Results for the first two topics only."""
    async def __call__(self, queries):
        out = await super().__call__(queries)
        keep = list(out)[:2]
        return {k: (v if k in keep else []) for k, v in out.items()}


def test_some_found_is_charged_per_finding_and_the_rest_given_back():
    r, meter = _run("uk_cafe_idea", "need_funding", Some())
    topics = len(r["topics"])
    found = len({x["topic"] for x in r["items"] if research.billable(x) and x.get("sources")})
    assert 0 < found < topics
    per = research.per_finding(60, topics)
    assert r["charged"] == min(60, found * per) and meter.balances[OWNER] == 200 - r["charged"]
    assert meter.refunds and meter.refunds[0][1] == 60 - r["charged"]      # reserved the maximum, the rest given back at once


def test_the_maximum_is_the_price_list_s_and_never_exceeded():
    r, meter = _run("uk_cafe_idea", "need_funding", Search())
    assert r["charged"] <= 60 and research.feature_of("need_funding") == "research_funding_readiness"
