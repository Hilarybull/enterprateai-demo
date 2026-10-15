"""A form opened before the Agent filled a field must not write the old value back when saved untouched."""
import asyncio
from types import SimpleNamespace

from app.modules.workspace_profile import service


def test_untouched_field_in_a_stale_form_keeps_the_newer_value(monkeypatch):
    saved = {}
    d = service._defaults(email="owner@example.test", company_name="Alchemy Test")
    d["services"] = [{"service_category": d["primary_industry"], **x} for x in d["services"]]
    current = service.WorkspaceProfile.model_validate({**d, "target_customer_type": "Office workers in Abuja", "tagline": ""}).model_dump()
    ws = SimpleNamespace(id="w1", data={"workspace_profile": dict(current)}, updated_at="now")

    async def load(u, w):
        return ws

    async def update(**kw):
        saved.update(kw["data_patch"]["workspace_profile"])

    async def get(**kw):
        return ws

    monkeypatch.setattr(service, "_load_workspace", load)
    monkeypatch.setattr(service, "update_workspace", update)
    monkeypatch.setattr(service, "get_workspace", get)
    base = service.WorkspaceProfile.model_validate(current).model_dump()
    form = dict(base, target_customer_type="Ebe", tagline="Clean cars")
    seen = dict(base, target_customer_type="Ebe", tagline="")
    asyncio.run(service.upsert_profile(user_id="u", workspace_id="w1", profile=service.WorkspaceProfile.model_validate(form), seen=seen))
    assert saved["target_customer_type"] == "Office workers in Abuja"   # untouched, the newer value stays
    assert saved["tagline"] == "Clean cars"                              # the owner's own edit is saved


def test_brand_brief_never_uses_one_persons_name_as_the_customer():
    from app.modules.agent import profile_fill as pf
    brief = pf.brand_brief({"workspace_profile": {"key_offering_focus": "Car washing", "target_customer_type": "Ebe", "city": "Abuja"}})
    assert brief["customer"] == ""
    brief = pf.brand_brief({"workspace_profile": {"key_offering_focus": "Car washing", "target_customer_type": "Office workers in Abuja"}})
    assert brief["customer"] == "Office workers in Abuja"
