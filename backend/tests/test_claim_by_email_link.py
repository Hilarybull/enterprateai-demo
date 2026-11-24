"""The claim email sent to a business's own listed address claims in one click (the owner, 14 Nov): opening it signs them in,
hands them the profile and makes their workspace from it. Only that address, once, and never for a link shared by hand."""
import pytest

from app.modules.marketplace import directory as d
from test_agent import run
from test_marketplace_claim import ADMIN, NORTHWIND, U
from test_marketplace_outreach import world      # noqa: F401 - the fixture

SLUG = "northwind-advisory-ltd-leeds"
EMAIL = NORTHWIND["contact_email"]


def _token(link):
    return link.split("token=")[1]


def test_the_emailed_link_claims_the_profile_and_makes_the_workspace(world):      # noqa: F811
    env, s = world
    from test_marketplace_claim import index
    index(env)
    token = _token(s.sent[0]["link"])
    assert run(s.claim_link_email(token)) == EMAIL
    done = run(s.claim_by_email_link(U(EMAIL), token))
    assert done["slug"] == SLUG and done["business_id"]
    profile = run(s._profile(SLUG))["data"]
    assert profile["claim_state"] == "verified" and profile["linked_business_id"] == done["business_id"]
    ws = env.businesses[done["business_id"]]
    assert ws["owner"] == EMAIL and ws["data"]["workspace_profile"]["company_name"] == "Northwind Advisory Ltd"
    assert ws["data"]["marketplace"]["directory_profile_id"] == run(s._profile(SLUG))["id"]
    seen = run(s.public_profile(SLUG, U(EMAIL)))
    assert seen["owner_controls"] is True
    claim = next(c for c in s.store.rows["claims"].values() if c["kind"] == EMAIL)
    assert claim["status"] == "verified" and claim["data"]["history"][-1]["method"] == "email_link"
    with pytest.raises(d.NotFound):      # once only
        run(s.claim_link_email(token))


def test_only_the_address_it_went_to_and_only_while_unclaimed(world):      # noqa: F811
    env, s = world
    from test_marketplace_claim import index
    index(env)
    token = _token(s.sent[0]["link"])
    with pytest.raises(d.Forbidden):
        run(s.claim_by_email_link(U("someone@else.test"), token))
    with pytest.raises(d.NotFound):
        run(s.claim_link_email("not-a-real-token-at-all-123"))
    env.now += d.INVITE_TTL + d.timedelta(days=1)
    s.clock = lambda: env.now
    with pytest.raises(d.NotFound):      # expired
        run(s.claim_link_email(token))


def test_a_link_shared_by_hand_still_opens_the_claim_page_and_bulk_gets_one_click_only_for_the_listed_address(world):      # noqa: F811
    env, s = world
    from test_marketplace_claim import index
    index(env)
    by_hand = run(s.create_invitation(ADMIN, SLUG, by_hand=True))
    assert by_hand["link"].startswith(f"/marketplace/claim/{SLUG}?invite=")
    with pytest.raises(d.NotFound):      # a copied link proves nothing about who opens it
        run(s.claim_link_email(by_hand["link"].split("invite=")[1]))
    assert run(s.email_claim_link(SLUG, "other@x.test")) is None
    link = run(s.email_claim_link(SLUG, EMAIL.upper()))
    assert link.startswith("/marketplace/claim-link?token=") and run(s.claim_link_email(_token(link))) == EMAIL
