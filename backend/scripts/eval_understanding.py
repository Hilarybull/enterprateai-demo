"""Report (QA H): the golden set scored three ways, per case, with latency and cost per message.

  before : the readers as they were (goals.extract, number_in, said.read, lines_in_text, rule_capability, goals.resolve)
  rules  : understanding.understand(..., use_model=False)  (the deterministic floor and fallback)
  llm    : understanding.understand(...) with the configured model  (only with --live; sends only the golden sentences)

    python scripts/eval_understanding.py [--live]
"""
import asyncio
import json
import statistics
import sys
import time
from datetime import date
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.modules.agent import understanding as und  # noqa: E402
from app.modules.agent.understanding_golden import CATALOGUE, GOLDEN, score  # noqa: E402


def legacy(case) -> SimpleNamespace:
    """What the code did before the understanding layer, for the same message."""
    from app.modules.agent import answers, goals, intent, said
    msg, ctx = case["message"], case["context"]
    supported = list(und.capability_registry())
    fields = []
    if ctx.get("cta"):
        it = "launch_readiness"      # the button sent the owner to the Agent Centre with no context (QA E3)
    elif ctx.get("questions"):
        it = und.ANSWER
        q = ctx["questions"][0]
        n = goals.number_in(msg)      # digits only: "about sixty" and "standard rate" were refused
        val = "unknown" if msg.strip().lower() == "not sure" else n
        if val is not None:
            fields.append(SimpleNamespace(key=q["key"], normalised_value=val, currency=None))
    else:
        rule = intent.rule_capability(msg, supported)
        res = goals.resolve(text=msg)
        it = rule or (und.QUESTION if answers.topic_of(msg) else res.get("start_capability")) or und.UNSUPPORTED
        for k, v in goals.extract(msg, res.get("goal_key")).items():
            fields.append(SimpleNamespace(key=k, normalised_value=v, currency=None))
        if it in ("enquiry_to_quote",):
            read = said.read(msg, date.today())
            if read.get("party"):
                fields.append(SimpleNamespace(key="customer_name", normalised_value=read["party"], currency=None))
            lines = intent.lines_in_text(msg, CATALOGUE)
            if lines:
                fields.append(SimpleNamespace(key="items", normalised_value=lines, currency=None))
    return SimpleNamespace(intent=it, fields=fields, injected_instructions_detected=bool(intent.without_injection(msg)[1]), cta_context=None)


def _score_legacy(case, u):
    for f in u.fields:
        if f.key == "items":
            f.normalised_value = [{"name": x.get("name"), "quantity": x.get("quantity"), "unit_price": x.get("unit_price") or None} for x in f.normalised_value]
    return score(case, u)


async def run(live: bool):
    reg = und.capability_registry()
    rows = []
    for case in GOLDEN:
        ctx = {"capabilities": reg, "catalogue": CATALOGUE, **case["context"]}
        b = _score_legacy(case, legacy(case))
        t = time.perf_counter()
        r_u = await und.understand(case["message"], ctx, use_model=False)
        r_ms = (time.perf_counter() - t) * 1000
        r = score(case, r_u)
        row = {"id": case["id"], "before": b, "rules": r, "rules_ms": round(r_ms, 1)}
        if live:
            l_u = await und.understand(case["message"], ctx, use_model="always")      # the model on every case, to measure it
            row["llm"] = score(case, l_u)
            row["llm_ms"], row["tokens"], row["cost_usd"], row["error"], row["method"] = l_u.latency_ms, l_u.tokens, l_u.cost_usd, l_u.error, l_u.method
        rows.append(row)

    def acc(mode):
        right = sum(x[mode]["fields_right"] for x in rows)
        exp = sum(x[mode]["fields_expected"] for x in rows)
        return right, exp, sum(x[mode]["intent_ok"] for x in rows), sum(x[mode]["safe"] for x in rows if any(c["id"] == x["id"] and c.get("safety") for c in GOLDEN))
    safety_n = sum(1 for c in GOLDEN if c.get("safety"))
    print(f"{'case':22} {'before':>14} {'rules':>14}" + (f" {'llm+rules':>14} {'ms':>6} {'tokens':>6} {'cost $':>9}" if live else ""))
    for x in rows:
        cell = lambda m: f"{'I' if x[m]['intent_ok'] else 'i'} {x[m]['fields_right']}/{x[m]['fields_expected']} {'S' if x[m]['safe'] else 's'}"  # noqa: E731
        line = f"{x['id']:22} {cell('before'):>14} {cell('rules'):>14}"
        if live:
            line += f" {cell('llm'):>14} {x['llm_ms']:>6} {x['tokens']:>6} {x['cost_usd']:>9.6f}" + (f"  {x['error']}" if x["error"] else "")
        print(line)
    for mode in ("before", "rules") + (("llm",) if live else ()):
        right, exp, intents, safe = acc(mode)
        print(f"{mode:7}: fields {right}/{exp} = {right / exp:.0%}   intents {intents}/{len(rows)}   safety {safe}/{safety_n}")
    if live:
        ms = [x["llm_ms"] for x in rows if x["llm_ms"]]
        print(f"llm latency per message: median {statistics.median(ms):.0f} ms, max {max(ms)} ms; tokens per message median "
              f"{statistics.median([x['tokens'] for x in rows])}; estimated cost per message median ${statistics.median([x['cost_usd'] for x in rows]):.6f}")
    print(json.dumps({"rules_ms_median": statistics.median([x["rules_ms"] for x in rows])}))


if __name__ == "__main__":
    asyncio.run(run("--live" in sys.argv))
