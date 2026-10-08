import { useMemo, useState } from "react";

// Financial overview tiles with a click-to-expand breakdown of the records
// behind each figure. All totals are in the workspace currency.

const st = (v) => String(v || "").toLowerCase().trim();
const rawAmt = (r) => Number(r?.total_amount || r?.subtotal_amount || r?.amount || 0);
const expAmt = (e) => Number(e?.price || e?.total_amount || e?.amount || 0);

// Amount actually received on an invoice, in the invoice's own currency. Recorded payments win,
// then a partial paid_amount, otherwise a paid invoice is treated as fully received.
function receivedOf(i) {
  if (Array.isArray(i?.payments) && i.payments.length > 0) {
    return i.payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }
  return i?.payment_type === "partial" && i?.paid_amount != null ? Number(i.paid_amount) : rawAmt(i);
}

function costOfSales(i) {
  if (i?.cost_of_sales != null) return Number(i.cost_of_sales) || 0;
  return Array.isArray(i?.line_items)
    ? i.line_items.reduce((s, li) => s + (Number(li.qty) || 1) * Number(li.cost_of_sales || 0), 0)
    : 0;
}

function isoOf(cur) {
  const c = String(cur || "");
  return ((c.match(/\(([A-Z]{3})\)\s*$/) || c.match(/^([A-Z]{3})$/i) || [])[1] || c).toUpperCase();
}

const paidDate = (i) => (i.payments?.length > 0 ? i.payments[i.payments.length - 1].paid_at : null)
  || i.paid_at || i.delivered_at || i.issue_date || i.issued_at || i.created_at || null;
const expDate = (e) => e.date || e.expense_date || e.issue_date || e.issued_at || e.created_at || null;
const byRecent = (dateOf) => (a, b) => new Date(dateOf(b) || 0) - new Date(dateOf(a) || 0);
const fmtDate = (d) => (d && Number.isFinite(new Date(d).getTime()) ? new Date(d).toLocaleDateString() : "");

const TONE = { emerald: "text-emerald-600", rose: "text-rose-600", amber: "text-amber-600", slate: "text-slate-900 dark:text-slate-100" };

function statusPill(status, partial) {
  if (partial) return "bg-violet-50 text-violet-700";
  if (["paid", "signed", "received", "cash in"].includes(status)) return "bg-emerald-50 text-emerald-700";
  if (status === "cash out") return "bg-rose-50 text-rose-700";
  if (status === "delivered") return "bg-blue-50 text-blue-700";
  if (status === "pending") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-500";
}

