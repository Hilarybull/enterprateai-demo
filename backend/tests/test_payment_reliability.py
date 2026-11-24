import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from app.modules.plans import router as plans
from app.core.config import get_settings


def request(event):
    return SimpleNamespace(headers={"stripe-signature":"fixture"},body=AsyncMock(return_value=b"{}"))


def prepare(monkeypatch,kind,obj):
    event={"type":kind,"data":{"object":obj}}
    monkeypatch.setattr(get_settings(),"stripe_webhook_secret","whsec_fixture")
    monkeypatch.setattr(plans.stripe.Webhook,"construct_event",lambda *args:event)
    return request(event)


def test_delayed_checkout_does_not_activate_until_settled(monkeypatch):
    obj={"id":"cs_one","payment_status":"unpaid","metadata":{"user_id":"u","plan_key":"starter_insight"},"subscription":"sub_one"}
    req=prepare(monkeypatch,"checkout.session.completed",obj)
    upsert=AsyncMock()
    monkeypatch.setattr(plans,"sb_upsert",upsert)
    result=asyncio.run(plans.stripe_webhook(req))
    assert result["pending_payment"]
    upsert.assert_not_awaited()


def test_async_checkout_uses_real_item_period_and_retries_failed_fulfilment(monkeypatch):
    obj={"id":"cs_one","payment_status":"paid","metadata":{"user_id":"u","plan_key":"starter_insight"},"subscription":"sub_one","customer":"cus_one"}
    req=prepare(monkeypatch,"checkout.session.async_payment_succeeded",obj)
    sub={"status":"active","items":{"data":[{"current_period_start":1795000000,"current_period_end":1797678400}]}}
    monkeypatch.setattr(plans,"_stripe_client",lambda:SimpleNamespace(subscriptions=SimpleNamespace(retrieve=lambda _:sub)))
    monkeypatch.setattr(plans,"sb_select",AsyncMock(return_value=None))
    save=AsyncMock()
    monkeypatch.setattr(plans,"sb_upsert",save)
    monkeypatch.setattr(plans,"_create_referral_reward",AsyncMock())
    grant=AsyncMock(side_effect=RuntimeError("temporary"))
    monkeypatch.setattr(plans,"_provision_subscription_credits_once",grant)
    async def scenario():
        with pytest.raises(HTTPException) as error:await plans.stripe_webhook(req)
        assert error.value.status_code == 503
        assert save.await_args.kwargs["payload"]["current_period_end"] == datetime.fromtimestamp(1797678400,timezone.utc).isoformat()
        grant.side_effect=None;grant.return_value=True
        assert (await plans.stripe_webhook(req))["received"]
    asyncio.run(scenario())


def test_renewal_credits_are_keyed_by_invoice(monkeypatch):
    invoice={"id":"in_one","billing_reason":"subscription_cycle","customer":"cus_one","parent":{"subscription_details":{"subscription":"sub_one"}}}
    req=prepare(monkeypatch,"invoice.paid",invoice)
    monkeypatch.setattr(plans.addon_svc,"is_addon_subscription",AsyncMock(return_value=False))
    monkeypatch.setattr(plans,"sb_select",AsyncMock(return_value={"user_id":"u","plan_key":"starter_insight","stripe_subscription_id":"sub_one"}))
    grant=AsyncMock(return_value=True)
    monkeypatch.setattr(plans,"_grant_payment_credits_once",grant)
    monkeypatch.setattr(plans,"_create_referral_reward",AsyncMock())
    asyncio.run(plans.stripe_webhook(req))
    assert grant.await_args.args[2] == "invoice:in_one"


def test_payment_grant_uses_atomic_rpc_and_requires_confirmation(monkeypatch):
    monkeypatch.setattr("app.modules.credits.service._get_plan_config",AsyncMock(return_value={"credits_per_period":500}))
    rpc=AsyncMock(return_value={"ok":True,"granted":False})
    monkeypatch.setattr("app.modules.credits.service._rpc",rpc)
    async def scenario():
        assert not await plans._provision_subscription_credits_once("u","starter_insight","sub_one")
        assert rpc.await_args.args[0] == "grant_stripe_credits_once"
        assert rpc.await_args.args[1]["p_reference"] == "subscription:sub_one"
        rpc.return_value={"ok":False}
        with pytest.raises(RuntimeError):await plans._provision_subscription_credits_once("u","starter_insight","sub_one")
    asyncio.run(scenario())
