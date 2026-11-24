import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { formatCurrency } from "../../lib/format";

// The records behind a dashboard figure: opened by clicking its tile.
const day = (at) => (at ? new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const SEVERITY = { high: "bg-rose-50 text-rose-700 ring-rose-200", medium: "bg-amber-50 text-amber-700 ring-amber-200" };

export default function KpiDetails({ title, value, detail, locked = false, currency, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!detail && !locked) return null;
  const money = (n) => formatCurrency(n, currency, "en-GB");
  const rows = detail?.rows || [];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="kpi-details-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 id="kpi-details-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-950 dark:text-slate-100">{value}</p>
            {detail?.explain && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{detail.explain}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {locked ? (
            <div className="py-6 text-center">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">See what makes up this figure</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">The invoices, payments, expenses and risks behind each dashboard figure are available on Starter and above.</p>
              <Link to="/pricing" onClick={onClose} className="mt-4 inline-flex rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Upgrade</Link>
            </div>
          ) : detail.risks ? (
            detail.risks.length ? (
              <ul className="space-y-3">
                {detail.risks.map((r, i) => (
                  <li key={r.key || i} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{r.label}</span>
                      {r.severity && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${SEVERITY[r.severity] || "bg-slate-50 text-slate-600 ring-slate-200"}`}>{r.severity}</span>}
                    </div>
                    {r.details?.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                        {r.details.map((d) => <li key={d}>{d}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="py-6 text-center text-sm text-slate-400">No risks open right now.</p>
          ) : rows.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{r.party}{r.ref ? <span className="font-normal text-slate-400"> · {r.ref}</span> : null}</div>
                    <div className={`text-xs ${r.overdue ? "font-semibold text-rose-600" : "text-slate-500 dark:text-slate-400"}`}>{r.note}{r.at ? `, ${day(r.at)}` : ""}</div>
                  </div>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${r.amount < 0 ? "text-rose-600" : "text-slate-900 dark:text-slate-100"}`}>{money(r.amount)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="py-6 text-center text-sm text-slate-400">Nothing recorded for this period.</p>}
        </div>

        {!locked && <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
          {detail.rows ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">{rows.length} record{rows.length === 1 ? "" : "s"}, total <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{money(detail.total)}</span></span>
          ) : <span />}
          {detail.link && <Link to={detail.link.to} onClick={onClose} className="text-sm font-semibold text-brand-600 hover:text-brand-700">{detail.link.label}</Link>}
        </div>}
      </div>
    </div>,
    document.body,
  );
}
