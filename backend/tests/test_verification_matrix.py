"""Round 10 verification matrix: six synthetic workspaces (mixed sectors and countries, pre-revenue and trading, Starter
and Explorer) and every capability, each asked for in chat and taken through to its result. For each it records the
capability it was routed to, the questions asked, the draft and its approval, that no credit text appears anywhere the
owner reads, that the Credits page lists every charge and adds up to the ledger, and where the task shows (Active,
Needs approval, History). Then the special scenarios: an automatic trigger with the budget almost used up, a forced
worker failure (retries, holds released, a refund given once), a second idea, and the whole sales chain.

Synthetic data only, in memory: no database, no model (the rules route and read, as when the model is unreachable).
MATRIX_REPORT=path writes the table to a file."""
import copy
import json
import os
from datetime import timedelta

import pytest

from app.modules.agent import autostart
from app.modules.agent import router as agent_router
from app.modules.agent import summary as summary_mod
from app.modules.agent.workflows import WORKFLOWS
from test_agent import OWNER, Env, run
from test_agent_no_credit_text import credit_words


def _paid(n, customer, amount, days_ago, now, desc):
    at = (now - timedelta(days=days_ago)).isoformat()
    return {"id": f"inv-{customer[:3].lower()}-{n}", "reference": f"INV-{900 + n}", "customer_name": customer, "customer_email": f"{customer.split()[0].lower()}@buyer.test",
            "status": "paid", "total_amount": amount, "subtotal_amount": amount, "issued_at": at, "paid_at": at, "description": desc,
            "line_items": [{"description": desc, "qty": 1, "unit_price": amount}], "payments": [{"id": f"pay-{n}", "amount": amount, "paid_at": at}]}


# (key, plan, country, currency, sector, trading, what it sells, customer)
WORKSPACES = [
    ("uk_cleaning_pre", "explorer", "United Kingdom", "GBP", "Office cleaning for small firms in Leeds", False, ("Office deep clean", 120, 40), "Delta Offices Ltd"),
    ("uk_books_trading", "starter_insight", "United Kingdom", "GBP", "Bookkeeping for cafés and salons", True, ("Monthly bookkeeping", 300, 90), "Smith and Sons"),
    ("ng_cafe_trading", "starter_insight", "Nigeria", "NGN", "A café and catering service in Lagos", True, ("Office lunch platter", 25000, 9000), "Bread and Butter Bakery"),
    ("ie_grooming_pre", "explorer", "Ireland", "EUR", "A mobile dog grooming van in Cork", False, ("Full groom", 55, 15), "Fresh from the Farm"),
    ("us_it_trading", "starter_insight", "United States", "USD", "IT support for dental practices", True, ("Monthly IT support", 450, 120), "Nova Labs"),
    ("gh_bakery_pre", "starter_insight", "Ghana", "GHS", "Wedding and birthday cakes in Accra", False, ("Celebration cake", 600, 220), "Back to Basics Ltd"),
]

# Every capability, asked for in the owner's words. {c}: the customer, {p}: the item, {x}: its price.
PHRASES = {
    "enquiry_to_quote": "Quote {c} for 2 x {p}",
    "new_invoice": "Invoice {c} for 1 x {p} at {x}",
    "quote_to_cash": "Customer accepted {quote}",
    "receipt_send": "send the receipt for {paid_ref}",
    "record_payment": "{c} paid {unpaid_ref}",
    "credit_note": "credit note for {sent_ref}, {half} back, the job was cancelled",
    "new_purchase_order": "Raise a purchase order to Supplies for You for 3 x cleaning stock at 20",
    "supplier_bill": "record a bill from Supplies for You for 45 for cleaning stock",
    "record_expense": "Record an expense: 30 on parking today",
    "add_customer": "Add customer Hands to Help Ltd, ops@handstohelp.test",
    "add_vendor": "add a supplier called Tools to Go, orders@toolstogo.test",
    "add_catalogue_item": "add Gutter clearing to my catalogue at 95",
    "update_record": "change the price of {p} to {x2}",
    "new_contract": "Draft a contract for {c}: {p}, {x} a month for 12 months",
    "new_proposal": "write a proposal for {c} for {p} at {x} a month",
    "payment_followup": "chase up the unpaid ones",
    "marketplace_profile": "update my marketplace profile: {sector}",
    "marketplace_offering": "list my {p} on the marketplace",
    "price_test": "what if I raise my prices 10%",
    "capacity_check": "we can do 40 jobs a month, can we take on more?",
    "scenario_help": "what if I lose {c}",
    "expansion_scenario": "what if I hire another person",
    "risk_concentration": "what is my biggest risk?",
    "offer_review": "which of my services sell best?",
    "idea_validation": "Validate my idea: {sector}",
    "market_size": "how big is the market for {sector}",
    "business_plan_draft": "write me a business plan",
    "sales_letter_draft": "write a sales letter for my business",
    "funding_pack_draft": "make me a funding pack",
    "launch_evidence_gaps": "what evidence am I missing before I launch?",
    "readiness_refresh": "refresh my readiness",
    "registration_checklist": "register my company",
}


