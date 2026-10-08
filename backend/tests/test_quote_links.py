"""One live customer link per quotation, notifications that don't hold the customer up,
and the validity date shown once on the customer's page."""
import asyncio
import time
from types import SimpleNamespace

from app.modules.agent import documents as docs
from app.modules.marketplace import service as mkt
from test_agent import ENQUIRY, OWNER, Env, run
from test_quote_customer import quote, store  # noqa: F401  (fixture)


def _quote(env):
    return env.fin["quotes"][0]


# ── share links ───────────────────────────────────────────────────────────────
def test_a_sent_quotation_has_exactly_one_live_link():
    env = Env()
    r = env.approve(env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"])
    assert r["status"] == "succeeded"
    q = _quote(env)
    assert env.comms.active_links(q["id"]) == [q["acceptance_link"]]
    assert "pending_link" not in q and q["sent_version"] == int(q.get("version") or 1)


def test_a_failed_send_leaves_no_live_link_and_the_retry_makes_a_fresh_one():
    env = Env()
    env.comms.mode = "fail"
    r = env.approve(env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"])
    q = _quote(env)
    assert r["status"] == "failed" and len(env.comms.links) == 1
    assert env.comms.active_links(q["id"]) == [] and "pending_link" not in q      # the failed attempt's link is dead
    env.comms.mode = "ok"
    r = run(env.orch.retry(r["id"], OWNER))
    q = _quote(env)
    assert r["status"] == "succeeded" and len(env.comms.links) == 2
    assert env.comms.active_links(q["id"]) == [q["acceptance_link"]]


def test_a_refused_address_leaves_no_live_link():
    env = Env()
    env.comms.refuse_domains.add("example.com")
    r = env.submit(capability="enquiry_to_quote", channel="ui_action",
                   params={**ENQUIRY, "sender_name": "Inject Test Ltd", "sender_email": "inject@example.com"})["run"]
    r = env.approve(r)
    assert r["substatus"] == "waiting_for_information"
    assert env.comms.links and env.comms.active_links(_quote(env)["id"]) == []


def test_an_unconfirmed_send_keeps_its_link_for_the_retry():
    # The email may already be in the customer's inbox, so its link must keep working.
    env = Env()
    env.comms.mode = "uncertain_then_ok"
    r = env.approve(env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"])
    q = _quote(env)
    assert r["substatus"] == "delivery_status_uncertain"
    held = q["pending_link"]["url"]
    assert env.comms.active_links(q["id"]) == [held]
    r = run(env.orch.retry(r["id"], OWNER))
    q = _quote(env)
    assert r["status"] == "succeeded" and len(env.comms.links) == 1                 # no second link was made
    assert q["acceptance_link"] == held and env.comms.active_links(q["id"]) == [held]


def test_sending_again_revokes_the_earlier_link():
    env = Env()
    r = env.approve(env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"])
    q = _quote(env)
    first = q["acceptance_link"]
    # Older links to the same quotation (earlier sends, earlier versions) are still on record.
    env.comms.links["https://example.test/share/legacy"] = {"quote_id": q["id"], "active": True}
    run(env.comms.revoke_quotation_links(owner_id=OWNER, business_id="A", quote=q, keep=first))
    assert env.comms.active_links(q["id"]) == [first]


def test_revoking_by_type_keeps_only_the_named_token(monkeypatch):
    import app.modules.blueprint.share_repository as repo
    calls = []

    async def select(table, filters=None, **_):
        assert table == "blueprint_documents" and ("type", "eq", "quotation_acceptance::A::::q1") in filters
        return [{"id": "d1"}, {"id": "d2"}]

    async def update(table, filters=None, payload=None):
        calls.append((table, filters, payload))
        return [{"token": "old1"}, {"token": "old2"}]

    monkeypatch.setattr(repo, "sb_select", select)
    monkeypatch.setattr(repo, "sb_update", update)
    n = asyncio.run(repo.revoke_shares_for_type(user_id="u1", type="quotation_acceptance::A::::q1", keep_token="new"))
    table, filters, payload = calls[0]
    assert n == 2 and table == "blueprint_document_shares" and payload["revoked"] is True
    assert ("document_id", "in", ["d1", "d2"]) in filters and ("token", "neq", "new") in filters and ("user_id", "eq", "u1") in filters


def test_the_live_service_revokes_by_link_or_keeps_one(monkeypatch):
    import app.modules.blueprint.share_repository as repo
    from app.modules.agent.services import ResendComms
    seen = []

    async def one(*, token, user_id):
        seen.append(("one", token, user_id))
        return True

    async def by_type(*, user_id, type, keep_token=None):
        seen.append(("type", type, keep_token))
        return 1

    monkeypatch.setattr(repo, "revoke_share_token", one)
    monkeypatch.setattr(repo, "revoke_shares_for_type", by_type)
    q = {"id": "q1", "rfq_id": "r9"}
    comms = ResendComms()
    asyncio.run(comms.revoke_quotation_links(owner_id="u1", business_id="A", quote=q, link="https://app.test/share/abc123"))
    asyncio.run(comms.revoke_quotation_links(owner_id="u1", business_id="A", quote=q, keep="https://app.test/share/keepme?x=1"))
    assert seen == [("one", "abc123", "u1"), ("type", "quotation_acceptance::A::r9::q1", "keepme")]


# ── notifications don't keep the customer waiting ─────────────────────────────
def _slow_email(store, monkeypatch, seconds=0.4):  # noqa: F811
    async def email(**kw):
        await asyncio.sleep(seconds)
        store["emails"].append(kw)
        return SimpleNamespace(sent=True)
    monkeypatch.setattr(mkt, "send_email_via_resend", email)


def test_a_question_returns_before_the_email_is_sent(store, monkeypatch):  # noqa: F811
    _slow_email(store, monkeypatch)

    async def go():
        started = time.perf_counter()
        res = await mkt.ask_about_quote(token="tok", viewer_email="", message="Can we start next month?")
        took = time.perf_counter() - started
        assert not store["emails"]                      # the reply did not wait for the email
        await mkt.drain_background()
        return res, took

    res, took = asyncio.run(go())
    assert took < 0.2 and res["questions"][-1]["message"] == "Can we start next month?"
    assert len(store["emails"]) == 1 and store["emails"][0]["reply_to_email"] == "qa@buyer.test"


def test_a_failed_notification_never_loses_the_answer(store, monkeypatch):  # noqa: F811
    async def email(**kw):
        raise RuntimeError("mail service down")
    monkeypatch.setattr(mkt, "send_email_via_resend", email)

    async def go():
        res = await mkt.respond_to_quote(token="tok", viewer_email="", action="accept", signer_name="Sam Lee", accepted_terms=True)
        await mkt.drain_background()
        return res

    assert asyncio.run(go())["action"] == "accepted" and quote(store)["status"] == "accepted"


def test_questions_stay_on_the_quotation_after_a_decision(store):  # noqa: F811
    async def go():
        await mkt.ask_about_quote(token="tok", viewer_email="", message="Is delivery included?")
        await mkt.respond_to_quote(token="tok", viewer_email="", action="accept", signer_name="Sam Lee", accepted_terms=True)
        await mkt.drain_background()
        return await mkt.quote_status_for_customer(token="tok")

    s = asyncio.run(go())
    assert s["state"] == "accepted" and [q["message"] for q in s["questions"]] == ["Is delivery included?"]


# ── "Valid until" appears once on the page ────────────────────────────────────
def test_the_page_document_leaves_the_validity_to_the_summary_bar():
    p = {"reference": "QUO-1", "company": "Alchemy Test", "customer_name": "QA Test Ltd", "currency": "GBP", "version": 2,
         "items": [{"description": "Consulting", "qty": 2.0, "unit_price": 120}], "subtotal": 240, "vat_rate": 20,
         "vat_amount": 48, "total": 288, "valid_until": "2026-11-02", "issued_at": "2026-10-03", "payment_terms": "Net 14 days"}
    html = docs.quotation_document_html(p)
    body = html.split("</style>", 1)[1]
    assert body.count("Valid until") == 1                                   # only the copy kept for the PDF
    assert '<span class="eaq-pdf-only">Valid until</span><b class="eaq-pdf-only">2 November 2026</b>' in body
    assert ".eaq-pdf-only{display:none}" in html and ".eaq-pdf .eaq-pdf-only{display:revert}" in html
    assert "Payment terms" in body and "Net 14 days" in body
