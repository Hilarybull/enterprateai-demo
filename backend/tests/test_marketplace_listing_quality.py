"""A listing is shown to the public only when its description and offerings are real.
From the browser check: a profile went public with the description "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM"
and one offering, "Gooat", with nothing said about it."""
import pytest

from app.modules.marketplace import directory as dx
from app.modules.marketplace.service import _build_listing_item
from test_agent import OWNER
from test_marketplace_claim import OUTSIDER, U, Env, run, svc_of

GOOD = "Bookkeeping and management accounts for small firms across Leeds."


def _draft(env, description, *, described=False, tags=None):
    data = env.businesses["A"]["data"]
    data["catalogue"]["products"] = [{"id": "p1", "name": "Gooat", **({"description": "Monthly bookkeeping, done for you."} if described else {})}]
    data["marketplace"] = {"profile": {"description": description, "service_area": "UK", "service_tags": tags or []}, "opportunity_preferences": {"enquiries": {"enabled": True}}}
    return data


def test_real_text_is_words_someone_could_read():
    assert dx.real_text(GOOD)
    for junk in ("M" * 31, "aaaaa bbbbb ccccc ddddd", "asdf", "one two", "x x x x x x x x x x x x x"):
        assert not dx.real_text(junk), junk
    assert dx.real_text("Monthly bookkeeping, done for you.", least=10, words=2)


def test_placeholder_text_cannot_be_published_and_the_owner_is_told_what_to_fix():
    env = Env()
    s = svc_of(env)
    _draft(env, "M" * 31)
    view = run(s.business_profile(U(OWNER), "A"))
    todo = {i["key"]: i.get("fix") for i in view["activation"]["items"] if not i["done"]}
    assert view["activation"]["ready"] is False and set(todo) - {"claim"} == {"description", "offering"}
    assert "real description" in todo["description"] and "short description to at least one offering" in todo["offering"]
    with pytest.raises(dx.Invalid) as stop:
        run(s.activate(U(OWNER), "A"))
    assert set(stop.value.errors) == {"description", "offering"} and "real description" in stop.value.errors["description"]
    assert not env.businesses["A"]["data"]["marketplace"].get("is_active")
    # A real description and one described offering: it can go live.
    _draft(env, GOOD, described=True)
    assert run(s.business_profile(U(OWNER), "A"))["activation"]["ready"] is True
    assert run(s.activate(U(OWNER), "A"))["is_published"] is True
    # Services listed in words count too, where nothing in the Catalogue is described.
    assert dx.listing_quality(dx.marketplace_settings(_draft(env, GOOD, tags=["Bookkeeping"]))) == {}


def test_a_listing_published_before_the_check_is_kept_from_the_public_until_it_passes():
    env = Env()
    s = svc_of(env)
    _draft(env, GOOD, described=True)
    run(s.activate(U(OWNER), "A"))
    slug = run(s.business_profile(U(OWNER), "A"))["directory"]["slug"]
    assert run(s.search())["total"] == 1 and _build_listing_item({"id": "A", "data": env.businesses["A"]["data"]}) is not None
    # The same listing, as it was published before the check existed.
    env.businesses["A"]["data"]["marketplace"]["profile"]["description"] = "M" * 31
    env.businesses["A"]["data"]["catalogue"]["products"] = [{"id": "p1", "name": "Gooat"}]
    assert run(s.search())["total"] == 0                                    # not in the directory
    assert _build_listing_item({"id": "A", "data": env.businesses["A"]["data"]}) is None      # nor among the listings
    for viewer in (None, U(OUTSIDER)):
        with pytest.raises(dx.NotFound):
            run(s.public_profile(slug, viewer))
    mine = run(s.public_profile(slug, U(OWNER)))                            # its owner still sees it, with what to fix
    assert mine["owner_controls"] is True and len(mine["quality_hold"]) == 2 and mine["noindex"] is True
    assert env.businesses["A"]["data"]["marketplace"]["is_active"] is True  # nothing was changed or lost