def _workspace(key, plan, country, currency, sector, trading, sells, customer):
    env = Env(plan=plan, credits=500)
    d = env.businesses["A"]["data"]
    name, price, cost = sells
    d["settings"] = {"currency": currency}
    d["workspace_profile"] = {"company_name": f"Synthetic {key}", "email": f"hello@{key}.test", "country": country, "description": sector}
    d["catalogue"] = {"customers": [{"id": "c1", "name": customer, "email": f"{customer.split()[0].lower()}@buyer.test", "payment_terms": 14}],
                      "vendors": [{"id": "v1", "name": "Supplies for You", "email": "accounts@supplies.test"}],
                      "products": [{"id": "p1", "name": name, "base_price": price, "cost_of_sales": cost}]}
    inv = d["financials"]["invoices"]
    if trading:
        inv += [_paid(i, customer, price, 15 + i * 20, env.now, name) for i in range(3)]
    sent = {"id": "inv-sent", "reference": "INV-950", "customer_name": customer, "customer_id": "c1", "customer_email": f"{customer.split()[0].lower()}@buyer.test",
            "status": "sent", "total_amount": price, "subtotal_amount": price, "issued_at": (env.now - timedelta(days=40)).isoformat(),
            "due_date": (env.now - timedelta(days=26)).date().isoformat(), "line_items": [{"description": name, "qty": 1, "unit_price": price}], "payments": []}
    inv.append(sent)
    d["financials"]["quotes"].append({"id": "q1", "reference": "QUO-777", "quotation_id": "QUO-777", "customer_name": customer, "customer_id": "c1",
                                      "customer_email": sent["customer_email"], "status": "sent", "total_amount": price * 2,
                                      "items": [{"product_id": "p1", "product_name": name, "quantity": 2, "unit_price": price}],
                                      "line_items": [{"description": name, "qty": 2, "unit_price": price}], "sent_at": env.now.isoformat()})
    if not trading:
        d["workspace_profile"]["operating_stage"] = "idea"
    return env, {"c": customer, "p": name, "x": f"{price:g}", "x2": f"{price * 1.1:.0f}", "sector": sector, "quote": "QUO-777",
                 "paid_ref": "INV-900" if trading else "INV-950", "unpaid_ref": "INV-950", "sent_ref": "INV-950", "half": f"{price / 2:g}"}


def _answer(field, env):
    if field.get("default") not in (None, "", []):
        return field["default"]
    t, key = field.get("type"), field.get("key", "")
    if t == "email" or "email" in key:
        return "someone@synthetic.test"
    if t == "choice" or t == "customer":
        opts = [o.get("value") for o in field.get("options") or [] if o.get("value") not in (None, "", "new")]
        return opts[0] if opts else ""
    if t == "line_items":
        if "catalogue" in field and not field["catalogue"]:      # a supplier's lines: named, never one of the business's own items
            return [{"name": "Cleaning stock", "quantity": 3, "unit_price": 20}]
        p = env.businesses["A"]["data"]["catalogue"]["products"][0]
        return [{"product_id": p["id"], "quantity": 1, "unit_price": p["base_price"]}]
    if t == "number":
        return 0 if "refund" in key else 10
    if t == "date":
        return (env.now + timedelta(days=14)).date().isoformat()
    if t == "checkbox":
        return False
    return "Synthetic answer"


