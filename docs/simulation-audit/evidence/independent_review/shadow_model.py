"""Shadow model: the projection rebuilt from docs/simulation-audit/MODEL.md ONLY (sections 3, 4, 5 and 7).

It imports nothing from the application. Where MODEL.md does not say exactly what to do, the reading taken here is marked
READING (n); each is listed in 06-independent-review.md as a place where the specification needed to be sharper.

Scope: the projection without a date (MODEL.md section 3: "no period 0 and the monthly figures are used flat"), the
baseline method with a date (section 4), and the verdict (section 7). Not rebuilt: VAT, the 13-week view, payment delay,
launch, contractor and fixed-cost scenarios (covered by the application's own hand-calculated tests).
"""
from __future__ import annotations

import math

DEFAULT_TERMS = 30          # section 6
DEFAULT_ELASTICITY = -1.0   # section 6: price sensitivity 1.0
DEFAULT_ONCOST = 0.15       # section 6
PHI = 0.9                   # section 4


# ── Section 4: baseline ──────────────────────────────────────────────────────────────────────────────────────────────

def _months_before(history: dict, year: int, month: int) -> list:
    """Complete months only, first on record to last before (year, month), gaps as 0."""
    pts = {}
    for k, v in history.items():
        y, m = int(k[:4]), int(k[5:7])
        if (y, m) < (year, month):
            pts[(y, m)] = pts.get((y, m), 0.0) + float(v)
    if not pts:
        return []
    out, (y, m) = [], min(pts)
    ly, lm = (year, month - 1) if month > 1 else (year - 1, 12)
    while (y, m) <= (ly, lm):
        out.append(((y, m), pts.get((y, m), 0.0)))
        y, m = (y, m + 1) if m < 12 else (y + 1, 1)
    return out


def _f_pvalue(f: float, d1: int, d2: int) -> float:
    """P(F >= f), by numerical integration of the F density (Simpson's rule on a transformed variable). Written
    independently of the application's continued-fraction method, so each checks the other."""
    if f == float("inf"):
        return 0.0
    if f <= 0:
        return 1.0
    lc = math.lgamma((d1 + d2) / 2) - math.lgamma(d1 / 2) - math.lgamma(d2 / 2) + (d1 / 2) * math.log(d1 / d2)

    def dens(x):
        if x <= 0:
            return 0.0
        return math.exp(lc + (d1 / 2 - 1) * math.log(x) - ((d1 + d2) / 2) * math.log(1 + d1 * x / d2))
    # P(F > f) = integral over u in (0, 1] of dens(f + (1-u)/u) / u^2 du   (x = f + (1-u)/u)
    n = 4000
    h = 1.0 / n
    total = 0.0
    for i in range(n + 1):
        u = max(i * h, 1e-12)
        x = f + (1 - u) / u
        g = dens(x) / (u * u)
        w = 1 if i in (0, n) else (4 if i % 2 else 2)
        total += w * g
    return min(1.0, max(0.0, total * h / 3))


def _seasonality_significant(series: list) -> bool:
    """MODEL.md section 4 (1.3): F-test for stable seasonality at 1%: values divided by a straight-line trend through the
    whole series (by the mean if the line is not positive everywhere), one-way analysis of variance by calendar month."""
    x = [v for _k, v in series]
    n = len(x)
    my = sum(x) / n
    if my <= 0:
        return False
    mx = (n - 1) / 2
    sxx = sum((i - mx) ** 2 for i in range(n))
    b = sum((i - mx) * (v - my) for i, v in enumerate(x)) / sxx
    line = [my + b * (i - mx) for i in range(n)]
    if min(line) <= 0:
        line = [my] * n
    groups = {}
    for (k, v), t in zip(series, line):
        groups.setdefault(k[1], []).append(v / t)
    g = list(groups.values())
    k, N = len(g), sum(len(x) for x in g)
    if k < 2 or N - k < 1:
        return False
    grand = sum(sum(x) for x in g) / N
    ssb = sum(len(x) * (sum(x) / len(x) - grand) ** 2 for x in g)
    ssw = sum(sum((v - sum(x) / len(x)) ** 2 for v in x) for x in g)
    f = float("inf") if ssw <= 1e-18 and ssb > 1e-18 else (0.0 if ssw <= 1e-18 else (ssb / (k - 1)) / (ssw / (N - k)))
    return _f_pvalue(f, k - 1, N - k) < 0.01


def _seasonal(series: list):
    if len(series) < 24:
        return None
    if not _seasonality_significant(series):          # model 1.3
        return None
    x = [v for _k, v in series]
    r = {m: [] for m in range(1, 13)}
    for t in range(6, len(x) - 6):
        cma = (0.5 * x[t - 6] + sum(x[t - 5:t + 6]) + 0.5 * x[t + 6]) / 12
        if cma > 0:
            r[series[t][0][1]].append(x[t] / cma)
    if any(not v for v in r.values()):
        return None
    raw = {m: sum(v) / len(v) for m, v in r.items()}
    mean = sum(raw.values()) / 12
    return {m: v / mean for m, v in raw.items()}


