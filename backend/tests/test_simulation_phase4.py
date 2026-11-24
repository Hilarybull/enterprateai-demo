"""Simulation audit, Phase 4 (model projection-1.3): docs/simulation-audit/07-phase4-changes.md.

1. Seasonality only when it passes the F-test for stable seasonality (1%).
2. Running short of cash judged over the months ahead; a business already overdrawn today is said to be.
3. The low-high range: a 90% forecast range from the business's own history.
4. Confidence also reflects how predictable the sales are.
5. Every simulation endpoint checks that the caller may see the business (404 otherwise).
6. Clearing history clears only that business's runs.
"""
import math
from datetime import date

import pytest

from app.modules.scenario_intelligence import baseline as B
from app.modules.scenario_intelligence import projection as P
from app.modules.scenario_intelligence import router as si
from app.modules.scenario_intelligence import service as svc
from app.modules.scenario_intelligence import uncertainty as U
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as S
from test_agent import MEMBER, OUTSIDER, OWNER
from test_goal_onboarding import world  # noqa: F401  (the fixture)


# ── 1. Seasonality ────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("f,d1,d2,alpha", [(2.75, 10, 12, 0.05), (4.30, 10, 12, 0.01), (2.72, 11, 12, 0.05),
                                           (3.09, 11, 24, 0.01), (4.96, 1, 10, 0.05)])
def test_f_test_p_values_match_published_f_tables(f, d1, d2, alpha):
    """Critical values from standard F tables: the p-value at the critical value is the table's level."""
    assert B.f_test_p_value(f, d1, d2) == pytest.approx(alpha, abs=0.0006)


def _series(values, start=(2024, 1)):
    out, (y, m) = [], start
    for v in values:
        out.append(((y, m), v))
        y, m = (y, m + 1) if m < 12 else (y + 1, 1)
    return out


def test_noise_without_a_seasonal_pattern_is_not_seasonal():
    """24 months of 100 ± 2 in a pattern unrelated to the calendar: F = 0.80 on (11, 12), p = 0.64."""
    t = B.seasonality_test(_series([100 + ((t * 7) % 5 - 2) for t in range(24)]))
    assert t["df"] == (11, 12) and t["f_stat"] == pytest.approx(0.797, abs=0.001) and not t["significant"]


def test_a_real_seasonal_pattern_is_seasonal():
    """The same noise on a ±30% calendar pattern: F = 92.4, p < 0.0001."""
    t = B.seasonality_test(_series([100 * (1 + 0.3 * math.cos(2 * math.pi * (t % 12) / 12)) + ((t * 7) % 5 - 2) for t in range(24)]))
    assert t["f_stat"] == pytest.approx(92.41, abs=0.01) and t["significant"]


def test_the_baseline_applies_seasonality_only_when_significant():
    """Two businesses with 24 complete months, run on 15 Jan 2026: the steady one gets no seasonal pattern (model 1.2 gave
    it one), the seasonal one does. Both report the test."""
    steady = {f"{y:04d}-{m:02d}": v for (y, m), v in _series([100 + ((t * 7) % 5 - 2) for t in range(24)])}
    seasonal = {f"{y:04d}-{m:02d}": v for (y, m), v in _series([100 * (1 + 0.3 * math.cos(2 * math.pi * (t % 12) / 12)) for t in range(24)])}
    a = B.build_baseline(S(revenue_by_month=steady), date(2026, 1, 15))["revenue"]
    b = B.build_baseline(S(revenue_by_month=seasonal), date(2026, 1, 15))["revenue"]
    assert a["seasonality_applied"] is False and "no statistically significant" in a["seasonality_note"]
    assert a["seasonality_test"]["significant"] is False
    assert b["seasonality_applied"] is True and b["seasonality_test"]["significant"] is True
    short = B.build_baseline(S(revenue_by_month=dict(list(steady.items())[:12])), date(2025, 1, 15))["revenue"]
    assert short["seasonality_test"] is None and "24 complete months needed" in short["seasonality_note"]


# ── 2. Already overdrawn today ────────────────────────────────────────────────────────────────────────────────────

