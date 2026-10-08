"""A quotation asked for in the owner's own words: everything still missing is asked for in one
form (customer picker, items from the catalogue, VAT only without a default), and a request that
names a customer and items on record needs no questions at all."""
from app.modules.agent import router as agent_router
from test_agent import OWNER, Env, run


def _env():
    env = Env()
    cat = env.businesses["A"]["data"]["catalogue"]
    cat["customers"].append({"id": "c2", "name": "Frank", "email": "frank@frank.test"})
    cat["products"].append({"id": "p4", "name": "Bookkeeping", "base_price": 200})
    return env


def _fields(r):
    return {f["key"]: f for f in r["pending_question"]["fields"]}


def test_need_a_quotation_asks_for_the_customer_and_the_items_in_one_form():
    env = _env()
    r = env.submit(text="need a quotation")["run"]
    assert r["status"] == "running" and r["pending_question"]["question"] == "Who is this quotation for, and what should it include?"
    f = _fields(r)
    assert list(f) == ["customer_id", "customer_name", "customer_email", "items", "discount", "valid_until", "notes"]      # one form; VAT has a default, so it isn't asked
    assert f["valid_until"]["default"] == "2026-10-31" and not f["discount"].get("required") and not f["notes"].get("required")      # filled in from settings; nothing extra to type
    assert f["customer_id"]["type"] == "customer" and f["customer_id"]["new_label"] == "+ New customer"
    assert [(o["value"], o["label"]) for o in f["customer_id"]["options"]] == [("c1", "BrightTech Ltd"), ("c2", "Frank")]
    assert f["customer_name"]["show_if"] == f["customer_email"]["show_if"] == {"customer_id": "new"}      # only for a new customer
    assert {"id": "p4", "name": "Bookkeeping", "unit_price": 200} in f["items"]["catalogue"]      # prices come with the catalogue
    assert agent_router._public_run(r)["step"] == {"index": 2, "total": 5, "title": "Match the customer", "doing": "Matching the customer…"}
    # Customer and items answered together: the draft goes straight to Needs Approval.
    r = run(env.orch.provide_input(r["id"], OWNER, {"customer_id": "c2", "items": [{"product_id": "p4", "quantity": 2, "unit_price": 200}]}))
    assert r["status"] == "awaiting_approval" and r["pending_question"] is None
    payload = env.pending(r)[0]["payload"]
    assert (payload["customer_name"], payload["to_email"], payload["total"]) == ("Frank", "frank@frank.test", 480)
    assert [(i["description"], i["qty"], i["unit_price"], i["price_source"]) for i in payload["items"]] == [("Bookkeeping", 2, 200, "catalogue")]


def test_a_request_naming_a_customer_and_items_on_record_skips_both_questions():
    env = _env()
    r = env.submit(text="quote Frank for 2 months bookkeeping")["run"]
    assert r["status"] == "awaiting_approval"
    payload = env.pending(r)[0]["payload"]
    assert (payload["customer_name"], payload["total"]) == ("Frank", 480)
    assert [(i["description"], i["qty"]) for i in payload["items"]] == [("Bookkeeping", 2)]
    assert [c["name"] for c in env.businesses["A"]["data"]["catalogue"]["customers"]] == ["BrightTech Ltd", "Frank"]      # nobody new was created


def test_a_named_customer_with_no_items_is_only_asked_for_the_items():
    env = _env()
    r = env.submit(text="quote for brighttech")["run"]
    assert list(_fields(r)) == ["items"]


