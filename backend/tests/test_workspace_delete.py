"""An owner can delete one workspace. Nothing else of theirs changes, and its Marketplace profile doesn't stay stuck."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.idea_validation import router as validation_router
from app.modules.marketplace import directory_router
from app.shared.auth.deps import get_current_user
from test_agent import Env, OWNER, run
from test_marketplace_claim import ADMIN, NEW, U, index, svc_of
from test_marketplace_decisions import BUYER, SLUG, waiting_claim, decided
from test_marketplace_self_created import prepared


def claimed(env):
    s = svc_of(env)
    index(env)
    run(s.set_visibility(ADMIN, "public"))
    run(s.hold_request(SLUG, BUYER))
    claim = waiting_claim(env)
    run(s.review_decision(ADMIN, claim["id"], decision="approve", reason="Director on the filing."))
    return s, claim, s.store.rows["claims"][claim["id"]]["data"]["linked_business_id"]


def test_a_claimed_profile_goes_back_to_unclaimed_with_its_unanswered_requests():
    env = Env()
    s, claim, business = claimed(env)
    run(s.release_workspace(business, actor=NEW))
    listed = next(i for i in run(s.unclaimed_profiles(ADMIN))["items"] if i["slug"] == SLUG)
    assert listed["requests_waiting"] == 1
    public = next(b for b in run(s.search(trust="unclaimed"))["items"] if b["slug"] == SLUG)
    assert public["claimed"] is False
    assert s.store.rows["claims"][claim["id"]]["status"] == "cancelled"
    assert decided(s) == []      # no approval left to revoke on a workspace that is gone
    assert run(s.start_claim(U(OWNER), SLUG))["status"] == "claim_started"
    assert run(s.start_claim(U(NEW), SLUG))["status"] == "claim_started"


def test_a_self_made_profile_comes_down():
    env = Env()
    s = prepared(env, website="apex.test", email="office@apex.test")
    run(s.activate(U(OWNER), "A"))
    profile = next(p for p in s.store.rows["profiles"].values() if p["data"].get("origin") == "created")
    run(s.release_workspace("A", actor=OWNER))
    saved = s.store.rows["profiles"][profile["id"]]["data"]
    assert saved["publication"] == "suppressed" and saved["linked_business_id"] is None
    assert profile["data"]["slug"] not in [b["slug"] for b in run(s.search())["items"]]


def test_a_workspace_with_no_profile_is_nothing_to_release():
    env = Env()
    s = svc_of(env)
    run(s.release_workspace("A", actor=OWNER))
    assert s.store.rows["profiles"] == {}


class Route:
    """The delete route with the database calls replaced."""

    def __init__(self, monkeypatch, *, owner=True, name="Francal", company="Francal Ltd"):
        self.purged, self.released = [], []
        ws = SimpleNamespace(name=name, data={"workspace_profile": {"company_name": company}})

        async def access(*, user_id, workspace_id):
            return ws, owner

        async def purge(wid):
            self.purged.append(wid)

        async def release(wid, *, actor):
            self.released.append(wid)
        monkeypatch.setattr(validation_router, "_get_accessible_workspace", access)
        monkeypatch.setattr("app.shared.auth.purge.purge_workspace", purge)
        monkeypatch.setattr(directory_router, "get_service", lambda: SimpleNamespace(release_workspace=release))
        app.dependency_overrides[get_current_user] = lambda: U(OWNER)
        self.client = TestClient(app, raise_server_exceptions=False)

    def post(self, confirm):
        return self.client.post("/validation/w1/delete", json={"confirm": confirm})


@pytest.fixture(autouse=True)
def clean():
    yield
    app.dependency_overrides.clear()


@pytest.mark.parametrize("typed", ["Francal", " francal ", "FRANCAL LTD"])
def test_the_owner_deletes_it_by_typing_its_name(monkeypatch, typed):
    r = Route(monkeypatch)
    assert r.post(typed).status_code == 204
    assert r.released == ["w1"] and r.purged == ["w1"]


def test_the_wrong_name_changes_nothing(monkeypatch):
    r = Route(monkeypatch)
    assert r.post("something else").status_code == 422
    assert r.purged == [] and r.released == []


def test_a_member_cant_delete_it(monkeypatch):
    r = Route(monkeypatch, owner=False)
    assert r.post("Francal").status_code == 403
    assert r.purged == [] and r.released == []
