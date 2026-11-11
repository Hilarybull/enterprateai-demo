"""The superadmin's Emails area (the owner, 10 Nov): see what was sent, switch kinds of email on or off, edit their
wording, and send a one-off email. Essential emails (getting into an account, things a person asked for) stay on."""
import asyncio

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.admin import router as admin
from app.shared.auth.deps import get_current_user
from app.shared.email import catalog, resend
from app.shared.email.resend import EmailDeliveryResult


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def mail(monkeypatch):
    """No real email or database: what would be sent, what is logged, and the stored settings."""
    sent, logged, settings = [], [], {}
    catalog.forget()

    async def deliver(**kw):
        sent.append(kw)
        return EmailDeliveryResult(sent=True, message_id="m1")

    async def log(**kw):
        logged.append(kw)

    async def setting(kind):
        return settings.get(kind)
    monkeypatch.setattr(resend, "_deliver", deliver)
    monkeypatch.setattr(catalog, "log", log)
    monkeypatch.setattr(catalog, "setting", setting)
    return sent, logged, settings


def test_every_email_is_logged_with_its_kind(mail):
    sent, logged, _ = mail
    run(resend.send_password_reset_email(to_email="ada@example.com", reset_url="https://x.test/r"))
    assert len(sent) == 1 and logged[0]["kind"] == "password_reset" and logged[0]["status"] == "sent" and logged[0]["message_id"] == "m1"


def test_a_switched_off_email_is_not_sent_but_logged_and_an_essential_one_always_goes(mail):
    sent, logged, settings = mail
    settings["workspace_invitation"] = {"enabled": False}
    r = run(resend.send_workspace_invitation_email_with_link(to_email="b@example.com", inviter_email="o@example.com", invite_url="https://x.test/i",
                                                             expires_in_days=7, permission_type="module"))
    assert r.sent is False and r.error == resend.MSG_SWITCHED_OFF and sent == [] and logged[-1]["status"] == "switched_off"
    settings["password_reset"] = {"enabled": False}      # can't be switched off: it still goes
    assert run(resend.send_password_reset_email(to_email="ada@example.com", reset_url="https://x.test/r")).sent is True


def test_edited_wording_is_used_with_the_real_details_and_nothing_typed_becomes_markup(mail):
    sent, _, settings = mail
    settings["password_reset"] = {"enabled": True, "subject": "Reset your {app_name} password", "button_label": "Choose a password",
                                  "body": "Hello <b>there</b>,\n\nClick below for {email}.\n\n{link}\n\nIt lasts {minutes} minutes."}
    run(resend.send_password_reset_email(to_email="ada@example.com", reset_url="https://x.test/r?a=1&b=2", expires_in_minutes=30))
    msg = sent[-1]
    assert msg["subject"].startswith("Reset your ") and msg["subject"].endswith(" password")
    assert "Hello &lt;b&gt;there&lt;/b&gt;" in msg["html_content"] and "<b>there</b>" not in msg["html_content"]
    assert 'href="https://x.test/r?a=1&amp;b=2"' in msg["html_content"] and "Choose a password" in msg["html_content"]
    assert "ada@example.com" in msg["text_content"] and "It lasts 30 minutes." in msg["text_content"] and "https://x.test/r?a=1&b=2" in msg["text_content"]


def test_wording_without_its_link_or_with_unknown_details_is_refused():
    assert "body" in catalog.problems("password_reset", "Reset", "No link here", "Go")
    assert "subject" in catalog.problems("password_reset", "Hi {first_name}", "{link}", "Go")
    assert "body" in catalog.problems("password_otp", "Code", "No code", "")
    assert catalog.problems("password_reset", "Reset your password", "Hi\n\n{link}", "Go") == {}
    assert "kind" in catalog.problems("agent_document", "x", "y", "z")      # the owner approves each one's words
    assert "body" in catalog.problems("claim_invitation", "Hi", "{message}\n\n{link}", "Claim")      # its own stop link must stay


