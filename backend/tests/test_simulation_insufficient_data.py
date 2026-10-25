"""QA PF4 (Blueprint AC-2, §11): with no revenue or costs on record a simulation doesn't run and isn't charged; it says
what is missing and offers the owner's own pricing answers as a baseline labelled "Estimate". No "Loss of Largest
Client" without a client; ratios are typed (unavailable, unbounded), never 1.00 from zeros; the narrative only
describes the engine and says "not enough data" when that's the case."""
import pytest

from app.modules.scenario_intelligence import router as si
from app.modules.scenario_intelligence import service as svc
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot
from test_agent import OWNER
from test_goal_onboarding import world  # noqa: F401  (the fixture)

EMPTY = {"revenue_monthly": 0, "expenses_monthly": 0, "cost_of_sales_monthly": 0, "starting_cash": 0}


def _run(client, template="tmpl_revenue_drop", state=None, **params):
    return client.post("/v1/scenario-intelligence/scenario-runs", json={
        "tenant_id": "A", "business_id": "A", "state_version": "v1", "scenario_template_id": template, "scenario_mode": "manual",
        "scenario_name": "Test", "parameters": {"timeline_months": 3, **params}, "state": state or EMPTY})


@pytest.fixture
def open_plan(monkeypatch):
    async def allowed(*_a, **_k):
        return None
    monkeypatch.setattr(si, "_require_scenario", allowed)      # the plan gate is tested on its own (test_paid_features_...)

    async def nowhere(table, docs):
        return True
    monkeypatch.setattr(svc, "_safe_insert", nowhere)


def test_no_revenue_or_costs_no_run_and_what_is_missing_said(world, open_plan):  # noqa: F811
    _env, _s, client, who = world
    who["user"] = OWNER
    r = _run(client)
    assert r.status_code == 422
    d = r.json()["detail"]
    assert d["error"] == "INSUFFICIENT_DATA" and d["missing"] == ["Monthly revenue", "Monthly costs"]
    assert "Nothing was run and nothing was charged." in d["message"] and d["estimate"] is None


def test_the_owner_s_pricing_answers_are_offered_as_an_estimate_and_used_only_when_chosen(world, open_plan):  # noqa: F811
    env, _s, client, who = world
    who["user"] = OWNER
    client.post("/businesses/A/quick-check/price_offer", json={"answers": {"sell": "Dog walking", "price": 70, "monthly_sales": 25, "cost": 10}})
    d = _run(client).json()["detail"]
    assert d["estimate"]["label"] == "Estimate" and d["estimate"]["basis"] == "£70 × 25 a month, from your pricing check"
    assert d["estimate"]["state"] == {"revenue_monthly": 1750.0, "cost_of_sales_monthly": 250.0, "expenses_monthly": 0}
    ran = _run(client, use_estimate=True)
    assert ran.status_code == 200, ran.text


def test_no_loss_of_largest_client_without_a_client(world, open_plan):  # noqa: F811
    _env, _s, client, who = world
    who["user"] = OWNER
    r = _run(client, "tmpl_client_loss", state={**EMPTY, "revenue_monthly": 1000, "expenses_monthly": 400, "clients_count": 0})
    assert r.status_code == 422 and r.json()["detail"]["error"] == "NO_CLIENT_ON_RECORD"
    ok = _run(client, "tmpl_client_loss", state={**EMPTY, "revenue_monthly": 1000, "expenses_monthly": 400, "clients_count": 3, "top_client_share_pct": 60})
    assert ok.status_code == 200


def test_ratios_are_typed_never_1_from_zeros():
    assert svc.typed_ratios(0, 0, 0) == (None, "unavailable", 0.0, "ok", None, "unavailable")
    assert svc.typed_ratios(-500, -200, 300) == (None, "unavailable", None, "unbounded", None, "unbounded")
    assert svc.typed_ratios(1000, 500, 200) == (2.0, "ok", 0.2, "ok", 0.4, "ok")
    timeline, _m = svc._timeline(BusinessStateSnapshot(**EMPTY), "revenue_drop", {"timeline_months": 3}, 3)
    assert all(t["cash_conversion_ratio"] is None and t["cash_conversion_state"] == "unavailable" for t in timeline)


def test_at_risk_months_come_from_the_projection():
    assert svc.at_risk_months([{"month_index": 1, "state_label": "stable"}, {"month_index": 2, "state_label": "at_risk"}, {"month_index": 3, "state_label": "critical"}]) == [2, 3]


def test_the_narrative_says_not_enough_data_with_no_model_call_and_no_charge(world, monkeypatch):  # noqa: F811
    _env, _s, client, who = world
    who["user"] = OWNER

    async def a_run(_id):
        return {"scenario_run_id": "s1", "baseline_snapshot": EMPTY}
    monkeypatch.setattr(si, "get_scenario_run", a_run)
    called = []

    async def never(*a, **k):
        called.append(a)
        raise AssertionError("the model was asked")
    monkeypatch.setattr(si, "generate_scenario_interpretation", never)
    out = client.post("/v1/scenario-intelligence/scenario-runs/s1/explain").json()
    assert out["not_enough_data"] is True and "not enough data" in out["interpretation"].lower() and called == []