def test_a_loan_that_clears_an_overdraft_is_an_improvement():
    """Revenue 10,000 = expenses 10,000 (profit 0), customers pay at once, cash -5,000 today, 6 months, no date.
    No change: cash stays at -5,000 every month.
    £20,000 loan at 0% over 12 months, received in month 1: month 1 cash = -5,000 + 20,000 = 15,000; months 2-6 repay
    1,666.67 each -> month 6 cash 15,000 - 5 x 1,666.67 = 6,666.67, never below zero from month 1.
    Model 1.2 counted today in both, so both "ran short" from the same month and the verdict fell through to
    "no material change" (net cash: 6,666.67 - 11,666.67 owed = -5,000, the same as doing nothing).
    Model 1.3: cash is back above zero from month 1 where it would stay below -> improved, and it says cash is below today."""
    st = S(revenue_monthly=10000, expenses_monthly=10000, starting_cash=-5000, payment_terms_days=0)
    _r, base = P.project(st, "do_nothing_projection", {}, 6)
    _r, scen = P.project(st, "take_loan", {"loan_amount": 20000, "loan_annual_rate_pct": 0, "loan_term_months": 12, "loan_start_month": 1}, 6)
    assert base["overdrawn_today"] is True and base["min_cash_ahead"] == -5000 and base["first_negative_month_ahead"] == 1
    assert scen["min_cash_ahead"] == pytest.approx(6666.67, abs=0.01) and scen["first_negative_month_ahead"] is None
    v = P.compare_projections(base, scen)
    assert v["outcome"] == "improved" and v["cash_shortfall_removed"] is True and v["cash_below_zero_today"] is True
    assert "below zero today" in v["reason"]


def test_older_summaries_without_the_new_fields_are_still_judged():
    """Runs saved before 1.3 have no min_cash_ahead: the verdict uses the whole period, as before."""
    base = dict(total_revenue=60000, total_costs=60000, closing_cash=1000, cumulative_profit=0, min_cash=500, first_negative_cash_month=None)
    scen = dict(base, closing_cash=-2000, min_cash=-2000, first_negative_cash_month=3)
    assert P.compare_projections(base, scen)["outcome"] == "worse"


# ── 3. The range ──────────────────────────────────────────────────────────────────────────────────────────────────

def test_the_revenue_range_by_hand():
    """Six complete months 100, 110, 90, 100, 110, 90 (Jan-Jun 2026), run on 15 Jul, 6 months ahead.
    Mean 100. Least squares: x - 2.5 = -2.5..2.5, Sxx = 17.5, slope = -20 / 17.5 = -1.142857.
    Residual sum of squares 377.143 -> sd = sqrt(377.143 / 4) = 9.7101; slope standard error = 9.7101 / sqrt(17.5) = 2.3212.
    Slope-months carried (damped 0.9, mean over months 1-6 of sum_{k=1..m+2} 0.9^k) = 3.87631; undamped mean = 5.5.
    Variance shares: 0.0943/3 = 0.0031429; 0.0943/6 = 0.0015714; (2.3212 x 3.87631 / 100)^2 = 0.0080955;
    (1.142857 x (5.5 - 3.87631) / 100)^2 = 0.0003443. Sum 0.0131541 -> 0.114691.
    Range = 1.645 x 1.4 x 0.114691 = 0.26413 (±26%)."""
    hist = {f"2026-{m:02d}": v for m, v in zip(range(1, 7), [100, 110, 90, 100, 110, 90])}
    swing, basis = U.forecast_swing(hist, date(2026, 7, 15), 6, 0.15)
    assert swing == pytest.approx(0.26413, abs=0.0001) and "90% forecast range" in basis


def test_the_range_without_history_keeps_the_stated_defaults():
    assert U.forecast_swing({}, date(2026, 7, 15), 6, 0.15)[0] == 0.15
    assert U.forecast_swing({"2026-06": 100}, date(2026, 7, 15), 6, 0.10)[0] == 0.10


def test_the_range_is_wider_for_a_longer_horizon_with_a_trend_and_never_beyond_its_bounds():
    hist = {f"2025-{m:02d}": 1000 + 40 * m + (25 if m % 2 else -25) for m in range(1, 13)}
    s6, _ = U.forecast_swing(hist, date(2026, 1, 15), 6, 0.15)
    s24, _ = U.forecast_swing(hist, date(2026, 1, 15), 24, 0.15)
    assert U.MIN_SWING <= s6 < s24 <= U.MAX_SWING


# ── 4. Confidence ─────────────────────────────────────────────────────────────────────────────────────────────────

def test_confidence_reflects_how_predictable_sales_are():
    """12+ months (+2). A ±25% range: -1 -> 1 point, medium. A ±40% range: -2 -> 0, medium. ±15%: high."""
    baseline = {"revenue": {"complete_months_on_record": 14}}
    inputs = [{"input": "Monthly revenue", "label": "from your history"}]
    st = S(revenue_monthly=1000, payment_terms_days=30)
    assert U.confidence(st, "do_nothing_projection", {}, baseline, inputs, revenue_range=0.15)["level"] == "high"
    mid = U.confidence(st, "do_nothing_projection", {}, baseline, inputs, revenue_range=0.25)
    assert mid["points"] == 1 and any("vary noticeably" in r for r in mid["reasons"])
    wide = U.confidence(st, "do_nothing_projection", {}, baseline, inputs, revenue_range=0.40)
    assert wide["points"] == 0 and any("vary a lot" in r for r in wide["reasons"])


