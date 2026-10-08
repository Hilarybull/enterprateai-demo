// Time-aware KPI figures for the Adaptive Dashboard: value for the selected
// range, change against the previous equal period, and a trend series.
// All amounts are converted to the workspace currency by the caller's `toWs`.

export const RANGES = [
  { key: "30d", label: "Last 30 days", days: 30, buckets: 10 },
  { key: "3m", label: "Last 3 months", days: 91, buckets: 12 },
  { key: "6m", label: "Last 6 months", days: 182, buckets: 12 },
  { key: "12m", label: "Last 12 months", days: 365, buckets: 12 },
];

const DAY = 86400000;
const st = (v) => String(v || "").toLowerCase().trim();
const NOT_RECEIVABLE = new Set(["", "draft", "disputed", "void", "voided", "cancelled", "canceled", "credited"]);
const total = (i) => Number(i?.total_amount || i?.subtotal_amount || i?.amount || 0);
const ms = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

function received(inv, at = Infinity) {
  if (Array.isArray(inv.payments) && inv.payments.length) {
    return inv.payments.reduce((s, p) => s + ((ms(p.paid_at) ?? 0) <= at ? Number(p.amount || 0) : 0), 0);
  }
  if (st(inv.status) !== "paid") return 0;
  const paidAt = ms(inv.paid_at) ?? ms(inv.updated_at) ?? ms(inv.created_at) ?? 0;
  if (paidAt > at) return 0;
  return inv.payment_type === "partial" && inv.paid_amount != null ? Number(inv.paid_amount) : total(inv);
}

const cosOf = (inv) => {
  if (inv.cost_of_sales != null) return Number(inv.cost_of_sales) || 0;
  return Array.isArray(inv.line_items) ? inv.line_items.reduce((s, li) => s + (Number(li.qty) || 1) * Number(li.cost_of_sales || 0), 0) : 0;
};
// When an invoice counted as revenue / became a receivable.
const issuedAt = (i) => ms(i.delivered_at) ?? ms(i.sent_at) ?? ms(i.issued_at) ?? ms(i.issue_date) ?? ms(i.created_at) ?? 0;
const paidAt = (i) => (i.payments?.length ? ms(i.payments[i.payments.length - 1].paid_at) : null) ?? ms(i.paid_at) ?? issuedAt(i);
const expAt = (e) => ms(e.date) ?? ms(e.expense_date) ?? ms(e.issue_date) ?? ms(e.created_at) ?? 0;
const expAmt = (e) => Number(e?.price || e?.total_amount || e?.amount || 0);

export function buildKpiTrends({ invoices = [], expenses = [], toWs, rangeKey = "3m", now = Date.now(), alertPct = 40 }) {
  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[1];
  const invs = invoices.filter((i) => !i.archived);
  const exps = expenses.filter((e) => !e.archived);
  const earning = invs.filter((i) => ["paid", "delivered"].includes(st(i.status)));
  const owed = invs.filter((i) => ["paid", "delivered", "sent"].includes(st(i.status)));
  const paidExps = exps.filter((e) => st(e.status) === "paid");

  // ── Flows: summed within a window ────────────────────────────────────────
  const revenueIn = (from, to) => earning.reduce((s, i) => {
    const t = st(i.status) === "paid" ? paidAt(i) : issuedAt(i);
    return t > from && t <= to ? s + toWs(total(i), i.currency) : s;
  }, 0);
  const costsIn = (from, to) =>
    exps.reduce((s, e) => (expAt(e) > from && expAt(e) <= to ? s + toWs(expAmt(e), e.currency) : s), 0)
    + invs.reduce((s, i) => {
      if (st(i.status) !== "paid") return s;
      const t = paidAt(i);
      const tot = total(i);
      return t > from && t <= to ? s + toWs(cosOf(i) * (tot > 0 ? received(i) / tot : 1), i.currency) : s;
    }, 0);

  // ── Positions: the balance as of a moment ────────────────────────────────
  const cashAt = (at) =>
    invs.reduce((s, i) => {
      const got = received(i, at);
      const tot = total(i);
      return s + toWs(got - cosOf(i) * (tot > 0 ? got / tot : 0), i.currency);
    }, 0) - paidExps.reduce((s, e) => (expAt(e) <= at ? s + toWs(expAmt(e), e.currency) : s), 0);
  // Receivables: what customers still owe on issued invoices (sent, delivered or part-paid),
  // including ones issued in the period and not yet paid. Drafts are not owed yet; disputed,
  // voided, cancelled and credited invoices are not being collected. Same rule as the server's
  // financial summary.
  const receivablesAt = (at) => invs.reduce((s, i) => {
    if (NOT_RECEIVABLE.has(st(i.status)) || i.disputed || issuedAt(i) > at) return s;
    return s + toWs(Math.max(0, total(i) - received(i, at)), i.currency);
  }, 0);
  const risksAt = (at) => {
    let n = 0;
    const by = {};
    earning.forEach((i) => {
      const t = st(i.status) === "paid" ? paidAt(i) : issuedAt(i);
      if (t <= at) {
        const name = String(i.customer_name || i.recipient || "Unknown").trim() || "Unknown";
        by[name] = (by[name] || 0) + toWs(total(i), i.currency);
      }
    });
    const shares = Object.values(by).sort((a, b) => b - a);
    const sum = shares.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      const top1 = (shares[0] / sum) * 100;
      const top2 = (((shares[0] || 0) + (shares[1] || 0)) / sum) * 100;
      if (top1 >= alertPct || (shares.length >= 2 && top2 >= Math.max(alertPct, 60))) n += 1;
    }
    const overdue = invs.some((i) => {
      const due = ms(i.due_date);
      return due != null && due < at && issuedAt(i) <= at && !["draft", "void", "voided", "cancelled", "canceled", "credited"].includes(st(i.status))
        && !i.disputed && total(i) - received(i, at) > 0.005;
    });
    if (overdue) n += 1;
    if (cashAt(at) < 0) n += 1;
    return n;
  };

  const start = now - range.days * DAY;
  const prevStart = start - range.days * DAY;
  const step = (range.days * DAY) / range.buckets;
  const edges = Array.from({ length: range.buckets }, (_, k) => start + step * (k + 1));
  const pct = (cur, prev) => (Math.abs(prev) < 0.005 ? null : ((cur - prev) / Math.abs(prev)) * 100);

  const flow = (fn) => {
    const value = fn(start, now);
    return { value, changePct: pct(value, fn(prevStart, start)), series: edges.map((e) => fn(e - step, e)) };
  };
  const position = (fn) => {
    const value = fn(now);
    return { value, changePct: pct(value, fn(start)), series: edges.map((e) => fn(e)) };
  };

  return {
    range,
    revenue: flow(revenueIn),
    cash: position(cashAt),
    costs: flow(costsIn),
    receivables: position(receivablesAt),
    risks: position(risksAt),
  };
}
