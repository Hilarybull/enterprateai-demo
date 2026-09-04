import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatCurrency } from "../lib/format";
import { getApiBaseUrl } from "../api/client";

function fmtDate(val) {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function InvoicePublicPage() {
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = params.get("t");
    const raw = params.get("d");

    if (token) {
      fetch(`${getApiBaseUrl()}/integrations/invoice-data/${token}`)
        .then(r => r.ok ? r.json() : null)
        .then(setData)
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    } else if (raw) {
      try { setData(JSON.parse(decodeURIComponent(atob(raw)))); } catch { setData(null); }
      setLoading(false);
    } else {
      setLoading(false);
    }
  }, [params]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-400">Loading invoice…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="text-2xl font-bold text-slate-400 mb-2">Invalid Link</div>
          <div className="text-sm text-slate-400">This invoice link is invalid or has expired.</div>
        </div>
      </div>
    );
  }

  const typeLabel = data.type === "invoice" ? "INVOICE" : data.type === "quote" ? "QUOTATION" : data.type?.toUpperCase() || "DOCUMENT";
  const cur = data.currency || "GBP";
  const totalAmt = Number(data.amount || 0);
  const payments = data.payments || [];
  const rawPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalPaid = rawPaid > 0 ? rawPaid : (data.paid_amount != null ? Number(data.paid_amount) : 0);
  const balanceDue = Math.max(0, totalAmt - totalPaid);

  return (
    <div className="min-h-screen bg-slate-100 flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header bar */}
        <div className="bg-indigo-600 px-8 py-5 flex justify-between items-center">
          <div className="text-white">
            <div className="text-lg font-bold">{data.workspaceName || "Business"}</div>
            <div className="text-indigo-200 text-xs mt-0.5">Issued by {data.workspaceName || ""}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-white tracking-widest">{typeLabel}</div>
            {data.ref && <div className="text-indigo-200 text-xs mt-0.5 font-mono">#{data.ref}</div>}
          </div>
        </div>

        <div className="px-8 py-8 space-y-8">
          {/* FROM | BILL TO */}
          <div className="flex justify-between items-start">
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">From</div>
              <div className="text-base font-semibold text-slate-900">{data.workspaceName || "—"}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Bill To</div>
              <div className="text-base font-semibold text-slate-900">{data.party || "—"}</div>
            </div>
          </div>
          {/* ISSUE DATE | DUE DATE or CURRENCY */}
          <div className="flex justify-between items-start">
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Issue Date</div>
              <div className="text-sm font-semibold text-slate-800">{fmtDate(data.issued_at)}</div>
            </div>
            <div className="text-right">
              {data.due_date ? (<>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Due Date</div>
                <div className="text-sm font-semibold text-slate-800">{fmtDate(data.due_date)}</div>
              </>) : (<>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Currency</div>
                <div className="text-sm font-semibold text-slate-800">{cur}</div>
              </>)}
            </div>
          </div>
          {/* PAYMENT TERMS — left, wrapping */}
          {data.payment_terms && (
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Payment Terms</div>
              <div className="text-sm font-semibold text-slate-800 break-words whitespace-pre-wrap">{data.payment_terms}</div>
            </div>
          )}

          {/* Line items */}
          {(() => {
            const items = Array.isArray(data.line_items) && data.line_items.length > 0 ? data.line_items : null;
            const sub = items ? items.reduce((s, i) => s + (Number(i.qty)||1)*(Number(i.unit_price)||0), 0) : totalAmt;
            const vatRate = Number(data.vat_rate) || 0;
            const vatTotal = sub * (vatRate / 100);
            return (<>
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Description</th>
                      <th className="px-3 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400 w-14">Qty</th>
                      <th className="px-3 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400 w-28">Unit Price</th>
                      <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400 w-28">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items ? items.map((item, i) => {
                      const lineTotal = (Number(item.qty)||1) * (Number(item.unit_price)||0);
                      return (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-5 py-3 text-slate-700">{item.description || "—"}</td>
                          <td className="px-3 py-3 text-center text-slate-500">{item.qty||1}×</td>
                          <td className="px-3 py-3 text-right text-slate-600">{formatCurrency(Number(item.unit_price)||0, cur)}</td>
                          <td className="px-5 py-3 text-right font-bold text-slate-900">{formatCurrency(lineTotal, cur)}</td>
                        </tr>
                      );
                    }) : (
                      <tr className="border-t border-slate-100">
                        <td className="px-5 py-4 text-slate-700">{data.description || "—"}</td>
                        <td colSpan={2}></td>
                        <td className="px-5 py-4 text-right font-bold text-slate-900">{formatCurrency(totalAmt, cur)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-slate-500 px-1"><span>Subtotal</span><span>{formatCurrency(sub, cur)}</span></div>
                {vatTotal > 0 && <div className="flex justify-between text-sm text-slate-500 px-1"><span>VAT ({vatRate}%)</span><span>{formatCurrency(vatTotal, cur)}</span></div>}
                {totalPaid > 0 && <div className="flex justify-between text-sm text-emerald-600 px-1"><span>Amount Received</span><span>{formatCurrency(totalPaid, cur)}</span></div>}
                <div className="flex justify-between items-center rounded-xl bg-indigo-50 border border-indigo-100 px-5 py-4">
                  <span className="text-base font-bold text-indigo-900">Balance Due</span>
                  <span className="text-xl font-bold text-indigo-700">{formatCurrency(balanceDue, cur)}</span>
                </div>
              </div>
            </>);
          })()}

          {/* Notes */}
          {data.notes && (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              {data.notes && (
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Notes</div>
                  <div className="text-sm text-slate-600 break-words whitespace-pre-wrap">{data.notes}</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 px-8 py-4 text-center text-xs text-slate-400">
          Generated by {data.workspaceName || "EnterprateAI"} · {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
        </div>
      </div>
    </div>
  );
}
