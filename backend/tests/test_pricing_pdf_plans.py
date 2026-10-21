"""The plans as sold (EnterprateAI_Pricing_Plans_AI_Agent_Final.pdf, 19 Oct 2026)."""
import asyncio
from datetime import datetime, timedelta, timezone

from app.modules.addons import service as addons
from app.modules.credits import service as credits
from app.modules.plans import capabilities as cap


def test_the_business_plan_generator_is_starter_and_above():
    assert cap.min_plan_for("business_plan_draft") == "starter_insight"
    assert not cap.plan_allows("explorer", "business_plan_draft")
    assert cap.plan_allows("explorer", "idea_validation")      # Basic Idea Validation stays on Explorer


def test_listings_are_1_then_10_then_unlimited_and_starter_has_4_scenarios_a_month():
    assert [cap.quota(p, "marketplace_listings") for p in ("explorer", "starter_insight", "decision_engine")] == [1, 10, None]
    assert [cap.quota(p, "scenario_help") for p in ("explorer", "starter_insight", "decision_engine")] == [0, 4, None]


def test_seats_count_the_owner():
    from app.modules.plans.team import SEATS_INCLUDED
    # Explorer and Starter: 1 user seat (the owner); Decision Engine: 3 included (the owner and 2 more).
    assert [SEATS_INCLUDED[p] for p in ("explorer", "starter_insight", "decision_engine")] == [1, 1, 3]


def test_an_extra_seat_brings_250_credits_once_per_payment(monkeypatch):
    granted, ledger = [], []

    async def select(table, filters=None, columns=None, single=False):
        reason = dict((f[0], f[2]) for f in filters or []).get("description")      # the ledger's column for the reason
        return [{"id": 1}] if reason in ledger else []

    async def grant(user_id, amount, grant_type="allocation", reason="", next_reset_at=None):
        granted.append(amount)
        ledger.append(reason)
    monkeypatch.setattr(addons, "sb_select", select)
    monkeypatch.setattr(credits, "grant_credits", grant)
    assert asyncio.run(addons.grant_seat_credits("u1", 1, "in_1")) is True
    assert asyncio.run(addons.grant_seat_credits("u1", 1, "in_1")) is False      # the same invoice again: nothing more
    assert asyncio.run(addons.grant_seat_credits("u1", 2, "in_2")) is True
    assert granted == [250, 500]


def test_what_is_left_of_the_welcome_credits_expires_after_60_days_on_explorer_only(monkeypatch):
    now = datetime(2026, 12, 20, tzinfo=timezone.utc)
    wallet = {"created_at": (now - timedelta(days=61)).isoformat(), "available_credits": 70, "lifetime_credits_used": 20}
    taken = []

    async def select(*a, **k):
        return []

    async def deduct(user_id, amount, reason):
        taken.append((amount, reason))
    monkeypatch.setattr(credits, "sb_select", select)
    monkeypatch.setattr(credits, "deduct_credits_admin", deduct)
    out = asyncio.run(credits.expire_welcome_credits("u1", wallet, "explorer", now))
    assert taken == [(30, "Welcome credits expired after 60 days")] and out["available_credits"] == 40      # 50 less 20 used; the 20 bought stay
    taken.clear()
    assert asyncio.run(credits.expire_welcome_credits("u1", wallet, "starter_insight", now)) == wallet and taken == []
    young = {**wallet, "created_at": (now - timedelta(days=10)).isoformat()}
    assert asyncio.run(credits.expire_welcome_credits("u1", young, "explorer", now)) == young and taken == []
    assert credits.welcome_expires_at(young) == now + timedelta(days=50)


# ── The team on Decision Engine: seats, the team's plan for members, pooled credits within an allowance ──
from app.modules.plans import access as plan_access, team as team_mod

TABLES = {
    "workspaces": [{"id": "W1", "user_id": "owner"}],
    "workspace_members": [{"id": "m1", "workspace_id": "W1", "user_id": "amy", "permissions": {"credits": {"monthly": 100, "month": team_mod.this_month(), "used": 90}}},
                          {"id": "m2", "workspace_id": "W1", "user_id": "ben", "permissions": {}}],
}


def _fake(monkeypatch, owner_plan="decision_engine", extra=0):
    async def select(table, filters=None, columns=None, single=False, **k):
        rows = [r for r in TABLES.get(table, []) if all(
            (str(r.get(f)) in [str(x) for x in v]) if op == "in" else str(r.get(f)) == str(v) for f, op, v in (filters or []))]
        return (rows[0] if rows else None) if single else rows

    async def own(user_id):
        return owner_plan if user_id == "owner" else "explorer"

    async def eff(user_id):
        return owner_plan if user_id == "owner" else await plan_access.effective_plan_key(user_id)

    async def extras(user_id):
        return extra
    monkeypatch.setattr(team_mod, "sb_select", select)
    monkeypatch.setattr(plan_access, "own_plan_key", own)
    monkeypatch.setattr(addons, "extra_seats", extras)
    return select


def test_a_member_works_under_the_teams_plan_and_pays_from_its_pool(monkeypatch):
    _fake(monkeypatch)
    assert asyncio.run(plan_access.effective_plan_key("amy")) == "decision_engine"
    payer, t = asyncio.run(team_mod.payer_for("amy"))
    assert payer == "owner" and t["member"]["id"] == "m1"
    assert asyncio.run(team_mod.payer_for("owner"))[0] == "owner"


def test_a_one_seat_plan_has_no_team(monkeypatch):
    _fake(monkeypatch, owner_plan="starter_insight")
    assert asyncio.run(plan_access.effective_plan_key("amy")) == "explorer" and asyncio.run(team_mod.payer_for("amy"))[0] == "amy"


def test_seats_in_use_and_free_with_an_extra_seat(monkeypatch):
    _fake(monkeypatch, extra=1)
    monkeypatch.setattr(plan_access, "effective_plan_key", lambda u: _plan("decision_engine"))
    s = asyncio.run(team_mod.seats("owner"))
    assert (s["included"], s["extra"], s["total"], s["used"], s["free"], s["can_invite"]) == (3, 1, 4, 3, 1, True)


async def _plan(p):
    return p


def test_a_members_allowance_stops_a_charge_beyond_it(monkeypatch):
    _fake(monkeypatch)

    async def cfg(code):
        return {"enabled": True, "credit_cost": 20, "credit_controlled": True, "minimum_plan": "explorer"}

    async def ent(*a, **k):
        return True
    monkeypatch.setattr(credits, "get_feature_config", cfg)
    monkeypatch.setattr(credits, "_feature_entitled", ent)
    monkeypatch.setattr(credits, "entitled_plan", lambda u: _plan("decision_engine"))
    out = asyncio.run(credits.reserve_credits("amy", "business_plan_full", "g1"))
    assert out["ok"] is False and out["error"] == "MEMBER_ALLOWANCE_USED" and "90 of the 100" in out["message"]
    assert team_mod.allowance_of(TABLES["workspace_members"][1]) == {"monthly": None, "used": 0, "left": None}