def test_every_email_can_be_worded_here_or_says_where_its_words_come_from():
    """The owner, 11 Nov: all emails should be edited and set from the Emails area."""
    for kind in catalog.KINDS:
        assert kind in catalog.TEMPLATES or kind in catalog.WRITTEN_ELSEWHERE, kind
    for kind, t in catalog.TEMPLATES.items():
        assert catalog.problems(kind, t["subject"], t["body"], t["button"]) == {}, kind
        subject, text, _ = catalog.render(kind, {}, admin._EMAIL_SAMPLES[kind], footer_html="", footer_text="")
        assert "{" not in subject + text, kind


def test_an_edited_claim_decision_and_claim_code_go_out_with_the_real_details(mail, monkeypatch):
    from app.core.config import get_settings
    from app.modules.marketplace import directory
    sent, _, settings = mail
    monkeypatch.setattr(get_settings(), "frontend_url", "https://app.test")
    settings["claim_decision"] = {"enabled": True, "subject": "Good news: {headline}", "body": "Dear owner,\n\n{message}\n\n{next_step}\n\n{link}", "button_label": "{action}"}
    run(directory._email_decision({"kind": "claim_approved", "business_name": "Apex Ltd", "to": "ada@example.com", "link": "/profile"}))
    msg = sent[-1]
    assert msg["subject"] == "Good news: You now manage Apex Ltd on EnterprateAI"
    assert "Dear owner," in msg["text_content"] and "https://app.test/profile" in msg["html_content"] and "Finish setting up your profile" in msg["html_content"]
    settings["claim_code"] = {"enabled": True, "subject": "Code for {business_name}", "body": "Here it is:\n\n{code}", "button_label": ""}
    run(directory._email_code("ada@example.com", "482913", "Apex Ltd"))
    assert sent[-1]["subject"] == "Code for Apex Ltd" and "482913" in sent[-1]["html_content"]


@pytest.fixture
def admin_client(monkeypatch):
    store = {"email_settings": {}, "email_log": [], "audit": []}

    async def sb_select(table, filters=None, single=False, **_kw):
        if table == "email_settings":
            rows = list(store["email_settings"].values())
            for col, _op, val in filters or []:
                rows = [r for r in rows if r.get(col) == val]
            return (rows[0] if rows else None) if single else rows
        if table == "email_log":
            return list(store["email_log"])
        return []

    async def sb_upsert(table, payload, on_conflict=None):
        store[table][payload["kind"]] = dict(payload)

    async def sb_update(table, filters, payload):
        for r in store[table].values():
            if r["kind"] == filters[0][2]:
                r.update(payload)

    async def audit(actor, action, detail):
        store["audit"].append(action)
    monkeypatch.setattr(admin, "sb_select", sb_select)
    monkeypatch.setattr(admin, "sb_upsert", sb_upsert)
    monkeypatch.setattr(admin, "sb_update", sb_update)
    monkeypatch.setattr(admin, "_audit", audit)
    app.dependency_overrides[admin.require_admin] = lambda: {"id": "a", "email": "tech.support@enterprateai.com"}
    try:
        yield TestClient(app, raise_server_exceptions=False), store
    finally:
        app.dependency_overrides.clear()


def test_the_admin_lists_switches_edits_and_resets(admin_client, mail):
    client, store = admin_client
    kinds = {k["key"]: k for k in client.get("/admin/emails/kinds").json()["items"]}
    assert kinds["password_reset"]["essential"] and kinds["password_reset"]["editable"] and kinds["claim_invitation"]["editable"] and kinds["agent_document"]["editable"] is False and kinds["agent_document"]["written"] == "each_time"
    assert kinds["workspace_invitation"]["default"]["body"].count("{link}") == 1
    assert client.put("/admin/emails/kinds/password_reset", json={"enabled": False}).status_code == 400
    assert client.put("/admin/emails/kinds/claim_invitation", json={"enabled": False}).json()["enabled"] is False
    assert store["email_settings"]["claim_invitation"]["updated_by"] == "tech.support@enterprateai.com"
    bad = client.put("/admin/emails/kinds/workspace_invitation", json={"body": "Join us"})
    assert bad.status_code == 422 and "body" in bad.json()["detail"]["errors"]
    ok = client.put("/admin/emails/kinds/workspace_invitation", json={"subject": "Join {inviter_email}", "body": "Hi\n\n{link}", "button_label": "Join"})
    assert ok.json()["edited"] is True
    preview = client.post("/admin/emails/kinds/workspace_invitation/preview", json={"subject": "Join {inviter_email}", "body": "Hi\n\n{link}", "button_label": "Join"}).json()
    assert preview["subject"] == "Join owner@example.com" and "https://example.com/invite" in preview["html"] and preview["errors"] == {}
    assert client.delete("/admin/emails/kinds/workspace_invitation/wording").json()["edited"] is False
    assert store["email_settings"]["workspace_invitation"]["body"] is None
    assert store["audit"] == ["email_setting_changed", "email_setting_changed", "email_wording_reset"]


