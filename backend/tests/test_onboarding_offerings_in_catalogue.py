"""QA D2: offerings named at onboarding become Catalogue offerings, once each (whatever their case or
ending), with no invented price, so the pricing check, quotations and the Marketplace use them."""
import asyncio
from datetime import datetime, timezone

from app.modules.workspace_profile import service as wp
from app.modules.workspace_profile.service import catalogue_with_offerings
from app.shared.schemas.common import WorkspaceDocument

NOW = "2026-10-12T09:00:00+00:00"


def test_each_offering_is_added_once_with_no_price():
    cat, added = catalogue_with_offerings({"products": [{"id": "p1", "name": "Home Cleaning", "base_price": 45}], "customers": [{"id": "c1"}]},
                                          ["home cleaning", "End of tenancy cleaning", "end of tenancy clean", ""], NOW)
    assert [a["name"] for a in added] == ["End of tenancy cleaning"]                 # "home cleaning" is already there
    new = added[0]
    assert (new["base_price"], new["price_needed"], new["source"], new["type"]) == (None, True, "onboarding", "service")
    assert [p["name"] for p in cat["products"]] == ["Home Cleaning", "End of tenancy cleaning"] and cat["customers"] == [{"id": "c1"}]


def test_onboarding_saves_them_to_the_catalogue(monkeypatch):
    now = datetime.now(timezone.utc)
    ws = WorkspaceDocument(id="ws1", user_id="u1", name="QA Sparkle Cleaning Ltd", created_at=now, updated_at=now, data={})
    saved = {}

    async def get_user_workspace(**_k):
        return ws

    async def update_workspace(**k):
        saved.update(k["data_patch"])

    async def get_workspace(**_k):
        return ws
    monkeypatch.setattr(wp, "get_user_workspace", get_user_workspace)
    monkeypatch.setattr(wp, "update_workspace", update_workspace)
    monkeypatch.setattr(wp, "get_workspace", get_workspace)
    asyncio.run(wp.complete_onboarding(user_id="u1", email="owner@sparkle.example", answers={
        "company_name": "QA Sparkle Cleaning Ltd", "city": "Leeds", "country": "United Kingdom", "operating_stage": "early_revenue",
        "services": [{"service_name": "Home cleaning"}, {"service_name": "End of tenancy cleaning"}]}))
    assert [p["name"] for p in saved["catalogue"]["products"]] == ["Home cleaning", "End of tenancy cleaning"]
    assert saved["workspace_profile"]["city"] == "Leeds" and saved["workspace_profile"]["operating_stage"] == "early_revenue"      # kept as company facts