def _drive(env, text):
    """The chat request, every question answered (what was read from it left as read), every approval approved."""
    res = env.submit(text=text)
    out = {"kind": res.get("kind"), "routed": (res.get("run") or {}).get("workflow_key") or res.get("capability"), "questions": [], "said": [], "approvals": [],
           "texts": [res]}
    r = res.get("run")
    for _ in range(8):
        if not r:
            break
        q = r.get("pending_question") if r.get("status") == "running" else None
        if q:
            fields = q.get("fields") or []
            out["questions"].append([f["key"] for f in fields if not f.get("said") and not f.get("companion_of")])
            out["said"] += [f["key"] for f in fields if f.get("said")] + [s.get("key") for s in q.get("said") or []]
            out["texts"].append(q)
            r = run(env.orch.provide_input(r["id"], OWNER, {f["key"]: _answer(f, env) for f in fields}))
            continue
        pending = env.pending(r) if r.get("status") == "awaiting_approval" else []
        if pending:
            a = pending[0]
            p = a.get("payload") or {}
            out["approvals"].append({"tool": a["tool_id"], "to": p.get("to_email"), "total": p.get("total"), "party": p.get("customer_name") or p.get("vendor_name")})
            out["texts"].append(a)
            r = env.approve(r)
            continue
        break
    out["run"] = r
    out["status"] = (agent_router._public_run(r)["display_status"] if r else res.get("kind"))
    out["bucket"] = summary_mod.bucket_of(r) if r else None
    out["texts"].append(agent_router._public_run(r) if r else {})
    return out


def _ledger_matches(env, client_get) -> bool:
    page = client_get("/businesses/A/agent/charges")
    taken = sum(c for _, _, c in env.meter.charges) - sum(c for _, c, _, _ in getattr(env.meter, "refunds", []))
    return page["total"] == taken


ROWS: list[dict] = []


@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.shared.auth.deps import get_current_user
    holder = {}
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: holder["env"].orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    c = TestClient(app)
    yield holder, (lambda path: c.get(path).json())
    app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.parametrize("ws", WORKSPACES, ids=[w[0] for w in WORKSPACES])
def test_every_capability_in_every_workspace(ws, client):
    holder, get = client
    rows = []
    for capability in sorted(WORKFLOWS):
        env, names = _workspace(*ws)
        holder["env"] = env
        out = _drive(env, PHRASES[capability].format(**names))
        comms = env.comms.sent
        row = {"workspace": ws[0], "plan": ws[1], "capability": capability, "routed": out["routed"], "status": out["status"], "bucket": out["bucket"],
               "questions": out["questions"], "said": sorted(set(filter(None, out["said"]))), "approvals": out["approvals"],
               "emails": [m["to"] for m in comms], "credit_text": credit_words(*out["texts"], comms), "ledger_ok": _ledger_matches(env, get)}
        rows.append(row)
    ROWS.extend(rows)
    # The rules every row must keep.
    assert [r for r in rows if r["credit_text"]] == [], [(r["capability"], r["credit_text"]) for r in rows if r["credit_text"]]
    assert all(r["ledger_ok"] for r in rows), [r["capability"] for r in rows if not r["ledger_ok"]]
    assert all(all(e.endswith(".test") for e in r["emails"]) for r in rows)      # nothing ever leaves for a real address
    assert all(r["status"] not in ("failed",) for r in rows), [(r["capability"], r["status"]) for r in rows if r["status"] == "failed"]


def test_zz_write_the_matrix():
    path = os.environ.get("MATRIX_REPORT")
    if not path or not ROWS:
        pytest.skip("MATRIX_REPORT not set")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(ROWS, f, indent=1, default=str)


# ══ Special scenarios ═══════════════════════════════════════════════════════

def test_an_automatic_trigger_with_the_budget_almost_used_up_waits_and_starts_once_the_cap_is_raised():
    env, _ = _workspace(*WORKSPACES[1])
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "monthly_credit_cap": 3, "items": {"invoice_overdue": True}}}, OWNER))
    env.store.runs["spent"] = {"id": "spent", "business_id": "A", "workflow_key": "risk_concentration", "capability": "risk_concentration", "title": "Risk",
                               "requester_id": OWNER, "status": "succeeded", "source_channel": "business_event",
                               "created_at": env.now.isoformat(), "state": {"credits": [{"feature": "agent_task", "credits": 2, "at": env.now.isoformat()}]}}
    left = autostart.budget(run(env.store.get_policy("A")), run(env.store.list_runs("A")), env.now)["left"]
    assert left == 1
    started = run(autostart.sweep(env.orch, "A"))
    assert started == [] and env.meter.charges == []                        # a 2-credit reminder would go over: it waits
    run(env.store.set_policy("A", {"automation": {**run(env.store.get_policy("A"))["automation"], "monthly_credit_cap": 20}}, OWNER))
    assert "payment_followup" in [r["workflow_key"] for r in run(autostart.sweep(env.orch, "A"))]      # the waiting reminder starts


