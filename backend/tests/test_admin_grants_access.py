"""Admin grants and the shared plan gate: an admin's full-access grant counts as the top plan
for Agent tasks, automatic drafts and Marketplace RFQs; "agent" and "marketplace_rfq" can also
be granted on their own."""
import asyncio

import pytest

from app.modules.addons import service as addons
from app.modules.agent.services import CreditMeter
from app.modules.plans import access
from app.modules.plans.schemas import SubscriptionOut

FULL = list(access.FULL_ACCESS_MODULES)


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def account(monkeypatch):
    """One account: its subscription and the grants an admin has given it."""
    state = {"plan": "explorer", "status": "active", "grants": []}

    async def subscription(user_id):
        return SubscriptionOut(plan_key=state["plan"], billing_period="monthly", status=state["status"])

    async def select(table, filters=None, columns=None, **_):
        assert table == "user_platform_grants"
        wanted = {f[0]: f[2] for f in filters or []}
        rows = [{"id": f"g{i}", "module_key": g if isinstance(g, str) else g[0], "feature_key": "" if isinstance(g, str) else g[1]}
                for i, g in enumerate(state["grants"])]
        return [r for r in rows if "module_key" not in wanted or r["module_key"] == wanted["module_key"]]

    monkeypatch.setattr(access, "resolve_subscription", subscription)
    monkeypatch.setattr(access, "sb_select", select)
    return state


def test_an_explorer_account_with_no_grants_has_nothing_extra(account):
    a = run(access.effective_access("u1"))
    assert (a["effective_plan"], a["full_access"], a["agent_tasks"], a["marketplace_rfqs"], a["source"]) == ("explorer", False, False, False, "subscription")
    assert run(access.effective_plan_key("u1")) == "explorer" and run(access.has_paid_access("u1")) is False
    assert run(CreditMeter().plan("u1")) == "explorer" and run(addons.rfq_unlocked("u1")) is False


def test_a_full_access_grant_counts_as_the_top_plan_everywhere_the_plan_is_read(account):
    account["grants"] = FULL                                              # what "Grant Full Access" has always given
    a = run(access.effective_access("u1"))
    assert a["subscription_plan"] == "explorer" and a["effective_plan"] == "strategic_business_os" and a["full_access"] is True
    assert a["source"] == "admin full-access grant" and a["agent_tasks"] is True and a["marketplace_rfqs"] is True
    assert run(access.effective_plan_key("u1")) == "strategic_business_os" and run(access.has_paid_access("u1")) is True
    assert run(CreditMeter().plan("u1")) == "strategic_business_os"      # the Agent's plan gate, limits and automatic drafts
    assert run(addons.rfq_unlocked("u1")) is True                         # requests for a quotation are unlocked
    run(addons.require_rfq_access("u1"))                                  # and can be replied to
    data = {"financials": {"rfq_requests": [{"id": "r1", "customer_name": "Real Buyer", "customer_email": "b@x.test", "items": []}]}}
    assert run(addons.redact_workspace_data_for_owner(data, "u1")) is data
    # All but one module is not full access.
    account["grants"] = FULL[:-1]
    assert run(access.effective_access("u1"))["full_access"] is False and run(access.effective_plan_key("u1")) == "explorer"
    # A grant for one feature inside a module is not the module.
    account["grants"] = [*FULL[:-1], (FULL[-1], "some_feature")]
    assert run(access.effective_access("u1"))["full_access"] is False


def test_the_agent_and_rfqs_can_each_be_granted_on_their_own(account):
    account["grants"] = ["agent"]
    a = run(access.effective_access("u1"))
    assert (a["agent_tasks"], a["marketplace_rfqs"], a["effective_plan"]) == (True, False, "explorer")
    assert run(CreditMeter().plan("u1")) == "starter_insight"            # Agent tasks as on Starter
    assert run(access.has_paid_access("u1")) is False and run(addons.rfq_unlocked("u1")) is False
    account["grants"] = ["marketplace_rfq"]
    a = run(access.effective_access("u1"))
    assert (a["agent_tasks"], a["marketplace_rfqs"]) == (False, True)
    assert run(addons.rfq_unlocked("u1")) is True and run(CreditMeter().plan("u1")) == "explorer"
    assert run(access.has_paid_access("u1")) is False                     # nothing else that needs a paid plan opens


def test_a_subscription_is_never_lowered_by_a_grant(account):
    account.update(plan="decision_engine", grants=["agent"])
    assert run(CreditMeter().plan("u1")) == "decision_engine" and run(access.effective_access("u1"))["source"] == "subscription"
    account.update(plan="explorer", status="grandfathered", grants=[])
    a = run(access.effective_access("u1"))
    assert a["effective_plan"] == "strategic_business_os" and a["source"] == "early-access account" and a["agent_tasks"] is True


def test_the_agent_gate_lets_a_full_access_explorer_account_work_and_read_its_requests(account, monkeypatch):
    """The shared gate end to end: the same orchestrator the app uses, with the real plan lookup."""
    from app.modules.agent import rfq as agent_rfq
    from test_agent import OWNER, Env

    async def balance(self, user_id):
        return 100
    monkeypatch.setattr(CreditMeter, "balance", balance)
    env = Env()
    real = CreditMeter()
    env.meter.plan = real.plan                                            # the plan and the RFQ lock come from the real rules
    env.meter.rfq_unlocked = real.rfq_unlocked
    env.fin["rfq_requests"] = [{"id": "r1", "status": "pending", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test",
                                "items": [{"name": "Strategy Workshop", "quantity": 1}]}]
    blocked = env.submit(capability="enquiry_to_quote", params={"rfq_id": "r1"}, channel="ui_action")
    assert blocked["kind"] == "blocked" and blocked["reason_codes"] == ["plan_capability"]
    assert run(agent_rfq.received(env.orch, "A", "r1")) is None and run(env.orch.visible_data("A"))["financials"]["rfq_requests"][0]["locked"] is True
    account["grants"] = FULL                                              # the admin grants full access
    assert run(env.orch.entitlement("A"))["plan"] == "strategic_business_os"
    assert run(env.orch.visible_data("A"))["financials"]["rfq_requests"][0]["customer_name"] == "BrightTech Ltd"
    started = run(agent_rfq.received(env.orch, "A", "r1"))               # the request now starts its draft by itself
    assert started["kind"] == "workflow" and started["run"]["status"] == "awaiting_approval" and started["run"]["requester_id"] == OWNER


def test_the_admin_page_can_read_effective_access_and_full_access_includes_the_new_grants(account, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.modules.admin import router as admin
    assert set(admin.ALL_MODULE_KEYS) == set(access.FULL_ACCESS_MODULES) | {"agent", "marketplace_rfq"}
    account["grants"] = FULL
    app.dependency_overrides[admin.require_admin] = lambda: {"id": "admin"}
    try:
        with TestClient(app) as client:
            body = client.get("/admin/users/u1/access").json()
            assert body["effective_plan"] == "strategic_business_os" and body["agent_tasks"] is True and body["marketplace_rfqs"] is True
            assert body["source"] == "admin full-access grant" and body["subscription_plan"] == "explorer"
    finally:
        app.dependency_overrides.pop(admin.require_admin, None)