def test_the_log_filters_by_address_or_subject(admin_client):
    client, store = admin_client
    store["email_log"] = [{"to_email": "ada@example.com", "subject": "Your code", "kind": "task_code", "status": "sent"},
                          {"to_email": "bo@example.com", "subject": "Invitation", "kind": "workspace_invitation", "status": "failed"}]
    assert [r["to_email"] for r in client.get("/admin/emails/log?q=invit").json()["items"]] == ["bo@example.com"]


def test_a_one_off_email_goes_to_each_address_on_its_own(admin_client, mail):
    client, _ = admin_client
    sent, logged, _ = mail
    r = client.post("/admin/emails/send", json={"to": "ada@example.com, bo@example.com\nada@example.com", "subject": "Hello", "body": "Line <one>\n\nLine two"})
    assert r.status_code == 200 and r.json()["sent"] == 2
    assert [m["to_email"] for m in sent] == ["ada@example.com", "bo@example.com"] and "Line &lt;one&gt;" in sent[0]["html_content"]
    assert all(entry["kind"] == "manual" and entry["sent_by"] == "tech.support@enterprateai.com" for entry in logged)
    assert client.post("/admin/emails/send", json={"to": "not-an-address", "subject": "Hello", "body": "Hi there"}).status_code == 422


def test_only_the_superadmin_can_use_it():
    app.dependency_overrides[get_current_user] = lambda: {"id": "u", "email": "someone@example.test"}
    try:
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/admin/emails/kinds").status_code == 403
        assert client.post("/admin/emails/send", json={"to": "a@b.co", "subject": "Hello", "body": "Hi there"}).status_code == 403
    finally:
        app.dependency_overrides.clear()


# ── tracking (the owner, 10 Nov: "track all") ──────────────────────────────────────────────────

def test_resend_events_land_on_the_email_once_each(monkeypatch):
    row = {"id": "e1", "provider_message_id": "m1", "events": [], "open_count": 0, "click_count": 0}

    async def sb_select(table, filters=None, single=False, **_kw):
        return dict(row) if filters[0][2] == "m1" else None

    async def sb_update(table, filters, payload):
        row.update(payload)
    import app.core.supabase as sb
    monkeypatch.setattr(sb, "sb_select", sb_select)
    monkeypatch.setattr(sb, "sb_update", sb_update)
    ev = lambda i, t, at, data=None: run(catalog.record_event(event_id=i, type_=t, message_id="m1", at=at, data=data))
    assert ev("v1", "email.delivered", "2026-11-10T09:00:00Z")
    assert ev("v2", "email.opened", "2026-11-10T09:05:00Z") and ev("v3", "email.opened", "2026-11-10T10:00:00Z")
    assert ev("v3", "email.opened", "2026-11-10T10:00:00Z") is False      # Resend sent it twice: counted once
    assert ev("v4", "email.clicked", "2026-11-10T10:01:00Z", {"click": {"link": "https://x.test/claim"}})
    assert (row["delivered_at"], row["opened_at"], row["last_opened_at"], row["open_count"]) == ("2026-11-10T09:00:00Z", "2026-11-10T09:05:00Z", "2026-11-10T10:00:00Z", 2)
    assert (row["click_count"], row["last_clicked_link"]) == (1, "https://x.test/claim")
    assert ev("v5", "email.bounced", "2026-11-10T11:00:00Z", {"bounce": {"message": "Mailbox full"}}) and row["bounce_reason"] == "Mailbox full"
    assert run(catalog.record_event(event_id="v6", type_="email.opened", message_id="unknown", at="x")) is False
    assert run(catalog.record_event(event_id="v7", type_="email.sent", message_id="m1", at="x")) is False