def test_a_forced_worker_failure_retries_releases_every_hold_and_refunds_once():
    env, _ = _workspace(*WORKSPACES[0])
    env.orch.rt.studio.fail = True
    r = env.submit(capability="business_plan_draft", channel="business_event", source_reference="idea:plan")["run"]
    if r.get("pending_question"):
        r = run(env.orch.provide_input(r["id"], OWNER, {f["key"]: _answer(f, env) for f in r["pending_question"]["fields"]}))
    for i in range(4):                                                      # the quick retries, then parked
        env.now += timedelta(minutes=20)
        run(env.orch.auto_retry(run(env.store.list_runs("A"))))
    r = run(env.store.get_run(r["id"]))
    assert r["status"] == "failed" and env.meter.charges == []              # every hold given back: nothing taken
    # Charged, then never delivered (cancelled): given back once, however often it is looked at.
    env2, _ = _workspace(*WORKSPACES[0])
    env2.meter.costs["business_plan_full"] = 40                            # as on the live price list (F1: 40 credits)
    ok = env2.submit(capability="business_plan_draft", channel="business_event", source_reference="idea:plan")["run"]
    if ok.get("pending_question"):
        ok = run(env2.orch.provide_input(ok["id"], OWNER, {f["key"]: _answer(f, env2) for f in ok["pending_question"]["fields"]}))
    charged = sum(c for _, _, c in env2.meter.charges)
    ok["status"] = "running"
    run(env2.orch._finish(ok, "cancelled", None, "test", "Closed."))
    run(env2.orch.refund_undelivered(ok))
    assert charged > 0 and len(env2.meter.refunds) == 1 and env2.meter.refunds[0][1] == charged


def test_a_second_idea_in_a_workspace_that_has_one_gets_its_own_record():
    env, _ = _workspace(*WORKSPACES[1])
    d = env.businesses["A"]["data"]
    before = json.dumps(d["workspace_profile"], sort_keys=True)
    r = _drive(env, "Validate my idea: a mobile dog grooming van for busy owners in Leeds")
    assert r["status"] in ("succeeded", "nothing_to_do") and json.dumps(d["workspace_profile"], sort_keys=True) == before
    assert list(d.get("agent_ideas") or {}) and "dog grooming" in json.dumps(d["agent_ideas"]).lower()


def test_the_whole_sales_chain():
    env, n = _workspace(*WORKSPACES[1])
    d = env.businesses["A"]["data"]
    run(env.store.set_policy("A", {"contract_route": "direct_invoice", "default_vat_rate": 20}, OWNER))
    steps = {}
    steps["invoice"] = _drive(env, f"Invoice {n['c']} for 1 x {n['p']} at {n['x']}")
    inv = next(i for i in d["financials"]["invoices"] if i.get("agent_run_id") == steps["invoice"]["run"]["id"])
    assert steps["invoice"]["approvals"][0]["tool"] == "send_invoice" and steps["invoice"]["approvals"][0]["to"].endswith(".test")
    steps["payment"] = _drive(env, f"{n['c']} paid {inv['reference']}")
    assert inv["status"] == "paid"
    steps["receipt"] = _drive(env, f"send the receipt for {inv['reference']}")
    assert any(m["to"].endswith(".test") for m in env.comms.sent)
    steps["credit"] = _drive(env, f"credit note for {inv['reference']}, 10 back, one visit was missed")
    assert steps["credit"]["status"] in ("succeeded",) and d["financials"].get("credit_notes")
    env.now += timedelta(days=40)                                           # the unpaid invoice is now well overdue
    steps["followup"] = _drive(env, "chase up the unpaid ones")
    assert any(a["tool"] == "send_payment_reminder" for a in steps["followup"]["approvals"])
    steps["accepted"] = _drive(env, "Customer accepted QUO-777")
    assert steps["accepted"]["routed"] == "quote_to_cash" and any(a["tool"] == "send_invoice" for a in steps["accepted"]["approvals"])
    for s in steps.values():
        assert credit_words(*s["texts"]) == []
