"""Field accuracy of the shared extractor against the real model, on the held-out set (extraction_heldout.py).
Runs only with EXTRACTION_LIVE=1 (it calls the model: about one short call per case). The build fails below 95% field
accuracy, or if any field is filled with a value the owner never said.

    EXTRACTION_LIVE=1 python -m pytest tests/test_extraction_heldout_live.py -s"""
import asyncio
import json
import os
import re
from collections import defaultdict

import pytest

import app.modules.agent.orchestrator  # noqa: F401  (loads the Agent)
from app.modules.agent import extraction
from app.modules.agent.services import LLMClassifier
from extraction_heldout import DATA, TODAY

# EXTRACTION_SET=e5 scores the second held-out set (extraction_heldout_e5.py), reported on its own; scoring is the same.
if os.environ.get("EXTRACTION_SET") == "e5":
    from extraction_heldout_e5 import CASES
elif os.environ.get("EXTRACTION_SET") == "e6":
    from extraction_heldout_e6 import CASES
else:
    from extraction_heldout import CASES

from app.core.config import get_settings

# The suite clears model keys for every test (conftest); this opt-in test calls the real model, so it keeps the key it
# was started with. The database stays blocked as for every test.
_KEYS = {k: getattr(get_settings(), k, None) for k in ("openai_api_key", "claude_api_key", "gemini_api_key")}

pytestmark = pytest.mark.skipif(os.environ.get("EXTRACTION_LIVE") != "1", reason="calls the model: set EXTRACTION_LIVE=1 to run")


def _plain(v) -> str:
    """Case, spacing, a leading article and a closing full stop aside."""
    t = " ".join(str(v).lower().replace("\u2019", "'").split()).rstrip(".")
    for a in ("a ", "an ", "the "):
        if t.startswith(a):
            t = t[len(a):]
    return t


def _same(key: str, got, want) -> bool:
    if key in ("term", "timeline"):
        return (extraction.duration(got) or _plain(got)) == (extraction.duration(want) or _plain(want))
    if want is None:
        return got is None
    if got is None:
        return False
    if isinstance(want, list):      # items: (name, qty, unit price)
        if not isinstance(got, list) or len(got) != len(want):
            return False
        for g, (name, qty, price) in zip(got, want):
            said = {extraction._item_key(g.get("said") or ""), extraction._item_key(g.get("name") or "")}
            if extraction._item_key(name) not in said or float(g.get("quantity") or 1) != float(qty):
                return False
            if price is not None and (g.get("unit_price") in ("", None) or abs(float(g["unit_price"]) - float(price)) > 0.005):
                return False
        return True
    if isinstance(want, (int, float)):
        try:
            return abs(float(got) - float(want)) < 0.005
        except (TypeError, ValueError):
            return False
    return _plain(got) == _plain(want)


def _run_all() -> list[dict]:
    reader = LLMClassifier()

    async def one(cap, msg, want):
        read = await extraction.understand(reader, cap, msg, DATA, TODAY, "heldout")
        # A name matched to a record is scored by the record's id (what the task uses).
        fields = {k: (v.get("record_id") or v["value"]) for k, v in (read.get("fields") or {}).items()}
        return {"capability": cap, "message": msg, "want": want, "got": fields, "by": read.get("by")}

    async def every():
        out = []
        for i in range(0, len(CASES), 4):      # a few at a time
            out += await asyncio.gather(*(one(*c) for c in CASES[i:i + 4]))
        return out
    return asyncio.run(every())


def test_field_accuracy_is_at_least_95_percent_and_nothing_is_invented(monkeypatch):
    from app.shared.llm import usage

    async def nowhere(_payload):
        return None
    monkeypatch.setattr(usage, "_insert", nowhere)      # no usage rows written anywhere: nothing reaches the dev database
    for k, v in _KEYS.items():
        monkeypatch.setattr(get_settings(), k, v, raising=False)
    results = _run_all()
    per = defaultdict(lambda: {"right": 0, "fields": 0, "invented": 0})
    invented, wrong, extras = [], [], []
    for r in results:
        cap, want, got = r["capability"], r["want"], r["got"]
        for key in set(want) | set(got):
            if key not in want:
                # Read but not expected. Invented only if its words aren't in the message (what the owner never said);
                # a record id stands for a name that was checked against the message.
                words = got[key] if not isinstance(got[key], list) else " ".join(str(x.get("said") or x.get("name")) for x in got[key])
                if not extraction.said_in(str(words), r["message"]) and not re.fullmatch(r"(?:item|customer|vendor):?\w+|[cvpiq]\d+", str(words)):
                    per[cap]["invented"] += 1
                    invented.append((cap, r["message"], key, got[key]))
                else:
                    extras.append((cap, r["message"], key, got[key]))
                continue
            per[cap]["fields"] += 1
            if _same(key, got.get(key), want[key]):
                per[cap]["right"] += 1
            else:
                wrong.append((cap, r["message"], key, want[key], got.get(key)))
    total_right = sum(p["right"] for p in per.values())
    total = sum(p["fields"] for p in per.values())
    print("\nfield accuracy per capability:")
    for cap in sorted(per):
        p = per[cap]
        print(f"  {cap:22} {p['right']:3}/{p['fields']:<3} invented {p['invented']}")
    print(f"overall: {total_right}/{total} = {total_right / max(total, 1):.1%}; invented: {len(invented)}")
    for w in wrong:
        print("  WRONG", json.dumps(w, ensure_ascii=False, default=str))
    for v in invented:
        print("  INVENTED", json.dumps(v, ensure_ascii=False, default=str))
    for v in extras:
        print("  EXTRA (said, not expected)", json.dumps(v, ensure_ascii=False, default=str))
    with open(os.environ.get("EXTRACTION_RESULTS") or os.devnull, "w", encoding="utf-8") as f:      # set EXTRACTION_RESULTS=path to keep them
        json.dump(results, f, ensure_ascii=False, indent=1, default=str)
    assert all(r["by"] in ("model", "nothing") for r in results), "the model wasn't reachable for every case"
    assert total_right / max(total, 1) >= 0.95 and not invented
