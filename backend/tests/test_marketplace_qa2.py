"""Marketplace Index & Claim QA round 2: nobody reviews their own case (Q-1), no health result
without records (Q-2), locations are a town not an address (Q-3), a claimed profile shows the
owner's content only once published (Q-4), and "sent" means an email went out (Q-6)."""
import json

import pytest

from app.modules.agent import dashboard as dash
from app.modules.marketplace import directory as d
from app.modules.marketplace.directory import Forbidden, town_of
from test_agent import MEMBER, OUTSIDER, OWNER, Env, run
from test_marketplace_claim import ADMIN, NEW, NORTHWIND, U, events, index, svc_of, verified_claim

QA = {"id": OWNER, "email": OWNER}      # a moderator who also owns business "A"


@pytest.fixture
def moderator(monkeypatch):
    monkeypatch.setattr(d, "_moderators", lambda: {OWNER.lower(), MEMBER.lower()})


def pending(env, user, target="new"):
    s = svc_of(env)
    claim = run(s.start_claim(U(user), "northwind-advisory-ltd-leeds"))
    claim = run(s.confirm_match(U(user), claim["id"], target))
    claim = run(s.start_verification(U(user), claim["id"], method="manual", note="I am a director of this company."))
    run(s.attach_evidence(U(user), claim["id"], claim["verification"]["id"], "cert.pdf", "application/pdf", b"%PDF-1.4 certificate"))
    return claim


# ══ Q-1 ═══════════════════════════════════════════════════════════════════════

def test_q1_a_moderator_cannot_decide_or_read_the_evidence_of_their_own_claim(moderator):
    env = Env()
    index(env)
    s = svc_of(env)
    claim = pending(env, OWNER)
    queue = run(s.review_queue(QA))["claims"]
    assert [(c["id"], c["needs_another_reviewer"], c["evidence"]) for c in queue] == [(claim["id"], True, [])]
    for decision in ("approve", "reject"):
        with pytest.raises(Forbidden) as e:
            run(s.review_decision(QA, claim["id"], decision=decision, reason="Looks right to me."))
        assert "your own claim" in str(e.value)
    with pytest.raises(Forbidden):
        run(s.evidence_file(QA, claim["verification"]["id"], 0))
    assert run(s.get_claim(U(OWNER), claim["id"]))["status"] == "verification_pending"      # nothing moved
    # Another reviewer sees the evidence and decides.
    other = run(s.review_queue(ADMIN))["claims"][0]
    assert other["needs_another_reviewer"] is False and other["evidence"][0]["files"] == [{"name": "cert.pdf", "index": 0}]
    assert run(s.evidence_file(ADMIN, claim["verification"]["id"], 0))["content"].startswith(b"%PDF")
    assert run(s.review_decision(ADMIN, claim["id"], decision="approve", reason="Certificate matches the register."))["status"] == "verified"
    with pytest.raises(Forbidden):                                        # and can't revoke or re-decide their own afterwards
        run(s.review_decision(QA, claim["id"], decision="revoke", reason="Changed my mind."))


def test_q1_a_member_of_the_target_business_or_of_the_business_that_holds_the_profile_is_a_party_too(moderator):
    env = Env()
    index(env)
    s = svc_of(env)
    env.businesses["A"]["members"][MEMBER] = env.businesses["A"]["members"].get(MEMBER) or {"role": "member", "tools": ["operations"]}
    # Someone else claims the profile for business A, which the moderator belongs to.
    env.businesses["A"]["owner"], claim = OWNER, None
    done = verified_claim(env, user=OWNER, target="A")
    with pytest.raises(Forbidden):
        run(s.review_decision({"id": MEMBER, "email": MEMBER}, done["id"], decision="revoke", reason="Not ours any more."))
    # A challenge to a profile the moderator's business holds: they can't decide that either, or reports about it.
    challenge = pending(env, OUTSIDER)
    assert run(s.review_queue(QA))["claims"][0]["needs_another_reviewer"] is True
    with pytest.raises(Forbidden):
        run(s.review_decision(QA, challenge["id"], decision="reject", reason="We hold this profile."))
    report = run(s.report("northwind-advisory-ltd-leeds", kind="unlist", message="Please remove this page."))
    assert run(s.review_queue(QA))["reports"][0]["needs_another_reviewer"] is True
    with pytest.raises(Forbidden) as e:
        run(s.resolve_report(QA, report["id"], action="dismiss", reason="No change needed."))
    assert "your own business" in str(e.value)
    assert run(s.review_queue(ADMIN))["reports"][0]["needs_another_reviewer"] is False
    assert run(s.resolve_report(ADMIN, report["id"], action="dismiss", reason="No change needed."))["status"] == "resolved"


