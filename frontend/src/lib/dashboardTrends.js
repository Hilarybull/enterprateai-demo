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

// ── What a figure is made of ─────────────────────────────────────────────
// The records behind each tile, worked out by the same rules as buildKpiTrends, so the rows add
// up to the figure shown. Rows: { id, kind, party, ref, at, amount, note, overdue }.
const INVOICES = "/operations?tab=Sales&sub=Invoices";
const EXPENSES = "/operations?tab=Transactions&sub=Expenses";

export function kpiBreakdown({ kind, invoices = [], expenses = [], toWs, rangeKey = "3m", now = Date.now(), alertPct = 40, refs = new Map(), risks = null }) {
  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[1];
  const start = now - range.days * DAY;
  const invs = invoices.filter((i) => !i.archived);
  const exps = expenses.filter((e) => !e.archived);
  const party = (r) => String(r.customer_name || r.recipient || r.vendor_name || r.party_name || "").trim() || "Unknown";
  const ref = (i) => refs.get(i.id) || i.invoice_number || i.reference || "";
  const expRef = (e) => String(e.description || e.item_name || e.category || e.reference || "").trim();
  const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0);
  const newestFirst = (rows) => rows.sort((a, b) => (b.at || 0) - (a.at || 0));
  const isPaid = (i) => st(i.status) === "paid";
  const outstanding = (i) => Math.max(0, total(i) - received(i, now));
  const overdueOf = (i) => {
    const due = ms(i.due_date);
    return due != null && due < now && !["draft", "void", "voided", "cancelled", "canceled", "credited"].includes(st(i.status))
      && !i.disputed && outstanding(i) > 0.005;
  };

  if (kind === "revenue") {
    const rows = invs.filter((i) => ["paid", "delivered"].includes(st(i.status))).flatMap((i) => {
      const at = isPaid(i) ? paidAt(i) : issuedAt(i);
      return at > start && at <= now ? [{ id: i.id, kind: "invoice", party: party(i), ref: ref(i), at, amount: toWs(total(i), i.currency),
        note: isPaid(i) ? "Paid" : "Delivered, not paid yet" }] : [];
    });
    return { rows: newestFirst(rows), total: sum(rows), range, link: { label: "Open invoices", to: INVOICES },
      explain: `Invoices paid or delivered in the ${range.label.toLowerCase()}.` };
  }
  if (kind === "costs") {
    const rows = [
      ...exps.flatMap((e) => (expAt(e) > start && expAt(e) <= now ? [{ id: e.id, kind: "expense", party: party(e), ref: expRef(e), at: expAt(e),
        amount: toWs(expAmt(e), e.currency), note: st(e.status) === "paid" ? "Expense, paid" : "Expense, not paid yet" }] : [])),
      ...invs.flatMap((i) => {
        if (!isPaid(i)) return [];
        const at = paidAt(i); const tot = total(i);
        const amount = toWs(cosOf(i) * (tot > 0 ? received(i) / tot : 1), i.currency);
        return at > start && at <= now && Math.abs(amount) > 0.005
          ? [{ id: `${i.id}-cos`, kind: "invoice", party: party(i), ref: ref(i), at, amount, note: "Cost of sales on a paid invoice" }] : [];
      }),
    ];
    return { rows: newestFirst(rows), total: sum(rows), range, link: { label: "Open expenses", to: EXPENSES },
      explain: `Expenses dated in the ${range.label.toLowerCase()}, plus the cost of sales on invoices paid in it.` };
  }
  if (kind === "cash") {
    const rows = [
      ...invs.flatMap((i) => {
        const got = received(i, now); const tot = total(i);
        if (got <= 0.005) return [];
        const cos = cosOf(i) * (tot > 0 ? got / tot : 0);
        return [{ id: i.id, kind: "invoice", party: party(i), ref: ref(i), at: paidAt(i), amount: toWs(got - cos, i.currency),
          note: cos > 0.005 ? "Received, less its cost of sales" : got < tot - 0.005 ? "Part paid" : "Received" }];
      }),
      ...exps.filter((e) => st(e.status) === "paid" && expAt(e) <= now).map((e) => ({ id: e.id, kind: "expense", party: party(e), ref: expRef(e),
        at: expAt(e), amount: -toWs(expAmt(e), e.currency), note: "Expense paid" })),
    ];
    return { rows: newestFirst(rows), total: sum(rows), range, link: { label: "Open invoices", to: INVOICES },
      explain: "Money received on invoices, less their cost of sales and the expenses you have paid, to date." };
  }
  if (kind === "receivables") {
    const rows = invs.flatMap((i) => {
      if (NOT_RECEIVABLE.has(st(i.status)) || i.disputed || issuedAt(i) > now) return [];
      const owed = outstanding(i);
      if (owed <= 0.005) return [];
      const due = ms(i.due_date);
      return [{ id: i.id, kind: "invoice", party: party(i), ref: ref(i), at: due ?? issuedAt(i), amount: toWs(owed, i.currency), overdue: overdueOf(i),
        note: overdueOf(i) ? "Overdue" : due != null ? "Due" : "Issued" }];
    });
    rows.sort((a, b) => (b.overdue - a.overdue) || ((a.at || 0) - (b.at || 0)));
    return { rows, total: sum(rows), range, link: { label: "Open invoices", to: INVOICES },
      explain: "What customers still owe on invoices sent, delivered or part paid. Overdue first, then by due date." };
  }
  if (kind === "risks") {
    const by = {};
    invs.filter((i) => ["paid", "delivered"].includes(st(i.status))).forEach((i) => {
      if ((isPaid(i) ? paidAt(i) : issuedAt(i)) <= now) by[party(i)] = (by[party(i)] || 0) + toWs(total(i), i.currency);
    });
    const shares = Object.entries(by).sort((a, b) => b[1] - a[1]);
    const all = shares.reduce((s, [, v]) => s + v, 0);
    const pctOf = (v) => Math.round((v / all) * 100);
    const top1 = all > 0 ? (shares[0][1] / all) * 100 : 0;
    const top2 = all > 0 ? ((shares[0][1] + (shares[1]?.[1] || 0)) / all) * 100 : 0;
    const overdue = invs.filter(overdueOf);
    const detail = {
      concentration: all > 0 ? shares.slice(0, 3).map(([name, v]) => `${name}: ${pctOf(v)}% of revenue`) : [],
      overdue: overdue.map((i) => `${ref(i) || "Invoice"} from ${party(i)}, due ${new Date(ms(i.due_date)).toLocaleDateString("en-GB")}`),
    };
    const computed = [];
    if (all > 0 && (top1 >= alertPct || (shares.length >= 2 && top2 >= Math.max(alertPct, 60))))
      computed.push({ key: "concentration", label: "Customer concentration", severity: "high" });
    if (overdue.length) computed.push({ key: "overdue", label: `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}`, severity: "medium" });
    const cashRows = kpiBreakdown({ kind: "cash", invoices, expenses, toWs, rangeKey, now, refs });
    if (cashRows.total < 0) computed.push({ key: "cash_negative", label: "Negative cash position", severity: "high" });
    const list = (Array.isArray(risks) ? risks : computed).map((r) => (typeof r === "string" ? { label: r } : r))
      .map((r) => ({ ...r, details: detail[r.key] || [] }));
    return { risks: list, range, link: { label: "Open invoices", to: INVOICES },
      explain: "Risks open now: customer concentration, overdue invoices, negative cash and short runway." };
  }
  return null;
}
