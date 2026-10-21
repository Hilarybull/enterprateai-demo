"""A5: one price per task, read from the price list file. Agent settings' trigger list, its table of what the Agent can
do, the run page's recorded cost and the charge itself must agree; this fails if any two of them differ."""
import re

from app.modules.agent import autostart, config
from app.modules.agent.workflows import WORKFLOWS
from app.modules.credits.catalogue import FEATURES
from app.modules.credits.service import charged
from test_agent import OWNER, Env, run


def _figures(text: str) -> list[int]:
    return [int(n) for n in re.findall(r"\d+", text)]


def test_the_trigger_list_and_the_table_say_the_same_for_every_task():
    for cap in WORKFLOWS:
        assert config.AUTOMATIC_COST.get(cap, config.cost_of(cap)) == config.cost_of(cap), cap
        assert "Free" not in config.cost_of(cap) or cap in config.FREE_CAPABILITIES


def test_every_figure_shown_is_a_price_on_the_price_list():
    prices = {charged(row[1]) for row in FEATURES.values()}
    for cap in WORKFLOWS:
        for n in _figures(config.cost_of(cap)):
            assert n in prices, (cap, n)


def test_the_settings_rows_read_the_same_table():
    env = Env()
    rows = [e for e in autostart.events(run(env.store.get_policy("A")), run(env.orch.entitlement("A"))) if e["key"]]
    for e in rows:
        cap = autostart.ITEMS[e["key"]][1]
        assert e["credits"] == config.cost_of(cap), e["key"]


def test_what_a_task_is_charged_is_what_it_says():
    env = Env(plan="starter_insight", credits=50)
    r = env.submit(capability="registration_checklist", channel="ui_action")["run"]
    assert r["status"] == "succeeded" and not (r["state"].get("outcome") or {}).get("skipped")
    charged_now = sum(c for _u, _f, c in env.meter.charges)
    shown = sum(int(c.get("credits") or 0) for c in (r.get("state") or {}).get("credits") or [])
    assert charged_now == shown == _figures(config.cost_of("registration_checklist"))[0]


def test_a_task_with_nothing_to_do_is_free():
    env = Env(plan="decision_engine", credits=50)
    r = env.submit(capability="funding_pack_draft", channel="ui_action")["run"]      # no funding case yet
    assert r["state"]["outcome"].get("skipped") and env.meter.charges == []
