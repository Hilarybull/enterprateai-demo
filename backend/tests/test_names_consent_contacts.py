"""A person's own name is read from what they say of themselves, never from who a request is for.
Their marketing choice is stored as they made it, and only those who said yes are sent marketing.
The superadmin's Contacts list and its export come from the same rows."""
import asyncio
from datetime import datetime, timezone

from app.modules.admin import router as admin
from app.modules.agent import goals, summary
from app.shared import people


class Store(goals.SessionStore):
    def __init__(self):
        self.rows = {}

    async def put(self, s):
        self.rows[s["id"]] = s

    async def get(self, sid):
        return self.rows.get(sid)

    async def track(self, *a, **k):
        return None


def test_the_users_own_name_is_never_the_customer():
    who, rest = people.own_name("I'm Munah, invoice for Mark $300")
    assert who == {"first_name": "Munah", "full_name": "Munah"} and rest == "invoice for Mark $300"
    assert people.own_name("invoice for Mark $300") == (None, "invoice for Mark $300")      # Mark is the customer, and nobody said who they are
    assert people.own_name("my name is munah okoro and I need funding")[0] == {"first_name": "Munah", "full_name": "Munah Okoro"}
    assert people.own_name("this is Munah from Apex Consulting, create a quotation for ABC Ltd") == ({"first_name": "Munah", "full_name": "Munah"}, "create a quotation for ABC Ltd")
    for not_a_name in ("I'm looking for funding", "I am a baker and need customers", "I'm not sure what I need"):
        assert people.own_name(not_a_name)[0] is None, not_a_name


def test_a_name_is_letters_only_and_kept_tidy():
    assert people.clean_name("  mary-jane   okoro ") == {"first_name": "Mary-Jane", "full_name": "Mary-Jane Okoro"}
    for bad in ("", "a@b.com", "http://x.com", "Munah123", "X" * 41, "the"):
        assert people.clean_name(bad) is None, bad
    assert people.call_me("call me hilary") == {"first_name": "Hilary", "full_name": "Hilary"}
    assert people.call_me("invoice for Mark") is None


def test_the_homepage_session_keeps_the_name_and_reads_the_rest_as_the_request():
    store = Store()
    s = asyncio.run(goals.start(store, text="I'm Munah, invoice for Mark $300", key=None, entry_mode="free_text"))
    shown = goals.public(s)
    assert shown["first_name"] == "Munah" and s["name"] == "Munah"
    assert shown["goal_key"] == "create_invoice" and str(s["proposed"].get("customer") or "").lower() == "mark"      # Mark is who the invoice is for
    assert "Munah" not in str(s["proposed"])
    plain = goals.public(asyncio.run(goals.start(store, text="invoice for Mark $300", key=None, entry_mode="free_text")))
    assert plain["first_name"] is None                                      # nothing said about themselves: asked for at the checkpoint


def test_the_marketing_choice_is_stored_as_made_and_only_a_yes_is_sent_marketing():
    async def mailer(*_):
        return None

    store = Store()
    s = asyncio.run(goals.start(store, text="invoice for Mark $300", key=None, entry_mode="free_text"))
    s = asyncio.run(goals.send_code(store, s, "new@example.test", mailer, name="munah okoro", marketing_consent=False))
    assert s["visitor"] == {"first_name": "Munah", "full_name": "Munah Okoro"}
    assert s["consent"]["marketing_consent"] is False and s["consent"]["consent_version"] == people.CONSENT_VERSION and s["consent"]["consent_source"] == "homepage_agent"
    no = admin.contact_of({"id": "new@example.test", "email": "new@example.test", "name": "Munah Okoro"})      # unticked: nothing was recorded
    yes = admin.contact_of({"id": "y@example.test", "email": "y@example.test", "marketing_email_status": "subscribed", "marketing_permission_at": "2026-10-08T10:00:00+00:00",
                            "marketing_permission_source": "homepage_agent", "marketing_permission_wording": people.CONSENT_VERSION})
    gone = admin.contact_of({"id": "u@example.test", "email": "u@example.test", "marketing_email_status": "unsubscribed", "marketing_unsubscribed_at": "2026-10-09T10:00:00+00:00"})
    assert (yes["consent_at"], yes["consent_source"], yes["consent_version"]) == ("2026-10-08T10:00:00+00:00", "homepage_agent", people.CONSENT_VERSION) and gone["unsubscribed"] is True
    assert [admin.may_be_sent_marketing(c) for c in (no, yes, gone)] == [False, True, False]      # unticked, or unsubscribed: never sent marketing
    assert no["signup_source"] == "direct_signup" and no["plan"] == "explorer"


