"""Marketplace admin: each unclaimed profile's own visibility over the global level, adding and
editing businesses by hand, and CSV import with a preview."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import router as agent_router
from app.modules.marketplace import directory as d
from app.modules.marketplace.directory import Conflict, Forbidden, Invalid, NotFound
from app.shared.auth.deps import get_current_user, get_optional_user
from test_agent import OUTSIDER, OWNER, Env, run
from test_marketplace_claim import ADMIN, NEW, NORTHWIND, U, events, index, svc_of, verified_claim

SLUG = "northwind-advisory-ltd-leeds"
HARBOUR = {**NORTHWIND, "name": "Harbour Legal LLP", "company_number": "87654321", "website": "https://harbour-legal.co.uk", "contact_email": "office@harbour-legal.co.uk",
           "category": "Legal", "location": "York", "source": {"provider": "Companies House", "record_id": "87654321"}}
H_SLUG = "harbour-legal-llp-york"
FORM = {"name": "Bright Ledger Limited", "trading_name": "Bright Ledger", "company_number": "44556677", "country": "United Kingdom", "category": "Accounting", "location": "Leeds",
        "website": "https://brightledger.example", "description": "Bookkeeping and payroll for independent shops and cafes across West Yorkshire.", "service_tags": ["Bookkeeping", "Payroll"],
        "business_status": "active", "contact_email": "hello@brightledger.example", "visibility": "inherit",
        "source": {"provider": "Company website", "record_id": "https://brightledger.example/about", "retrieved_at": "2026-10-01"}}


def two(level):
    env = Env()
    s = svc_of(env)
    index(env, NORTHWIND, HARBOUR)
    run(s.set_visibility(ADMIN, level))
    return env, s


# ══ 1. per-profile visibility ═════════════════════════════════════════════════

def test_a_profiles_own_visibility_wins_over_the_global_level_everywhere():
    env, s = two("invite_only")
    assert run(s.search())["total"] == 0 and run(s.search())["unclaimed_listed"] is False
    done = run(s.set_profile_visibility(ADMIN, [SLUG], "public", "Pilot partner: agreed to be listed."))
    assert done == {"changed": [SLUG], "count": 1, "skipped": []}
    found = run(s.search())
    assert [i["slug"] for i in found["items"]] == [SLUG] and found["unclaimed_listed"] is True and found["categories"] == ["Consulting"]
    assert run(s.search(trust="unclaimed"))["total"] == 1 and run(s.sitemap_slugs()) == [SLUG]
    assert run(s.public_profile(SLUG))["noindex"] is False and run(s.start_claim(U(NEW), SLUG))["status"] == "claim_started"
    with pytest.raises(NotFound):
        run(s.public_profile(H_SLUG))                                    # the other one still follows the global level
    rows = {p["slug"]: p for p in run(s.unclaimed_profiles(ADMIN))["items"]}
    assert (rows[SLUG]["visibility"], rows[SLUG]["visibility_label"], rows[SLUG]["public_state"]) == ("public", "Public (override)", "Ready · public")
    assert (rows[H_SLUG]["visibility"], rows[H_SLUG]["visibility_label"], rows[H_SLUG]["public_state"]) == ("inherit", "Invite only (default)", "Ready · hidden (invite only)")
    # The other way round: a public directory with one profile kept back.
    run(s.set_visibility(ADMIN, "public"))
    run(s.set_profile_visibility(ADMIN, [H_SLUG], "hidden"))
    assert [i["slug"] for i in run(s.search())["items"]] == [SLUG] and run(s.sitemap_slugs()) == [SLUG]
    with pytest.raises(NotFound):
        run(s.public_profile(H_SLUG))
    with pytest.raises(NotFound):
        run(s.report(H_SLUG, kind="correction", message="Probing a hidden page."))
    with pytest.raises(NotFound):
        run(s.start_claim(U(NEW), H_SLUG))
    assert run(s.find_to_claim(name="Harbour Legal LLP", company_number="87654321")) == {"found": False}      # hidden: no lookup
    assert run(s.unclaimed_profiles(ADMIN))["items"][0]["visibility_label"] == "Moderators only (override)"
    assert run(s.public_profile(H_SLUG, ADMIN))["name"] == "Harbour Legal LLP"      # moderators always


@pytest.mark.parametrize("own,lookup", [("hidden", False), ("invite_only", True)])
def test_a_hidden_profile_is_still_reached_by_its_invitation_and_by_exact_lookup_where_allowed(own, lookup):
    env, s = two("public")
    run(s.set_profile_visibility(ADMIN, [SLUG], own))
    token = run(s.create_invitation(ADMIN, SLUG, by_hand=True))["link"].split("invite=")[1]
    assert run(s.public_profile(SLUG, None, {"invitation": token}))["claim"]["eligible"] is True
    assert run(s.create_intent(SLUG, invitation_token=token))["intent"]
    hit = run(s.find_to_claim(name="Northwind Advisory Ltd", company_number="12345678"))
    assert hit["found"] is lookup
    if lookup:
        assert run(s.public_profile(SLUG, None, {"access": hit["access"]}))["name"] == "Northwind Advisory Ltd"
    with pytest.raises(NotFound):
        run(s.public_profile(SLUG))


def test_inherit_follows_the_global_level_again_and_suppressed_stays_hidden_whatever_is_set():
    env, s = two("admin_only")
    run(s.set_profile_visibility(ADMIN, [SLUG, H_SLUG], "public"))
    assert run(s.search())["total"] == 2
    run(s.set_profile_visibility(ADMIN, [SLUG], "inherit"))
    assert [i["slug"] for i in run(s.search())["items"]] == [H_SLUG]
    run(s.moderate_profile(ADMIN, H_SLUG, action="suppress", reason="Asked to be removed."))
    assert run(s.search())["total"] == 0 and run(s.sitemap_slugs()) == []
    with pytest.raises(NotFound):
        run(s.public_profile(H_SLUG, ADMIN))
    assert {p["slug"]: p["public_state"] for p in run(s.unclaimed_profiles(ADMIN))["items"]}[H_SLUG] == "Suppressed"


def test_a_bulk_change_records_who_when_and_why_and_skips_what_it_cannot_change():
    env, s = two("public")
    verified_claim(env, user=OWNER, slug=H_SLUG, target="A", email="partner@harbour-legal.co.uk")
    for call in (s.set_profile_visibility(U(OWNER), [SLUG], "public"), ):
        with pytest.raises(Forbidden):
            run(call)
    with pytest.raises(Invalid):
        run(s.set_profile_visibility(ADMIN, [SLUG], "everyone"))
    with pytest.raises(Invalid):
        run(s.set_profile_visibility(ADMIN, [], "public"))
    done = run(s.set_profile_visibility(ADMIN, [SLUG, H_SLUG, "no-such-profile"], "public", "Launch cohort."))
    assert done["changed"] == [SLUG] and [x["ref"] for x in done["skipped"]] == [H_SLUG, "no-such-profile"]
    env.now += d.timedelta(hours=2)
    run(s.set_profile_visibility(ADMIN, [SLUG], "hidden"))
    data = [p for p in s.store.rows["profiles"].values() if p["data"]["slug"] == SLUG][0]["data"]
    assert [(h["from"], h["to"], h["by"], h["reason"]) for h in data["visibility_history"]] == [("inherit", "public", d.ADMIN_EMAIL, "Launch cohort."), ("public", "hidden", d.ADMIN_EMAIL, None)]
    assert data["visibility_changed"]["at"] == env.now.isoformat() and len(events(env, "DirectoryProfileVisibilityChanged")) == 2
    assert run(s.set_profile_visibility(ADMIN, [SLUG], "hidden"))["count"] == 0       # no change, no new entry
    assert run(s.profile_sources(ADMIN, SLUG))["visibility_history"][-1]["to"] == "hidden"


def test_indexing_takes_an_optional_visibility_and_only_suggests_public():
    env = Env()
    s = svc_of(env)
    run(s.set_visibility(ADMIN, "invite_only"))
    plain, chosen = index(env, NORTHWIND, {**HARBOUR, "visibility": "public"})
    assert (plain["visibility"], plain["suggested_visibility"]) == ("inherit", "public")      # high band, quality 10: suggested, not applied
    assert chosen["visibility"] == "public"
    assert [i["slug"] for i in run(s.search())["items"]] == [H_SLUG]
    index(env, HARBOUR)                                                  # a later import without the field doesn't undo the choice
    assert [i["slug"] for i in run(s.search())["items"]] == [H_SLUG]
    assert index(env, {**NORTHWIND, "visibility": "loud"})[0]["visibility"] == "inherit"


# ══ 2. Add business ═══════════════════════════════════════════════════════════

def test_the_form_requires_a_town_a_category_and_a_source():
    env = Env()
    s = svc_of(env)
    bad = {**FORM, "name": "", "category": "Wizardry", "location": "14 Acacia Avenue, Leeds LS1 2AB", "website": "not a site", "contact_email": "nope",
           "source": {"provider": "A friend", "record_id": "", "retrieved_at": "soon"}, "visibility": "loud"}
    checked = run(s.check_business(ADMIN, bad))
    assert set(checked["errors"]) == {"name", "category", "location", "website", "contact_email", "source.provider", "source.record_id", "source.retrieved_at", "visibility"}
    assert "town or region only" in checked["errors"]["location"] and "Leeds" in checked["errors"]["location"] and checked["verdict"] is None
    with pytest.raises(Invalid) as e:
        run(s.add_business(ADMIN, bad))
    assert "location" in e.value.errors and s.store.rows["profiles"] == {}
    with pytest.raises(Forbidden):
        run(s.check_business(U(OWNER), FORM))
    with pytest.raises(Forbidden):
        run(s.add_business(U(OWNER), FORM))


def test_saving_shows_the_quality_result_and_a_link_and_the_contact_stays_private():
    env = Env()
    s = svc_of(env)
    run(s.set_visibility(ADMIN, "invite_only"))
    preview = run(s.check_business(ADMIN, FORM))
    assert preview["errors"] == {} and preview["duplicates"] == [] and preview["verdict"]["publication"] == "published"
    made = run(s.add_business(ADMIN, FORM))
    assert (made["result"], made["publication"], made["slug"], made["link"]) == ("created", "published", "bright-ledger-limited-leeds", "/marketplace/business/bright-ledger-limited-leeds")
    assert made["reasons"] == [] and made["visibility"] == "inherit"
    row = run(s.unclaimed_profiles(ADMIN))["items"][0]
    assert row["has_contact"] is True and row["public_state"] == "Ready · hidden (invite only)" and row["trading_name"] == "Bright Ledger"
    page = run(s.public_profile(made["slug"], ADMIN))
    assert "hello@brightledger.example" not in str(page) and page["sources"] == ["Company website"]
    thin = run(s.add_business(ADMIN, {**FORM, "name": "Thin Co", "company_number": "", "website": "", "description": "", "service_tags": [], "contact_email": ""}))
    assert thin["publication"] in ("noindex", "unpublished") and "No website." in thin["reasons"]      # the same quality result as an import
    dormant = run(s.add_business(ADMIN, {**FORM, "name": "Dormant Co", "company_number": "11112222", "website": "dormant.example", "business_status": "dissolved"}))
    assert dormant["result"] == "excluded"


def test_a_duplicate_is_shown_before_saving_with_the_existing_record_to_open():
    env = Env()
    s = svc_of(env)
    index(env)
    env.businesses["B"]["data"]["workspace_profile"].update({"company_name": "Bright Ledger Limited"})      # already signed up
    same_number = run(s.check_business(ADMIN, {**FORM, "name": "Northwind Advisory (Leeds)", "company_number": "12345678"}))
    assert [(x["kind"], x["slug"], x["matched_on"]) for x in same_number["duplicates"]] == [("profile", SLUG, "company number")]
    assert [x["matched_on"] for x in run(s.check_business(ADMIN, {**FORM, "website": "northwind-advisory.co.uk"}))["duplicates"]][0] == "website"
    near = run(s.check_business(ADMIN, {**FORM, "name": "NORTHWIND ADVISORY LIMITED"}))["duplicates"]
    assert [(x["slug"], x["matched_on"]) for x in near if x["kind"] == "profile"] == [(SLUG, "name")]
    signed_up = run(s.check_business(ADMIN, FORM))["duplicates"]
    assert signed_up == [{"kind": "business", "id": "B", "name": "Bright Ledger Limited", "matched_on": "a business already signed up"}]
    with pytest.raises(Conflict) as e:
        run(s.add_business(ADMIN, {**FORM, "company_number": "12345678"}))
    assert e.value.code == "possible_duplicate" and e.value.detail["can_add_anyway"] is False      # the same number is the same record
    with pytest.raises(Conflict) as e:
        run(s.add_business(ADMIN, FORM))
    assert e.value.detail["can_add_anyway"] is True
    assert len(s.store.rows["profiles"]) == 1
    assert run(s.add_business(ADMIN, FORM, allow_duplicate=True))["result"] == "created"      # a name match can be added on purpose


def test_csv_rows_are_previewed_with_their_problems_and_duplicates_before_anything_is_imported():
    env = Env()
    s = svc_of(env)
    index(env)
    rows = [FORM, {**FORM, "name": "Cobalt Studio Ltd", "company_number": "33334444", "website": "cobalt.example", "category": "Design", "location": "Bristol"},
            {**FORM, "name": "Address Ltd", "company_number": "55556666", "website": "address.example", "location": "9 Mill Lane, Bath BA1 1AA"},
            {**FORM, "name": "Northwind Advisory Ltd", "company_number": "12345678", "website": "other.example"}]
    preview = run(s.import_businesses(ADMIN, rows))
    assert preview["committed"] is False and preview["summary"] == {"total": 4, "ready": 2, "with_problems": 1, "duplicates": 1, "added": 0}
    assert [r["ok"] for r in preview["rows"]] == [True, True, False, False]
    assert "location" in preview["rows"][2]["errors"] and preview["rows"][3]["duplicates"][0]["slug"] == SLUG
    assert len(s.store.rows["profiles"]) == 1                            # a preview adds nothing
    done = run(s.import_businesses(ADMIN, rows, commit=True))
    assert done["summary"]["added"] == 2 and [r.get("result", {}).get("result") for r in done["rows"]] == ["created", "created", None, None]
    assert sorted(p["data"]["name"] for p in s.store.rows["profiles"].values()) == ["Bright Ledger Limited", "Cobalt Studio Ltd", "Northwind Advisory Ltd"]
    with pytest.raises(Forbidden):
        run(s.import_businesses(U(OWNER), rows))


def test_an_edit_keeps_the_earlier_value_and_its_source_and_archiving_is_reversible():
    env = Env()
    s = svc_of(env)
    index(env)
    with pytest.raises(Invalid) as e:
        run(s.edit_profile(ADMIN, SLUG, {"location": "14 Acacia Avenue, Leeds LS1 2AB", "category": "Wizardry"}))
    assert set(e.value.errors) == {"location", "category"}
    with pytest.raises(Invalid):
        run(s.edit_profile(ADMIN, SLUG, {"colour": "blue"}))
    with pytest.raises(Forbidden):
        run(s.edit_profile(U(OWNER), SLUG, {"location": "York"}))
    done = run(s.edit_profile(ADMIN, SLUG, {"location": "York", "website": "https://northwind-advisory.com", "service_tags": ["Pricing"]}, "Moved; confirmed on their site."))
    assert done["slug"] == SLUG and done["publication"] == "published"   # the address doesn't change
    data = [p for p in s.store.rows["profiles"].values()][0]["data"]
    assert (data["location"], data["domain"]) == ("York", "northwind-advisory.com")
    assert data["provenance"]["location"]["provider"] == "Moderator edit" and data["provenance"]["location"]["previous"]["provider"] == "Companies House"
    assert data["edits"][0]["before"] == {"location": "Leeds", "website": "https://www.northwind-advisory.co.uk", "service_tags": ["Strategy", "Pricing"]}
    assert data["edits"][0]["reason"] == "Moved; confirmed on their site." and data["edits"][0]["by"] == d.ADMIN_EMAIL
    src = run(s.profile_sources(ADMIN, SLUG))
    assert [f for f in src["fields"] if f["field"] == "location"][0]["previous"] == "Companies House" and len(src["edits"]) == 1
    assert run(s.find_to_claim(name="Northwind Advisory Ltd", website="northwind-advisory.com"))["found"] is True      # the corrected website finds it
    assert run(s.find_to_claim(name="Northwind Advisory Ltd", company_number="12345678", client="b"))["found"] is True
    # Archive and bring back.
    assert run(s.moderate_profile(ADMIN, SLUG, action="archive", reason="Ceased trading per their site."))["public_state"] == "Archived"
    assert run(s.search())["total"] == 0
    assert run(s.moderate_profile(ADMIN, SLUG, action="restore", reason="Archived by mistake."))["publication"] == "published"
    # A profile a business holds is edited by its owner, not here.
    verified_claim(env, user=OWNER, target="A", email="owner@northwind-advisory.com")
    with pytest.raises(Conflict):
        run(s.edit_profile(ADMIN, SLUG, {"location": "Leeds"}))


def test_the_admin_api_for_adding_importing_editing_and_visibility(monkeypatch):
    env = Env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    who = dict(ADMIN)
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_optional_user] = lambda: dict(who)
    try:
        client = TestClient(app, raise_server_exceptions=False)
        assert client.put("/admin/marketplace/settings", json={"unclaimed_visibility": "invite_only"}).status_code == 200
        assert client.post("/admin/marketplace/directory/check", json={"record": {**FORM, "location": "1 High St, Leeds"}}).json()["errors"]["location"]
        bad = client.post("/admin/marketplace/directory/businesses", json={"record": {**FORM, "category": ""}})
        assert bad.status_code == 422 and "category" in bad.json()["detail"]["errors"]
        made = client.post("/admin/marketplace/directory/businesses", json={"record": FORM})
        assert made.status_code == 201 and made.json()["link"] == "/marketplace/business/bright-ledger-limited-leeds"
        again = client.post("/admin/marketplace/directory/businesses", json={"record": FORM})
        assert again.status_code == 409 and again.json()["detail"]["code"] == "possible_duplicate" and again.json()["detail"]["duplicates"][0]["slug"] == "bright-ledger-limited-leeds"
        preview = client.post("/admin/marketplace/directory/import", json={"records": [FORM, {**FORM, "name": "Cobalt Studio Ltd", "company_number": "33334444", "website": "cobalt.example"}]}).json()
        assert preview["summary"]["ready"] == 1 and preview["committed"] is False
        slug = made.json()["slug"]
        assert client.patch(f"/admin/marketplace/directory-profiles/{slug}", json={"changes": {"location": "Bradford"}, "reason": "Moved."}).json()["slug"] == slug
        listed = client.get("/admin/marketplace/directory/unclaimed").json()
        assert listed["items"][0]["location"] == "Bradford" and listed["options"]["providers"][0] == "Companies House" and listed["invites_enabled"] is False
        assert client.post("/admin/marketplace/directory/visibility", json={"profiles": [slug], "visibility": "public", "reason": "Pilot."}).json()["count"] == 1
        who.clear()
        who.update({"id": NEW, "email": NEW})
        for path, body in (("/admin/marketplace/directory/businesses", {"record": FORM}), ("/admin/marketplace/directory/import", {"records": [FORM]}),
                           ("/admin/marketplace/directory/visibility", {"profiles": [slug], "visibility": "hidden"}), ("/admin/marketplace/directory/check", {"record": FORM})):
            assert client.post(path, json=body).status_code == 403
        assert client.patch(f"/admin/marketplace/directory-profiles/{slug}", json={"changes": {"location": "York"}}).status_code == 403
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides[get_optional_user] = lambda: None
        assert [i["slug"] for i in client.get("/marketplace/businesses").json()["items"]] == [slug]      # public by its own setting
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_optional_user, None)


# ══ N-2 ═══════════════════════════════════════════════════════════════════════

def test_n2_public_by_choice_but_held_back_by_quality_says_so_with_what_is_missing():
    env = Env()
    s = svc_of(env)
    run(s.set_visibility(ADMIN, "invite_only"))
    thin = {"name": "Thin Advisory Ltd", "category": "Consulting", "location": "Leeds", "website": "https://thin.example", "source": {"provider": "Companies House", "record_id": "1"}}
    made = index(env, thin)[0]
    assert made["publication"] == "noindex"
    run(s.set_profile_visibility(ADMIN, [made["slug"]], "public"))
    row = run(s.unclaimed_profiles(ADMIN))["items"][0]
    assert row["visibility_label"] == "Public (override)" and row["public_state"] == "Public \u00b7 not listed until quality passes" and row["state_tone"] == "amber"
    assert "No description." in row["state_detail"] and "No service tags." in row["state_detail"]
    assert run(s.search())["total"] == 0 and run(s.public_profile(made["slug"]))["name"] == "Thin Advisory Ltd"      # reachable, not listed
    run(s.edit_profile(ADMIN, made["slug"], {"description": "Independent advisers helping small firms set prices and plan growth.", "service_tags": ["Pricing"]}))
    row = run(s.unclaimed_profiles(ADMIN))["items"][0]
    assert row["public_state"] == "Ready \u00b7 public" and "state_detail" not in row and run(s.search())["total"] == 1
