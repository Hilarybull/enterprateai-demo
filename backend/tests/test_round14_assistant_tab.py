"""The owner's mockups, 27 Oct ("exactly like the mockups"): the Assistant tab's side column and the cards the conversation
shows. A stand-in model; no real model, search or charge."""
from datetime import timedelta

from test_goal_onboarding import world, _funding, OWNER, run  # noqa: F401
from test_round14_converse_funding import _Model
from app.modules.agent import assistant_context, research


def test_the_side_column_reads_the_business_records_and_invents_nothing(world):
    env, store, client, who = world
    who["user"] = OWNER
    out = client.get("/businesses/A/agent/assistant-context?kind=funding").json()
    assert set(out) >= {"business", "revenue", "records", "activity", "approvals", "research", "working"}
    assert [r["key"] for r in out["records"]] == ["profile", "revenue", "customers", "pricing", "costs", "sales"]
    assert out["revenue"]["months"] == [0.0] * 12 or len(out["revenue"]["months"]) == 12


def test_another_business_is_not_found(world):
    env, store, client, who = world
    who["user"] = "someone-else"
    assert client.get("/businesses/A/agent/assistant-context").status_code == 404


def test_records_and_revenue_from_the_records_only():
    now = __import__("datetime").datetime(2026, 10, 27, tzinfo=__import__("datetime").timezone.utc)
    data = {"workspace_profile": {"company_name": "Acme", "primary_industry": "Software", "city": "London", "country": "UK"},
            "catalogue": {"customers": [{"id": "c1", "name": "Northbridge", "created_at": (now - timedelta(days=1)).isoformat()}]},
            "financials": {"invoices": [{"id": "i1", "status": "paid", "total_amount": 1200, "customer_name": "Northbridge", "paid_at": (now - timedelta(days=40)).isoformat()}]}}
    rows = {r["key"]: r["available"] for r in assistant_context.records_check(data, "funding")}
    assert rows == {"profile": True, "revenue": True, "customers": True, "pricing": False, "costs": False, "sales": True}
    rev = assistant_context.revenue(data, now)
    assert rev["total"] == 1200 and rev["months"][10] == 1200 and sum(rev["months"]) == 1200
    acts = assistant_context.activity(data, now)
    assert [a["kind"] for a in acts] == ["customer_added", "invoice_paid"]


def test_a_first_look_at_the_case_shows_what_was_checked_and_the_result(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    _funding(client, amount=50000, use="a second van")
    model = _Model({"say": "You're at 40/100 so far."}, {"say": "The forecast is next."})
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: model)
    ask = lambda t: client.post("/agent/requests", json={"business_id": "A", "text": t, "source_channel": "text"}).json()      # noqa: E731
    first = ask("I need funding for my business")
    assert [c["type"] for c in first["cards"]] == ["records", "result"]
    again = ask("thanks, and when do funders usually reply?")
    assert not again.get("cards")      # only once, unless the model shows them


def test_the_model_can_show_a_card_and_an_unknown_one_is_dropped():
    from app.modules.agent.converse import cards_for
    assert cards_for({"show": ["next", "made_up"]}, False, True, "c1", None, None) == [{"type": "next", "case_id": "c1"}]
    assert cards_for({}, False, True, "c1", 40, 52)[-1] == {"type": "score_change", "case_id": "c1", "before": 40, "after": 52}
    assert cards_for({"show": ["result"]}, True, False, None, None, None) == []


def test_drafts_are_adopted_by_typing_and_only_on_the_owners_word(world, monkeypatch):
    """The mockups: "The use of funds looks ok, but let me edit the market evidence", "...keep this customer segment. Adopt it"."""
    from app.modules.agent import draft_review
    data = {"purpose": "a van", "agent_drafts": {"purpose": {"value": "a second van and a driver", "source": "from research"},
                                                 "traction.customers": {"value": 120, "source": "from your records"},
                                                 "market.size": {"value": "UK vans, 2bn", "source": "from research"}}}
    keep = {"accept": ["purpose"], "edit": {"traction.customers": "100"}, "reject": ["market.size"]}
    assert draft_review.decided("How's it looking?", keep, data) is None      # nothing applied without their word
    dec = draft_review.decided("Keep the purpose, make customers 100 and adopt it. Drop the market size.", keep, data)
    assert dec == {"accept": {"purpose": "a second van and a driver", "traction.customers": 100.0}, "reject": ["market.size"]}
    out = draft_review.changes_for(dec, data)
    assert out["purpose"] == "a second van and a driver" and out["traction"] == {"customers": 100.0}
    assert out["agent_drafts"] == {} and out["rejected_drafts"] == ["market.size"]
    assert draft_review.decided("adopt all of them", {"accept": "all"}, data)["accept"].keys() == data["agent_drafts"].keys()
    assert draft_review.decided("adopt it", {"accept": ["not.a.draft"]}, data) is None      # only drafts that are waiting


