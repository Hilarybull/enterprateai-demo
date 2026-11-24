"""The baseline a projection starts from: what the business earns and spends in a normal month, and how that is moving.

Simulation audit, Phase 1 (17 Nov 2026), finding F8: the baseline used to be the latest calendar month only, often a month
still in progress. Pure calculation, no database or network calls.

Rules (each one is reported back with the projection, under ``summary["baseline"]``):

* Only **complete** months count. The month containing ``as_of`` (today) and any later month are left out.
* **Level** per series (revenue, cost of sales, operating expenses):
    1. the figure the rest of the product already uses (``figure_sources`` set by the server from agent/figures.py,
       the one set of figures shared by the dashboard, the risk check and the Agent), when there is one;
    2. otherwise the average of the last three complete months on record (fewer if the business is younger);
    3. otherwise the monthly figure sent with the request, labelled as such.
  Months with nothing recorded between the first month on record and the last complete month count as zero.
* **Trend**: least-squares slope over the last 12 complete months (at least 6 needed). Applied only when it is
  statistically significant (|t| >= 2, roughly 95% confidence), and damped (each month adds 0.9x the previous month's
  growth, the standard damped-trend form), so a short run of growth is not projected on for ever.
* **Seasonality**: classical ratio-to-moving-average indices by calendar month, only with at least 24 complete months
  (two full years). Indices average to 1.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

TREND_MIN_MONTHS = 6
TREND_WINDOW = 12
TREND_T_THRESHOLD = 2.0
TREND_DAMPING = 0.9
SEASONAL_MIN_MONTHS = 24
LEVEL_MONTHS = 3

SERIES = (
    # name, history field on the state, monthly field on the state, figure_sources key that marks a shared figure
    ("revenue", "revenue_by_month", "revenue_monthly", "revenue_monthly"),
    ("cost_of_sales", "cost_of_sales_by_month", "cost_of_sales_monthly", "cost_of_sales_monthly"),
    ("expenses", "expenses_by_month", "expenses_monthly", "expenses_monthly"),
)


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def add_months(year: int, month: int, n: int) -> Tuple[int, int]:
    total = year * 12 + (month - 1) + n
    return total // 12, total % 12 + 1


def _parse_key(key: str) -> Optional[Tuple[int, int]]:
    try:
        y, m = str(key)[:7].split("-")
        y, m = int(y), int(m)
        return (y, m) if 1 <= m <= 12 else None
    except (ValueError, AttributeError):
        return None


def complete_months(history: Dict[str, Any] | None, as_of: date) -> List[Tuple[Tuple[int, int], float]]:
    """[((year, month), amount)] for every month from the first on record to the last complete month before `as_of`,
    in order, with gaps filled as zero. Months on or after the month of `as_of` are left out (not complete)."""
    if not isinstance(history, dict) or not history:
        return []
    cur = (as_of.year, as_of.month)
    values: Dict[Tuple[int, int], float] = {}
    for k, v in history.items():
        ym = _parse_key(k)
        if ym is None or ym >= cur:
            continue
        try:
            values[ym] = values.get(ym, 0.0) + float(v or 0.0)
        except (TypeError, ValueError):
            continue
    if not values:
        return []
    first = min(values)
    last = add_months(cur[0], cur[1], -1)
    out = []
    ym = first
    while ym <= last:
        out.append((ym, round(values.get(ym, 0.0), 2)))
        ym = add_months(ym[0], ym[1], 1)
    return out


def seasonal_indices(series: List[Tuple[Tuple[int, int], float]]) -> Optional[Dict[int, float]]:
    """Calendar-month indices (1..12) by ratio to the centred 2x12 moving average. None with under 24 months, or when a
    calendar month has no usable ratio."""
    if len(series) < SEASONAL_MIN_MONTHS:
        return None
    x = [v for _ym, v in series]
    ratios: Dict[int, List[float]] = {m: [] for m in range(1, 13)}
    for t in range(6, len(x) - 6):
        cma = (0.5 * x[t - 6] + sum(x[t - 5:t + 6]) + 0.5 * x[t + 6]) / 12.0
        if cma > 0:
            ratios[series[t][0][1]].append(x[t] / cma)
    if any(not r for r in ratios.values()):
        return None
    raw = {m: sum(r) / len(r) for m, r in ratios.items()}
    mean = sum(raw.values()) / 12.0
    if mean <= 0:
        return None
    return {m: round(v / mean, 4) for m, v in raw.items()}


# ── Simulation audit, Phase 4: is there really a seasonal pattern? ──────────────────────────────────────────────────
# The F-test for stable seasonality used in classical seasonal adjustment (US Census Bureau X-11 / X-13ARIMA-SEATS):
# a one-way analysis of variance of the detrended values by calendar month. Seasonality is applied only when the
# differences between calendar months are larger than noise would produce (p < SEASONAL_ALPHA). Before this, any
# business with 24 months was given a seasonal pattern, which on steady businesses fitted noise
# (06-independent-review-and-mock-production.md, section 3.4).
SEASONAL_ALPHA = 0.01


def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the incomplete beta function (Lentz's method)."""
    tiny, qab, qap, qam = 1e-300, a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c if abs(1.0 + aa / c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c if abs(1.0 + aa / c) > tiny else tiny
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-12:
            break
    return h


def _betainc(a: float, b: float, x: float) -> float:
    """Regularised incomplete beta I_x(a, b)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbeta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    front = math.exp(lbeta + a * math.log(x) + b * math.log(1.0 - x))
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


def f_test_p_value(f: float, df1: int, df2: int) -> float:
    """P(F >= f) for an F distribution with (df1, df2) degrees of freedom."""
    if f is None or df1 <= 0 or df2 <= 0:
        return 1.0
    if math.isinf(f):
        return 0.0
    if f <= 0:
        return 1.0
    return _betainc(df2 / 2.0, df1 / 2.0, df2 / (df2 + df1 * f))


def seasonality_test(series: List[Tuple[Tuple[int, int], float]]) -> Optional[Dict[str, Any]]:
    """F-test for stable seasonality on complete months: each month divided by a straight-line trend through the whole
    series, then grouped by calendar month. None with under SEASONAL_MIN_MONTHS months or nothing to test."""
    if len(series) < SEASONAL_MIN_MONTHS:
        return None
    x = [v for _ym, v in series]
    n = len(x)
    mx, my = (n - 1) / 2.0, sum(x) / n
    if my <= 0:
        return None
    sxx = sum((i - mx) ** 2 for i in range(n))
    slope = sum((i - mx) * (v - my) for i, v in enumerate(x)) / sxx
    fitted = [my + slope * (i - mx) for i in range(n)]
    base = fitted if min(fitted) > 0 else [my] * n
    ratios: Dict[int, List[float]] = {}
    for ((_y, m), v), f in zip(series, base):
        ratios.setdefault(m, []).append(v / f)
    groups = [g for g in ratios.values() if g]
    k = len(groups)
    total = sum(len(g) for g in groups)
    df1, df2 = k - 1, total - k
    if df1 < 1 or df2 < 1:
        return None
    grand = sum(sum(g) for g in groups) / total
    ssb = sum(len(g) * (sum(g) / len(g) - grand) ** 2 for g in groups)
    ssw = sum(sum((v - sum(g) / len(g)) ** 2 for v in g) for g in groups)
    if ssw <= 1e-18:
        f = math.inf if ssb > 1e-18 else 0.0
    else:
        f = (ssb / df1) / (ssw / df2)
    p = f_test_p_value(f, df1, df2)
    return dict(f_stat=None if math.isinf(f) else round(f, 3), df=(df1, df2), p_value=round(p, 6),
                significant=p < SEASONAL_ALPHA, alpha=SEASONAL_ALPHA)


def trend(values: List[float]) -> Dict[str, Any]:
    """Least-squares slope per month over the values given, with its t-statistic."""
    n = len(values)
    if n < TREND_MIN_MONTHS:
        return dict(slope=0.0, t_stat=None, months=n, significant=False)
    xs = list(range(n))
    mx, my = (n - 1) / 2.0, sum(values) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, values)) / sxx
    intercept = my - slope * mx
    sse = sum((y - (intercept + slope * x)) ** 2 for x, y in zip(xs, values))
    if sse <= 1e-12:
        t_stat = math.inf if abs(slope) > 1e-12 else 0.0
    else:
        se = math.sqrt(sse / (n - 2) / sxx)
        t_stat = slope / se if se > 0 else 0.0
    return dict(slope=slope, t_stat=t_stat, months=n, significant=abs(t_stat) >= TREND_T_THRESHOLD and abs(slope) > 1e-9)


def damped_steps(h: int, phi: float = TREND_DAMPING) -> float:
    """phi + phi^2 + ... + phi^h: how many months of slope a forecast h months ahead carries under a damped trend."""
    return sum(phi ** k for k in range(1, max(0, h) + 1))


def _series_baseline(state: Any, name: str, hist_field: str, monthly_field: str, source_key: str, as_of: date) -> Dict[str, Any]:
    history = complete_months(getattr(state, hist_field, None), as_of)
    sources = getattr(state, "figure_sources", None) or {}
    stated = float(getattr(state, monthly_field, 0.0) or 0.0)
    s_test = seasonality_test(history)
    seasonal = seasonal_indices(history) if (s_test and s_test["significant"]) else None

    def deseason(ym_v):
        (_y, m), v = ym_v
        return v / seasonal[m] if seasonal and seasonal.get(m) else v

    adjusted = [deseason(p) for p in history]
    if sources.get(source_key):
        level, source, months_used = stated, f"shared figure: {sources[source_key]}", None
        if seasonal and history:                           # a recent-months figure carries those months' season
            recent = [seasonal[m] for (_y, m), _v in history[-LEVEL_MONTHS:]]
            level = level / (sum(recent) / len(recent)) if recent and sum(recent) > 0 else level
    elif history:
        recent = adjusted[-LEVEL_MONTHS:]
        level = sum(recent) / len(recent)
        months_used = [f"{y:04d}-{m:02d}" for (y, m), _v in history[-LEVEL_MONTHS:]]
        source = f"average of the last {len(recent)} complete month{'s' if len(recent) != 1 else ''} on record"
    else:
        level, source, months_used = stated, "monthly figure sent with the request (no monthly history)", None

    tr = trend(adjusted[-TREND_WINDOW:])
    slope = tr["slope"] if tr["significant"] else 0.0
    return dict(
        series=name,
        level=round(max(0.0, level), 2),
        source=source,
        months_used=months_used,
        complete_months_on_record=len(history),
        trend_per_month=round(slope, 2),
        trend_pct_per_month=round(slope / level * 100, 2) if level > 0 and slope else 0.0,
        trend_t_stat=None if tr["t_stat"] is None else (round(tr["t_stat"], 2) if math.isfinite(tr["t_stat"]) else None),
        trend_applied=bool(slope),
        trend_note=("not enough complete months (6 needed)" if tr["months"] < TREND_MIN_MONTHS
                    else "applied (statistically significant), damped" if slope
                    else "no significant trend"),
        seasonality_applied=seasonal is not None,
        seasonal_indices=seasonal,
        seasonality_test=s_test,
        seasonality_note=("applied (statistically significant seasonal pattern)" if seasonal is not None
                          else f"not applied ({SEASONAL_MIN_MONTHS} complete months needed, {len(history)} on record)" if s_test is None
                          else "not applied (no statistically significant seasonal pattern)"),
    )


def build_baseline(state: Any, as_of: Optional[date]) -> Dict[str, Any]:
    """Baseline drivers for each series. Without `as_of` (direct calls, older tests) the state's monthly figures are used
    as they are, flat: the Phase 0 behaviour."""
    if as_of is None:
        out = {name: dict(series=name, level=round(float(getattr(state, mf, 0.0) or 0.0), 2),
                           source="monthly figure sent with the request", months_used=None, complete_months_on_record=0,
                           trend_per_month=0.0, trend_pct_per_month=0.0, trend_t_stat=None, trend_applied=False,
                           trend_note="not assessed (no date given)", seasonality_applied=False, seasonal_indices=None,
                           seasonality_note="not assessed (no date given)")
                for name, _hf, mf, _sk in SERIES}
    else:
        out = {name: _series_baseline(state, name, hf, mf, sk, as_of) for name, hf, mf, sk in SERIES}
    # Operating expenses: when the request only carries a total, expenses are total costs less cost of sales
    if out["expenses"]["level"] == 0 and (as_of is None or not getattr(state, "expenses_by_month", None)):
        total = float(getattr(state, "costs_monthly", 0.0) or 0.0)
        out["expenses"]["level"] = round(max(total - out["cost_of_sales"]["level"], 0.0), 2)
        if out["expenses"]["level"]:
            out["expenses"]["source"] = "total monthly costs less cost of sales"
    return out


def value_in_month(series: Dict[str, Any], as_of: Optional[date], month_index: int) -> float:
    """The series' baseline value in projection month `month_index` (0 = the rest of this month, 1 = next month...)."""
    level = float(series["level"])
    v = level + float(series.get("trend_per_month") or 0.0) * damped_steps(month_index + 2)
    if series.get("seasonality_applied") and series.get("seasonal_indices") and as_of is not None:
        _y, m = add_months(as_of.year, as_of.month, month_index)
        idx = series["seasonal_indices"].get(m) or series["seasonal_indices"].get(str(m)) or 1.0
        v *= float(idx)
    return max(0.0, v)


# ---------------------------------------------------------------------------------------------------------------------
# Phase 3: how well the baseline method would have forecast the business's own past (backtest)
# ---------------------------------------------------------------------------------------------------------------------

def backtest(history: Dict[str, Any] | None, as_of: date, holdout: int = 3, min_train: int = 3) -> Optional[Dict[str, Any]]:
    """Rolling-origin backtest of the baseline method on one series: for each of the last `holdout` complete months, the
    method is fitted on the months before it only, and its forecast is compared with what actually happened.

    Reports WAPE (total absolute error / total actual), bias (sum of errors / total actual; positive = forecast too high)
    and the same for the naive method ("next month = last month") so the method's skill can be judged. None when there
    are too few complete months."""
    series = complete_months(history, as_of)
    if len(series) < min_train + 1:
        return None
    holdout = min(holdout, len(series) - min_train)
    rows = []
    for k in range(len(series) - holdout, len(series)):
        (y, m), actual = series[k]
        train = {f"{yy:04d}-{mm:02d}": v for (yy, mm), v in series[:k]}

        class _S:  # a minimal state holding only the training history
            revenue_by_month = train
            revenue_monthly = 0.0
            figure_sources: Dict[str, str] = {}

        fitted = _series_baseline(_S, "revenue", "revenue_by_month", "revenue_monthly", "revenue_monthly", date(y, m, 1))
        # The test month is the month "today" falls in for this fit: projection index 0, as in a live run
        forecast = value_in_month(fitted, date(y, m, 1), 0)
        naive = series[k - 1][1]
        rows.append(dict(month=f"{y:04d}-{m:02d}", actual=round(actual, 2), forecast=round(forecast, 2), naive=round(naive, 2)))
    total_actual = sum(r["actual"] for r in rows)
    if total_actual <= 0:
        return dict(months=rows, wape_pct=None, bias_pct=None, naive_wape_pct=None, skill=None,
                    note="No actual revenue in the test months, so accuracy can't be measured.")
    wape = sum(abs(r["forecast"] - r["actual"]) for r in rows) / total_actual * 100
    bias = sum(r["forecast"] - r["actual"] for r in rows) / total_actual * 100
    naive_wape = sum(abs(r["naive"] - r["actual"]) for r in rows) / total_actual * 100
    return dict(
        months=rows,
        wape_pct=round(wape, 1),
        bias_pct=round(bias, 1),
        naive_wape_pct=round(naive_wape, 1),
        skill=("better than the naive method" if wape < naive_wape - 0.05
               else "worse than the naive method" if wape > naive_wape + 0.05 else "same as the naive method"),
        note=f"Each of the last {len(rows)} complete months forecast from the months before it only.",
    )
