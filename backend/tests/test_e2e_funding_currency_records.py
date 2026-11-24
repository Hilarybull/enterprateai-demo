"""End to end, as the owner used it (20 Oct): a funding chat in £ on the homepage, signed in to a naira workspace that has
Business Operations on record. Asked once about the currency; kept and converted; one currency after that; and the
research's questions answered from the records, never asked."""
from datetime import date, timedelta

from app.modules.agent import credibility, research
from test_agent import OWNER
from test_goal_onboarding import world  # noqa: F401 - the fixture

TODAY = date.today()


def goal_router_store():
    from app.modules.agent import goal_router
    return goal_router._store


def _naira_workspace_with_records(env):
    d = env.businesses["A"]["data"]
    d["settings"] = {"currency": "NGN"}
    d["workspace_profile"] = {"company_name": "Synthetic Wash", "country": "Nigeria", "city": "Abuja"}
    d["financials"] = {
        "invoices": [{"id": f"i{n}", "status": "paid" if n % 2 else "partially_paid", "customer_name": f"Client {n % 3}", "total_amount": 20000,
                      "payments": [] if n % 2 else [{"amount": 10000, "date": (TODAY - timedelta(days=5 + n)).isoformat()}],
                      "issue_date": (TODAY - timedelta(days=10 + n)).isoformat()} for n in range(6)],
        "expenses": [{"id": "e1", "status": "paid", "price": 30000, "date": (TODAY - timedelta(days=20)).isoformat()}]}


def test_pounds_are_asked_about_once_converted_and_the_records_answer_the_research(world, monkeypatch):  # noqa: F811
    env, store, client, who = world
    _naira_workspace_with_records(env)

    async def rate(frm, to, today):
        return {"rate": 1773.03, "date": TODAY.isoformat()} if (frm, to) == ("GBP", "NGN") else None
    monkeypatch.setattr(credibility, "dated_rate", rate)
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal"}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"amount": 10000}, "picked": "£10,000", "asked": "amount"}).json()
    for k, v in (("use", "Equipment"), ("stage", "trading"), ("route", "loan"), ("timing", "Within 3 months"), ("traction", "Some customers")):
        s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {k: v}, "picked": v, "asked": k}).json()
    who["user"] = OWNER
    resumed = client.post(f"/task-sessions/{s['id']}/resume").json()
    # 1. Asked once: £10,000, or about ₦17,730,300 at the day's rate. Nothing is prepared before the answer.
    q = resumed["currency_question"]
    assert (q["shown"], q["workspace"], q["figures"], q["rate"]["rate"]) == ("GBP", "NGN", {"amount": 10000.0}, 1773.03)
    assert client.post(f"/task-sessions/{s['id']}/prepare").status_code == 409
    # 2. Kept as given: £10,000 stays £10,000 (never converted), and the case is in pounds.
    settled = client.post(f"/task-sessions/{s['id']}/currency", json={"choice": "keep"}).json()
    assert settled["currency"] == "GBP" and settled["currency_question"] is None and settled["inputs"]["amount"] == 10000.0
    prepared = client.post(f"/task-sessions/{s['id']}/prepare").json()
    fv = client.get(f"/task-sessions/{s['id']}/first-value").json()
    assert fv["result"]["currency_sign"] == "£"
    # The workspace's currency changes later: the amount and its currency do not.
    env.businesses["A"]["data"]["settings"]["currency"] = "USD"
    again = client.get(f"/task-sessions/{s['id']}/first-value").json()["result"]
    assert again["currency_sign"] == "£" and "17,730,300" not in str(again)
    # 3. The research reads the records: sales a month, paying customers, cash now and costs, never asked.
    found = {k: v for k, v, _w in research.records_of(env.businesses["A"]["data"], TODAY)}
    # Weeks of records: no monthly figure of their own, asked instead (the owner's QA, 21 Oct)
    assert "monthly_sales" not in found and found["records_thin"]["count"] == 6 and found["evidence"].startswith("3 paying customers")
    spent = TODAY - timedelta(days=20)
    spread = max(1, min(3, (TODAY.year - spent.year) * 12 + TODAY.month - spent.month + 1))
    assert found["cash_in_bank"] == 3 * 20000 + 3 * 10000 - 30000 and found["fixed_costs"] == round(30000 / spread, 2)
    assert prepared.get("handoff") or prepared.get("first_value")


def test_meant_in_naira_takes_the_figure_as_naira(world, monkeypatch):  # noqa: F811
    env, store, client, who = world
    _naira_workspace_with_records(env)

    async def rate(frm, to, today):
        return None
    monkeypatch.setattr(credibility, "dated_rate", rate)
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal"}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"amount": 10000}, "picked": "£10,000", "asked": "amount"}).json()
    who["user"] = OWNER
    resumed = client.post(f"/task-sessions/{s['id']}/resume").json()
    assert resumed["currency_question"]["rate"] is None
    settled = client.post(f"/task-sessions/{s['id']}/currency", json={"choice": "meant"}).json()
    assert settled["currency"] == "NGN" and settled["inputs"]["amount"] == 10000.0


def test_the_case_page_shows_the_very_result_the_chat_ended_on(world, monkeypatch):  # noqa: F811
    """FUNDING RESULT CONSISTENCY: finish the chat, open the case: the same score, count, coverage and top 3 steps."""
    env, store, client, who = world
    _naira_workspace_with_records(env)
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal"}).json()
    for k, v in (("amount", 5000000), ("use", "2 more washing bays"), ("stage", "trading"), ("route", "loan"), ("timing", "In 3 to 6 months"),
                 ("traction", "300 cars a month")):
        s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {k: v}, "picked": str(v), "asked": k}).json()
    who["user"] = OWNER
    resumed = client.post(f"/task-sessions/{s['id']}/resume").json()
    if resumed.get("currency_question"):
        client.post(f"/task-sessions/{s['id']}/currency", json={"choice": "meant"})
    prepared = client.post(f"/task-sessions/{s['id']}/prepare").json()
    case_id = prepared["handoff"]["subject_id"]
    chat = client.get(f"/task-sessions/{s['id']}/first-value").json()["result"]
    page = client.get(f"/businesses/A/cases/{case_id}/overview").json()["result"]
    same = lambda r: (r["score"], len(r["blockers"]), r["evidence_coverage"], [b["key"] for b in r["blockers"][:3]], (r.get("assessment") or {}).get("score"))      # noqa: E731
    assert same(page) == same(chat)