# ══ Q-2 ═══════════════════════════════════════════════════════════════════════

def test_q2_no_health_result_until_there_are_records_to_work_it_out_from():
    layout = dash.STAGE_LAYOUT["operating"]
    none = {"revenue": {"value": None, "state": "insufficient_data"}, "revenue_growth": {"value": None, "state": "insufficient_data"}}
    assert dash.headline_of("operating", layout, none, [], {}) == {"key": "health", "label": "Health", "value": "Not enough data yet", "state": "insufficient_data", "tone": None}
    grow = dash.headline_of("growth", dash.STAGE_LAYOUT["growth"], none, [], {})
    assert grow["value"] == "Not enough data yet" and grow["state"] == "insufficient_data" and grow["tone"] is None
    some = {"revenue": {"value": None, "state": "available"}, "revenue_growth": {"value": None, "state": "insufficient_data"}}
    assert dash.headline_of("operating", layout, some, [], {})["value"] == "Stable"
    assert dash.headline_of("operating", layout, none, [{"severity": "high"}], {})["value"] == "Needs attention"      # a real risk is still shown
    # A newly claimed business, set to Operating with nothing recorded, through the whole composition.
    env = Env()
    index(env)
    s = svc_of(env)
    done = verified_claim(env)
    data = env.businesses[done["business_id"]]["data"]
    for stage, key in (("operating", "health"), ("growth", "health_growth")):
        data["dashboard_stage"] = {"stage": stage, "set_by": NEW, "set_at": env.now.isoformat()}
        view = run(dash.build_dashboard(env.orch, NEW, done["business_id"]))
        assert view["context"]["business_stage"] == stage and all(k["state"] == "insufficient_data" for k in view["kpis"])
        assert view["context"]["headline"] == {"key": key, "label": "Health", "value": "Not enough data yet", "state": "insufficient_data", "tone": None}
        assert "Stable" not in json.dumps(view["context"])
    # Any new business, not only a claimed one: the same rule.
    fresh = env.businesses["B"]["data"]
    fresh["financials"] = {}
    fresh["dashboard_stage"] = {"stage": "operating", "set_by": OUTSIDER, "set_at": env.now.isoformat()}
    assert run(dash.build_dashboard(env.orch, OUTSIDER, "B"))["context"]["headline"]["value"] == "Not enough data yet"


# ══ Q-3 ═══════════════════════════════════════════════════════════════════════

def test_q3_a_location_is_reduced_to_a_town_and_never_reaches_the_card_the_page_or_the_address():
    assert town_of("14 Acacia Avenue, Leeds LS1 2AB") == ("Leeds", True)
    assert town_of("Leeds") == ("Leeds", False) and town_of("St Albans, Hertfordshire") == ("St Albans, Hertfordshire", False)
    assert town_of("Unit 4, Riverside Court, 22 High St, Manchester, M1 1AA") == ("Manchester", True)
    assert town_of("LS1 2AB") == ("LS1", True) and town_of("") == (None, False) and town_of("Flat 2, 9 Mill Lane") == (None, True)
    env = Env()
    s = svc_of(env)
    home = {**NORTHWIND, "name": "QA Home Address Ltd", "company_number": "55555555", "website": "https://qa-home.example", "location": "14 Acacia Avenue, Leeds LS1 2AB",
            "source": {"provider": "Companies House", "record_id": "55555555"}}
    made = index(env, home)[0]
    assert made["slug"] == "qa-home-address-ltd-leeds" and made["location"] == "Leeds" and "town or region" in made["notes"][0]
    public = run(s.public_profile(made["slug"]))
    assert public["location"] == "Leeds"
    stored = json.dumps(list(s.store.rows["profiles"].values()) + list(s.store.rows["snapshots"].values()))
    assert "Acacia" not in stored and "LS1 2AB" not in stored and "Acacia" not in json.dumps(run(s.search()))


