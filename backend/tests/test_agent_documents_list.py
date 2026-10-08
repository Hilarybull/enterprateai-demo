"""The Agent Centre's Documents list, after the browser check: every row carries the number the
document is known by elsewhere (never a bare record id), a status that belongs to its kind, and
the newest first; and receipts that were numbered twice before the receipt ledger existed are
each given their own number."""
from datetime import timedelta

from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import integrity
from app.modules.agent import router as agent_router
from app.modules.agent.dashboard import invoice_label, invoice_labels
from app.shared.auth.deps import get_current_user
from test_agent import OWNER, Env, run


def _documents(env, monkeypatch):
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        with TestClient(app) as client:
            return client.get("/businesses/A/agent/documents").json()
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _day(env, ago):
    return (env.now - timedelta(days=ago)).isoformat()


def test_rows_carry_the_documents_own_number_a_status_of_their_kind_and_the_newest_first(monkeypatch):
    env = Env()
    # Made by hand in Business Operations, with no number saved on them.
    env.fin["invoices"] += [
        {"id": "29ef9b20-aaaa-4bbb-8ccc-000000000001", "customer_name": "Aftred", "status": "pending", "total_amount": 149, "created_at": _day(env, 20),
         "due_date": (env.now + timedelta(days=10)).date().isoformat()},
        {"id": "inv-numbered", "invoice_number": "INV-77", "customer_name": "BrightTech Ltd", "status": "sent", "total_amount": 60, "created_at": _day(env, 2),
         "due_date": (env.now + timedelta(days=10)).date().isoformat()},
    ]
    env.fin["quotes"] += [{"id": "7b420df3-aaaa-4bbb-8ccc-000000000002", "customer_name": "Frank", "status": "pending", "total_amount": 900, "created_at": _day(env, 5)}]
    env.fin["contracts"] += [{"id": "con-1", "reference": "CON-1", "customer_name": "Frank", "status": "pending", "created_at": _day(env, 9)}]
    body = _documents(env, monkeypatch)
    docs = {d["id"]: d for d in body["items"]}
    aftred, frank = docs["29ef9b20-aaaa-4bbb-8ccc-000000000001"], docs["7b420df3-aaaa-4bbb-8ccc-000000000002"]
    # The same derived number the dashboard and Business Operations show, never "29ef9b20".
    data = env.businesses["A"]["data"]
    assert aftred["reference"] == invoice_label(env.fin["invoices"][0], invoice_labels(data)) and aftred["reference"].startswith("INV-")
    assert "29ef9b20" not in aftred["reference"].lower()
    assert frank["reference"] == "QUO-7B420DF3"                             # how Business Operations names a quotation saved without a number
    assert docs["inv-numbered"]["reference"] == "INV-77"
    # "pending" reads as what it means for that kind of document.
    assert aftred["status_label"] == "Awaiting payment" and "signature" not in aftred["status_label"]
    assert frank["status_label"] == "Sent, awaiting reply"
    assert docs["con-1"]["status_label"] == "Sent, awaiting signature"
    assert docs["inv-numbered"]["status_label"] == "Sent"
    # Newest first by the document's date; none of these has a task, so each is marked as made by hand.
    assert [d["date"] for d in body["items"]] == sorted((d["date"] for d in body["items"]), reverse=True)
    assert [d["id"] for d in body["items"]] == ["inv-numbered", "7b420df3-aaaa-4bbb-8ccc-000000000002", "con-1", "29ef9b20-aaaa-4bbb-8ccc-000000000001"]
    assert all(d["from_agent"] is False and d["run_id"] is None and d["duplicate_number"] is False for d in body["items"])


def test_what_waits_for_approval_stays_on_top_whatever_its_date(monkeypatch):
    env = Env()
    env.fin["invoices"].append({"id": "newer", "invoice_number": "INV-9", "customer_name": "Frank", "status": "sent", "total_amount": 10,
                                "created_at": (env.now + timedelta(days=1)).isoformat()})
    waiting = env.submit(text="quote BrightTech Ltd for Strategy Workshop")["run"]
    assert waiting["status"] == "awaiting_approval"
    body = _documents(env, monkeypatch)
    assert [(d["kind"], d["status"]) for d in body["items"]][:2] == [("quotation", "awaiting_approval"), ("invoice", "sent")]
    assert body["items"][0]["from_agent"] is True and body["items"][0]["run_id"] == waiting["id"]