export default function FinancialOverviewCards({ invoices = [], expenses = [], fxRates = {}, wsCurrency = "GBP", formatMoney }) {
  const [openType, setOpenType] = useState(null);

  const k = useMemo(() => {
    const wsIso = isoOf(wsCurrency || "GBP");
    const toWs = (amount, cur) => {
      const num = Number(amount || 0);
      const from = cur ? isoOf(cur) : "";
      if (!from || from === wsIso) return num;
      const rate = fxRates[from];
      return rate != null ? Math.round(num * rate * 100) / 100 : num;
    };

    const active = invoices.filter((i) => !i.archived);
    const activeExp = expenses.filter((e) => !e.archived);
    const paid = active.filter((i) => st(i.status) === "paid");
    const delivered = active.filter((i) => st(i.status) === "delivered");
    const paidExps = activeExp.filter((e) => st(e.status) === "paid");
    const unpaidExps = activeExp.filter((e) => st(e.status) !== "paid");
    const partial = paid.filter((i) => receivedOf(i) < rawAmt(i));
    const cosShare = (i) => {
      const total = rawAmt(i);
      return costOfSales(i) * (total > 0 ? receivedOf(i) / total : 1);
    };

    const paidRevenue = paid.reduce((s, i) => s + toWs(receivedOf(i), i.currency), 0);
    const paidExpTotal = paidExps.reduce((s, e) => s + toWs(expAmt(e), e.currency), 0);
    const paidCoS = paid.reduce((s, i) => s + toWs(cosShare(i), i.currency), 0);
    const revenuePaidTotal = paid.reduce((s, i) => s + toWs(rawAmt(i), i.currency), 0);
    const recDeliveredTotal = delivered.reduce((s, i) => s + toWs(rawAmt(i), i.currency), 0);
    const recPartialTotal = partial.reduce((s, i) => s + toWs(Math.max(0, rawAmt(i) - receivedOf(i)), i.currency), 0);

    const now = new Date();
    const thisMonth = (d) => {
      const dt = new Date(d || "");
      return Number.isFinite(dt.getTime()) && dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
    };
    const monthPaid = paid.filter((i) => thisMonth(paidDate(i))).sort(byRecent(paidDate));
    const monthlyRev = monthPaid.reduce((s, i) => s + toWs(receivedOf(i), i.currency), 0);
    const overdue = delivered.filter((i) => i.due_date && new Date(i.due_date) < now);

    // Rows for each breakdown: { id, name, detail, date, amount (workspace currency), status, partial }
    const invRow = (i, amount, extra) => {
      const isPartial = st(i.status) === "paid" && receivedOf(i) < rawAmt(i);
      return {
        id: i.id,
        name: i.customer_name || i.recipient || i.counterparty_name || "Invoice",
        detail: (Array.isArray(i.product_names) ? i.product_names.join(", ") : i.product_names) || i.product_name || i.description || "",
        date: i.due_date && st(i.status) !== "paid" ? `Due ${fmtDate(i.due_date)}` : fmtDate(paidDate(i)),
        amount: toWs(amount, i.currency),
        note: extra || null,
        status: isPartial ? "partial" : st(i.status) || "—",
        partial: isPartial,
      };
    };
    const money = (v, cur) => formatMoney(v, cur);
    const receivedNote = (i) => (receivedOf(i) < rawAmt(i) ? `${money(receivedOf(i), i.currency)} received of ${money(rawAmt(i), i.currency)}` : null);

    const cashRows = [
      ...paid.map((i) => ({ ...invRow(i, receivedOf(i)), id: `in-${i.id}`, date: fmtDate(paidDate(i)), status: "cash in", partial: false, _d: paidDate(i) })),
      ...paidExps.map((e) => ({
        id: `out-exp-${e.id}`,
        name: e.vendor_name || e.counterparty_name || e.description || "Expense",
        detail: e.description || e.expense_type || e.item || "Expense",
        date: fmtDate(expDate(e)),
        amount: -toWs(expAmt(e), e.currency),
        status: "cash out",
        _d: expDate(e),
      })),
      ...paid.filter((i) => cosShare(i) > 0).map((i) => ({
        ...invRow(i, 0), id: `out-cos-${i.id}`, detail: "Cost of sales", date: fmtDate(paidDate(i)),
        amount: -toWs(cosShare(i), i.currency), status: "cash out", partial: false, _d: paidDate(i),
      })),
    ].sort((a, b) => new Date(b._d || 0) - new Date(a._d || 0));

    const rows = {
      "kpi-arr": monthPaid.map((i) => invRow(i, receivedOf(i), receivedNote(i))),
      "kpi-mrr": monthPaid.map((i) => invRow(i, receivedOf(i), receivedNote(i))),
      "kpi-revenue": [...paid, ...delivered].sort(byRecent(paidDate)).map((i) => invRow(i, rawAmt(i))),
      "cash-balance": cashRows,
      "kpi-cos": paid.filter((i) => costOfSales(i) > 0).sort(byRecent(paidDate))
        .map((i) => invRow(i, cosShare(i), `on a ${money(rawAmt(i), i.currency)} invoice`)),
      "invoices-unpaid": [...delivered, ...partial].sort(byRecent(paidDate)).map((i) => {
        const isPaid = st(i.status) === "paid";
        return invRow(i, Math.max(0, rawAmt(i) - (isPaid ? receivedOf(i) : 0)),
          isPaid ? `${money(receivedOf(i), i.currency)} paid of ${money(rawAmt(i), i.currency)}` : null);
      }),
      "expenses-unpaid": unpaidExps.sort(byRecent(expDate)).map((e) => ({
        id: e.id,
        name: e.vendor_name || e.counterparty_name || e.description || "Expense",
        detail: e.description || e.expense_type || "",
        date: e.due_date ? `Due ${fmtDate(e.due_date)}` : fmtDate(expDate(e)),
        amount: toWs(expAmt(e), e.currency),
        status: st(e.status) || "pending",
      })),
      "invoices-overdue": overdue.sort(byRecent((i) => i.due_date)).map((i) => invRow(i, rawAmt(i))),
    };

    const arr = Number((monthlyRev * 12).toFixed(2));
    const totalRevenue = revenuePaidTotal + recDeliveredTotal;
    const cashBalance = paidRevenue - paidExpTotal - paidCoS;
    const pendingRec = recDeliveredTotal + recPartialTotal;
    const pendingPay = unpaidExps.reduce((s, e) => s + toWs(expAmt(e), e.currency), 0);

    const tiles = [
      { type: "kpi-arr", label: "Annual Recurring Revenue", value: money(arr), sub: "annualised from this month's run rate", tone: "slate",
        calc: `Monthly run rate ${money(monthlyRev)} × 12 months = ${money(arr)}` },
      { type: "kpi-revenue", label: "Revenue", value: money(totalRevenue), sub: "paid + delivered (accrual)", tone: "emerald",
        calc: `Paid invoices ${money(revenuePaidTotal)} + delivered, not yet paid ${money(recDeliveredTotal)} = ${money(totalRevenue)}` },
      { type: "kpi-mrr", label: "Monthly run rate", value: money(monthlyRev), sub: "from paid invoices this month", tone: "emerald",
        calc: `Cash received this month from paid invoices = ${money(monthlyRev)}` },
      { type: "cash-balance", label: "Cash", value: money(cashBalance), sub: "paid in − paid out − cost of sales", tone: cashBalance >= 0 ? "emerald" : "rose",
        calc: `Cash in ${money(paidRevenue)} − expenses paid ${money(paidExpTotal)} − cost of sales ${money(paidCoS)} = ${money(cashBalance)}` },
      { type: "kpi-cos", label: "Cost of Sales", value: money(paidCoS), sub: "from paid invoices", tone: paidCoS > 0 ? "amber" : "slate",
        calc: `Cost of sales on paid invoices, in proportion to the amount received = ${money(paidCoS)}` },
      { type: "invoices-unpaid", label: "Receivables", value: money(pendingRec), sub: `${delivered.length} delivered · ${partial.length} partial`, tone: pendingRec > 0 ? "amber" : "slate",
        calc: `Delivered invoices ${money(recDeliveredTotal)} + balance still owed on part-paid invoices ${money(recPartialTotal)} = ${money(pendingRec)}` },
      { type: "expenses-unpaid", label: "Pending payables", value: money(pendingPay), sub: `${unpaidExps.length} unpaid expense${unpaidExps.length !== 1 ? "s" : ""}`, tone: pendingPay > 0 ? "rose" : "slate",
        calc: `Total of unpaid expenses = ${money(pendingPay)}` },
      { type: "invoices-overdue", label: "Overdue invoices", value: overdue.length, sub: overdue.length > 0 ? "require immediate action" : "all within terms", tone: overdue.length > 0 ? "rose" : "emerald",
        calc: `Delivered invoices past their due date = ${overdue.length}` },
    ];
    return { tiles, rows };
  }, [invoices, expenses, fxRates, wsCurrency, formatMoney]);

  const open = k.tiles.find((t) => t.type === openType) || null;
  const openRows = open ? k.rows[open.type] || [] : [];

  return (
    <div className="space-y-3">
      <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Financial overview</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {k.tiles.map((t) => {
          const isOpen = openType === t.type;
          return (
            <button key={t.type} type="button" aria-expanded={isOpen}
              onClick={() => setOpenType(isOpen ? null : t.type)}
              className={`min-w-0 rounded-xl border bg-white p-4 text-left transition hover:shadow-md dark:bg-slate-900 ${isOpen ? "border-indigo-400 ring-1 ring-indigo-200" : "border-slate-200 hover:border-slate-300 dark:border-slate-800"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500">{t.label}</div>
                <svg className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </div>
              <div className={`mt-1.5 break-words text-lg font-bold leading-tight tabular-nums ${TONE[t.tone]}`}>{t.value}</div>
              <div className="mt-1 text-[11px] leading-snug text-slate-500">{t.sub}</div>
            </button>
          );
        })}
      </div>

      {open && (
        <div className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm dark:border-indigo-900/60 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {open.label}
              <span className="ml-1.5 font-normal text-slate-400">({openRows.length})</span>
            </span>
            <button type="button" onClick={() => setOpenType(null)} aria-label="Close details" className="text-slate-400 hover:text-slate-600">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px] tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{open.calc}</div>
          {openRows.length === 0 ? (
            <p className="text-[13px] italic text-slate-400">No records found.</p>
          ) : (
            <div className="max-h-64 divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
              {openRows.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{r.name}</div>
                    <div className="text-[11px] text-slate-400">{[r.detail, r.date, r.note].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatMoney(r.amount)}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusPill(r.status, r.partial)}`}>{r.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