def test_q3_a_record_indexed_earlier_with_an_address_is_tidied_and_its_old_address_still_opens():
    env = Env()
    s = svc_of(env)
    made = index(env, {**NORTHWIND, "location": "Leeds"})[0]
    row = s.store.rows["profiles"][made["id"]]                             # as it was stored before the rule
    row["data"].update({"location": "14 Acacia Avenue, Leeds LS1 2AB", "slug": "northwind-advisory-ltd-14-acacia-avenue-leeds-ls1-2ab"})
    row["key"] = "northwind-advisory-ltd-14-acacia-avenue-leeds-ls1-2ab"
    with pytest.raises(Forbidden):
        run(s.normalise_locations(U(OUTSIDER)))
    done = run(s.normalise_locations(ADMIN))
    assert done["count"] == 1 and done["changed"][0]["to"] == "northwind-advisory-ltd-leeds" and done["changed"][0]["location"] == "Leeds"
    assert run(s.normalise_locations(ADMIN))["count"] == 0                 # nothing left to do
    assert run(s.public_profile("northwind-advisory-ltd-leeds"))["location"] == "Leeds"
    old = run(s.public_profile("northwind-advisory-ltd-14-acacia-avenue-leeds-ls1-2ab"))
    assert old["canonical_slug"] == "northwind-advisory-ltd-leeds" and old["id"] == made["id"]
    assert index(env, {**NORTHWIND, "location": "14 Acacia Avenue, Leeds LS1 2AB"})[0]["slug"] == "northwind-advisory-ltd-leeds"      # a re-import doesn't bring it back


# ══ Q-4 ═══════════════════════════════════════════════════════════════════════

def test_q4_a_claimed_profile_keeps_the_sourced_details_until_the_owner_publishes():
    env = Env()
    index(env)
    s = svc_of(env)
    # Business A has a draft Marketplace profile and saved opportunity settings, not published.
    run(s.update_profile(U(OWNER), "A", {"description": "Draft: we do pricing for small firms, not ready yet.", "service_area": "Draft area", "service_tags": ["Draft tag"]}))
    run(s.update_preferences(U(OWNER), "A", {"enquiries": {"enabled": True}, "rfqs": {"enabled": True}, "proposals": {"enabled": True}}))
    done = verified_claim(env, user=OWNER, target="A")
    owner = run(s.business_profile(U(OWNER), "A"))
    assert owner["is_published"] is False and owner["directory"]["trust"]["state"] == "verified"
    public = run(s.public_profile("northwind-advisory-ltd-leeds"))
    assert public["trust"]["label"] == "Owner-verified" and public["claimed"] is True and public["activated"] is False
    assert public["description"] == NORTHWIND["description"] and public["location"] == "Leeds" and public["service_tags"] == ["Strategy", "Pricing"]
    assert public["offerings"] == [] and not any(public["opportunities"].values()) and public["claim"] == {"eligible": False}
    assert "hasn't published its own details yet" in public["source_basis"] and public["sources"] == ["Companies House"]
    card = run(s.search())["items"][0]
    for text in (json.dumps(public), json.dumps(card)):
        assert "Draft" not in text
    assert run(s.search(q="draft"))["total"] == 0 and run(s.search(open_for="enquiries"))["total"] == 0
    # The draft and the saved opportunity settings are waiting in the claim's own steps, not lost.
    assert owner["profile"]["description"].startswith("Draft:") and owner["preferences"]["enquiries"]["enabled"] is True and owner["preferences"]["proposals"]["enabled"] is True
    assert run(s.get_claim(U(OWNER), done["id"]))["next_step"] == "profile_review"
    # Saving the profile in the claim flow still publishes nothing.
    run(s.update_profile(U(OWNER), "A", {"description": "We help small firms set prices that hold.", "service_area": "Leeds and remote", "service_tags": ["Pricing"]}, claim_id=done["id"]))
    assert run(s.public_profile("northwind-advisory-ltd-leeds"))["description"] == NORTHWIND["description"]
    assert run(s.public_profile("northwind-advisory-ltd-leeds"))["service_tags"] == ["Strategy", "Pricing"]
    # Activation is the moment the owner's content and the saved opportunity settings go public together.
    live = run(s.activate(U(OWNER), "A"))
    public = run(s.public_profile("northwind-advisory-ltd-leeds"))
    assert live["is_published"] is True and public["activated"] is True and public["description"] == "We help small firms set prices that hold."
    assert public["service_tags"] == ["Pricing"] and public["location"] == "Leeds and remote" and "source_basis" not in public
    assert public["opportunities"] == {"enquiries": True, "rfqs": True, "proposals": True, "partnerships": False, "subcontracting": False}
    # And unpublishing puts the public page back to the sourced details: the two always agree.
    off = run(s.activate(U(OWNER), "A", publish=False))
    public = run(s.public_profile("northwind-advisory-ltd-leeds"))
    assert off["is_published"] is False and public["activated"] is False and public["description"] == NORTHWIND["description"] and not any(public["opportunities"].values())


