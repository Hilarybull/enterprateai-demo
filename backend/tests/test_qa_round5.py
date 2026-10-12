"""QA round 5: what the owner's first message said is shown once and never asked (P5-1)."""
from test_agent import OWNER
from test_goal_onboarding import world  # noqa: F401  (the fixture)

DOG = "thinking of opening a dog walking biz in Bristol around March, already got 3 mates who said they'd pay"


def test_answers_from_the_first_message_stay_marked_as_said_after_they_are_confirmed(world):  # noqa: F811
    _env, _store, client, _who = world
    s = client.post("/task-sessions", json={"text": DOG, "entry_mode": "free_text"}).json()
    said = {r["key"] for r in s["summary"] if r["from_message"]}
    assert said == {"kind", "sell", "where", "target_date", "evidence"}
    assert {q["key"] for q in s["questions"] if not q["proposed"]} == {"stage", "customer"}      # only these are asked
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {**s["proposed"], "stage": "idea"}}).json()
    assert s["proposed"] == {}                                                # confirmed: in the inputs now
    rows = {r["key"]: r for r in s["summary"]}
    assert all(rows[k]["from_message"] for k in said) and rows["stage"]["from_message"] is False      # still the "said" line, not replies
    assert s["missing"] == ["customer"]


def test_a_quick_check_started_from_a_sentence_marks_what_it_answered(world):  # noqa: F811
    _env, _store, client, who = world
    who["user"] = OWNER
    qs = client.get("/businesses/A/quick-check/launch", params={"said": DOG}).json()["questions"]
    said = {q["key"]: q for q in qs if q.get("said")}
    assert set(said) >= {"sell", "where", "target_date", "evidence"}
    assert said["sell"]["default"] == "dog walking" and said["sell"]["said_text"] == "dog walking"
    assert said["where"]["said_text"] == "Bristol"
    assert not {q["key"] for q in qs if q.get("said")} & {"stage", "customer"}      # still asked
    plain = client.get("/businesses/A/quick-check/launch").json()["questions"]
    assert not any(q.get("said") for q in plain)                              # with no sentence, nothing is "said"


# ── P5-3: the business email is the business's, never assumed from the sign-in ──────────────────────────────────
import pytest  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from app.modules.agent import tools  # noqa: E402

SIGN_IN = "owner.personal@example.test"


def _tc():
    return SimpleNamespace(run={"state": {"answers": {}}, "requester_email": SIGN_IN}, actor=SimpleNamespace(email=SIGN_IN, user_id="u1"))


def _asked(profile: dict) -> dict:
    with pytest.raises(tools.NeedsInformation) as e:
        tools._sender(_tc(), {"workspace_profile": {"company_name": "Sparkle Cleaning", **profile}})
    return {f["key"]: f for f in e.value.fields}


def test_a_profile_with_its_business_email_is_used_and_nothing_is_asked():
    # As the restored Sparkle profile holds it (workspace_profile.email).
    company = tools._sender(_tc(), {"workspace_profile": {"company_name": "Sparkle Cleaning", "email": "hello@sparkle.test"}})
    assert company["email"] == "hello@sparkle.test"


def test_missing_it_is_suggested_from_the_profile_not_from_the_sign_in():
    assert _asked({"contact_email": "bookings@sparkle.test"})["business_email"]["default"] == "bookings@sparkle.test"
    assert "default" not in _asked({})["business_email"]                      # nothing on the profile: nothing assumed
    assert _asked({"contact_email": SIGN_IN})["business_email"]["default"] == SIGN_IN      # the same address on the profile: offered
