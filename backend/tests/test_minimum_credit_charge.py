"""Nothing on the system is charged at less than 2 credits. Free stays free."""
import asyncio

from app.modules.agent import config
from app.modules.credits import service


def test_a_price_is_free_or_at_least_the_minimum():
    assert service.MIN_CREDIT_CHARGE == 2
    assert [service.charged(c) for c in (0, None, "", -3, 1, "1", 2, 5, 30)] == [0, 0, 0, 0, 2, 2, 2, 5, 30]


def test_no_default_agent_price_is_below_the_minimum():
    assert all(f["cost"] >= service.MIN_CREDIT_CHARGE for f in config.CREDIT_FEATURES.values())
    assert not any(" 1 credit" in text or text.startswith("1 credit") or ", 1 when" in text for text in config.AUTOMATIC_COST.values())


def test_a_stored_price_of_one_is_read_checked_and_charged_as_two(monkeypatch):
    rows = {"email_share": {"feature_code": "email_share", "credit_cost": 1, "enabled": True, "credit_controlled": True},
            "free_thing": {"feature_code": "free_thing", "credit_cost": 0, "enabled": True, "credit_controlled": True},
            "big": {"feature_code": "big", "credit_cost": 30, "enabled": True, "credit_controlled": True}}
    saved = []

    async def select(table, **kw):
        assert table == "credit_feature_config"
        if kw.get("single"):
            return dict(rows[kw["filters"][0][2]])
        return [dict(r) for r in rows.values()]

    async def update(table, *, payload, filters):
        saved.append(payload)
        rows[filters[0][2]].update(payload)
    monkeypatch.setattr(service, "sb_select", select)
    import app.core.supabase as sb
    monkeypatch.setattr(sb, "sb_update", update)
    run = asyncio.run
    assert run(service.get_feature_config("email_share"))["credit_cost"] == 2      # what every check and charge reads
    assert run(service.get_feature_config("free_thing"))["credit_cost"] == 0       # free stays free
    assert {r["feature_code"]: r["credit_cost"] for r in run(service.get_all_features())} == {"email_share": 2, "free_thing": 0, "big": 30}      # the price list shown
    # An administrator can't set a price of 1: it is saved as 2. Setting 0 makes it free.
    assert run(service.update_feature_config("big", {"credit_cost": 1}))["credit_cost"] == 2 and saved[-1] == {"credit_cost": 2}
    assert run(service.update_feature_config("big", {"credit_cost": 0}))["credit_cost"] == 0
