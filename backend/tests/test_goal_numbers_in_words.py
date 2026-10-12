"""QA P0-1: a number written with words around it is read; one that isn't a number is kept
out and said (session["rejected"]), never dropped in silence or shown back as if it were kept."""
from app.modules.agent.goals import number_in
from test_goal_onboarding import world  # noqa: F401  (the fixture)


def test_the_number_in_an_answer():
    assert number_in("£45 per groom") == 45
    assert number_in("about 20 a month") == 20
    assert number_in("£2.5k") == 2500
    assert number_in("50,000") == 50000
    assert number_in(300) == 300
    assert number_in("not sure yet") is None


def test_an_answer_with_no_number_is_said_and_one_with_words_is_kept(world):  # noqa: F811
    _env, _store, client, _who = world
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal"}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"amount": "lots"}}).json()
    assert s["rejected"] == {"amount": "Please enter a number, for example 45."}
    assert "amount" in s["missing"] and not s["inputs"].get("amount")      # asked again, with why
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"amount": "£25k please"}}).json()
    assert s["rejected"] == {} and s["inputs"]["amount"] == 25000 and "amount" not in s["missing"]


def test_progress_counts_each_question_answered(world):  # noqa: F811
    """QA P2-1: "2 of 6" after four answers is wrong; the count moves with each answer."""
    _env, _store, client, _who = world
    s = client.post("/task-sessions", json={"key": "test_idea", "entry_mode": "business_goal"}).json()
    total = len(s["questions"])
    assert s["progress"] == {"answered": 0, "total": total}
    answers = {}
    for n, (k, v) in enumerate((("description", "Dog grooming van"), ("customer", "Dog owners in Leeds"), ("price", 45), ("monthly_sales", 80)), start=1):
        answers[k] = v
        s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": answers}).json()
        assert s["progress"] == {"answered": n, "total": total}
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {**answers, "cost": "unknown"}}).json()
    assert s["progress"]["answered"] == 5      # "Not sure" is an answer
