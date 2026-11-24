"""Every product the Agent charges for is on the price list: the business plan step once charged "business_plan",
which isn't a feature, and every Agent business plan failed with FEATURE_NOT_FOUND."""
import asyncio
import re
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.modules.agent import services
from app.modules.agent.tools import ToolStop
from app.modules.credits.catalogue import default_config

WORKFLOWS = Path(__file__).resolve().parents[1] / "app" / "modules" / "agent" / "workflows.py"


def test_every_studio_charge_names_a_feature_on_the_price_list():
    charged = set(re.findall(r'_(?:studio|generated)\(ctx, "([a-z_]+)"', WORKFLOWS.read_text(encoding="utf-8")))
    assert "business_plan_full" in charged
    assert {f for f in charged if not default_config(f)} == set()


def test_a_refusal_is_said_in_words_never_as_the_raw_response(monkeypatch):
    @asynccontextmanager
    async def refuse(_user, _feature, _key=None):
        raise HTTPException(status_code=403, detail={"error": "FEATURE_NOT_ENTITLED", "message": "Complete Business Plan is included from the Starter plan. You're on Explorer."})
        yield
    import app.modules.credits.service as credits
    monkeypatch.setattr(credits, "credit_guard", refuse)
    meter = next(c for c in vars(services).values() if isinstance(c, type) and issubclass(c, services.Meter) and c not in (services.Meter, services.MemoryMeter))()

    async def go():
        async with meter.charge("u1", "business_plan_full"):
            pass
    with pytest.raises(ToolStop) as stop:
        asyncio.run(go())
    assert stop.value.reason_code == "plan_required"
    assert stop.value.message == "Complete Business Plan is included from the Starter plan. You're on Explorer. Nothing was charged."
    assert "403" not in stop.value.message and "{" not in stop.value.message