def test_a_new_customer_is_entered_in_the_same_form_and_vat_is_asked_only_without_a_default():
    env = _env()
    env.store.policies["A"] = {"contract_route": "direct_invoice"}        # no default VAT rate
    r = env.submit(text="need a quotation")["run"]
    assert list(_fields(r)) == ["customer_id", "customer_name", "customer_email", "items", "discount", "valid_until", "notes", "vat_rate", "save_vat_default"]
    r = run(env.orch.provide_input(r["id"], OWNER, {
        "customer_id": "new", "customer_name": "Nova Labs", "customer_email": "dana@novalabs.test", "vat_rate": 0,
        "items": [{"product_id": "p1", "quantity": 1, "unit_price": 1500}, {"product_id": None, "name": "Travel", "quantity": 1, "unit_price": 50}]}))
    assert r["status"] == "awaiting_approval"
    payload = env.pending(r)[0]["payload"]
    assert (payload["customer_name"], payload["to_email"], payload["total"]) == ("Nova Labs", "dana@novalabs.test", 1550)
    assert [i["price_source"] for i in payload["items"]] == ["catalogue", "user_confirmed"]


def test_with_no_customers_on_record_the_form_asks_for_the_new_one_directly():
    env = _env()
    env.businesses["A"]["data"]["catalogue"]["customers"] = []
    f = _fields(env.submit(text="need a quotation")["run"])
    assert "customer_id" not in f and "show_if" not in f["customer_name"]