def _two_receipts_one_number(env):
    """As in the books before the receipt ledger: the first receipt's record was lost, so the second payment was given its number."""
    env.fin["invoices"] += [
        {"id": "inv-qa-test", "invoice_number": "INV-1", "customer_name": "QA Test Ltd", "status": "paid", "total_amount": 100, "created_at": _day(env, 4),
         "payments": [{"id": "pay-1", "amount": 100, "paid_at": _day(env, 4),
                       "receipt": {"number": "REC-1031026", "created_at": _day(env, 4), "sent_at": _day(env, 4), "sent_to": "a@qa.test"}}]},
        {"id": "inv-round-six", "invoice_number": "INV-2", "customer_name": "QA Round Six Ltd", "status": "paid", "total_amount": 100, "created_at": _day(env, 3),
         "payments": [{"id": "pay-2", "amount": 100, "paid_at": _day(env, 3),
                       "receipt": {"number": "REC-1031026", "created_at": _day(env, 3), "sent_at": _day(env, 3), "sent_to": "b@six.test", "message_id": "m-2"}}]},
    ]
    env.store.receipts.append({"business_id": "A", "number": "REC-1031026", "invoice_id": "inv-qa-test", "payment_id": "pay-1", "created_at": _day(env, 4),
                               "sent_at": _day(env, 4), "sent_to": "a@qa.test", "message_id": None})


def test_two_receipts_with_one_number_are_shown_as_such_and_put_right(monkeypatch):
    env = Env()
    _two_receipts_one_number(env)
    before = [d for d in _documents(env, monkeypatch)["items"] if d["kind"] == "receipt"]
    assert [d["reference"] for d in before] == ["REC-1031026"] * 2 and all(d["duplicate_number"] for d in before)
    # A dry run says what would change and changes nothing.
    plan = run(integrity.repair_duplicate_receipts(env.orch.rt, "A"))
    assert [(c["receipt_number"], c["customer_name"], c["kept_by"], c["new_number"]) for c in plan] == [("REC-1031026", "QA Round Six Ltd", "QA Test Ltd", None)]
    assert [p["receipt"]["number"] for i in env.fin["invoices"] for p in i.get("payments") or []] == ["REC-1031026"] * 2
    # Applied: the first payment keeps the number; the later one gets the next free number and remembers the old one.
    done = run(integrity.repair_duplicate_receipts(env.orch.rt, "A", apply=True))
    new = done[0]["new_number"]
    first, second = env.fin["invoices"][-2]["payments"][0]["receipt"], env.fin["invoices"][-1]["payments"][0]["receipt"]
    assert first["number"] == "REC-1031026" and "replaces" not in first
    assert second["number"] == new != "REC-1031026" and second["replaces"] == "REC-1031026" and second["sent_to"] == "b@six.test"
    assert new.startswith("REC-") and new.endswith((env.now - timedelta(days=3)).strftime("%d%m%y"))      # numbered for the day it was issued
    ledger = {(r["invoice_id"], r["payment_id"]): r for r in run(env.store.receipt_history("A"))}
    assert ledger[("inv-round-six", "pay-2")]["number"] == new and ledger[("inv-round-six", "pay-2")]["sent_to"] == "b@six.test"
    assert ledger[("inv-qa-test", "pay-1")]["number"] == "REC-1031026"
    assert len({r["number"] for r in ledger.values()}) == len(ledger)       # one number, one payment
    # Nothing left to do, in the list or on a second run.
    assert integrity.duplicate_receipts(env.businesses["A"]["data"]) == [] and run(integrity.repair_duplicate_receipts(env.orch.rt, "A", apply=True)) == []
    after = [d for d in _documents(env, monkeypatch)["items"] if d["kind"] == "receipt"]
    assert sorted(d["reference"] for d in after) == sorted(["REC-1031026", new]) and not any(d["duplicate_number"] for d in after)
    assert not [i for i in run(integrity.check_business(env.orch.rt, "A")) if i["issue"] == "duplicate_receipt_number"]


# ══ paging: the API returns a page, not everything ════════════════════════════

def _client(env, monkeypatch):
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    return TestClient(app)


