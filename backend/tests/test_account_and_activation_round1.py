"""Activation emails round 1 (not set up is said plainly; the one-time question after a Google
sign-up; internal accounts are never held out; one-click unsubscribe headers) and the account
endpoints behind the settings page (other devices, a copy of your data, closing the account)."""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.activation import router as act_router
from app.modules.activation import rules
from app.modules.activation.service import WORDING, WORDING_VERSION, ActivationService, Config, SendResult
from app.modules.activation.store import MemoryStore, NotSetUp, SupabaseStore, _missing
from app.shared.auth import deps
from app.shared.auth import router as auth_router
from app.shared.auth.deps import get_current_user
from app.shared.auth.security import create_access_token
from test_activation import T0, World, run

ADMIN = {"id": "tech.support@enterprateai.com", "email": "tech.support@enterprateai.com"}


# ══ E-1 ═══════════════════════════════════════════════════════════════════════

class Broken(MemoryStore):
    """A server where migration 033 hasn't been run: every read and write says the table isn't there."""
    async def get_user(self, user_id): raise NotSetUp()
    async def list_users(self): raise NotSetUp()
    async def ledger(self, user_id=None): raise NotSetUp()
    async def update_user(self, user_id, patch): raise NotSetUp()
    async def workspace_index(self): raise NotSetUp()
    async def events(self, user_id=None): raise NotSetUp()


def test_e1_a_missing_table_or_column_is_recognised_for_what_it_is():
    for text in ("Could not find the table 'public.activation_ledger' in the schema cache", "PGRST205", "column users.marketing_email_status does not exist",
                 "Could not find the 'marketing_email_status' column of 'users'", "42703", "42P01"):
        assert _missing(Exception(text))
    assert not _missing(Exception("connection reset by peer")) and not _missing(Exception("duplicate key value violates unique constraint"))

    async def boom(*a, **k):
        raise Exception("Could not find the table 'public.activation_ledger' in the schema cache")
    with pytest.raises(NotSetUp):
        run(SupabaseStore._call(boom))

    async def other(*a, **k):
        raise RuntimeError("connection reset")
    with pytest.raises(RuntimeError):
        run(SupabaseStore._call(other))


def test_e1_not_set_up_is_a_503_for_administrators_and_never_an_error_for_an_ordinary_user(monkeypatch):
    svc = ActivationService(store=Broken(), send=None, config=Config(enabled=False))
    monkeypatch.setattr(act_router, "get_service", lambda: svc)
    client = TestClient(app, raise_server_exceptions=False)
    who = {"id": "ada@example.test", "email": "ada@example.test"}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    try:
        mine = client.get("/auth/me/email-preferences")
        assert mine.status_code == 200 and mine.json() == {"available": False, "product_tips": False, "status": "unknown", "can_resubscribe": False, "ask_once": False}
        assert client.post("/auth/me/email-preferences/prompt", json={"product_tips": True}).json()["available"] is False
        changed = client.put("/auth/me/email-preferences", json={"product_tips": True})
        assert changed.status_code == 503 and changed.json()["detail"]["code"] == "not_set_up"
        who.update(ADMIN)
        for path in ("/admin/activation", "/admin/activation/dry-run", "/admin/activation/users/ada@example.test"):
            r = client.get(path)
            assert r.status_code == 503 and r.json()["detail"] == {"code": "not_set_up", "message": "Activation emails aren't set up on this server: run migration 033."}
        token = svc.token("ada@example.test")
        assert client.get(f"/email/preferences?token={token}").status_code == 503 and client.post(f"/email/unsubscribe?token={token}").status_code == 503
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_e1_switched_off_but_set_up_still_lets_people_keep_their_own_setting(monkeypatch):
    w = World(enabled=False)
    u = w.user(status="unknown")
    monkeypatch.setattr(act_router, "get_service", lambda: w.svc)
    client = TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides[get_current_user] = lambda: {"id": u, "email": u}
    try:
        assert client.get("/auth/me/email-preferences").json()["available"] is True
        assert client.put("/auth/me/email-preferences", json={"product_tips": True}).json()["product_tips"] is True
        app.dependency_overrides[get_current_user] = lambda: dict(ADMIN)
        board = client.get("/admin/activation")
        assert board.status_code == 200 and board.json()["config"]["enabled"] is False
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert w.tick() == {"enabled": False, "selected": [], "delivered": []} and w.outbox == []


