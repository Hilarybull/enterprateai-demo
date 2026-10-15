"""A draft's items not in the catalogue are offered once ("Add 'Flower · £200' to your catalogue?"), never items already listed,
and never again once answered."""
from app.modules.agent.router import _catalogue_offer

APPROVAL = {"tool_id": "send_invoice", "payload": {"currency": "GBP", "items": [
    {"description": "Flower", "qty": 1, "unit_price": 200}, {"description": "Vase", "qty": 1, "unit_price": 30}]}}
RECORD = {"catalogue": {"products": [{"name": "vase", "base_price": 30}]}}


def test_only_new_items_are_offered_with_the_draft_price():
    assert _catalogue_offer({"state": {}}, APPROVAL, RECORD) == [{"name": "Flower", "unit_price": 200, "currency": "GBP"}]


def test_offered_once_and_only_on_documents_with_items():
    assert _catalogue_offer({"state": {"catalogue_offer_done": "not_now"}}, APPROVAL, RECORD) == []
    assert _catalogue_offer({"state": {}}, {**APPROVAL, "tool_id": "send_contract"}, RECORD) == []
    assert _catalogue_offer({"state": {}}, None, RECORD) == []


def test_add_saves_the_item_once_and_closes_the_offer(monkeypatch):
    from test_agent import OWNER, Env, run
    from test_b8_named_drafts import _draft
    from app.modules.agent import router as agent_router
    env = Env()
    r, _inv, _ref = _draft(env)
    pending = run(env.store.list_approvals(run_id=r["id"], status="pending"))[0]
    env.store.approvals[pending["id"]]["payload"]["items"].append({"description": "Flower", "qty": 1, "unit_price": 200})
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    user = {"id": OWNER, "email": "owner@example.test"}
    res = run(agent_router.answer_catalogue_offer(r["id"], agent_router.CatalogueOfferIn(add=True), user))
    assert res["added"] == ["Flower"]
    products = run(env.orch.rt.business.load(r["business_id"]))["catalogue"]["products"]
    assert [p["base_price"] for p in products if p["name"] == "Flower"] == [200]
    again = run(agent_router.answer_catalogue_offer(r["id"], agent_router.CatalogueOfferIn(add=True), user))
    assert again["added"] == []      # offered once: nothing added twice