def test_documents_come_a_page_at_a_time_with_totals_that_do_not_depend_on_the_page(monkeypatch):
    env = Env()
    for n in range(45):
        env.fin["invoices"].append({"id": f"inv-{n:02d}", "invoice_number": f"INV-{n:02d}", "customer_name": "Frank" if n % 3 == 0 else "Aftred", "status": "sent",
                                    "total_amount": 10 + n, "created_at": _day(env, n), "due_date": (env.now + timedelta(days=30)).date().isoformat()})
    for n in range(5):
        env.fin["quotes"].append({"id": f"q-{n}", "reference": f"QUO-{n}", "customer_name": "Frank", "status": "sent", "total_amount": 50, "created_at": _day(env, 100 + n)})
    try:
        with _client(env, monkeypatch) as client:
            get = lambda **params: client.get("/businesses/A/agent/documents", params=params).json()      # noqa: E731
            assert agent_router.PAGE_SIZE == 10
            pages = [get(page=n) for n in range(1, 6)]                      # ten rows a page
            assert [len(p["items"]) for p in pages] == [10] * 5 and get(page=6)["items"] == [] and pages[2]["offset"] == 20 and pages[0]["limit"] == 10
            assert [d["id"] for p in pages for d in p["items"]] == [d["id"] for d in get()["items"]]
            first, second, third = get(limit=20), get(limit=20, offset=20), get(limit=20, offset=40)
            assert [len(p["items"]) for p in (first, second, third)] == [20, 20, 10]
            assert all(p["total"] == 50 and p["all_total"] == 50 and p["counts"] == {"invoice": 45, "quotation": 5} for p in (first, second, third))      # totals, not the page's count
            ids = [d["id"] for p in (first, second, third) for d in p["items"]]
            assert len(set(ids)) == 50 and ids[0] == "inv-00" and ids[-1] == "q-4"      # every document once, newest first across the pages
            # Filter, search and order happen on the server, before the page is cut.
            quotes = get(limit=20, kind="quotation")
            assert quotes["total"] == 5 and quotes["all_total"] == 50 and {d["kind"] for d in quotes["items"]} == {"quotation"}
            assert quotes["counts"] == {"invoice": 45, "quotation": 5}      # the type list still shows every type's total
            frank = get(limit=20, q="frank", kind="invoice")
            assert frank["total"] == 15 and all(d["party"] == "Frank" for d in frank["items"])
            assert get(limit=20, q="INV-07")["items"][0]["reference"] == "INV-07" and get(limit=20, q="nobody at all")["total"] == 0
            oldest = get(limit=20, order="oldest")
            assert oldest["items"][0]["id"] == "q-4" and oldest["total"] == 50
            assert get(limit=20, offset=500)["items"] == []                 # past the end: empty, not an error
            assert client.get("/businesses/A/agent/documents", params={"limit": 0}).status_code == 422
            assert len(get()["items"]) == 50                                # without a page asked for, as before
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_tasks_come_a_page_at_a_time_and_the_tab_counts_are_always_the_totals(monkeypatch):
    env = Env()
    waiting = env.submit(text="quote BrightTech Ltd for Strategy Workshop")["run"]
    one = run(env.store.get_run(env.submit(text="invoice Customer Ltd for consulting £100")["run"]["id"]))      # a task waiting for information
    for n in range(22):      # and 22 more like it (written straight to the store: a plan's monthly allowance is not what is being tested)
        run(env.store.create_run({**one, "id": f"00000000-0000-4000-8000-{n:012d}", "created_at": _day(env, n + 1), "updated_at": _day(env, n + 1)}))
    try:
        with _client(env, monkeypatch) as client:
            get = lambda **params: client.get("/businesses/A/workflow-runs", params=params).json()      # noqa: E731
            everything = get()
            counts = everything["counts"]
            assert counts["needs_approval"] == 1 and counts["history"] == 24 == len(everything["items"])
            bucket = next(k for k, v in counts.items() if v == 23)
            first, second = get(bucket=bucket, limit=20), get(bucket=bucket, limit=20, offset=20)
            assert (len(first["items"]), len(second["items"]), first["total"], second["total"]) == (20, 3, 23, 23)
            assert first["counts"] == second["counts"] == counts            # the numbers on the tabs never change with the page
            assert not {r["id"] for r in first["items"]} & {r["id"] for r in second["items"]}
            history = get(bucket="history", limit=20, capability="enquiry_to_quote")
            assert history["total"] == 1 and history["items"][0]["id"] == waiting["id"] and history["counts"]["history"] == 24
            assert get(bucket="needs_approval", limit=20)["total"] == 1
            third = get(bucket=bucket, page=3)                              # ten rows a page: 10, 10, 3
            assert (len(get(bucket=bucket, page=1)["items"]), len(third["items"]), third["total"], third["offset"], third["limit"]) == (10, 3, 23, 20, 10)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