def _ols(vals: list):
    n = len(vals)
    if n < 6:
        return 0.0
    mx, my = (n - 1) / 2, sum(vals) / n
    sxx = sum((i - mx) ** 2 for i in range(n))
    b = sum((i - mx) * (v - my) for i, v in enumerate(vals)) / sxx
    a = my - b * mx
    sse = sum((v - (a + b * i)) ** 2 for i, v in enumerate(vals))
    if sse <= 1e-12:
        return b
    t = b / math.sqrt(sse / (n - 2) / sxx)
    return b if abs(t) >= 2 else 0.0


def baseline_forecast(history: dict, year: int, month: int, horizon: int) -> list:
    """Forecast for projection months 1..horizon (calendar months after (year, month)); level = mean of the last 3
    deseasonalised complete months; value = (level + slope * sum_{k=1..m+2} phi^k) * index."""
    series = _months_before(history, year, month)
    if not series:
        return [0.0] * horizon
    idx = _seasonal(series)
    adj = [v / idx[k[1]] if idx and idx[k[1]] else v for k, v in series]      # READING (5): a zero index leaves the month as it is
    level = sum(adj[-3:]) / len(adj[-3:])
    slope = _ols(adj[-12:])
    out = []
    for m in range(1, horizon + 1):
        v = level + slope * sum(PHI ** k for k in range(1, m + 3))
        cm = (month - 1 + m) % 12 + 1
        if idx:
            v *= idx[cm]
        out.append(max(0.0, v))
    return out


# ── Section 5: projection without a date ─────────────────────────────────────────────────────────────────────────────

def _progress(m: int, ramp: int) -> float:
    # READING (1): "progress" over a ramp of r months = min(1, m / r) in projection month m (m = 1, 2, ...).
    return min(1.0, m / max(1, ramp))


def _cycle_months(days) -> int:
    # READING (2): "the sales cycle in months (1-3)" = ceil(days / 30), kept within 1..3; no cycle given = 1.
    if not days:
        return 1
    return max(1, min(3, math.ceil(days / 30)))


def monthly_values(s: dict, kind: str, p: dict, m: int):
    R, C, E = s["revenue_monthly"], s["cost_of_sales_monthly"], s["expenses_monthly"]
    if kind in ("client_loss", "revenue_drop"):
        pct = (p.get("client_loss_pct") if kind == "client_loss" else p.get("revenue_drop_pct")) or 0
        ramp = _cycle_months(s.get("sales_cycle_days"))
        if kind == "client_loss":
            ramp = max(2, ramp)
        f = 1 - pct / 100 * _progress(m, ramp)
        return R * f, C * f, E
    if kind == "price_change":
        e = p.get("price_elasticity")
        e = DEFAULT_ELASTICITY if e is None else e
        # READING (3), as clarified in review: the price ramp is the sales cycle in months, capped at 2.
        P = 1 + (p.get("price_change_pct") or 0) / 100 * _progress(m, min(2, _cycle_months(s.get("sales_cycle_days"))))
        q = P ** e
        return R * P * q, C * q, E
    if kind == "cost_increase":
        f = 1 + (p.get("cost_increase_pct") or 0) / 100 * _progress(m, 2)
        return R, C * f, E * f
    if kind == "hire_staff":
        n, pay = p.get("employee_count") or 0, p.get("employee_monthly_cost") or 0
        on = DEFAULT_ONCOST if p.get("employer_oncost_pct") is None else p["employer_oncost_pct"] / 100
        start = p.get("start_month") or 1
        if m < start:
            return R, C, E
        extra_r = n * (p.get("revenue_per_hire_monthly") or 0) * min(1.0, (m - start + 1) / (p.get("ramp_months") or 3))
        ratio = C / R if R else 0.0
        return R + extra_r, C + extra_r * ratio, E + n * pay * (1 + on)
    return R, C, E


