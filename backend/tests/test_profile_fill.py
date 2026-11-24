"""P0.3 and P0.4 (QA, 15 Oct): a flow fills only EMPTY workspace profile fields, with where it came from; a field the
owner set is never changed (a different value is asked once); Undo empties a filled field; research uses the result."""
from app.modules.agent import profile_fill, research

SAID = {"description": "A mobile car wash subscription", "customer": "busy professionals", "where": "Abuja", "stage": "trading", "monthly_sales": 40}


def test_after_a_flow_the_profile_shows_the_place_the_offer_and_the_model():
    d = {"workspace_profile": {"company_name": "Shine"}, "settings": {}}
    out = profile_fill.fill(d, SAID, "test_idea", currency="NGN")
    p = d["workspace_profile"]
    assert (p["country"], p["city"], p["state_or_region"], d["settings"]["currency"]) == ("Nigeria", "Abuja", "FCT", "NGN")
    assert p["primary_revenue_model"] == "subscription" and p["target_customer_type"] == "Busy professionals"
    assert p["services"][0]["service_name"] == "Mobile car wash subscription" and p["primary_industry"] == "other"
    assert p["operating_stage"] == "early_revenue" and p["about_company"] == "We offer a mobile car wash subscription for busy professionals in Abuja."
    assert d["profile_provenance"]["country"]["source"].startswith("From your idea check, ") and d["profile_provenance"]["about_company"]["suggestion"]
    assert "company_size" not in p and "business_type" not in p and "year_established" not in p      # never guessed
    assert set(out["filled"]) >= {"country", "city", "currency", "services", "target_customer_type"}


def test_a_filled_field_is_never_overwritten_and_a_conflict_asks_once():
    d = {"workspace_profile": {"country": "England", "city": "Leeds"}, "settings": {"currency": "GBP"}}
    out = profile_fill.fill(d, {"where": "Abuja"}, "need_funding", currency="NGN")
    assert out["filled"] == [] and d["workspace_profile"]["country"] == "England" and d["settings"]["currency"] == "GBP"
    assert {c["field"] for c in out["conflicts"]} == {"country", "currency"}
    c = next(x for x in d["profile_conflicts"] if x["field"] == "country")
    assert profile_fill.question(c) == "Your business profile says England, but you mentioned Nigeria. Update your profile?"
    assert [o["label"] for o in profile_fill.options(c)] == ["Update to Nigeria", "Keep England", "This was for one task only"]
    again = profile_fill.fill(d, {"where": "Abuja"}, "need_funding", currency="NGN")
    assert again["conflicts"] == []      # asked once
    assert profile_fill.resolve(d, "country", "keep") and d["workspace_profile"]["country"] == "England"


def test_undo_restores_a_filled_field_to_empty():
    d = {"workspace_profile": {}, "settings": {}}
    profile_fill.fill(d, SAID, "test_idea", currency="NGN")
    assert profile_fill.undo(d, "city") and "city" not in d["workspace_profile"] and "city" not in d["profile_provenance"]
    assert profile_fill.undo(d, "currency") and "currency" not in d["settings"]
    d["workspace_profile"]["country"] = "Ghana"      # the owner edited it since: Undo leaves it alone
    assert not profile_fill.undo(d, "country") and d["workspace_profile"]["country"] == "Ghana"


def test_the_research_context_uses_the_profile_s_country():
    d = {"workspace_profile": {}, "settings": {}}
    profile_fill.fill(d, SAID, "test_idea", currency="NGN")
    ctx = research.context_of(d, {"sell": "car wash"})
    assert ctx["country"] == "Nigeria" and ctx["place"] == "Abuja, FCT"


def test_the_backfill_fills_from_remembered_answers_and_is_safe_to_run_again():
    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
    from backfill_workspace_profiles import plan
    data = {"workspace_profile": {"country": "United Kingdom"}, "settings": {"currency": "GBP"},
            "quick_check_answers": {"launch": {"answers": {"sell": "Home cleaning", "customer": "Busy households", "where": "Leeds"}, "at": "2026-10-01T09:00:00+00:00"}}}
    once, done = plan(data)
    assert once["workspace_profile"]["city"] == "Leeds" and once["workspace_profile"]["country"] == "United Kingdom" and "city" in done["filled"]
    twice, again = plan(once)
    assert again["filled"] == [] and twice["workspace_profile"] == once["workspace_profile"]


INDUSTRY_OPTIONS = {"startup", "consulting", "technology", "finance", "healthcare", "education", "retail", "ecommerce", "logistics", "manufacturing",
                    "real_estate", "marketing", "other"}


def test_industry_is_always_a_list_value_and_drafted_text_is_grammatical():
    for offering in ("Mobile car wash", "Bookkeeping for cafes", "Online shop for shoes", "Car washing"):
        d = {"workspace_profile": {}, "settings": {}}
        profile_fill.fill(d, {"description": offering, "customer": "people that has car", "where": "Abuja"}, "test_idea")
        assert d["workspace_profile"]["primary_industry"] in INDUSTRY_OPTIONS
        about = d["workspace_profile"].get("about_company") or ""
        assert "that has" not in about and about == profile_fill.tidy(about)      # the grammar pass changes nothing more
    assert profile_fill.tidy("we offer car washing for people that has car") == "We offer car washing for people who have a car."
    assert profile_fill.tidy("We offer a apple pie for SMEs in in Leeds") == "We offer an apple pie for SMEs in Leeds."


def test_keep_keep_all_undo_and_redo():
    d = {"workspace_profile": {}, "settings": {}}
    profile_fill.fill(d, SAID, "test_idea", currency="NGN")
    assert profile_fill.keep(d, "city") and d["profile_provenance"]["city"]["kept"] and d["workspace_profile"]["city"] == "Abuja"
    assert profile_fill.undo(d, "country") and "country" not in d["workspace_profile"]
    assert profile_fill.redo(d, "country") and d["workspace_profile"]["country"] == "Nigeria"
    profile_fill.keep(d, "all")
    assert all(v.get("kept") for v in d["profile_provenance"].values()) and "profile_filled" not in d


def test_one_flow_fills_the_brand_fields_and_the_models_with_their_hints():
    d = {"workspace_profile": {"country": "Nigeria", "city": "Abuja"}, "settings": {}}
    profile_fill.fill(d, {"sell": "monthly car wash subscription", "customer": "Office workers in Abuja", "kind": "service"}, "launch")
    p = d["workspace_profile"]
    assert (p["primary_revenue_model"], p["delivery_model"], d["settings"]["currency"]) == ("subscription", "manual", "NGN")
    brief = profile_fill.brand_brief(d)
    assert brief["fields"] == ["tagline", "vision", "mission", "core_values"] and "Office workers in Abuja" == brief["customer"]
    got = profile_fill.apply_brand(d, {"tagline": "Clean cars while you work", "vision": "Every office car park in Abuja has clean cars.",
                                       "mission": "We wash cars where people work.", "core_values": ["Reliability", "Care", "Honest pricing"]})
    assert got == ["tagline", "vision", "mission", "core_values"]
    assert all(d["profile_provenance"][f]["source"] == "Suggested by the Agent" for f in got)
    assert profile_fill.apply_brand(d, {"tagline": "Something else entirely"}) == []      # never over a filled field
