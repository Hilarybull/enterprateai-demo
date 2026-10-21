"""The owner's QA (17 Oct): an edited figure, then a refresh, must never buy the same research again. Research depends on
the business, place, route and stage; figures are worked out again for free."""
from datetime import datetime, timezone

from app.modules.agent import research

RUN = {"id": "rr_1", "goal": "need_funding", "status": "review", "created_at": datetime.now(timezone.utc).isoformat(), "counts": {"sources": 1},
       "answers": {"amount": 50000, "route": "grant", "stage": "trading", "timing": "In 3 to 6 months"},
       "inputs": {"cost": 6000.0, "price": 15000.0, "sell": "car wash"}, "topics": ["grants", "market_size"], "context": {"country": "Nigeria"},
       "fingerprint": "an-old-style-key"}
DATA = {"research_runs": {"rr_1": RUN}}


def test_a_changed_figure_reuses_the_research_free():
    fp = research.fingerprint_of({**RUN["answers"], "amount": 25000, "timing": "Now"}, {**RUN["inputs"], "cost": 3000.0}, ["market_size", "grants"], "nigeria")
    assert research.reusable(DATA, "need_funding", fp)["id"] == "rr_1"      # a run saved before this rule matches too
    assert research.research_state(DATA, "need_funding", answers={**RUN["answers"], "amount": 25000})["state"] == "review"


def test_a_different_route_or_place_is_new_research():
    assert research.reusable(DATA, "need_funding", research.fingerprint_of({**RUN["answers"], "route": "loan"}, RUN["inputs"], RUN["topics"], "Nigeria")) is None
    assert research.reusable(DATA, "need_funding", research.fingerprint_of(RUN["answers"], RUN["inputs"], RUN["topics"], "Ghana")) is None
    assert research.research_state(DATA, "need_funding", answers={**RUN["answers"], "route": "loan"})["state"] == "stale"


def test_a_new_topic_from_a_figure_set_aside_is_not_new_research():
    fp = research.fingerprint_of(RUN["answers"], RUN["inputs"], RUN["topics"] + ["bench_monthly_sales"], "Nigeria")
    assert research.reusable(DATA, "need_funding", fp)["id"] == "rr_1"