# ══ Q-6 ═══════════════════════════════════════════════════════════════════════

def test_q6_a_link_made_by_hand_is_created_and_sent_is_recorded_only_when_an_email_goes_out():
    env = Env()
    index(env)
    s = svc_of(env)
    outbox = []

    async def off(message):
        return False                                                      # sending is switched off

    async def on(message):
        outbox.append(message["to"])
        return True

    s._send_invitation = on
    made = run(s.create_invitation(ADMIN, "northwind-advisory-ltd-leeds"))                 # send not asked for
    assert made["status"] == "created" and outbox == []
    assert len(events(env, "ClaimInvitationCreated")) == 1 and events(env, "ClaimInvitationSent") == []
    env.now += d.INVITE_GAP + d.timedelta(days=1)
    s._send_invitation = off
    made = run(s.create_invitation(ADMIN, "northwind-advisory-ltd-leeds", send=True))      # asked for, but the mailer is off
    assert made["status"] == "created" and len(events(env, "ClaimInvitationCreated")) == 2 and events(env, "ClaimInvitationSent") == []
    env.now += d.INVITE_GAP + d.timedelta(days=1)
    s._send_invitation = on
    made = run(s.create_invitation(ADMIN, "northwind-advisory-ltd-leeds", send=True))
    assert made["status"] == "sent" and outbox == ["hello@northwind-advisory.co.uk"] and len(events(env, "ClaimInvitationSent")) == 1


def test_q6_the_invitation_mailer_reports_that_nothing_went_when_sending_is_off(monkeypatch):
    import app.core.config as config
    from types import SimpleNamespace
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(marketplace_claim_invites_enabled=False, frontend_url=""))
    assert run(d._email_invitation({"to": "x@example.test", "business_name": "X", "reason": "profile_control", "link": "/l", "opt_out": "/o"})) is False


# ══ Round 3, R-2 ══════════════════════════════════════════════════════════════

