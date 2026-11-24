"""Live check (opt-in, LIVE=1): every task asked for in chat with the real model, two or more phrasings each (the frozen
held-out set extraction_heldout_e6.py), through the Agent's own entry point: the task it was routed to, and the fields
read from the message, scored as the extraction tests score them. Usage logging is stubbed; no database is touched.

    LIVE=1 LIVE_RESULTS=path python -m pytest tests/test_live_routing_and_fields.py -s"""
import asyncio
import copy
import json
import os
from collections import defaultdict

import pytest

import app.modules.agent.orchestrator  # noqa: F401
from app.core.config import get_settings
from app.modules.agent.services import LLMClassifier
from extraction_heldout import DATA
from extraction_heldout_e6 import CASES
from test_agent import OWNER, Env

_KEYS = {k: getattr(get_settings(), k, None) for k in ("openai_api_key", "claude_api_key", "gemini_api_key")}
pytestmark = pytest.mark.skipif(os.environ.get("LIVE") != "1", reason="calls the model: set LIVE=1 to run")


def _env():
    env = Env()
    d = env.businesses["A"]["data"]
    cat = DATA["catalogue"]
    d["catalogue"] = {"customers": copy.deepcopy(cat["customers"]), "vendors": copy.deepcopy(cat["vendors"]),
                      "products": [{**p, "base_price": p["base_price"]} for p in cat["products"]]}
    d["financials"]["invoices"] = [{"id": i["id"], "reference": i["reference"], "invoice_number": i["reference"], "customer_name": i["customer_name"],
                                    "status": "sent", "issue_date": "2026-08-01", "due_date": "2026-08-31", "total_amount": 100, "line_items": [{"description": "Work", "qty": 1, "unit_price": 100}], "payments": []}
                                   for i in DATA["financials"]["invoices"]]
    d["financials"]["quotes"] = [{"id": q["id"], "reference": q["reference"], "quotation_id": q["reference"], "customer_name": q["customer_name"], "status": "sent",
                                  "total_amount": 100, "items": [], "line_items": []} for q in DATA["financials"]["quotes"]]
    env.orch.rt.classifier = LLMClassifier()
    return env


def test_every_task_routed_and_read_from_chat_with_the_real_model(monkeypatch):
    from app.shared.llm import usage
    from test_extraction_heldout_live import _same

    async def nowhere(_payload):
        return None
    monkeypatch.setattr(usage, "_insert", nowhere)
    for k, v in _KEYS.items():
        monkeypatch.setattr(get_settings(), k, v, raising=False)
    rows = []
    for cap, message, want in CASES:
        env = _env()
        try:
            res = env.submit(text=message)
        except Exception as e:      # noqa: BLE001 - recorded, the run carries on
            rows.append({"capability": cap, "message": message, "routed": f"error: {type(e).__name__}", "fields": {}, "want": want})
            continue
        run = res.get("run") or {}
        understood = ((run.get("state") or {}).get("understood") or {})
        fields = {k: (v.get("record_id") or v.get("value")) for k, v in (understood.get("fields") or {}).items()}
        rows.append({"capability": cap, "message": message, "routed": run.get("workflow_key") or res.get("kind"), "by": understood.get("by"),
                     "fields": fields, "want": want})
    per = defaultdict(lambda: {"routed": 0, "n": 0, "right": 0, "fields": 0})
    for r in rows:
        p = per[r["capability"]]
        p["n"] += 1
        p["routed"] += r["routed"] == r["capability"]
        if r["routed"] == r["capability"]:
            for key, value in r["want"].items():
                p["fields"] += 1
                p["right"] += _same(key, r["fields"].get(key), value)
    total_routed = sum(p["routed"] for p in per.values())
    total_right, total_fields = sum(p["right"] for p in per.values()), sum(p["fields"] for p in per.values())
    print(f"\nrouted correctly: {total_routed}/{len(rows)}; fields right (where routed): {total_right}/{total_fields}")
    for cap in sorted(per):
        p = per[cap]
        print(f"  {cap:22} routed {p['routed']}/{p['n']}  fields {p['right']}/{p['fields']}")
    for r in rows:
        if r["routed"] != r["capability"]:
            print("  MISROUTED", json.dumps({k: r[k] for k in ("capability", "message", "routed")}, ensure_ascii=False))
    with open(os.environ.get("LIVE_RESULTS") or os.devnull, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1, default=str)
    assert len(rows) == len(CASES)


def test_every_task_asked_for_in_chat_through_the_agents_own_entry_point(monkeypatch):
    """The same phrasings through /agent/requests, as the chat sends them: the rules, the understanding layer and the
    written answer's own "start this task" marker (E2), all with the real model. The wallet and the database are stand-ins."""
    from app.modules.business_assistant import service as assistant
    from app.shared.llm import usage
    from test_agent_employee import Chat
    from test_extraction_heldout_live import _same
    real_pick = assistant.pick_llm_for_user

    async def nowhere(_payload):
        return None
    monkeypatch.setattr(usage, "_insert", nowhere)
    for k, v in _KEYS.items():
        monkeypatch.setattr(get_settings(), k, v, raising=False)
    rows = []
    for cap, message, want in CASES:
        env = _env()
        chat = Chat(monkeypatch, env, balance=1000)
        monkeypatch.setattr(assistant, "pick_llm_for_user", real_pick)      # the real model writes the answer (and may start the task)
        try:
            out = chat.say(message)
        except AssertionError as e:
            rows.append({"capability": cap, "message": message, "routed": f"error: {str(e)[:80]}", "fields": {}, "want": want})
            continue
        run = out.get("run") or {}
        stored = asyncio.run(env.orch.rt.store.get_run(run["id"])) if run.get("id") else None      # the public view carries no working state
        understood = (((stored or run).get("state") or {}).get("understood") or {})
        rows.append({"capability": cap, "message": message, "routed": run.get("workflow_key") or out.get("kind"), "by": understood.get("by"),
                     "fields": {k: (v.get("record_id") or v.get("value")) for k, v in (understood.get("fields") or {}).items()}, "want": want,
                     "reply": (out.get("message") or "")[:200], "offers": [o.get("capability") for o in out.get("offers") or []]})
    from app.main import app
    from app.shared.auth.deps import get_current_user
    app.dependency_overrides.pop(get_current_user, None)
    routed = sum(r["routed"] == r["capability"] for r in rows)
    offered = sum(r["routed"] != r["capability"] and r["capability"] in (r.get("offers") or []) for r in rows)
    right = sum(_same(k, r["fields"].get(k), v) for r in rows if r["routed"] == r["capability"] for k, v in r["want"].items())
    total = sum(len(r["want"]) for r in rows if r["routed"] == r["capability"])
    print(f"\nthrough the entry point: routed {routed}/{len(rows)}, offered as a button {offered}; fields right where routed {right}/{total}")
    for r in rows:
        if r["routed"] != r["capability"]:
            print("  NOT ROUTED", json.dumps({k: r.get(k) for k in ("capability", "message", "routed", "offers", "reply")}, ensure_ascii=False)[:400])
    with open((os.environ.get("LIVE_RESULTS") or os.devnull) + (".entry.json" if os.environ.get("LIVE_RESULTS") else ""), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1, default=str)
