"""QA, 16 Oct: "why ask for my business email when there's one in the workspace form", and "the email I signed up with
should be the default contact email". With no contact email on the profile the owner's sign-up email is used, so nothing
is asked; a task already waiting on the question carries on once the profile has an address, with automatic starting off."""
from types import SimpleNamespace

from test_agent import OWNER, Env, run
from app.modules.agent import current


def test_with_no_contact_email_the_sign_up_email_is_used_and_nothing_is_asked():
    env = Env()
    run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))
    env.businesses["A"]["data"].setdefault("workspace_profile", {}).pop("email", None)
    r = env.submit(text="invoice BrightTech Ltd for a Strategy Workshop")["run"]
    assert "business_email" not in {f["key"] for f in (r.get("pending_question") or {}).get("fields") or []}, r.get("pending_question")
    assert r["status"] == "awaiting_approval"


def test_a_task_already_waiting_for_the_business_email_carries_on_once_the_profile_has_one():
    advanced = []

    async def advance(run_id):
        advanced.append(run_id)
        return {"id": run_id, "status": "awaiting_approval"}
    orch = SimpleNamespace(advance=advance)
    waiting = {"id": "r1", "status": "running", "workflow_key": "new_invoice", "business_id": "A",
               "pending_question": {"question": "Before this goes to the customer I need your business email.", "fields": [{"key": "business_email"}]}}
    out = run(current.recheck_against_profile(orch, waiting, {"workspace_profile": {"company_name": "Apex", "email": "hello@apex.test"}}))
    assert advanced == ["r1"] and out["status"] == "awaiting_approval"
    advanced.clear()
    run(current.recheck_against_profile(orch, waiting, {"workspace_profile": {"company_name": "Apex"}}))      # still none: it stands
    assert advanced == []
