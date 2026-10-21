"""QA PF1 and PF2: every paid action is checked against the effective plan (the one /plans/my resolves, admin grants
included) before credits, refused in words (never "FEATURE_NOT_FOUND", never 402 for a plan), and charged through the
central credit service exactly the cost a confirmation shows, only when it succeeds.

The wallet, the price list and the grants are in memory here; the price list is empty, as on the dev database
(which holds only the Agent's rows), so the migrations' own prices are what is used."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.credits import catalogue
from app.modules.credits import service as credits
from app.modules.plans import access

FULL = list(access.FULL_ACCESS_MODULES)
ACCOUNTS = {
    "explorer": ("explorer", "active", []),
    "explorer+grant": ("explorer", "active", FULL),      # "Full access (test grant)"
    "starter": ("starter_insight", "active", []),
    "decision_engine": ("decision_engine", "active", []),
}


class Wallets:
    """credit_wallets, the reserve/commit/release functions, and the grants, in memory. Idempotent per key."""

    def __init__(self, balance=100):
        self.available = {}
        self.held = {}
        self.grants = {}
        self.start = balance
        self.charged = []

    async def select(self, table, filters=None, single=False, **_k):
        user = next((v for (c, _op, v) in (filters or []) if c == "user_id"), None)
        if table == "credit_feature_config":
            return None if single else []                 # as on the dev database: no row for these features
        if table == "credit_wallets":
            self.available.setdefault(user, self.start)
            row = {"user_id": user, "available_credits": self.available[user]}
            return row if single else [row]
        if table == "user_platform_grants":
            return [{"module_key": m, "feature_key": None} for m in self.grants.get(user, [])]
        if table == "plan_feature_entitlements":
            raise RuntimeError("no such table")           # as on the dev database
        return None if single else []

    async def rpc(self, fn, p):
        key = p.get("p_idempotency_key")
        if fn == "reserve_credits":
            user, cost = p["p_user_id"], p["p_credit_cost"]
            if key in self.held:
                return {"ok": True, "transaction_id": key}
            have = self.available.setdefault(user, self.start)
            if have < cost:
                return {"ok": False, "error": "INSUFFICIENT_CREDITS", "available": have, "required": cost}
            self.available[user] = have - cost
            self.held[key] = (user, cost, "held")
            return {"ok": True, "transaction_id": key}
        if fn == "commit_credits":
            user, cost, state = self.held[key]
            if state == "held":
                self.held[key] = (user, cost, "committed")
                self.charged.append((user, cost))
            return {"ok": True}
        if fn == "release_credits":
            user, cost, state = self.held[key]
            if state == "held":
                self.held[key] = (user, cost, "released")
                self.available[user] += cost
            return {"ok": True}
        return {"ok": True}


@pytest.fixture
def wallets(monkeypatch):
    w = Wallets()
    monkeypatch.setattr(credits, "sb_select", w.select)
    monkeypatch.setattr(access, "sb_select", w.select)
    monkeypatch.setattr(credits, "_rpc", w.rpc)
    subs = {}

    async def resolve(user_id):
        plan, status, _g = subs[user_id]
        return SimpleNamespace(plan_key=plan, status=status)
    monkeypatch.setattr(access, "resolve_subscription", resolve)
    for user, (plan, status, grants) in ACCOUNTS.items():
        subs[user] = (plan, status, grants)
        w.grants[user] = grants
    return w


def run(coro):
    return asyncio.run(coro)


# What each plan may do: (feature, the cheapest plan it is on).
PAID = [
    ("business_plan_full", "starter_insight"),   # Blueprints: business plan (Starter, the pricing PDF)
    ("proposal_full", "starter_insight"),        # Blueprints: proposal
    ("sales_letter_full", "starter_insight"),
    ("scenario_ai_interpretation", "starter_insight"),      # Simulation: the AI explanation (the run itself is free)
    ("market_data_refresh", "explorer"),
    ("live_plan_import_extract", "decision_engine"),        # Live plan
    ("live_plan_full_refresh", "decision_engine"),
]
RANK = ["explorer", "starter_insight", "decision_engine"]


def _expected(account, minimum):
    plan = ACCOUNTS[account][0]
    if ACCOUNTS[account][2]:
        return True                                   # full access: the top plan
    return RANK.index(plan) >= RANK.index(minimum)


@pytest.mark.parametrize("account", list(ACCOUNTS))
@pytest.mark.parametrize("feature, minimum", PAID)
def test_each_paid_feature_on_each_plan_is_allowed_or_refused_in_words_never_not_found(wallets, account, feature, minimum):
    check = run(credits.check_credits(account, feature))
    assert check.get("reason") != "FEATURE_NOT_FOUND"
    assert check["entitled"] is _expected(account, minimum)
    got = run(credits.reserve_credits(account, feature, "g1"))
    if _expected(account, minimum):
        assert got["ok"] is True
    else:
        assert got["ok"] is False and got["error"] == "FEATURE_NOT_ENTITLED"
        assert got["message"].startswith(f"{catalogue.FEATURES[feature][0]} is included from the")
        assert check["refusal"]["minimum_plan"] == minimum


def test_a_full_access_test_grant_generates_a_business_plan_and_a_proposal(wallets):
    for feature in ("business_plan_full", "proposal_full", "live_plan_import_extract"):
        before = wallets.available.get("explorer+grant", wallets.start)
        shown = run(credits.check_credits("explorer+grant", feature))["cost_shown"]

        async def go():
            async with credits.credit_guard("explorer+grant", feature):
                pass
        run(go())
        assert wallets.available["explorer+grant"] == before - shown      # exactly what the confirmation showed


@pytest.mark.parametrize("feature", [f for f, _m in PAID])
def test_the_balance_drops_by_exactly_the_shown_cost_on_success_and_not_at_all_on_failure(wallets, feature):
    user = "decision_engine"
    shown = run(credits.check_credits(user, feature))["cost_shown"]
    assert shown == catalogue.FEATURES[feature][1] or shown == credits.charged(catalogue.FEATURES[feature][1])
    start = wallets.available.get(user, wallets.start)

    async def fails():
        async with credits.credit_guard(user, feature):
            raise RuntimeError("the model call failed")
    with pytest.raises(RuntimeError):
        run(fails())
    assert wallets.available[user] == start                               # failed: nothing taken

    async def works():
        async with credits.credit_guard(user, feature, "same-id"):
            pass
    run(works())
    assert wallets.available[user] == start - shown
    run(works())                                                          # the same action again (a retry): charged once
    assert wallets.available[user] == start - shown


def test_a_refusal_by_plan_is_403_in_words_and_charges_nothing(wallets):
    start = wallets.available.get("explorer", wallets.start)

    async def go():
        async with credits.credit_guard("explorer", "proposal_full"):
            pass
    with pytest.raises(HTTPException) as e:
        run(go())
    assert e.value.status_code == 403
    assert e.value.detail["error"] == "FEATURE_NOT_ENTITLED" and e.value.detail["minimum_plan_label"] == "Starter"
    assert e.value.detail["message"] == "Complete Business Proposal is included from the Starter plan. You're on Explorer."
    assert wallets.available.get("explorer", start) == start


def test_a_deterministic_scenario_run_is_free_and_shows_no_cost(wallets):
    check = run(credits.check_credits("starter", "scenario_simulation"))
    assert check["cost_shown"] == 0 and check["credit_controlled"] is False      # Credit System v2 §6: never "10 credits"


@pytest.mark.parametrize("account", list(ACCOUNTS))
def test_plan_gated_modules_use_the_same_resolver(wallets, account):
    # Proposals (Starter), Live Plan and Integrations (Decision Engine): a full-access grant counts as the top plan.
    assert run(access.plan_meets(account, "starter_insight", grant_module="marketplace")) is _expected(account, "starter_insight")
    assert run(access.plan_meets(account, "decision_engine", grant_module="live_plan")) is _expected(account, "decision_engine")


@pytest.mark.parametrize("account", list(ACCOUNTS))
def test_scenario_templates_by_plan_on_the_server(wallets, account):
    from app.modules.scenario_intelligence import router as si

    def allowed(template):
        try:
            run(si._require_scenario(account, template, "Loss of Largest Client"))
            return True
        except HTTPException as e:
            assert e.status_code == 403 and e.detail["error"] == "FEATURE_NOT_ENTITLED"
            return False
    assert allowed("do_nothing_projection") is True                      # every plan
    assert allowed("tmpl_client_loss") is _expected(account, "starter_insight")
    assert allowed("tmpl_hiring_plan") is _expected(account, "decision_engine")


def test_every_feature_the_code_charges_for_has_a_price():
    import pathlib
    import re
    root = pathlib.Path(__file__).resolve().parents[1] / "app"
    used = set()
    for f in root.rglob("*.py"):
        used |= set(re.findall(r'credit_guard\([^,]+,\s*"([a-z_]+)"', f.read_text(encoding="utf-8")))
    used |= {"business_plan_full", "business_plan_section", "proposal_full", "proposal_section", "sales_letter_full", "sales_letter_section",
             "idea_validation", "idea_validation_comprehensive"}      # chosen by code (blueprint and validation routes)
    assert used - set(catalogue.FEATURES) == set()


def test_the_catalogue_is_migration_016_as_written_with_042_s_prices_on_top():
    import pathlib
    import re
    here = pathlib.Path(__file__).resolve().parents[1] / "migrations"
    row = r"\(\s*'([a-z_]+)',\s*'([^']+)',\s*(\d+),\s*(TRUE|FALSE),\s*'([a-z_]+)',\s*(TRUE|FALSE),\s*(TRUE|FALSE)\s*\)"
    rows = {r[0]: r for r in re.findall(row, (here / "016_credit_system_v2.sql").read_text(encoding="utf-8"))}
    assert len(rows) >= 30
    v2 = (here / "042_credit_allocation_v2.sql").read_text(encoding="utf-8")
    rows.update({r[0]: r for r in re.findall(row, v2)})
    expected = {code: (name, int(cost), enabled == "TRUE", minimum, refundable == "TRUE", controlled == "TRUE")
                for code, name, cost, enabled, minimum, refundable, controlled in rows.values()}
    # 042's UPDATEs: a new price (and, for Basic validation, no longer credit-controlled) on rows 016 or later wrote.
    for cost, uncontrolled, code in re.findall(r"SET credit_cost = (\d+)(, credit_controlled = FALSE)? WHERE feature_code = '([a-z_]+)'", v2):
        name, _, enabled, minimum, refundable, controlled = expected.get(code) or catalogue.FEATURES[code]
        expected[code] = (name, int(cost), enabled, minimum, refundable, False if uncontrolled else controlled)
    # 043 (the pricing PDF): features moved to another plan.
    v3 = (here / "043_pricing_pdf_plans.sql").read_text(encoding="utf-8")
    for plan, codes in re.findall(r"SET minimum_plan = '([a-z_]+)'[^;]*?feature_code IN \(([^)]*)\)", v3):
        for code in re.findall(r"'([a-z_]+)'", codes):
            name, cost, enabled, _minimum, refundable, controlled = expected[code]
            expected[code] = (name, cost, enabled, plan, refundable, controlled)
    for code, want in expected.items():
        assert catalogue.FEATURES[code] == want, code


def test_the_owner_s_credit_chart_v2():
    """The owner's chart (Updated Credit allocation v2), capability by capability."""
    chart = {"agent_task": 2, "business_plan_section": 5, "sales_letter_full": 4, "proposal_full": 10, "business_plan_full": 40,
             "idea_validation_comprehensive": 25, "research_best_price": 40, "research_customer_opportunities": 40,
             "research_launch_blockers": 50, "research_funding_readiness": 60, "scenario_ai_interpretation": 15, "live_plan_full_refresh": 20}
    assert {k: catalogue.FEATURES[k][1] for k in chart} == chart
    assert catalogue.FEATURES["idea_validation"][1] == 0 and catalogue.FEATURES["idea_validation"][5] is False      # Basic is free


def test_a_research_run_id_is_charged_through_the_wallet_s_uuid_key_once(wallets, monkeypatch):
    """QA R9-1: the wallet's generation_id is a UUID column. A research run's "rr_…" id made the reserve fail in the
    running app, so every live research run reported "nothing found". Any key is now a stable UUID."""
    import uuid as _uuid
    real = wallets.rpc

    async def like_postgres(fn, p):
        _uuid.UUID(str(p["p_generation_id"]))      # raises, as the uuid column does, for anything else
        return await real(fn, p)
    monkeypatch.setattr(credits, "_rpc", like_postgres)
    user = "decision_engine"
    start = wallets.available.get(user, wallets.start)

    async def go():
        async with credits.credit_guard(user, "scenario_ai_interpretation", "rr_8f2c1a9b0d3e4f56"):
            pass
    run(go())
    run(go())
    assert wallets.available[user] == start - 15      # charged, and only once for the same run
    assert credits.generation_uuid("rr_x") == credits.generation_uuid("rr_x") != credits.generation_uuid("rr_y")