# ══ E-2 ═══════════════════════════════════════════════════════════════════════

def test_e2_a_google_sign_up_is_asked_once_and_only_a_tick_is_permission():
    w = World()
    g = w.user("gina@example.test", status="unknown", auth_provider="google")
    form = w.user("fred@example.test", status="unknown", auth_provider=None)
    assert run(w.svc.preferences(g))["ask_once"] is True and run(w.svc.preferences(g))["wording"] == WORDING[WORDING_VERSION]
    assert run(w.svc.preferences(form))["ask_once"] is False            # the sign-up form already showed them the choice
    # Closing it without a tick: no permission, recorded, never asked again.
    closed = run(w.svc.answer_prompt(g, False))
    assert (closed["product_tips"], closed["status"], closed["ask_once"]) == (False, "unknown", False)
    assert w.store.users[g]["marketing_prompt_answered_at"] == w.now.isoformat() and w.store.users[g].get("marketing_permission_source") is None
    assert [e["type"] for e in w.store.event_rows] == ["prompt_dismissed"]
    w.tick()
    assert w.steps(g) == {}                                               # no tick, no emails
    # Ticking: consent, with where, when and which wording.
    t = w.user("tia@example.test", status="unknown", auth_provider="google")
    w.at(hours=1)
    ticked = run(w.svc.answer_prompt(t, True))
    assert (ticked["product_tips"], ticked["status"], ticked["ask_once"]) == (True, "subscribed", False)
    rec = w.store.users[t]
    assert (rec["marketing_permission_source"], rec["marketing_permission_wording"], rec["marketing_permission_at"]) == ("google_signup_prompt", "tips-v1", w.now.isoformat())
    assert ticked["last_changed_from"] == "the prompt after signing in with Google" and ticked["last_changed_at"] == w.now.isoformat()
    w.tick()
    assert set(w.steps(t)) == {"a1", "a2", "a3", "a4", "a5"}
    # Someone who already chose (either way) isn't asked.
    assert run(w.svc.preferences(w.user("sub@example.test", auth_provider="google")))["ask_once"] is False
    assert run(w.svc.preferences(w.user("off@example.test", status="unsubscribed", auth_provider="google")))["ask_once"] is False


def test_e2_the_last_change_says_when_and_where_from():
    w = World()
    u = w.user(status="unknown")
    assert run(w.svc.preferences(u))["last_changed_at"] is None
    run(w.svc.set_permission(u, "subscribed", source="account_settings"))
    w.at(days=2)
    run(w.svc.set_permission(u, "unsubscribed", source="unsubscribe_link"))
    p = run(w.svc.preferences(u))
    assert (p["last_changed_at"], p["last_changed_from"], p["permission_source"]) == (w.now.isoformat(), "an unsubscribe link", "account_settings")
    run(w.svc.set_permission(u, "subscribed", source="Opted in at the Leeds event (recorded by tech.support@enterprateai.com)", actor="admin"))
    assert run(w.svc.preferences(u))["last_changed_from"] == "support"


# ══ the two activation checks ═════════════════════════════════════════════════

def test_internal_accounts_are_never_held_out_however_the_list_is_typed():
    assert act_router.parse_emails(' "Hilarybull5@Gmail.com" ; team@example.test\nqa@example.test,  ,not-an-address') == frozenset({"hilarybull5@gmail.com", "team@example.test", "qa@example.test"})
    assert act_router.parse_emails("") == frozenset() and act_router.parse_emails(None) == frozenset()
    w = World(cohort="internal", holdout_percent=100, internal_emails=act_router.parse_emails("Hilarybull5@gmail.com"))
    u = w.user("hilarybull5@gmail.com")
    other = w.user("customer@example.test")
    assert run(w.svc.user_journey(u))["cohort"] == {"in_rollout": True, "holdout": False, "internal": True}
    assert run(w.svc.user_journey(other))["cohort"] == {"in_rollout": False, "holdout": True, "internal": False}
    w.tick()
    w.at(minutes=15).tick()
    assert [m["to"] for m in w.outbox] == [u] and w.steps(u)["a1"] == "sent"      # sent, even with everyone else held out
    w.config = Config(enabled=True, dry_run=False, cohort="all", holdout_percent=100, internal_emails=frozenset({u}))
    w.tick()
    w.at(minutes=15).tick()
    assert w.steps(other)["a1"] == "holdout" and len(w.outbox) == 1