# ── opting out (the owner, 10 Nov: "there should be option to opt out on the emails") ─────────────

def test_an_optional_email_carries_an_unsubscribe_link_and_header_and_an_essential_one_doesnt(mail):
    sent, _, _ = mail
    run(resend.send_workspace_invitation_email_with_link(to_email="b@example.com", inviter_email="o@example.com", invite_url="https://x.test/i",
                                                         expires_in_days=7, permission_type="module"))
    msg = sent[-1]
    assert "/email/opt-out?t=" in msg["text_content"] and ">Unsubscribe</a>" in msg["html_content"] and msg["html_content"].endswith("</div>")
    assert "List-Unsubscribe" in msg["headers"]
    token = msg["text_content"].split("/email/opt-out?t=")[1].split()[0]
    assert catalog.read_optout_token(token) == ("b@example.com", "workspace_invitation")
    assert catalog.read_optout_token(token[:-1] + ("0" if token[-1] != "0" else "1")) is None      # tampered
    run(resend.send_password_reset_email(to_email="ada@example.com", reset_url="https://x.test/r"))
    assert "opt-out" not in sent[-1]["text_content"] and "List-Unsubscribe" not in (sent[-1].get("headers") or {})


def test_someone_who_opted_out_is_not_sent_it_but_still_gets_account_emails(mail, monkeypatch):
    sent, logged, _ = mail

    async def opted_out(email, kind):
        return email == "b@example.com" and kind in catalog.OPT_OUT_HONOURED
    monkeypatch.setattr(catalog, "opted_out", opted_out)
    r = run(resend.send_workspace_invitation_email_with_link(to_email="b@example.com", inviter_email="o@example.com", invite_url="https://x.test/i",
                                                             expires_in_days=7, permission_type="module"))
    assert r.sent is False and r.error == resend.MSG_OPTED_OUT and sent == [] and logged[-1]["status"] == "opted_out"
    assert run(resend.send_password_reset_email(to_email="b@example.com", reset_url="https://x.test/r")).sent is True


def test_the_unsubscribe_page_stops_one_kind_or_all_and_can_undo(monkeypatch):
    store = []

    async def opt_out(email, kind, source):
        store.append((email, kind, source))

    async def opt_in(email, kind=None):
        store[:] = [r for r in store if not (r[0] == email and (kind is None or r[1] == kind))]

    async def sb_select(table, filters=None, **_kw):
        return [{"kind": k} for e, k, _s in store if e == filters[0][2]]
    import app.core.supabase as sb
    monkeypatch.setattr(catalog, "opt_out", opt_out)
    monkeypatch.setattr(catalog, "opt_in", opt_in)
    monkeypatch.setattr(sb, "sb_select", sb_select)
    client = TestClient(app, raise_server_exceptions=False)
    t = catalog.optout_token("Bo@Example.com", "proposal_invite")
    page = client.get(f"/email/opt-out?t={t}").json()
    assert page == {"email": "b***@example.com", "kind": "proposal_invite", "label": "Proposal invitation", "this": False, "all": False}
    assert client.post(f"/email/opt-out?t={t}&scope=this").json()["this"] is True and store == [("bo@example.com", "proposal_invite", "unsubscribe_link")]
    assert client.post(f"/email/opt-out?t={t}&scope=all&one_click=1").json()["all"] is True and store[-1] == ("bo@example.com", "all", "one_click")
    assert client.post(f"/email/opt-in?t={t}&scope=all").json() == {**page, "this": False, "all": False}
    assert client.get("/email/opt-out?t=nonsense").status_code == 404
