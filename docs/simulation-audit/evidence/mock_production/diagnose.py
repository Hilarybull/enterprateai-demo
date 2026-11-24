"""Diagnostic only (no model change): rerun the forecasts with seasonality or trend switched off IN MEMORY, to find which
part of the baseline method causes the failed pass marks. Run after evaluate.py, from the project root."""
import json, os, sys
from datetime import date
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "..", "backend"))
from app.modules.scenario_intelligence import baseline as B
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot

truth = json.load(open(os.path.join(HERE, "truth.json"), encoding="utf-8"))
run_on, months = date(*truth["run_date"]), truth["forecast_months"]
def wape(f, a): return sum(abs(x - y) for x, y in zip(f, a)) / sum(a) * 100
def bias(f, a): return sum(x - y for x, y in zip(f, a)) / sum(a) * 100

def forecasts(variant):
    saved = (B.SEASONAL_MIN_MONTHS, B.TREND_T_THRESHOLD)
    if variant == "no seasonality": B.SEASONAL_MIN_MONTHS = 10**6
    if variant == "no trend": B.TREND_T_THRESHOLD = 10**9
    out = {}
    for b in truth["businesses"]:
        bl = B.build_baseline(BusinessStateSnapshot(revenue_by_month=b["revenue_by_month"]), run_on)["revenue"]
        out[b["id"]] = [B.value_in_month(bl, run_on, k) for k in range(1, len(months) + 1)]
    B.SEASONAL_MIN_MONTHS, B.TREND_T_THRESHOLD = saved
    return out

variants = {v: forecasts(v) for v in ("as built", "no seasonality", "no trend")}
print(f"{'Archetype':20s}" + "".join(f"{v:>26s}" for v in variants))
for arch in sorted({b["archetype"] for b in truth["businesses"]}):
    g = [b for b in truth["businesses"] if b["archetype"] == arch]
    A = sum(([b["future_actual"][k] for k in months] for b in g), [])
    cells = []
    for v, fc in variants.items():
        F = sum((fc[b["id"]] for b in g), [])
        cells.append(f"WAPE {wape(F, A):5.1f}% bias {bias(F, A):+5.1f}%")
    print(f"{arch:20s}" + "".join(f"{c:>26s}" for c in cells))
