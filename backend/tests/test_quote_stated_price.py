"""QA, 16 Oct (end-to-end run): "Prepare a quotation for ABC Ltd: 20 car washes at ₦15,000 each" with "Car wash subscription"
in the catalogue but not priced yet (added from the profile) asked for the price again. The price the request states is the
owner's: it prices the line, and the draft waits for approval at 20 × ₦15,000."""
from test_agent import OWNER, Env, run


def test_a_price_stated_in_the_request_prices_an_unpriced_catalogue_item():
    env = Env()
    data = env.businesses["A"]["data"]
    data.setdefault("catalogue", {})["products"] = [{"id": "p-cw", "name": "Car wash subscription", "base_price": 0, "type": "service", "from_profile": True}]
    r = env.submit(text="Prepare a quotation for ABC Ltd (abc@example.test): 20 car washes at ₦15,000 each")["run"]
    for _ in range(3):      # the customer details are confirmed as read; the items are never asked again
        q = r.get("pending_question")
        if not q:
            break
        assert "approved price" not in str(q.get("question")), q
        r = run(env.orch.provide_input(r["id"], OWNER, {f["key"]: f.get("default") or "" for f in q["fields"]}))
    approvals = run(env.store.list_approvals(run_id=r["id"], status="pending"))
    assert r["status"] == "awaiting_approval" and approvals, (r["status"], r.get("pending_question"))
    items = approvals[0]["payload"]["items"]
    assert [(float(i["qty"]), float(i["unit_price"])) for i in items] == [(20.0, 15000.0)]
