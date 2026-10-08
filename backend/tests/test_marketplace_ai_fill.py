"""AI fill for the public description: written from what the business has on record, never saved for the owner."""
import pytest

from app.modules.marketplace import directory as dx
from test_agent import OWNER
from test_marketplace_claim import OUTSIDER, U, Env, run, svc_of

WRITTEN = "We run strategy workshops and financial reviews for small firms across Leeds, helping leadership teams set direction and understand their numbers."


def _writer(reply, seen):
    async def write(prompt):
        seen.append(prompt)
        return reply
    return write


def test_it_writes_from_the_business_details_and_saves_nothing():
    env = Env()
    s = svc_of(env)
    data = env.businesses["A"]["data"]
    data["financials"]["invoices"] = [{"id": "i1", "customer_name": "BrightTech Ltd", "total_amount": 1500}]
    before = dx.marketplace_settings(data)["profile"]["description"]
    seen = []
    out = run(s.suggest_description(U(OWNER), "A", {"description": "M" * 31, "service_area": "Leeds", "service_tags": ["Pricing"]}, _writer(f'  "{WRITTEN}"  ', seen)))
    assert out == {"suggestion": WRITTEN}
    prompt = seen[0]
    assert "Business name: Apex Consulting" in prompt and "Location or service area: Leeds" in prompt and "Services: Pricing" in prompt
    assert "Strategy Workshop (A one-day strategy workshop for leadership teams.)" in prompt      # offerings, with what is said about them
    assert "MMMMM" not in prompt                                            # placeholder text is not passed on as fact
    for private in ("BrightTech", "1500", "base_price", "cost_of_sales"):
        assert private not in prompt                                        # customers and money never go to the writer
    assert "Do not invent" in prompt and "no em or en dashes" in prompt
    assert dx.marketplace_settings(data)["profile"]["description"] == before  # nothing saved


def test_dashes_are_taken_out_and_a_reply_that_is_not_real_text_is_refused():
    env = Env()
    s = svc_of(env)
    out = run(s.suggest_description(U(OWNER), "A", {}, _writer("We help small firms set prices that hold \u2014 and keep them. Workshops and reviews, for owners.", [])))
    assert "\u2014" not in out["suggestion"] and "\u2013" not in out["suggestion"]
    for junk in ("", "aaaaaaaaaaaaaaaaaaaaaaaaaaaa", "ok"):
        with pytest.raises(dx.Invalid) as stop:
            run(s.suggest_description(U(OWNER), "A", {}, _writer(junk, [])))
        assert "couldn't be written" in stop.value.errors["description"]


def test_only_someone_who_manages_the_business_can_ask():
    env = Env()
    s = svc_of(env)
    seen = []
    with pytest.raises(dx.NotFound):
        run(s.suggest_description(U(OUTSIDER), "A", {}, _writer(WRITTEN, seen)))
    assert seen == []                                                       # nothing was written, so nothing was charged


def test_services_come_back_as_a_short_clean_list():
    env = Env()
    s = svc_of(env)
    seen = []
    out = run(s.suggest_services(U(OWNER), "A", {"description": "We run strategy workshops for small firms."}, _writer("Strategy Workshops, Financial Reviews; strategy workshops,\nPricing Advice, aaaaaaa, x, A very long thing that is not a service at all really", seen)))
    assert out == {"suggestion": "Strategy Workshops, Financial Reviews, Pricing Advice"}
    assert "Offerings: Strategy Workshop; Financial Review; Unpriced Service" in seen[0] and "1500" not in seen[0]
    with pytest.raises(dx.Invalid):
        run(s.suggest_services(U(OWNER), "A", {}, _writer("", [])))
    with pytest.raises(dx.NotFound):
        run(s.suggest_services(U(OUTSIDER), "A", {}, _writer("Pricing", [])))