def test_started_in_the_background_the_request_returns_at_once_and_the_task_says_what_it_is_doing(monkeypatch):
    """The Agent box asks for the task to be carried on in the background, so it can show the step."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.shared.auth.deps import get_current_user
    env = _env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        with TestClient(app) as client:
            started = client.post("/agent/requests", json={"business_id": "A", "text": "need a quotation", "background": True}).json()
            assert started["kind"] == "workflow" and started["run"]["status"] == "running" and started["run"]["pending_question"] is None
            assert started["run"]["step"]["doing"] == "Reading the request…"
            run_id = started["run"]["id"]
            shown = client.get(f"/workflow-runs/{run_id}").json()["run"]      # by the time it is looked at, it has got to its question
            assert shown["pending_question"]["question"] == "Who is this quotation for, and what should it include?"
            after = client.post(f"/workflow-runs/{run_id}/input", json={"background": True, "answers": {
                "customer_id": "c2", "items": [{"product_id": "p4", "quantity": 2, "unit_price": 200}]}}).json()["run"]
            assert after["status"] == "running" and after["pending_question"] is None
            assert client.get(f"/workflow-runs/{run_id}").json()["run"]["status"] == "awaiting_approval"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_identical_reads_in_one_piece_of_work_are_fetched_once_and_a_write_forgets_them(monkeypatch):
    import asyncio
    from app.core import supabase as sb
    fetched = []

    async def fake(table, **kwargs):
        fetched.append(table)
        await asyncio.sleep(0)
        return {"rows": [len(fetched)]}
    monkeypatch.setattr(sb, "_sb_select", fake)

    async def work():
        with sb.read_cache():
            a, b = await asyncio.gather(sb.sb_select("workspaces", filters=[("id", "eq", "A")]), sb.sb_select("workspaces", filters=[("id", "eq", "A")]))
            a["rows"].append("changed by the caller")
            c = await sb.sb_select("workspaces", filters=[("id", "eq", "A")])
            other = await sb.sb_select("workspaces", filters=[("id", "eq", "B")])
            sb._forget_reads("workspaces")          # what every write helper does for its table
            d = await sb.sb_select("workspaces", filters=[("id", "eq", "A")])
            return a, b, c, other, d
        return None
    a, b, c, other, d = run(work())
    assert fetched == ["workspaces", "workspaces", "workspaces"]      # A once (though asked three times), B once, A again after the write
    assert b == c == {"rows": [1]} and other == {"rows": [2]} and d == {"rows": [3]}      # a caller's own changes never reach the next reader
    assert run(sb.sb_select("workspaces", filters=[("id", "eq", "A")])) == {"rows": [4]}      # outside it, nothing is kept


def test_needs_approval_is_the_same_number_on_the_dashboard_and_in_the_agent_centre(monkeypatch):
    """One query for both. A receipt left waiting while hundreds of newer tasks pile up is still counted and listed."""
    import copy
    from fastapi.testclient import TestClient
    from app.main import app
    from app.shared.auth.deps import get_current_user
    env = _env()
    env.fin["invoices"] = [{"id": "i2", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 300, "status": "paid",
                            "reference": "INV-2", "payments": [{"id": "pay1", "amount": 300, "paid_at": env.now.isoformat()}]}]
    receipt = env.submit(capability="receipt_send", params={"invoice_id": "i2"}, channel="ui_action")["run"]
    quote = env.submit(text="quote Frank for 2 months bookkeeping")["run"]
    assert receipt["status"] == quote["status"] == "awaiting_approval"
    done = next(r for r in env.store.runs.values() if r["id"] == quote["id"])
    for n in range(520):                                                  # newer finished tasks than one page of the list holds
        later = copy.deepcopy(done)
        later.update({"id": f"later-{n}", "status": "succeeded", "created_at": f"2026-11-01T00:{n // 60:02d}:{n % 60:02d}+00:00", "dedupe_key": None})
        env.store.runs[later["id"]] = later
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        with TestClient(app) as client:
            summary = client.get("/businesses/A/agent/summary").json()
            centre = client.get("/businesses/A/workflow-runs").json()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    listed = [r["id"] for r in centre["items"] if r["bucket"] == "needs_approval"]
    assert summary["needs_approval_count"] == centre["counts"]["needs_approval"] == len(listed) == 2
    assert set(listed) == {receipt["id"], quote["id"]} == {c["run_id"] for c in summary["needs_approval"]}


def test_editing_a_draft_bumps_the_version_asks_again_and_says_what_changed():
    env = _env()
    r = env.submit(text="quote Frank for 2 months bookkeeping")["run"]
    first = env.pending(r)[0]
    assert (first["payload_version"], first["payload"]["total"]) == (1, 480)
    edited = run(env.orch.edit_draft(r["id"], OWNER, {
        "items": [{"product_id": "p4", "name": "Bookkeeping", "quantity": 3, "unit_price": 200},        # qty changed, still the catalogue price
                  {"product_id": None, "name": "Year-end accounts", "quantity": 1, "unit_price": 350}],
        "vat_rate": 20, "customer_email": "accounts@frank.test", "valid_until": "2026-12-01", "payment_terms_days": 30, "notes": "Thank you."}))
    assert edited["status"] == "awaiting_approval"
    waiting = env.pending(edited)
    assert len(waiting) == 1 and waiting[0]["id"] != first["id"] and waiting[0]["payload_version"] == 2      # the old approval can't be used
    assert run(env.store.get_approval(first["id"]))["status"] not in ("pending", "approved")
    p = waiting[0]["payload"]
    assert (p["total"], p["to_email"], p["valid_until"], p["payment_terms"], p["notes"]) == (1140, "accounts@frank.test", "2026-12-01", "Net 30 days", "Thank you.")
    assert [(i["description"], i["qty"], i["price_source"]) for i in p["items"]] == [("Bookkeeping", 3, "catalogue"), ("Year-end accounts", 1, "user_edited")]
    last = agent_router._public_run(run(env.store.get_run(r["id"])))["last_edit"]
    assert (last["version"], last["by"]) == (2, OWNER)
    assert last["changes"].startswith("Qty 2 → 3 on Bookkeeping; Added Year-end accounts; Sent to frank@frank.test → accounts@frank.test")
    assert last["changes"].endswith("total £480.00 → £1,140.00")
    # Another customer on record: "Sent to" follows them.
    again = run(env.orch.edit_draft(r["id"], OWNER, {"customer_id": "c1"}))
    q = env.pending(again)[0]
    assert (q["payload"]["customer_name"], q["payload"]["to_email"], q["payload_version"]) == ("BrightTech Ltd", "buyer@brighttech.test", 3)
    import pytest
    from app.modules.agent.orchestrator import Conflict
    for bad in ({"items": []}, {"items": [{"name": "X", "quantity": 0, "unit_price": 5}]}, {"customer_email": "not-an-email"}, {"valid_until": "2020-01-01"}):
        with pytest.raises(Conflict):
            run(env.orch.edit_draft(r["id"], OWNER, bad))
    assert env.pending(again)[0]["payload_version"] == 3                  # a refused edit changes nothing