def test_contacts_can_be_searched_filtered_and_exported_with_the_consent_fields():
    rows = [admin.contact_of({"id": "a@x.test", "email": "a@x.test", "name": "Munah Okoro", "signup_source": "homepage_agent", "first_goal": "create_invoice",
                              "created_at": "2026-10-08T09:00:00+00:00", "marketing_email_status": "subscribed", "marketing_permission_at": "2026-10-08T09:00:00+00:00",
                              "marketing_permission_wording": people.CONSENT_VERSION}, "starter_insight"),
            admin.contact_of({"id": "b@x.test", "email": "b@x.test", "name": "Mark Ade", "created_at": "2026-09-01T09:00:00+00:00"})]
    assert [c["email"] for c in admin.filter_contacts(rows, q="munah")] == ["a@x.test"]
    assert [c["email"] for c in admin.filter_contacts(rows, consent="yes")] == ["a@x.test"] and [c["email"] for c in admin.filter_contacts(rows, consent="no")] == ["b@x.test"]
    assert [c["email"] for c in admin.filter_contacts(rows, plan="starter_insight")] == ["a@x.test"]
    assert [c["email"] for c in admin.filter_contacts(rows, source="direct_signup")] == ["b@x.test"]
    assert [c["email"] for c in admin.filter_contacts(rows, since="2026-10-01")] == ["a@x.test"]
    lines = admin.contacts_csv(rows).splitlines()
    assert lines[0].split(",") == list(admin.CSV_FIELDS) and "marketing_consent" in lines[0] and "consent_at" in lines[0]
    assert lines[1].startswith("Munah Okoro,a@x.test,homepage_agent,create_invoice,starter_insight") and ",yes," in lines[1] and ",no," in lines[2]


def test_the_briefing_counts_what_was_done_since_the_last_visit_and_what_is_waiting():
    now = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)
    runs = [
        {"id": "r1", "workflow_key": "new_invoice", "status": "awaiting_approval", "updated_at": "2026-10-08T09:00:00+00:00"},      # drafted while away
        {"id": "r2", "workflow_key": "risk_concentration", "status": "succeeded", "completed_at": "2026-10-08T10:00:00+00:00"},
        {"id": "r3", "workflow_key": "new_invoice", "status": "succeeded", "completed_at": "2026-10-01T10:00:00+00:00"},            # before the last visit
        {"id": "r4", "workflow_key": "enquiry_to_quote", "status": "running", "pending_question": {"question": "Who is it for?"}},
        {"id": "r5", "workflow_key": "enquiry_to_quote", "status": "running", "title": "Quotation for Mark"},
    ]
    b = summary.briefing_of(runs, since="2026-10-07T18:00:00+00:00", needs_approval=1, now=now)
    assert b["done_since_last_visit"] == {"new_invoice": 1, "risk_concentration": 1}
    assert (b["needs_approval_count"], b["needs_input_count"], b["first_input_run_id"]) == (1, 1, "r4")
    assert b["working_on"] == {"run_id": "r5", "title": "Quotation for Mark"} and b["first_visit"] is False
    first = summary.briefing_of([], since=None, needs_approval=0, now=now)
    assert first["first_visit"] is True and first["done_since_last_visit"] == {}
    assert summary.briefing_of(runs, since=None, needs_approval=0, now=now)["first_visit"] is False      # not their first visit: there is work on record


def test_a_ticked_box_is_recorded_as_the_accounts_email_permission_and_an_unticked_one_records_nothing():
    """Marketing permission has one home: the account's own record, which every send and the one-click unsubscribe already use."""
    import inspect
    from app.modules.agent import goal_router
    source = inspect.getsource(goal_router.Accounts.permit)
    assert "set_permission" in source and '"subscribed"' in source
    verify = inspect.getsource(goal_router.session_verify)
    assert 'get("marketing_consent")' in verify and "accounts.permit" in verify      # only a yes is recorded
    assert "marketing_consent" not in admin.CONTACT_COLUMNS                           # no second copy of the choice