def test_the_narrative_prompt_only_describes_the_engine():
    import inspect
    src = inspect.getsource(svc.generate_scenario_interpretation)
    assert "Only describe the engine output above" in src and '"not enough data"' in src


def test_a_what_if_runs_on_the_figures_the_risk_check_read(world, open_plan, monkeypatch):  # noqa: F811
    """R-4 (the owner, 25 Oct): "lose them" opened from the risk check said "not enough on record" while the risk check had
    the records. The run and the baseline read the same figures (agent/figures.py), so the scenario runs."""
    from test_round12_risk_chat_e2e import _signed_in
    env, _s, client, who = world
    _signed_in(env, who, monkeypatch)      # Delta Offices Ltd paid £450; £68.50 of expenses
    r = _run(client, "tmpl_client_loss", client_loss_pct=100)      # Simulation's own figures were all zero
    assert r.status_code == 200, r.text
    base = client.post("/v1/scenario-intelligence/do-nothing/run", json={"tenant_id": "A", "business_id": "A", "state_version": "v1",
                                                                       "timeline_months": 3, "state": EMPTY, "parameters": {}})
    assert base.status_code == 200, base.text      # the page's first projection: never the banner
    from app.modules.agent import figures
    f = figures.of(env.businesses["A"]["data"])
    filled = __import__("asyncio").run(si.shared_state({"id": OWNER, "email": OWNER}, "A", BusinessStateSnapshot(**EMPTY)))
    assert (filled.revenue_monthly, filled.expenses_monthly, filled.starting_cash, filled.top_client_share_pct) == (f["revenue_monthly"], f["costs_monthly"], f["cash"], 100.0)


def test_losing_a_client_worth_all_the_revenue_is_judged_at_full_effect_never_neutral():
    """The owner, 25 Oct: losing a 100% client read "Neutral impact" (judged on month 1, half of it gone)."""
    st = BusinessStateSnapshot(revenue_monthly=150, expenses_monthly=22.83, costs_monthly=22.83, starting_cash=381.5, top_client_share_pct=100, clients_count=1)
    _tl, m = svc._timeline(st, "client_loss", {"client_loss_pct": 100, "timeline_months": 6}, 6)
    assert m["scenario_metrics"]["monthly_revenue"] == 0
    assert svc._result_state(m["baseline_metrics"]["stability_score"], m["scenario_metrics"]["stability_score"]) == "worse"


def test_the_page_s_run_keeps_its_name_and_its_100_percent_and_reads_back_as_worse(world, open_plan, monkeypatch):  # noqa: F811
    """The owner, 25 Oct: "Loss of Delta Offices Ltd" at 100% read back as "Loss of Largest Client", £150 to £105, Neutral."""
    async def kept_in_memory(table, docs):
        return False
    monkeypatch.setattr(svc, "_safe_insert", kept_in_memory)
    _env, _s, client, who = world
    who["user"] = OWNER
    state = {**EMPTY, "revenue_monthly": 150, "expenses_monthly": 22.83, "costs_monthly": 22.83, "starting_cash": 381.5,
             "top_client_share_pct": 100, "clients_count": 1}
    made = client.post("/v1/scenario-intelligence/scenario-runs", json={
        "tenant_id": "A", "business_id": "A", "state_version": "v1", "scenario_template_id": "tmpl_client_loss", "scenario_mode": "manual",
        "scenario_name": "Loss of Delta Offices Ltd", "parameters": {"timeline_months": 6, "client_loss_pct": 100}, "state": state})
    assert made.status_code == 200, made.text
    run = client.get(f"/v1/scenario-intelligence/scenario-runs/{made.json()['scenario_run_id']}").json()
    assert run["scenario_name"] == "Loss of Delta Offices Ltd"
    assert run["scenario_metrics"]["monthly_revenue"] == 0 and run["state_result"] == "worse"


def test_a_month_s_status_follows_the_months_its_cash_covers_never_a_fixed_amount():
    """The owner, 25 Oct: October, profitable with £381.50 against £22.83 a month, was "at risk" for being under £500."""
    assert svc._classify_health_status(net_profit=127.17, cash_balance=381.5, total_costs=22.83) == "stable"
    assert svc._classify_health_status(net_profit=-22.83, cash_balance=381.5, total_costs=22.83) == "tight"      # losing money
    assert svc._classify_health_status(net_profit=-10, cash_balance=50, total_costs=22.83) == "stress"
    assert svc._classify_health_status(net_profit=-10, cash_balance=10, total_costs=22.83) == "at risk"
    assert svc._classify_health_status(net_profit=-10, cash_balance=-1, total_costs=22.83) == "critical"
    st = BusinessStateSnapshot(revenue_monthly=150, expenses_monthly=22.83, costs_monthly=22.83, starting_cash=381.5, top_client_share_pct=100, clients_count=1)
    tl, _m = svc._timeline(st, "client_loss", {"client_loss_pct": 100, "timeline_months": 6}, 6)
    assert tl[0]["state_label"] == "stable" and {t["state_label"] for t in tl[1:]} == {"tight"}