def test_r2_the_server_asks_before_a_second_public_profile_and_keeps_the_answer_with_the_business():
    from app.modules.marketplace.directory import Conflict, Invalid
    env = Env()
    index(env)
    s = svc_of(env)
    env.businesses["A"]["data"]["workspace_profile"].update({"registration_number": "12345678"})
    run(s.update_profile(U(OWNER), "A", {"description": "We help small firms set prices that hold.", "service_area": "Leeds and remote", "service_tags": ["Pricing"]}))
    view = run(s.update_preferences(U(OWNER), "A", {"enquiries": {"enabled": True}}))
    assert [(p["slug"], p["matched_on"]) for p in view["possible_duplicates"]] == [("northwind-advisory-ltd-leeds", "registered number")]
    with pytest.raises(Conflict) as e:
        run(s.activate(U(OWNER), "A"))
    assert e.value.code == "possible_duplicate" and e.value.detail["profile"]["slug"] == "northwind-advisory-ltd-leeds" and "Northwind Advisory Ltd" in e.value.message
    assert env.businesses["A"]["data"]["marketplace"].get("is_active") is not True and len(s.store.rows["profiles"]) == 1      # nothing published, no second profile
    with pytest.raises(Invalid):
        run(s.answer_duplicate(U(OWNER), "A", "northwind-advisory-ltd-leeds", "mine"))
    with pytest.raises(d.NotFound):
        run(s.answer_duplicate(U(OUTSIDER), "A", "northwind-advisory-ltd-leeds"))      # only someone who manages the business answers for it
    env.now += d.timedelta(minutes=5)
    after = run(s.answer_duplicate(U(OWNER), "A", "northwind-advisory-ltd-leeds"))
    assert after["possible_duplicates"] == []
    kept = env.businesses["A"]["data"]["marketplace"]["not_my_profiles"]
    assert len(kept) == 1 and kept[0]["by"] == OWNER and kept[0]["answer"] == "not_mine" and kept[0]["at"] == env.now.isoformat()
    assert len(events(env, "marketplace_duplicate_answered")) == 1
    run(s.answer_duplicate(U(OWNER), "A", "northwind-advisory-ltd-leeds"))
    assert len(env.businesses["A"]["data"]["marketplace"]["not_my_profiles"]) == 1      # answered once, kept once
    live = run(s.activate(U(OWNER), "A"))
    assert live["is_published"] is True and live["directory"]["origin"] == "created" and live["possible_duplicates"] == []
    # A different record for the same website, indexed later: asked about that one, but the live profile isn't taken down.
    env.businesses["A"]["data"]["marketplace"]["profile"]["website"] = "apex-other.test"
    index(env, {**NORTHWIND, "name": "Apex Other Ltd", "company_number": "99999999", "website": "https://apex-other.test", "source": {"provider": "Companies House", "record_id": "99999999"}})
    assert [p["name"] for p in run(s.business_profile(U(OWNER), "A"))["possible_duplicates"]] == ["Apex Other Ltd"]
    assert run(s.activate(U(OWNER), "A"))["is_published"] is True


def test_r2_claiming_the_match_clears_the_question_and_the_api_maps_it(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.modules.agent import router as agent_router
    from app.shared.auth.deps import get_current_user
    env = Env()
    index(env)
    s = svc_of(env)
    env.businesses["A"]["data"]["workspace_profile"].update({"website": "northwind-advisory.co.uk"})
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        client = TestClient(app, raise_server_exceptions=False)
        assert client.patch("/businesses/A/marketplace-profile", json={"changes": {"description": "We help small firms set prices that hold.", "service_area": "Leeds", "service_tags": ["Pricing"]}}).status_code == 200
        assert client.patch("/businesses/A/marketplace-opportunity-preferences", json={"changes": {"enquiries": {"enabled": True}}}).status_code == 200
        blocked = client.post("/businesses/A/marketplace-profile/activate", json={"publish": True})
        assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "possible_duplicate" and blocked.json()["detail"]["profile"]["matched_on"] == "website"
        assert client.post("/businesses/A/marketplace-profile/duplicate-answers", json={"profile_id": "no-such-profile"}).status_code == 404
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    verified_claim(env, user=OWNER, target="A")
    view = run(s.business_profile(U(OWNER), "A"))
    assert view["possible_duplicates"] == [] and view["directory"]["trust"]["state"] == "verified"
    assert run(s.activate(U(OWNER), "A"))["is_published"] is True and len([p for p in s.store.rows["profiles"].values() if p["data"]["publication"] == "published"]) == 1
