"""One funding case per business, which every review updates (an archived one reactivated); a figure the case already
holds differently is said, never overwritten, until the owner chooses the review's. Research is consistent: the same
check with the same figures is the run already made, free; sources are for the business's own country, a page title is
not a quote, and "nothing was found" is asked, not charged."""
import asyncio
import copy
from datetime import datetime, timezone

from app.modules.agent import assessment_summary, credibility, research
from app.modules.readiness import rules
from app.modules.readiness.service import service_for
from test_agent import OWNER, Env, run
from test_premium_research import WORKSPACES, _orch, answers_for

USER = {"id": OWNER, "email": OWNER}
NOW = datetime(2026, 10, 14, 9, 0, tzinfo=timezone.utc)
QUOTE = "Around 1.2 million households in the UK paid for a regular cleaner in the last year, the survey found."


def test_a_review_updates_the_one_funding_case_reactivating_it_and_says_what_it_kept():
    env = Env()
    svc = service_for(env.orch)
    case = run(svc.create_subject(OWNER, "A", rules.FUNDING, {"title": "£25,000 for marketing", "economics": {"price": "60"}}, OWNER))
    run(svc.set_status(OWNER, "A", rules.FUNDING, case["id"], "archive", OWNER))
    fed = run(assessment_summary.feed(env.orch, USER, "A", "need_funding", {"price": 65, "cost": 20}, {}, "review:t:1"))
    rows = run(svc.store.list("subjects", "A", kind=rules.FUNDING))
    assert len(rows) == 1 and rows[0]["status"] != "archived" and fed["reactivated"] == "£25,000 for marketing"
    assert rows[0]["data"]["economics"]["price"] in ("60", 60, 60.0) and str(rows[0]["data"]["economics"]["direct_cost"]) in ("20", "20.0")      # empty field filled
    assert fed["differences"] == [{"field": "price", "label": "price per sale", "case_value": rows[0]["data"]["economics"]["price"], "review_value": 65}]
    used = run(assessment_summary.use_figures(env.orch, USER, "A", "funding", {"price": 65}, "use:t:1"))
    assert used is not None and float(run(svc.store.list("subjects", "A", kind=rules.FUNDING))[0]["data"]["economics"]["price"]) == 65


def test_a_source_must_be_for_the_businesss_own_country_and_say_more_than_its_title():
    us = "https://legacy.sba.gov/events"
    page = {"ok": True, "url": us, "title": "Find upcoming events | U.S. Small Business Administration", "publisher": "legacy.sba.gov",
            "published": "2026-10-14", "text": "Find upcoming events | U.S. Small Business Administration. " + QUOTE}
    item = {"id": "x", "label": "Grants", "value": "v", "confidence": 0.8, "topic": "route_grant"}
    title_only = credibility.judge(item, [{"url": us, "quote": "Find upcoming events | U.S. Small Business Administration", "region": "UK"}],
                                   {us: page}, {"country": "United Kingdom"}, NOW, False)
    assert title_only["kind"] == "missing"
    us_site = credibility.judge(item, [{"url": us, "quote": QUOTE, "region": ""}], {us: page}, {"country": "United Kingdom"}, NOW, False)
    assert us_site["kind"] == "missing" and "United States" in us_site["dropped_sources"][0]["why"]
    nowhere = credibility.judge(item, [{"url": "https://www.bbc.co.uk/x", "quote": QUOTE, "region": "UK"}],
                                {"https://www.bbc.co.uk/x": {**page, "url": "https://www.bbc.co.uk/x"}}, {"country": ""}, NOW, False)
    assert nowhere["kind"] == "missing"      # the business's country isn't known: nothing can be matched to it


def test_the_country_comes_from_the_currency_when_the_profile_does_not_say():
    assert research.context_of({"workspace_profile": {}, "settings": {"currency": "GBP"}}, {})["country"] == "United Kingdom"


def test_nothing_found_is_asked_not_adopted():
    topics = [{"topic": "route_grant", "criterion": "materials", "label": "Grants"}]
    raw = {"items": [{"topic": "route_grant", "value": "No grant funding specifically for this was found in the pages.", "basis": "researched",
                      "confidence": 0.6, "results": [1]}]}
    assert research.read_items(raw, topics, {1: {"topic": "route_grant", "url": "https://www.gov.uk/x", "title": "t", "date": ""}}, NOW) == []


def test_the_same_research_asked_again_is_the_run_already_made_and_free(monkeypatch):
    from test_s5_credible_research import _Model, _Search, page
    monkeypatch.setattr(research, "connected", lambda: {"connected": True, "search": True, "model": True})
    data = copy.deepcopy(WORKSPACES["uk_home_services_pre_launch"]["data"])
    orch, meter = _orch(data, 100)
    answers = answers_for("uk_home_services_pre_launch", "launch", data)

    async def fetch(url):
        return page(url)
    go = lambda: asyncio.run(research.start(orch, user={"id": OWNER}, business_id="W", goal="launch", answers=answers, data=data,      # noqa: E731
                                            search=_Search(), llm=_Model(), fetcher=fetch))
    first = go()
    charged = list(meter.charges)
    again = go()
    assert again["id"] == first["id"] and again.get("repeat") and meter.charges == charged


def test_research_that_runs_too_long_is_said_and_free(monkeypatch):
    monkeypatch.setattr(research, "connected", lambda: {"connected": True, "search": True, "model": True})
    monkeypatch.setattr(research, "RESEARCH_SECONDS", 0.2)
    data = copy.deepcopy(WORKSPACES["uk_home_services_pre_launch"]["data"])
    orch, meter = _orch(data, 100)

    class Slow:
        async def __call__(self, queries):
            await asyncio.sleep(1)
            return {}
    r = asyncio.run(research.start(orch, user={"id": OWNER}, business_id="W", goal="launch", answers=answers_for("uk_home_services_pre_launch", "launch", data),
                                   data=data, search=Slow(), llm=object()))
    assert r["error"] == "timeout" and r["charged"] == 0 and meter.charges == []
    assert any(x.get("question", "").startswith("The research took too long just now") for x in r["items"])
