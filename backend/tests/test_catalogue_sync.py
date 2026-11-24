"""QA, 15 Oct: a service on the workspace profile is in Catalogue > Products too, once, without a duplicate, and one the
owner deleted from the catalogue does not come back."""
import asyncio

from app.shared.catalogue_sync import add_profile_services


def test_profile_services_are_added_once_as_unpriced_services():
    data = {"workspace_profile": {"services": [{"service_name": "AI Automation Service", "service_description": "Workflows"}, {"service_name": "Chatbot setup"}]},
            "catalogue": {"products": [{"name": "chatbot SETUP", "base_price": 500}]}}
    assert add_profile_services(data) == ["AI Automation Service"]
    item = data["catalogue"]["products"][0]
    assert (item["name"], item["type"], item["base_price"], item["description"], item["from_profile"]) == ("AI Automation Service", "service", 0, "Workflows", True)
    assert add_profile_services(data) == [] and len(data["catalogue"]["products"]) == 2      # never twice
    data["catalogue"]["products"] = [p for p in data["catalogue"]["products"] if p["name"] != "AI Automation Service"]      # deleted by the owner
    assert add_profile_services(data) == []      # does not come back
    data["workspace_profile"]["services"].append({"service_name": "Data audits"})
    assert add_profile_services(data) == ["Data audits"]


def test_saving_the_workspace_form_adds_its_services_to_the_catalogue(monkeypatch):
    from types import SimpleNamespace
    from app.modules.workspace_profile import service
    from app.modules.agent import business
    store = {"workspace_profile": {}}
    d = service._defaults(email="owner@example.test", company_name="Apex")
    d["services"] = [{"service_category": d["primary_industry"], "service_name": "AI Automation Service"}]
    ws = SimpleNamespace(id="w1", data=store, updated_at="now")

    async def load(u, w):
        return ws

    async def update(**kw):
        store.update(kw["data_patch"])

    async def get(**kw):
        return ws

    class Biz:
        async def mutate(self, bid, fn):
            return fn(store)
    monkeypatch.setattr(service, "_load_workspace", load)
    monkeypatch.setattr(service, "update_workspace", update)
    monkeypatch.setattr(service, "get_workspace", get)
    monkeypatch.setattr(business, "SupabaseBusiness", Biz)
    asyncio.run(service.upsert_profile(user_id="u", workspace_id="w1", profile=service.WorkspaceProfile.model_validate(d)))
    assert [p["name"] for p in store["catalogue"]["products"]] == ["AI Automation Service"]