def project(s: dict, kind: str, p: dict, months: int) -> dict:
    terms = s.get("payment_terms_days")
    terms = DEFAULT_TERMS if terms is None else terms
    lag = terms / 30
    whole, frac = int(math.floor(lag)), lag - math.floor(lag)
    rate = (s.get("profit_tax_rate_pct") or 0) / 100
    pay_month = s.get("tax_payment_month")
    cash = s["starting_cash"]
    recv = sum(s.get("pending_receivables_schedule") or [])
    payables = sum(s.get("pending_payables_schedule") or [])
    loan = s.get("existing_loan_balance") or 0.0
    l_rate = (s.get("existing_loan_annual_rate_pct") or 0) / 100 / 12
    l_pay = s.get("existing_loan_monthly_repayment")
    # New loan (take_loan): annuity from the month after it is received.
    nl_amt = p.get("loan_amount") or 0.0 if kind == "take_loan" else 0.0
    nl_start = p.get("loan_start_month") or 1
    nl_i = (p.get("loan_annual_rate_pct") or 0) / 100 / 12
    nl_n = p.get("loan_term_months") or 12
    nl_A = (nl_amt * nl_i / (1 - (1 + nl_i) ** -nl_n)) if nl_amt and nl_i else (nl_amt / nl_n if nl_amt else 0.0)
    new_loan = 0.0

    due_in = {}
    for i, a in enumerate(s.get("pending_receivables_schedule") or []):
        # READING (4), as clarified in review: index 0 = this month (and overdue), index i = i calendar months ahead;
        # with no date there is no period 0, so index 0 joins index 1 in projection month 1.
        due_in[max(1, i)] = due_in.get(max(1, i), 0.0) + a
    due_out = {}
    for i, a in enumerate(s.get("pending_payables_schedule") or []):
        due_out[max(1, i)] = due_out.get(max(1, i), 0.0) + a
    tax_set, tax_owed, cum_pbt, cum_profit = 0.0, 0.0, 0.0, 0.0
    rows, first_neg, min_cash = [], None, None
    for m in range(1, months + 1):
        r, c, e = monthly_values(s, kind, p, m)
        if recruit := (kind == "hire_staff" and m == (p.get("start_month") or 1)):
            e += (p.get("employee_count") or 0) * (p.get("recruitment_cost_per_hire") or 0)
        # loans
        interest = loan * l_rate                              # existing loan: interest is a cost
        ex_pr = min(loan, max(0.0, l_pay - interest)) if (loan > 0 and l_pay) else 0.0
        loan -= ex_pr
        principal = ex_pr
        loan_in = 0.0
        if kind == "take_loan" and m == nl_start:
            loan_in, new_loan = nl_amt, nl_amt
        elif kind == "take_loan" and new_loan > 0 and m > nl_start:
            ni = new_loan * nl_i
            interest += ni
            pr = min(new_loan, nl_A - ni)
            principal += pr
            new_loan -= pr
        # collections
        due_in[m + whole] = due_in.get(m + whole, 0.0) + r * (1 - frac)
        due_in[m + whole + 1] = due_in.get(m + whole + 1, 0.0) + r * frac
        collected = due_in.pop(m, 0.0)
        recv += r - collected
        paid_bills = due_out.pop(m, 0.0)
        payables -= paid_bills
        pbt = r - c - e - interest
        cum_pbt += pbt
        set_now = rate * max(0.0, cum_pbt) - tax_set
        tax_set += set_now
        tax_owed += set_now
        tax_paid = 0.0
        if pay_month and m == pay_month:
            tax_paid, tax_owed = tax_owed, 0.0
        profit = pbt - set_now
        cum_profit += profit
        cash += collected + loan_in - c - e - interest - principal - paid_bills - tax_paid
        min_cash = cash if min_cash is None else min(min_cash, cash)
        if cash < 0 and first_neg is None:
            first_neg = m
        rows.append(dict(month_index=m, revenue=r, cost_of_sales=c, expenses=e + interest + set_now, profit=profit, cash_balance=cash))
    return dict(rows=rows, closing_cash=cash, cumulative_profit=cum_profit, total_revenue=sum(x["revenue"] for x in rows),
                total_costs=sum(x["cost_of_sales"] + x["expenses"] for x in rows), closing_receivables=recv,
                closing_tax_owed=tax_owed, closing_loans=loan + new_loan, first_negative_cash_month=first_neg, min_cash=min_cash)


# ── Section 7: verdict ───────────────────────────────────────────────────────────────────────────────────────────────

def verdict(base: dict, scen: dict) -> str:
    mat = 0.01 * (base["total_revenue"] if base["total_revenue"] > 0 else base["total_costs"])
    net = lambda x: x["closing_cash"] - x["closing_loans"] - x["closing_tax_owed"]      # noqa: E731 (no VAT here)
    bn, sn = base["first_negative_cash_month"], scen["first_negative_cash_month"]
    if sn and not bn:
        return "worse"
    if bn and not sn:
        return "improved"
    dp, dc = scen["cumulative_profit"] - base["cumulative_profit"], net(scen) - net(base)
    lower, higher = (dp < -mat or dc < -mat), (dp > mat or dc > mat)
    if bn and sn and sn != bn:
        if sn < bn:
            return "worse"
        return "mixed" if lower else "improved"
    if lower and not higher:
        return "worse"
    if higher and not lower:
        return "improved"
    if higher and lower:
        return "mixed"
    return "no_material_change"