def test_a_draft_that_already_matches_its_field_is_not_waiting():
    from app.modules.agent import draft_review
    assert draft_review.waiting({"purpose": "a van", "agent_drafts": {"purpose": {"value": "a van"}}}) == {}


def test_funding_from_the_landing_page_opens_the_cases_assistant(world):
    env, store, client, who = world
    who["user"] = OWNER
    _sid, made = _funding(client, amount=50000, use="a second van")
    out = client.post("/agent/readiness-question", json={"business_id": "A", "text": "I need funding"}).json()
    cid = str(made["handoff"]["subject_id"])
    assert out == {"kind": "funding", "converse": True, "case_id": cid, "to": f"/funding/{cid}?tab=assistant"}


def test_drafted_spending_lines_follow_the_case_as_it_is_now():
    """The owner's test, 27 Oct: ₦10,000,000 of lines against a ₦25,000,000 ask, "Hiring staff" after the case moved to an
    equipment purchase, and "Reserve: one month of fixed costs" named twice."""
    from app.modules.readiness.service import ReadinessService
    lines = [{"category": "People", "amount": "8880000", "purpose": "Hire staff necessary for the business"},
             {"category": "Operations", "amount": "740000", "purpose": "Working capital: two months of fixed costs"},
             {"category": "Reserve", "amount": "380000", "purpose": "Reserve: one month of fixed costs", "rationale": "Reserve: one month of fixed costs"}]
    out = ReadinessService.lines_checked(lines, {"target_amount": "25000000", "purpose": "buy car wash equipment"})
    assert sum(float(x["amount"]) for x in out) == 25000000
    assert out[0]["purpose"] == "Buy car wash equipment" and out[0]["category"] == "Equipment"
    assert out[2]["rationale"] != out[2]["purpose"]
    assert ReadinessService.lines_checked(out, {"target_amount": "25000000", "purpose": "buy car wash equipment"}) == out      # already right: unchanged


def test_the_case_title_follows_its_amount_and_purpose_but_never_one_the_owner_wrote(world):
    """The owner's test, 27 Oct: "₦25m funding for the funding is to hire staff necessary for..." after the case moved to equipment."""
    from app.modules.agent.goals import need_title
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for
    env, store, client, who = world
    svc = service_for(env.orch)
    first = {"target_amount": "25000000", "currency": "NGN", "purpose": "the funding is to hire staff necessary for the business"}
    made = run(svc.create_subject(OWNER, "A", rules.FUNDING, {**first, "title": need_title(first)}))
    assert run(svc.store.get("subjects", made["id"]))["data"]["title"].endswith("to hire staff necessary for the business")
    row = run(svc.store.get("subjects", made["id"]))
    run(svc.update_subject(OWNER, "A", rules.FUNDING, made["id"], row["revision"], {"purpose": "buy car wash equipment"}))
    assert run(svc.store.get("subjects", made["id"]))["data"]["title"].endswith("to buy car wash equipment")
    row = run(svc.store.get("subjects", made["id"]))
    run(svc.update_subject(OWNER, "A", rules.FUNDING, made["id"], row["revision"], {"title": "Seed round"}))
    row = run(svc.store.get("subjects", made["id"]))
    run(svc.update_subject(OWNER, "A", rules.FUNDING, made["id"], row["revision"], {"purpose": "open a second site"}))
    assert run(svc.store.get("subjects", made["id"]))["data"]["title"] == "Seed round"


def test_trading_status_comes_from_the_records_as_the_dashboard_reads_them():
    """The owner's test, 27 Oct: "Not trading yet" in the same sentence as two paying customers and ₦994,276 this month."""
    from datetime import datetime, timezone
    from app.modules.agent import dashboard, first_value
    now = datetime.now(timezone.utc)
    data = {"workspace_profile": {"operating_stage": "pre_revenue"},
            "financials": {"invoices": [{"id": f"i{n}", "status": "paid", "total_amount": 500000, "customer_name": who, "paid_at": now.isoformat(), "created_at": now.isoformat()}
                                        for n, who in enumerate(["Ada", "Bola"])]}}
    assert dashboard.stage_of(data, now)["stage"] not in ("idea", "pre_launch")
    assert first_value.known_answers("need_funding", data).get("stage") == "trading"
    assert first_value.known_answers("need_funding", {"workspace_profile": {"operating_stage": "pre_revenue"}}).get("stage") == "pre_revenue"


def test_a_title_made_before_purposes_were_cleaned_still_follows_the_case():
    """The owner, 27 Oct: "₦25m funding for the funding is to hire staff necessary for…" was never made again."""
    from app.modules.agent.goals import is_made_title, need_title
    f = {"target_amount": 25000000, "currency": "NGN", "purpose": "the funding is to hire staff necessary for the expansion of our car wash"}
    assert is_made_title("₦25m funding for the funding is to hire staff necessary for…", f)
    assert is_made_title(need_title(f), f) and is_made_title("", f)
    assert not is_made_title("Seed round for vans", f)      # one the owner wrote stays theirs
    assert need_title(f).startswith("₦25m funding to hire staff")