# ── 5. Access ─────────────────────────────────────────────────────────────────────────────────────────────────────

EMPTY_STATE = {"revenue_monthly": 0, "expenses_monthly": 0}


def test_someone_without_access_gets_not_found_from_every_business_endpoint(world, monkeypatch):  # noqa: F811
    """OUTSIDER owns business B, not A. Everything about A answers 404, saying nothing about it."""
    _env, _s, client, who = world
    who["user"] = OUTSIDER
    body = {"tenant_id": OUTSIDER, "business_id": "A", "state_version": "v1", "state": EMPTY_STATE}
    calls = [
        client.post("/v1/scenario-intelligence/do-nothing/run", json=body),
        client.post("/v1/scenario-intelligence/risk-detection/run", json=body),
        client.post("/v1/scenario-intelligence/accuracy", json=body),
        client.post("/v1/scenario-intelligence/intelligence/run", json=body),
        client.post("/v1/scenario-intelligence/scenario-runs", json={**body, "scenario_template_id": "tmpl_revenue_drop",
                                                                      "scenario_mode": "manual", "scenario_name": "x"}),
        client.get("/v1/scenario-intelligence/history", params={"business_id": "A", "tenant_id": OUTSIDER}),
        client.delete("/v1/scenario-intelligence/history", params={"business_id": "A", "tenant_id": OUTSIDER}),
    ]
    assert [r.status_code for r in calls] == [404] * len(calls)


def test_a_run_of_another_business_is_not_found(world, monkeypatch):  # noqa: F811
    _env, _s, client, who = world

    async def a_run(run_id):
        return {"scenario_run_id": run_id, "business_id": "A", "tenant_id": OWNER, "baseline_snapshot": {}}
    monkeypatch.setattr(si, "get_scenario_run", a_run)
    who["user"] = OUTSIDER
    for r in (client.get("/v1/scenario-intelligence/scenario-runs/r1/timeline"),
              client.post("/v1/scenario-intelligence/scenario-runs/r1/explain"),
              client.post("/v1/scenario-intelligence/scenario-runs/r1/execute"),
              client.post("/v1/scenario-intelligence/scenario-runs/r1/decision", json={"decision_status": "accepted"})):
        assert r.status_code == 404 and r.json()["detail"] == "Scenario run not found"
    who["user"] = OWNER
    assert client.get("/v1/scenario-intelligence/scenario-runs/r1/timeline").status_code == 200


def test_the_owner_and_a_member_still_get_through(world):  # noqa: F811
    """A business with nothing on record answers 422 (not enough data), not 404: access was granted."""
    _env, _s, client, who = world
    for user in (OWNER, MEMBER):
        who["user"] = user
        r = client.post("/v1/scenario-intelligence/do-nothing/run",
                        json={"tenant_id": user, "business_id": "A", "state_version": "v1", "state": EMPTY_STATE})
        assert r.status_code == 422
        assert client.get("/v1/scenario-intelligence/history", params={"business_id": "A", "tenant_id": user}).status_code == 200


# ── 6. Clearing history ───────────────────────────────────────────────────────────────────────────────────────────

def test_clearing_history_leaves_other_businesses_alone(monkeypatch):
    async def nothing(*_a, **_k):
        return None
    monkeypatch.setattr(svc, "_safe_select", nothing)
    monkeypatch.setattr(svc, "_safe_delete", nothing)
    monkeypatch.setattr(svc, "_MEM_RUNS", {"a1": {"tenant_id": "t", "business_id": "A"}, "b1": {"tenant_id": "t", "business_id": "B"}})
    monkeypatch.setattr(svc, "_MEM_TIMELINES", {"a1": [1], "b1": [2]})
    monkeypatch.setattr(svc, "_MEM_RECOMMENDATIONS", {})
    monkeypatch.setattr(svc, "_MEM_DECISIONS", {})
    monkeypatch.setattr(svc, "_MEM_RISK_SIGNALS", [{"tenant_id": "t", "business_id": "A"}, {"tenant_id": "t", "business_id": "B"}])
    import asyncio
    assert asyncio.run(svc.clear_history("t", "A")) == 1
    assert list(svc._MEM_RUNS) == ["b1"] and list(svc._MEM_TIMELINES) == ["b1"]
    assert svc._MEM_RISK_SIGNALS == [{"tenant_id": "t", "business_id": "B"}]


# ── Version ───────────────────────────────────────────────────────────────────────────────────────────────────────

def test_runs_are_stamped_with_model_1_3_or_later():
    _r, s = P.project(S(revenue_monthly=1000, expenses_monthly=500), "do_nothing_projection", {}, 3, as_of=date(2026, 11, 20))
    major, minor = (int(x) for x in P.MODEL_VERSION.removeprefix("projection-").split("."))
    assert (major, minor) >= (1, 3) and s["model_version"] == P.MODEL_VERSION