def test_one_click_unsubscribe_is_on_once_the_api_address_is_set_and_the_mail_carries_the_rfc_8058_headers(monkeypatch):
    off = World()
    assert off.svc.describe()["one_click_unsubscribe"] is False
    u = off.user()
    assert "List-Unsubscribe" not in off.svc.message(off.store.users[u], {"id": "x", "journey_key": "A", "step_key": "a1"})["headers"]
    on = World(api_base_url="https://api.enterprateai.example/")
    assert on.svc.describe()["one_click_unsubscribe"] is True
    v = on.user()
    msg = on.svc.message(on.store.users[v], {"id": "row-1", "journey_key": "A", "step_key": "a1"})
    assert msg["headers"]["List-Unsubscribe"] == f"<https://api.enterprateai.example/email/unsubscribe?token={on.svc.token(v)}>"
    assert msg["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    # ...and they reach the provider, on mail that isn't labelled transactional.
    from app.shared.email import resend
    sent = {}

    class FakeResponse:
        status_code = 200
        text = ""
        def json(self): return {"id": "msg_123"}

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, headers=None, json=None):
            sent.update({"request_headers": headers, "payload": json})
            return FakeResponse()
    monkeypatch.setattr(resend, "_email_ready", lambda: (True, None))
    monkeypatch.setattr(resend.httpx, "AsyncClient", FakeClient)
    out = run(act_router._send(msg))
    assert out.sent and out.message_id == "msg_123"
    carried = sent["payload"]["headers"]
    assert carried["List-Unsubscribe"] == msg["headers"]["List-Unsubscribe"] and carried["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert "Precedence" not in carried                                    # promotional mail is not marked transactional
    assert sent["request_headers"]["Idempotency-Key"] == msg["idempotency_key"]
    # The POST that a mail client makes from that header unsubscribes with no sign-in.
    monkeypatch.setattr(act_router, "get_service", lambda: on.svc)
    client = TestClient(app, raise_server_exceptions=False)
    assert client.post(f"/email/unsubscribe?token={on.svc.token(v)}", data={"List-Unsubscribe": "One-Click"}).status_code == 200
    assert on.store.users[v]["marketing_email_status"] == "unsubscribed"


# ══ account settings ══════════════════════════════════════════════════════════

class Users:
    """A tiny users table behind the auth routes."""
    def __init__(self):
        self.rows = {"ada@example.com": {"id": "ada@example.com", "email": "ada@example.com", "name": "Ada", "password_hash": "x", "email_verification_token": None, "google_sub": "g-1",
                                          "auth_provider": "google", "sessions_valid_after": None}}
        self.workspaces = [{"id": "w1", "user_id": "ada@example.com", "name": "Apex", "data": {"workspace_profile": {"company_name": "Apex Consulting"}}}]
        self.deleted = []

    async def select(self, table, filters=None, single=False, **_):
        want = dict((c, v) for c, _op, v in (filters or []))
        rows = list(self.rows.values()) if table == "users" else self.workspaces if table == "workspaces" else []
        rows = [r for r in rows if all(r.get(k) == v for k, v in want.items())]
        return (rows[0] if rows else None) if single else rows

    async def update(self, table, filters=None, payload=None):
        if table == "users":
            for r in self.rows.values():
                if all(r.get(c) == v for c, _op, v in filters):
                    r.update(payload)
        return []

    async def delete(self, table, filters=None):
        if table == "users":
            for c, _op, v in filters:
                self.deleted.append(v)
                self.rows.pop(v, None)


@pytest.fixture
def users(monkeypatch):
    u = Users()
    for mod in (auth_router, deps):
        monkeypatch.setattr(mod, "sb_select", u.select)
    monkeypatch.setattr(auth_router, "sb_update", u.update)
    monkeypatch.setattr(auth_router, "sb_delete", u.delete)
    deps._user_cache.clear()
    yield u
    deps._user_cache.clear()


def test_signing_out_other_devices_stops_every_older_sign_in_and_keeps_this_one(users):
    client = TestClient(app, raise_server_exceptions=False)
    old = create_access_token(subject="ada@example.com", extra={"iat": int((datetime.now(timezone.utc) - timedelta(hours=3)).timestamp())})
    laptop = {"Authorization": f"Bearer {old}"}
    assert client.get("/auth/me", headers=laptop).status_code == 200      # and now cached, as on a busy device
    phone = {"Authorization": f"Bearer {create_access_token(subject='ada@example.com', extra={'iat': int((datetime.now(timezone.utc) - timedelta(hours=1)).timestamp())})}"}
    out = client.post("/auth/me/sign-out-others", headers=phone)
    assert out.status_code == 200 and out.json()["token_type"] == "bearer"
    fresh = {"Authorization": f"Bearer {out.json()['access_token']}"}
    gone = client.get("/auth/me", headers=laptop)
    assert gone.status_code == 401 and "signed out on this device" in gone.json()["detail"]      # at once, despite the cache
    assert client.get("/auth/me", headers=phone).status_code == 401       # the old sign-in on this device is replaced too
    assert client.get("/auth/me", headers=fresh).status_code == 200
    assert deps.signed_out({"iat": 10}, {"sessions_valid_after": None}) is False and deps.signed_out({"iat": 10}, {}) is False
    assert deps.signed_out({"iat": 10}, {"sessions_valid_after": "not a date"}) is False


def test_a_copy_of_your_data_has_your_account_and_businesses_and_no_sign_in_secrets(users):
    client = TestClient(app, raise_server_exceptions=False)
    token = {"Authorization": f"Bearer {create_access_token(subject='ada@example.com')}"}
    r = client.get("/auth/me/export", headers=token)
    assert r.status_code == 200 and 'filename="enterprateai-my-data.json"' in r.headers["content-disposition"]
    data = json.loads(r.text)
    assert data["account"]["email"] == "ada@example.com" and data["businesses_you_own"][0]["data"]["workspace_profile"]["company_name"] == "Apex Consulting"
    assert not any(k in data["account"] for k in ("password_hash", "email_verification_token", "google_sub"))
    assert client.get("/auth/me/export").status_code == 401


def test_deleting_an_account_needs_the_email_typed_out_and_then_removes_it(users):
    client = TestClient(app, raise_server_exceptions=False)
    token = {"Authorization": f"Bearer {create_access_token(subject='ada@example.com')}"}
    wrong = client.post("/auth/me/delete", json={"confirm": "delete"}, headers=token)
    assert wrong.status_code == 422 and users.deleted == []
    assert client.post("/auth/me/delete", json={"confirm": " Ada@Example.com "}, headers=token).status_code == 204
    assert users.deleted == ["ada@example.com"] and client.get("/auth/me", headers=token).status_code == 401
    users.rows[ADMIN["id"]] = {**ADMIN, "sessions_valid_after": None}
    admin = {"Authorization": f"Bearer {create_access_token(subject=ADMIN['id'])}"}
    assert client.post("/auth/me/delete", json={"confirm": ADMIN["email"]}, headers=admin).status_code == 403


def test_a_profile_photo_is_a_small_image_or_nothing(users):
    client = TestClient(app, raise_server_exceptions=False)
    token = {"Authorization": f"Bearer {create_access_token(subject='ada@example.com')}"}
    png = "data:image/png;base64,iVBORw0KGgo="
    assert client.patch("/auth/me", json={"picture": png}, headers=token).json()["picture"] == png
    assert client.patch("/auth/me", json={"picture": "javascript:alert(1)"}, headers=token).status_code == 422
    assert client.patch("/auth/me", json={"picture": "https://elsewhere.example/a.png"}, headers=token).status_code == 422
    assert client.patch("/auth/me", json={"name": "Ada L."}, headers=token).json() == {**client.get("/auth/me", headers=token).json()}      # the photo is left alone
    assert users.rows["ada@example.com"]["picture"] == png
    assert client.patch("/auth/me", json={"picture": ""}, headers=token).json()["picture"] is None
