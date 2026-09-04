import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "../lib/format";
import { CURRENCY_CODES, currencyLabel } from "../lib/currencies";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { useWorkspaceStore } from "../store/workspace";
import { apiRequest } from "../api/client";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import { InboxTab, ActivityTab, RequestsTab } from "./ProposalsPage";
import { useProposalStore } from "../store/proposal";

function fmtMoney(n) {
  if (n == null || isNaN(n)) return "£0";
  const abs = Math.abs(n);
  const pre = n < 0 ? "-£" : "£";
  return `${pre}${abs.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d)) return s;
  const diff = Date.now() - d.getTime();
  if (diff < 86400000) return "Today";
  if (diff < 172800000) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function StatusPill({ status, paymentType }) {
  const s = (status || "").toLowerCase();
  if (s === "paid" && paymentType === "partial") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-orange-50 text-orange-600">
        <span className="h-1.5 w-1.5 rounded-full bg-orange-400 inline-block" />
        Partial
      </span>
    );
  }
  const styles = {
    active: "text-emerald-600 bg-emerald-50",
    paid: "text-emerald-600 bg-emerald-50",
    adopted: "text-emerald-600 bg-emerald-50",
    awarded: "text-emerald-600 bg-emerald-50",
    received: "text-emerald-600 bg-emerald-50",
    recorded: "text-emerald-600 bg-emerald-50",
    sent: "text-blue-600 bg-blue-50",
    published: "text-blue-600 bg-blue-50",
    submitted: "text-blue-600 bg-blue-50",
    viewed: "text-blue-600 bg-blue-50",
    ready: "text-blue-600 bg-blue-50",
    pending: "text-amber-600 bg-amber-50",
    "awaiting response": "text-amber-600 bg-amber-50",
    "receiving responses": "text-teal-600 bg-teal-50",
    "under evaluation": "text-amber-600 bg-amber-50",
    negotiation: "text-purple-600 bg-purple-50",
    "expiring soon": "text-orange-600 bg-orange-50",
    overdue: "text-rose-600 bg-rose-50",
    expired: "text-rose-600 bg-rose-50",
    draft: "text-slate-500 bg-slate-100",
    won: "text-emerald-600 bg-emerald-50",
    "awaiting approval": "text-amber-600 bg-amber-50",
    customer: "text-blue-600 bg-blue-50",
    vendor: "text-purple-600 bg-purple-50",
    invoice: "text-blue-600 bg-blue-50",
    expense: "text-amber-600 bg-amber-50",
    receipt: "text-emerald-600 bg-emerald-50",
  };
  const cls = styles[s] || "text-slate-500 bg-slate-100";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>
      {status || "Unknown"}
    </span>
  );
}

function ActionMenu({ items }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (dropRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleToggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const dropH = items.length * 36 + 8; // estimate dropdown height
      const spaceBelow = window.innerHeight - r.bottom;
      const flipUp = spaceBelow < dropH + 8 && r.top > dropH + 8;
      setPos({
        top: flipUp ? r.top - dropH - 4 : r.bottom + 4,
        right: window.innerWidth - r.right,
      });
    }
    setOpen(v => !v);
  }

  return (
    <div>
      <button ref={btnRef} type="button"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
        onClick={handleToggle} aria-label="More actions">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
        </svg>
      </button>
      {open && createPortal(
        <div ref={dropRef}
          style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
          className="w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {items.map(item => (
            <button key={item.label} type="button"
              onClick={() => { setOpen(false); item.onClick?.(); }}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium ${item.tone === "danger" ? "text-rose-600 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-100"}`}>
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function KpiCard({ icon, label, value, numColor = "text-slate-900", iconBg = "bg-blue-50", iconColor = "text-blue-600" }) {
  const str = String(value ?? "");
  const fontSize = str.length > 14 ? "text-base" : str.length > 10 ? "text-lg" : "text-2xl";
  return (
    <div className="flex flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 min-w-0">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconBg} ${iconColor}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-slate-500 truncate">{label}</div>
        <div className={`mt-0.5 font-bold leading-tight truncate ${fontSize} ${numColor}`}>{value}</div>
      </div>
    </div>
  );
}

function Pipeline({ stages }) {
  return (
    <div className="flex items-stretch gap-0 w-full overflow-x-auto">
      {stages.map((s, i) => {
        const isFirst = i === 0;
        const isLast = i === stages.length - 1;
        const clip = isFirst && isLast
          ? "none"
          : isFirst
          ? "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)"
          : isLast
          ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 12px 50%)"
          : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)";
        return (
          <div
            key={s.label}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-3 px-2 ${s.bg || "bg-slate-100"}`}
            style={{ clipPath: clip }}
          >
            <div className={`text-[11px] font-semibold ${s.textColor || "text-slate-500"} text-center leading-tight`}>{s.label}</div>
            <div className={`text-xl font-bold ${s.textColor || "text-slate-700"}`}>{s.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function IntelBox({ message, btnLabel, onBtn }) {
  return (
    <div className="flex flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-500">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
        </svg>
      </div>
      <p className="flex-1 text-xs text-slate-600 leading-relaxed">{message}</p>
      <button type="button" onClick={onBtn}
        className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition whitespace-nowrap">
        {btnLabel}
      </button>
    </div>
  );
}

function TableSection({ title, cols, rows, searchPlaceholder, emptyText = "No data yet", filterValues }) {
  const [q, setQ] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  let filtered = q ? rows.filter(r => Object.values(r).some(v => typeof v === "string" && v.toLowerCase().includes(q.toLowerCase()))) : rows;
  if (activeFilter) filtered = filtered.filter(r => (r._filter || "").toLowerCase() === activeFilter.toLowerCase());
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={searchPlaceholder || "Search..."} className="rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 w-44" />
          </div>
          {filterValues && filterValues.length > 0 ? (
            <div className="relative">
              <button type="button" onClick={() => setShowFilterMenu(v => !v)}
                className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${activeFilter ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="8" x2="20" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>
                {activeFilter ? activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1) : "Filter"}
              </button>
              {showFilterMenu && (
                <div className="absolute right-0 top-8 z-30 min-w-[140px] rounded-xl border border-slate-200 bg-white shadow-xl py-1">
                  <button onClick={() => { setActiveFilter(""); setShowFilterMenu(false); }}
                    className={`w-full px-4 py-2 text-left text-xs hover:bg-slate-50 ${!activeFilter ? "font-semibold text-indigo-600" : "text-slate-700"}`}>All</button>
                  {filterValues.map(v => (
                    <button key={v} onClick={() => { setActiveFilter(v); setShowFilterMenu(false); }}
                      className={`w-full px-4 py-2 text-left text-xs capitalize hover:bg-slate-50 ${activeFilter === v ? "font-semibold text-indigo-600" : "text-slate-700"}`}>{v}</button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {cols.map(c => <th key={c} className="px-4 py-2.5 text-left font-semibold text-slate-500">{c}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr><td colSpan={cols.length} className="px-4 py-8 text-center text-slate-400">{emptyText}</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/60">
                {cols.map(c => <td key={c} className="px-4 py-2.5 text-slate-700">{r[c]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const MAIN_TABS = ["Overview", "Sales", "Procurement", "Contracts", "Transactions", "Reports"];

function SubTabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-0 border-b border-slate-200">
      {tabs.map(t => (
        <button key={t} type="button" onClick={() => onChange(t)}
          className={`px-4 py-2.5 text-xs font-semibold transition border-b-2 -mb-px whitespace-nowrap
            ${active === t ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
          {t}
        </button>
      ))}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════
   MODULE-LEVEL: RecordModal (create / edit / view records)
   Must be module-level to avoid React re-mount bug.
═══════════════════════════════════════════════════════════ */
const STATUS_OPTIONS = {
  invoice: ["draft", "sent", "paid", "overdue", "delivered", "pending"],
  quote: ["draft", "sent", "viewed", "won", "rejected", "expired"],
  expense: ["pending", "paid", "overdue"],
  contract: ["draft", "pending", "active", "expiring_soon", "expired"],
};

function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text" }) {
  return (
    <input type={type} value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select value={value || ""} onChange={e => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300">
      <option value="">— Select —</option>
      {options.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1).replace(/_/g, " ")}</option>)}
    </select>
  );
}

function ShareModal({ record, type, workspaceName, customers, onClose }) {
  const typeLabel = type === "invoice" ? "Invoice" : type === "quote" ? "Quotation" : type === "expense" ? "Expense" : "Contract";
  const rawRef = record?.invoice_number || record?.reference || "";
  const ref = isUuidLike(rawRef) ? "" : rawRef;
  const party = record?.customer_name || record?.recipient || record?.vendor_name || record?.party_name || "";
  const amt = Number(record?.total_amount || record?.amount || record?.price || 0);
  const cur = record?.currency || "GBP";
  const fmtAmt = new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(amt);

  const customerEmail = (customers || []).find(c =>
    (c.name || c.company_name || "").toLowerCase() === (party || "").toLowerCase()
  )?.email || "";

  const [toEmail, setToEmail] = React.useState(customerEmail);
  const [linkCopied, setLinkCopied] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [sendErr, setSendErr] = React.useState("");
  const [shareToken, setShareToken] = React.useState(null);
  const [tokenLoading, setTokenLoading] = React.useState(true);

  const shareData = React.useRef({
    type, ref, party, workspaceName: workspaceName || "",
    amount: amt, currency: cur,
    issued_at: record?.issued_at || record?.issue_date || "",
    description: record?.description || record?.product_name || (Array.isArray(record?.product_names) ? record.product_names.join(", ") : record?.product_names) || "",
    payments: record?.payments || [],
    paid_amount: record?.paid_amount,
    payment_terms: record?.payment_terms || "",
    notes: record?.notes || "",
    line_items: record?.line_items || [],
    vat_rate: record?.vat_rate != null ? Number(record.vat_rate) : 0,
  });

  const fallbackUrl = `${window.location.origin}/invoice?d=${btoa(encodeURIComponent(JSON.stringify(shareData.current)))}`;
  const shareUrl = shareToken ? `${window.location.origin}/invoice?t=${shareToken}` : fallbackUrl;

  React.useEffect(() => {
    apiRequest("/integrations/invoice-link", "POST", { data: shareData.current })
      .then(res => { if (res?.token) setShareToken(res.token); })
      .catch(() => {})
      .finally(() => setTokenLoading(false));
  }, []);

  function copyLink() {
    if (navigator.clipboard) { navigator.clipboard.writeText(shareUrl).catch(() => {}); }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
  }

  async function sendEmail() {
    const emails = toEmail.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean);
    if (!emails.length || !emails[0].includes("@")) { setSendErr("Enter at least one valid email address."); return; }
    setSending(true); setSendErr("");
    try {
      await apiRequest("/integrations/share-invoice", "POST", {
        to_email: emails, share_url: shareUrl, ref,
        party, amount_fmt: fmtAmt, workspace_name: workspaceName || "",
        document_type: type,
      });
      setSent(true);
    } catch (e) {
      setSendErr(e?.message || "Failed to send. Please try again.");
    } finally { setSending(false); }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <div className="text-base font-bold text-slate-900">Share {typeLabel}</div>
            {ref && <div className="text-xs text-slate-500 mt-0.5">{ref} · {fmtAmt}</div>}
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {/* Link row */}
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-1.5">Shareable Link</div>
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
              {tokenLoading
                ? <span className="text-xs text-slate-300 flex-1">Generating link…</span>
                : <span className="text-xs text-slate-500 truncate flex-1 font-mono">{shareUrl}</span>}
              <button type="button" onClick={copyLink} disabled={tokenLoading}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${linkCopied ? "bg-emerald-100 text-emerald-700" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40"}`}>
                {linkCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          {/* Email send row */}
          {sent ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
              <svg className="h-4 w-4 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              <span className="text-sm font-medium text-emerald-700">Sent to {toEmail.split(/[\s,;]+/).filter(Boolean).join(", ")}</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-500">Send via Email</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={toEmail}
                  onChange={e => { setToEmail(e.target.value); setSendErr(""); }}
                  placeholder="email1@co.com, email2@co.com"
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <button type="button" onClick={sendEmail} disabled={sending}
                  className="shrink-0 flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition">
                  {sending
                    ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    : <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
                  Send
                </button>
              </div>
              {sendErr && <div className="text-xs text-rose-600">{sendErr}</div>}
              {customerEmail && toEmail !== customerEmail && (
                <button type="button" onClick={() => setToEmail(customerEmail)}
                  className="text-xs text-indigo-500 hover:underline">
                  Use {party}{"'"}s email: {customerEmail}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="border-t border-slate-100 px-6 py-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function RfqRespondModal({ rfq, wsCurrency, onClose, onDone }) {
  const [prices, setPrices] = useState(() => (rfq.items || []).map(item => ({ ...item, unit_price: "" })));
  const [validityDays, setValidityDays] = useState("30");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const sym = wsCurrency === "USD" ? "$" : wsCurrency === "EUR" ? "€" : "£";
  const subtotal = prices.reduce((s, p) => s + (Number(p.unit_price) || 0) * (Number(p.quantity) || 1), 0);

  async function handleRespond() {
    setSubmitting(true); setError(null);
    try {
      await apiRequest(`/marketplace/rfq/${rfq.id}/approve`, "POST", {
        validity_days: Number(validityDays) || 30,
        item_prices: prices.map(p => ({
          product_name: p.name,
          unit_price: Number(p.unit_price) || 0,
        })),
      });
      onDone && onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to respond to RFQ.");
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="ea-dialog relative z-10 w-full max-w-lg overflow-hidden rounded-2xl" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">Respond to RFQ</h3>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">From {rfq.customer_name || rfq.customer_email}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="ea-scroll overflow-y-auto px-5 py-4 space-y-4" style={{ maxHeight: "calc(90vh - 130px)" }}>
          {rfq.message && (
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-[12px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Message: </span>{rfq.message}
            </div>
          )}
          <div>
            <div className="mb-2 text-[12px] font-semibold text-slate-600 dark:text-slate-400">Set unit prices for each item</div>
            <div className="space-y-2">
              {prices.map((item, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex-1">
                    <div className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">{item.name || "Item"}</div>
                    <div className="text-[11px] text-slate-400">Qty: {item.quantity || 1}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[12px] text-slate-400">{sym}</span>
                    <input
                      type="number" min="0" step="0.01"
                      value={item.unit_price}
                      onChange={e => setPrices(p => p.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x))}
                      placeholder="0.00"
                      className="w-24 rounded-lg border border-slate-200 bg-transparent px-2 py-1 text-[12px] text-right text-slate-800 focus:border-brand-400 focus:outline-none dark:border-slate-600 dark:text-slate-200"
                    />
                  </div>
                  <div className="w-20 text-right text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                    {sym}{((Number(item.unit_price) || 0) * (Number(item.quantity) || 1)).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-[12px] text-slate-500 dark:text-slate-400">
              Quote valid for
              <input type="number" min="1" max="365" value={validityDays} onChange={e => setValidityDays(e.target.value)}
                className="mx-2 w-14 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-center dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
              days
            </div>
            <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100">
              Total: {sym}{subtotal.toFixed(2)}
            </div>
          </div>
          {error && <p className="text-[12px] text-red-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
          <button disabled={submitting} onClick={handleRespond}
            className="rounded-xl bg-brand-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-brand-700 disabled:opacity-50">
            {submitting ? "Sending Quote…" : "Send Quote"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function RecordPaymentModal({ invoice, onRecord, onClose }) {
  const total = Number(invoice?.total_amount || invoice?.amount || 0);
  const paymentsTotal = (invoice?.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  const legacyPaid = paymentsTotal === 0 && invoice?.payment_type === "partial" ? Number(invoice?.paid_amount || 0) : 0;
  const alreadyPaid = paymentsTotal + legacyPaid;
  const remaining = Math.max(0, total - alreadyPaid);
  const [amount, setAmount] = React.useState(String(remaining > 0 ? remaining : ""));
  const [paidAt, setPaidAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = React.useState("");
  const [err, setErr] = React.useState("");
  function handleSubmit() {
    const n = Number(amount);
    if (!n || n <= 0) { setErr("Enter a valid payment amount."); return; }
    if (n > remaining + 0.01) { setErr(`Amount exceeds remaining balance of ${formatCurrency(remaining, invoice?.currency || "GBP")}.`); return; }
    onRecord(invoice.id, n, paidAt, note);
    onClose();
  }
  const thisPayment = Number(amount) || 0;
  const newRemaining = Math.max(0, remaining - thisPayment);
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="text-base font-bold text-slate-900">Record Payment</div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl bg-slate-50 p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Total</span>
              <span className="text-sm font-semibold text-slate-800">{formatCurrency(total, invoice?.currency || "GBP")}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Received</span>
              <span className="text-sm font-semibold text-emerald-600">{formatCurrency(alreadyPaid, invoice?.currency || "GBP")}</span>
            </div>
            <div className="flex justify-between items-center border-t border-slate-200 pt-2">
              <span className="text-xs font-medium text-slate-600">Remaining</span>
              <span className="text-sm font-bold text-rose-600">{formatCurrency(remaining, invoice?.currency || "GBP")}</span>
            </div>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Payment Amount</label>
            <input type="number" value={amount} onChange={e => { setAmount(e.target.value); setErr(""); }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="0.00" min="0" step="0.01" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Date Received</label>
            <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Note (optional)</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="e.g. Bank transfer, partial payment..." />
          </div>
          {thisPayment > 0 && (
            <div className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
              After this payment: <span className="font-semibold">{formatCurrency(newRemaining, invoice?.currency || "GBP")}</span> remaining
              {newRemaining === 0 && <span className="block mt-0.5 font-semibold">Invoice will be marked Paid</span>}
            </div>
          )}
          {err && <div className="text-xs text-rose-600">{err}</div>}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-xl border border-slate-200 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={handleSubmit}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Record Payment</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function RecordDeliveryModal({ invoice, onRecord, onClose }) {
  const [deliveredAt, setDeliveredAt] = React.useState(new Date().toISOString().slice(0, 10));
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xs rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="text-base font-bold text-slate-900">Mark as Delivered</div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="text-sm text-slate-600">
            Enter the date the goods or service were delivered to <span className="font-semibold text-slate-800">{invoice?.customer_name || "the customer"}</span>.
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Delivery Date</label>
            <input type="date" value={deliveredAt} onChange={e => setDeliveredAt(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-xl border border-slate-200 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => { onRecord(invoice.id, deliveredAt); onClose(); }}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Confirm Delivery</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function RecordModal({ mode, type, record, customers, catalogueProducts = [], allKnownCustomers, workspaceName, onSave, onClose, onRecordPayment, refLabel, nextRef, receiptMode }) {
  const isView = mode === "view";
  const title = isView ? "View " : (mode === "edit" ? "Edit " : "New ");
  const typeLabel = receiptMode ? "Receipt" : type === "invoice" ? "Invoice" : type === "quote" ? "Quotation" : type === "expense" ? "Expense" : "Contract";

  const [form, setForm] = React.useState(() => {
    const rawRef = record?.invoice_number || record?.reference || record?.quote_number || "";
    const ref = isUuidLike(rawRef) ? "" : rawRef;
    const desc = Array.isArray(record?.product_names)
      ? record.product_names.join(", ")
      : (record?.product_name || record?.description || record?.title || record?.service_name || "");
    const amt = record?.total_amount || record?.amount || record?.price || record?.subtotal_amount || "";
    return {
      id: record?.id || ("local:" + Math.random().toString(36).slice(2)),
      customer_name: record?.customer_name || record?.recipient || record?.counterparty_name || "",
      vendor_name: record?.vendor_name || record?.party_name || record?.counterparty_name || "",
      party_name: record?.party_name || record?.customer_name || record?.vendor_name || "",
      party_type: record?.party_type || "customer",
      reference: ref || nextRef || "",
      description: desc,
      amount: amt,
      status: record?.status || (type === "invoice" ? "draft" : type === "quote" ? "draft" : type === "expense" ? "pending" : "draft"),
      due_date: record?.due_date || "",
      issued_at: record?.issued_at || record?.issue_date || record?.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      validity_days: record?.validity_days || "30",
      date: record?.date || record?.expense_date || new Date().toISOString().slice(0, 10),
      end_date: record?.end_date || "",
      payments: record?.payments || [],
      currency: record?.currency || record?.source_currency || "",
      payment_terms: record?.payment_terms || "",
      notes: record?.notes || "",
      vat_rate: record?.vat_rate != null ? String(record.vat_rate) : "0",
      line_items: (() => {
        if (Array.isArray(record?.line_items) && record.line_items.length > 0)
          return record.line_items.map(i => ({ ...i, vat_rate: undefined }));
        const desc = Array.isArray(record?.product_names) ? record.product_names[0] || "" : (record?.product_name || record?.description || record?.title || record?.service_name || "");
        const unitPrice = record?.total_amount || record?.amount || record?.price || "";
        return [{ id: Math.random().toString(36).slice(2), description: desc, qty: "1", unit_price: unitPrice ? String(unitPrice) : "", cost_of_sales: "" }];
      })(),
    };
  });

  const [showPaymentModal, setShowPaymentModal] = React.useState(false);
  const [validationError, setValidationError] = React.useState(null);

  function set(k) { return v => setForm(f => ({ ...f, [k]: v })); }

  // Line item helpers
  const [cataloguePicker, setCataloguePicker] = useState(false);
  const [catalogueSearch, setCatalogueSearch] = useState("");
  function addLineItem(product) {
    const item = product
      ? { id: Math.random().toString(36).slice(2), description: product.name || "", qty: "1", unit_price: String(Math.max(0, Number(product.base_price || 0) - Number(product.discount || 0))), cost_of_sales: String(Number(product.cost_of_sales || product.unit_cost || 0)) }
      : { id: Math.random().toString(36).slice(2), description: "", qty: "1", unit_price: "", cost_of_sales: "" };
    setForm(f => ({ ...f, line_items: [...(f.line_items || []), item] }));
    setCataloguePicker(false);
    setCatalogueSearch("");
  }
  function removeLineItem(id) {
    setForm(f => ({ ...f, line_items: (f.line_items || []).filter(i => i.id !== id) }));
  }
  function updateLineItem(id, key, val) {
    setForm(f => ({ ...f, line_items: (f.line_items || []).map(i => i.id === id ? { ...i, [key]: val } : i) }));
  }
  const lineItems = form.line_items || [];
  const liSubtotal = lineItems.reduce((s, i) => s + (Number(i.qty) || 1) * (Number(i.unit_price) || 0), 0);
  const liVatRate = Number(form.vat_rate) || 0;
  const liTotalVat = liSubtotal * (liVatRate / 100);
  const liGrandTotal = liSubtotal + liTotalVat;

  function fmtDisplayDate(val) {
    if (!val) return "—";
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function handleSave() {
    setValidationError(null);
    if (type === "invoice" && !form.customer_name?.trim()) { setValidationError("Customer name is required."); return; }
    if (type === "quote" && !form.customer_name?.trim()) { setValidationError("Customer name is required."); return; }
    if (type === "expense" && !form.vendor_name?.trim() && !form.party_name?.trim()) { setValidationError("Vendor / supplier name is required."); return; }
    if (type === "contract") {
      if (!form.party_name?.trim()) { setValidationError(`${form.party_type === "vendor" ? "Vendor" : "Customer"} name is required.`); return; }
    }
    if (type !== "invoice" && type !== "quote" && !form.amount && type !== "contract") { setValidationError("Amount is required."); return; }
    const saved = { ...form, updated_at: new Date().toISOString() };
    if (type === "invoice" || type === "quote") {
      const items = saved.line_items || [];
      const subtotal = items.reduce((s, i) => s + (Number(i.qty) || 1) * (Number(i.unit_price) || 0), 0);
      const vatRate = Number(saved.vat_rate) || 0;
      const totalVat = subtotal * (vatRate / 100);
      saved.amount = subtotal + totalVat;
      saved.total_amount = saved.amount;
      saved.description = items.map(i => i.description).filter(Boolean).join(", ") || saved.description || "";
      if (type === "invoice") saved.invoice_number = saved.reference || "";
    } else {
      saved.total_amount = Number(saved.amount) || 0;
    }
    onSave(saved);
  }

  const [showShareModal, setShowShareModal] = React.useState(false);

  async function downloadPDF() {
    const ref = refLabel || "";
    const party = form.customer_name || form.vendor_name || form.party_name || "—";
    const amt = Number(form.amount || 0);
    const cur = form.currency || "GBP";
    const fmt = n => new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(n);
    const totalPaidAmt = (form.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    const balanceDue = Math.max(0, amt - totalPaidAmt);
    const issueDate = form.issued_at ? new Date(form.issued_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";
    // ReportLab parser supports: h1/h2/h3, p (with <b>/<i>), table/tr/th/td, ul/li
    const finalAmt = totalPaidAmt > 0 ? balanceDue : amt;
    const finalLabel = totalPaidAmt > 0 ? "Balance Due" : "Total";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1e293b; }
  table { border-collapse: collapse; }
</style>
</head><body>
<!-- FOOTER pinned to page bottom -->
<table width="100%" cellpadding="0" cellspacing="0" style="position:fixed; bottom:0; left:0; border-top:1px solid #e2e8f0;">
  <tr>
    <td style="padding:12px 40px; text-align:center; font-size:9px; color:#94a3b8;">
      Generated by ${workspaceName || "EnterprateAI"} &middot; ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
    </td>
  </tr>
</table>
<!-- HEADER -->
<table width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background-color:#4f46e5; padding:36px 40px; color:#ffffff; vertical-align:middle; width:55%;">
      <span style="font-size:20px; font-weight:bold; color:#ffffff;">${workspaceName || "Business"}</span><br/>
      <span style="font-size:11px; color:#c7d2fe;">Issued by ${workspaceName || ""}</span>
    </td>
    <td style="background-color:#4f46e5; padding:36px 40px; color:#ffffff; vertical-align:middle; text-align:right; width:45%;">
      <span style="font-size:28px; font-weight:bold; color:#ffffff;">${typeLabel.toUpperCase()}</span><br/>
      ${ref ? `<span style="font-size:11px; color:#c7d2fe;">#${ref}</span>` : ""}
    </td>
  </tr>
</table>
<!-- FROM | BILL TO -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:36px;">
  <tr>
    <td style="width:50%; padding:0 20px 0 40px; vertical-align:top;">
      <p style="font-size:9px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin:0 0 6px 0;">From</p>
      <p style="font-size:16px; font-weight:bold; color:#0f172a; margin:0;">${workspaceName || "—"}</p>
    </td>
    <td style="width:50%; padding:0 40px 0 20px; vertical-align:top; text-align:right;">
      <p style="font-size:9px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin:0 0 6px 0;">Bill To</p>
      <p style="font-size:16px; font-weight:bold; color:#0f172a; margin:0;">${party}</p>
    </td>
  </tr>
</table>
<!-- ISSUE DATE | DUE DATE -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
  <tr>
    <td style="padding:0 20px 0 40px; vertical-align:top;">
      <p style="font-size:9px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin:0 0 6px 0;">Issue Date</p>
      <p style="font-size:13px; font-weight:bold; color:#1e293b; margin:0;">${issueDate}</p>
    </td>
    <td style="padding:0 40px 0 20px; vertical-align:top; text-align:right;">
      ${form.due_date ? `<p style="font-size:9px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin:0 0 6px 0;">Due Date</p>
      <p style="font-size:13px; font-weight:bold; color:#1e293b; margin:0;">${new Date(form.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>` : `<p style="font-size:9px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin:0 0 6px 0;">Currency</p>
      <p style="font-size:13px; font-weight:bold; color:#1e293b; margin:0;">${form.currency || "GBP"}</p>`}
    </td>
  </tr>
</table>
${form.payment_terms ? `<!-- PAYMENT TERMS -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
  <tr>
    <td style="padding:0 40px 0 40px;">
      <p style="font-size:9px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin:0 0 4px 0;">Payment Terms</p>
      <p style="font-size:12px; color:#334155; margin:0; word-wrap:break-word;">${form.payment_terms}</p>
    </td>
  </tr>
</table>` : ""}
<!-- LINE ITEMS -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px; border:1px solid #e2e8f0;">
  <tr>
    <td style="background-color:#f8fafc; padding:10px 10px 10px 40px; font-size:9px; font-weight:bold; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; width:44%;">Description</td>
    <td style="background-color:#f8fafc; padding:10px; font-size:9px; font-weight:bold; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; text-align:center; width:8%;">Qty</td>
    <td style="background-color:#f8fafc; padding:10px; font-size:9px; font-weight:bold; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; text-align:right; width:24%;">Unit Price</td>
    <td style="background-color:#f8fafc; padding:10px 40px 10px 10px; font-size:9px; font-weight:bold; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; text-align:right; width:24%;">Total</td>
  </tr>
  ${(form.line_items && form.line_items.length > 0 ? form.line_items : [{ description: form.description || typeLabel, qty: "1", unit_price: String(amt) }]).map(item => {
    const qty = Number(item.qty) || 1;
    const up = Number(item.unit_price) || 0;
    const lineTotal = qty * up;
    return `<tr>
      <td style="padding:14px 10px 14px 40px; font-size:13px; color:#334155; border-top:1px solid #e2e8f0; word-wrap:break-word;">${item.description || "—"}</td>
      <td style="padding:14px 10px; font-size:13px; color:#334155; text-align:center; border-top:1px solid #e2e8f0;">${qty}</td>
      <td style="padding:14px 10px; font-size:13px; color:#334155; text-align:right; border-top:1px solid #e2e8f0; white-space:nowrap;">${fmt(up)}</td>
      <td style="padding:14px 40px 14px 10px; font-size:13px; font-weight:bold; color:#1e293b; text-align:right; border-top:1px solid #e2e8f0; white-space:nowrap;">${fmt(lineTotal)}</td>
    </tr>`;
  }).join("")}
</table>
<!-- TOTALS -->
${(() => {
  const items = (form.line_items && form.line_items.length > 0) ? form.line_items : [{ qty: "1", unit_price: String(amt) }];
  const sub = items.reduce((s, i) => s + (Number(i.qty)||1)*(Number(i.unit_price)||0), 0);
  const vatRate = Number(form.vat_rate) || 0;
  const vatTotal = sub * (vatRate / 100);
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px; padding:0 40px;">
  <tr><td style="padding:5px 40px; font-size:13px; color:#475569;">Subtotal</td><td style="padding:5px 40px; font-size:13px; color:#475569; text-align:right;">${fmt(sub)}</td></tr>
  ${vatTotal > 0 ? `<tr><td style="padding:5px 40px; font-size:13px; color:#475569;">VAT (${vatRate}%)</td><td style="padding:5px 40px; font-size:13px; color:#475569; text-align:right;">${fmt(vatTotal)}</td></tr>` : ""}
  ${totalPaidAmt > 0 ? `<tr><td style="padding:5px 40px; font-size:13px; color:#059669;">Amount Received</td><td style="padding:5px 40px; font-size:13px; color:#059669; text-align:right;">${fmt(totalPaidAmt)}</td></tr>` : ""}
</table>`;
})()}
<!-- BALANCE BAR -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
  <tr>
    <td style="background-color:#eef2ff; padding:18px 40px; font-size:15px; font-weight:bold; color:#3730a3;">${finalLabel}</td>
    <td style="background-color:#eef2ff; padding:18px 40px; font-size:20px; font-weight:bold; color:#4f46e5; text-align:right;">${fmt(finalAmt)}</td>
  </tr>
</table>
${form.notes ? `<!-- NOTES -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px; border-top:1px solid #e2e8f0;">
  <tr>
    <td style="padding:14px 40px 0 40px;">
      <p style="font-size:9px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin:0 0 4px 0;">Notes</p>
      <p style="font-size:12px; color:#334155; margin:0; white-space:pre-wrap;">${form.notes}</p>
    </td>
  </tr>
</table>` : ""}
</body></html>`;
    const filename = ref ? `${ref}.pdf` : `${typeLabel.toLowerCase()}.pdf`;
    try {
      const token = localStorage.getItem("ea_token");
      const res = await fetch(`${(await import("../api/client")).getApiBaseUrl()}/integrations/invoice-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ html, filename: filename.replace(".pdf", "") }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
        return;
      }
    } catch {}
    // Fallback: iframe print
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(iframe);
    const doc2 = iframe.contentDocument || iframe.contentWindow.document;
    doc2.open(); doc2.write(html); doc2.close();
    setTimeout(() => {
      iframe.contentWindow.print();
      setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 2000);
    }, 300);
  }

  const customerNames = [...new Set([
    ...(allKnownCustomers || []),
    ...customers.map(c => c.name || c.company_name).filter(Boolean),
    ...(record?.customer_name ? [record.customer_name] : []),
  ])];

  const payments = form.payments || [];
  // Legacy invoices may be "paid" with no payments[] array — use paid_amount or total
  const totalAmt = Number(form.amount || 0);
  const rawPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalPaid = rawPaid > 0 ? rawPaid
    : (record?.paid_amount != null ? Number(record.paid_amount)
      : ((form.status || "").toLowerCase() === "paid" ? totalAmt : 0));
  const remaining = Math.max(0, totalAmt - totalPaid);

  const statusCls = st => {
    const s = (st || "").toLowerCase();
    if (["paid","won","active","delivered"].includes(s)) return "inline-block rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-semibold text-emerald-700 capitalize";
    if (["overdue","expired","rejected"].includes(s)) return "inline-block rounded-full bg-rose-100 px-3 py-0.5 text-xs font-semibold text-rose-700 capitalize";
    if (["sent","viewed","submitted"].includes(s)) return "inline-block rounded-full bg-blue-100 px-3 py-0.5 text-xs font-semibold text-blue-700 capitalize";
    return "inline-block rounded-full bg-slate-100 px-3 py-0.5 text-xs font-semibold text-slate-600 capitalize";
  };

  return createPortal(<>
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/30 backdrop-blur-sm sm:items-start sm:pt-16 sm:pr-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <div className="text-base font-bold text-slate-900">{title}{typeLabel}</div>
            {form.reference && !isUuidLike(form.reference) && <div className="text-xs text-slate-500 mt-0.5">Ref: {form.reference}</div>}
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {type === "invoice" && isView ? (
            <div className="space-y-5">
              {/* Invoice header */}
              <div className="flex justify-between items-start border-b-2 border-indigo-300 pb-4">
                <div>
                  <div className="text-lg font-bold text-indigo-700">{workspaceName || "—"}</div>
                  {workspaceName && <div className="text-xs text-slate-400 mt-0.5">Issued by {workspaceName}</div>}
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-slate-700 tracking-wide">{receiptMode ? "RECEIPT" : "INVOICE"}</div>
                  <div className="text-xs text-slate-400 mt-0.5 font-mono">{(form.reference && !isUuidLike(form.reference)) ? `#${form.reference}` : "—"}</div>
                </div>
              </div>
              {/* FROM | BILL TO */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">From</div>
                  <div className="text-sm font-semibold text-slate-900">{workspaceName || "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Bill To</div>
                  <div className="text-sm font-semibold text-slate-900">{form.customer_name || "—"}</div>
                </div>
              </div>
              {/* ISSUE DATE | DUE DATE (extreme right) */}
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Issue Date</div>
                  <div className="text-xs font-semibold text-slate-800">{fmtDisplayDate(form.issued_at)}</div>
                </div>
                {form.due_date && (
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Due Date</div>
                    <div className="text-xs font-semibold text-slate-800">{fmtDisplayDate(form.due_date)}</div>
                  </div>
                )}
              </div>
              {/* PAYMENT TERMS — left, wrapping */}
              {form.payment_terms && (
                <div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Payment Terms</div>
                  <div className="text-xs font-semibold text-slate-800 break-words whitespace-pre-wrap">{form.payment_terms}</div>
                </div>
              )}
              {/* Line items */}
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Description</th>
                      <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400 w-16">Qty</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400 w-28">Unit Price</th>
                      <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400 w-28">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.length > 0 ? lineItems.map((item, i) => {
                      const lineTotal = (Number(item.qty) || 1) * (Number(item.unit_price) || 0);
                      return (
                        <tr key={item.id || i} className="border-t border-slate-100">
                          <td className="px-4 py-2.5 text-slate-700">{item.description || "—"}</td>
                          <td className="px-3 py-2.5 text-center text-slate-500">{item.qty || 1}×</td>
                          <td className="px-3 py-2.5 text-right text-slate-600">{formatCurrency(Number(item.unit_price) || 0, form.currency || "GBP")}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{formatCurrency(lineTotal, form.currency || "GBP")}</td>
                        </tr>
                      );
                    }) : (
                      <tr className="border-t border-slate-100">
                        <td className="px-4 py-3 text-slate-700">{form.description || "—"}</td>
                        <td colSpan={2}></td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatCurrency(totalAmt, form.currency || "GBP")}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* Totals */}
              <div className="space-y-1.5">
                {lineItems.length > 0 ? (<>
                  <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>{formatCurrency(liSubtotal, form.currency || "GBP")}</span></div>
                  {liTotalVat > 0 && <div className="flex justify-between text-sm text-slate-500"><span>VAT</span><span>{formatCurrency(liTotalVat, form.currency || "GBP")}</span></div>}
                </>) : (
                  <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>{formatCurrency(totalAmt, form.currency || "GBP")}</span></div>
                )}
                {totalPaid > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600">
                    <span>Amount Received</span>
                    <span>{formatCurrency(totalPaid, form.currency || "GBP")}</span>
                  </div>
                )}
                <div className="flex justify-between items-center rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 mt-1">
                  <span className="text-sm font-bold text-indigo-800">Balance Due</span>
                  <span className="text-base font-bold text-indigo-700">{formatCurrency(remaining, form.currency || "GBP")}</span>
                </div>
              </div>
              {/* Notes */}
              {form.notes && (
                <div className="border-t border-slate-100 pt-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Notes</div>
                  <div className="text-xs text-slate-600 whitespace-pre-wrap">{form.notes}</div>
                </div>
              )}
            </div>
          ) : type === "invoice" ? (<>
            <Field label="Customer">
              <>
                <input list="customer-names-list" value={form.customer_name || ""} onChange={e => set("customer_name")(e.target.value)}
                  placeholder="Customer name"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                <datalist id="customer-names-list">
                  {customerNames.map(n => <option key={n} value={n} />)}
                </datalist>
              </>
            </Field>
            <Field label="Invoice No. / Reference">
              <TextInput value={form.reference} onChange={set("reference")} placeholder="INV-001" />
            </Field>
            <Field label="Currency">
              <select value={form.currency || "GBP"} onChange={e => set("currency")(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                {CURRENCY_CODES.map(code => <option key={code} value={code}>{currencyLabel(code)}</option>)}
              </select>
            </Field>
            {/* Line Items */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">Line Items</label>
                <span className="text-[10px] text-slate-400">CoS = internal cost, not shown on invoice</span>
              </div>
              <div className="space-y-2">
                {lineItems.map((item, idx) => {
                  const lineTotal = (Number(item.qty) || 1) * (Number(item.unit_price) || 0);
                  return (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex items-center gap-2">
                        <input value={item.description} onChange={e => updateLineItem(item.id, "description", e.target.value)}
                          placeholder={`Item ${idx + 1} description`}
                          className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                        {lineItems.length > 1 && (
                          <button type="button" onClick={() => removeLineItem(item.id)}
                            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <div className="mb-0.5 text-[10px] text-slate-400">Qty</div>
                          <input type="number" value={item.qty} onChange={e => updateLineItem(item.id, "qty", e.target.value)} min="1"
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                        </div>
                        <div>
                          <div className="mb-0.5 text-[10px] text-slate-400">Unit Price</div>
                          <input type="number" value={item.unit_price} onChange={e => updateLineItem(item.id, "unit_price", e.target.value)} placeholder="0.00" min="0"
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                        </div>
                        <div>
                          <div className="mb-0.5 text-[10px] text-slate-400">CoS (internal)</div>
                          <input type="number" value={item.cost_of_sales} onChange={e => updateLineItem(item.id, "cost_of_sales", e.target.value)} placeholder="0.00" min="0"
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                        </div>
                      </div>
                      <div className="flex justify-end text-[11px] text-slate-500">
                        Line total: <span className="ml-1 font-semibold text-slate-700">{formatCurrency(lineTotal, form.currency || "GBP")}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => addLineItem()}
                  className="flex-1 flex items-center gap-1.5 rounded-lg border border-dashed border-indigo-300 px-3 py-1.5 text-[12px] font-medium text-indigo-600 hover:bg-indigo-50 transition justify-center dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-900/20">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                  Add Item
                </button>
                {catalogueProducts.length > 0 && (
                  <div className="relative">
                    <button type="button" onClick={() => { setCataloguePicker(v => !v); setCatalogueSearch(""); }}
                      className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition whitespace-nowrap dark:border-slate-600 dark:text-slate-400">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>
                      From Catalogue
                    </button>
                    {cataloguePicker && (
                      <div className="absolute bottom-full mb-1 right-0 z-50 w-64 rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                        <div className="p-2 border-b border-slate-100 dark:border-slate-800">
                          <input autoFocus value={catalogueSearch} onChange={e => setCatalogueSearch(e.target.value)}
                            placeholder="Search products…" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                        </div>
                        <div className="max-h-48 overflow-y-auto py-1">
                          {catalogueProducts.filter(p => !catalogueSearch || (p.name || "").toLowerCase().includes(catalogueSearch.toLowerCase())).map((p, i) => (
                            <button key={i} type="button" onClick={() => addLineItem(p)}
                              className="w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition">
                              <div className="text-sm text-slate-800 dark:text-slate-100 font-medium">{p.name}</div>
                              {p.base_price > 0 && <div className="text-[11px] text-slate-400">{formatCurrency(Number(p.base_price || 0) - Number(p.discount || 0), form.currency || "GBP")}</div>}
                            </button>
                          ))}
                          {catalogueProducts.filter(p => !catalogueSearch || (p.name || "").toLowerCase().includes(catalogueSearch.toLowerCase())).length === 0 && (
                            <div className="px-3 py-2 text-xs text-slate-400">No products found</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* VAT + Totals */}
              <div className="mt-3 rounded-xl bg-white border border-slate-200 px-4 py-3 space-y-2 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">Subtotal</span>
                  <span className="text-xs font-medium text-slate-700">{formatCurrency(liSubtotal, form.currency || "GBP")}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-slate-500 shrink-0">VAT %</label>
                  <div className="flex items-center gap-2">
                    <input type="number" value={form.vat_rate} onChange={e => set("vat_rate")(e.target.value)} placeholder="0" min="0" max="100"
                      className="w-20 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm text-slate-900 text-right focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                    <span className="text-xs text-slate-400">=</span>
                    <span className="text-xs font-medium text-slate-700 w-24 text-right">{formatCurrency(liTotalVat, form.currency || "GBP")}</span>
                  </div>
                </div>
                <div className="flex justify-between text-sm font-bold text-slate-800 dark:text-slate-100 border-t border-slate-100 dark:border-slate-800 pt-2">
                  <span>Total</span><span>{formatCurrency(liGrandTotal, form.currency || "GBP")}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Issue Date">
                <TextInput type="date" value={(form.issued_at || "").slice(0, 10)} onChange={set("issued_at")} />
              </Field>
              <Field label="Due Date">
                <TextInput type="date" value={form.due_date} onChange={set("due_date")} />
              </Field>
            </div>
            <Field label="Status">
              <SelectInput value={form.status} onChange={set("status")} options={STATUS_OPTIONS.invoice} />
            </Field>
            <Field label="Payment Terms">
              <TextInput value={form.payment_terms} onChange={set("payment_terms")} placeholder="e.g. Net 30, Due on receipt, 50% upfront…" />
            </Field>
            <Field label="Notes">
              <textarea value={form.notes} onChange={e => set("notes")(e.target.value)} rows={3} placeholder="Additional notes, bank details, thank-you message…"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
            </Field>
          </>) : null}
          {type === "quote" && isView ? (
            <div className="space-y-5">
              {/* Quote header */}
              <div className="flex justify-between items-start border-b-2 border-indigo-300 pb-4">
                <div>
                  <div className="text-lg font-bold text-indigo-700">{workspaceName || "—"}</div>
                  {workspaceName && <div className="text-xs text-slate-400 mt-0.5">Issued by {workspaceName}</div>}
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-slate-700 tracking-wide">QUOTATION</div>
                  <div className="text-xs text-slate-400 mt-0.5 font-mono">{(form.reference && !isUuidLike(form.reference)) ? `#${form.reference}` : ""}</div>
                </div>
              </div>
              {/* From / Quote To */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">From</div>
                    <div className="text-sm font-semibold text-slate-900">{workspaceName || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Issue Date</div>
                    <div className="text-xs font-semibold text-slate-800">{fmtDisplayDate(form.issued_at)}</div>
                  </div>
                  {form.validity_days && <div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Valid For</div>
                    <div className="text-xs font-semibold text-slate-800">{form.validity_days} days</div>
                  </div>}
                </div>
                <div className="space-y-3 text-right">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Quote To</div>
                    <div className="text-sm font-semibold text-slate-900">{form.customer_name || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Currency</div>
                    <div className="text-xs font-semibold text-slate-800">{form.currency || "GBP"}</div>
                  </div>
                </div>
              </div>
              {/* Line items table */}
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Description</th>
                      <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400 w-16">Qty</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400 w-28">Unit Price</th>
                      <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400 w-28">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.length > 0 ? lineItems.map((item, i) => {
                      const lineTotal = (Number(item.qty) || 1) * (Number(item.unit_price) || 0);
                      return (
                        <tr key={item.id || i} className="border-t border-slate-100">
                          <td className="px-4 py-2.5 text-slate-700">{item.description || "—"}</td>
                          <td className="px-3 py-2.5 text-center text-slate-500">{item.qty || 1}×</td>
                          <td className="px-3 py-2.5 text-right text-slate-600">{formatCurrency(Number(item.unit_price) || 0, form.currency || "GBP")}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{formatCurrency(lineTotal, form.currency || "GBP")}</td>
                        </tr>
                      );
                    }) : (
                      <tr className="border-t border-slate-100">
                        <td className="px-4 py-3 text-slate-700">{form.description || "—"}</td>
                        <td colSpan={2}></td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatCurrency(Number(form.amount || 0), form.currency || "GBP")}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* Totals */}
              <div className="space-y-1.5">
                {lineItems.length > 0 && <>
                  <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>{formatCurrency(liSubtotal, form.currency || "GBP")}</span></div>
                  {liTotalVat > 0 && <div className="flex justify-between text-sm text-slate-500"><span>VAT ({liVatRate}%)</span><span>{formatCurrency(liTotalVat, form.currency || "GBP")}</span></div>}
                </>}
                <div className="flex justify-between items-center rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 mt-1">
                  <span className="text-sm font-bold text-indigo-800">Total</span>
                  <span className="text-base font-bold text-indigo-700">{formatCurrency(lineItems.length > 0 ? liGrandTotal : Number(form.amount || 0), form.currency || "GBP")}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <span className={statusCls(form.status)}>{form.status}</span>
              </div>
            </div>
          ) : type === "quote" ? (<>
            <Field label="Customer">
              <>
                <input list="customer-names-list" value={form.customer_name || ""} onChange={e => set("customer_name")(e.target.value)}
                  placeholder="Customer name"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                <datalist id="customer-names-list">
                  {customerNames.map(n => <option key={n} value={n} />)}
                </datalist>
              </>
            </Field>
            <Field label="Reference">
              <TextInput value={form.reference} onChange={set("reference")} placeholder="QUO-001" />
            </Field>
            {(<>
              <Field label="Currency">
                <select value={form.currency || "GBP"} onChange={e => set("currency")(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  {CURRENCY_CODES.map(code => <option key={code} value={code}>{currencyLabel(code)}</option>)}
                </select>
              </Field>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">Line Items</label>
                  <span className="text-[10px] text-slate-400">CoS = internal cost, not shown on quote</span>
                </div>
                <div className="space-y-2">
                  {lineItems.map((item, idx) => {
                    const lineTotal = (Number(item.qty) || 1) * (Number(item.unit_price) || 0);
                    return (
                      <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 dark:border-slate-700 dark:bg-slate-800/50">
                        <div className="flex items-center gap-2">
                          <input value={item.description} onChange={e => updateLineItem(item.id, "description", e.target.value)}
                            placeholder={`Item ${idx + 1} description`}
                            className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                          {lineItems.length > 1 && (
                            <button type="button" onClick={() => removeLineItem(item.id)}
                              className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition">
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <div className="mb-0.5 text-[10px] text-slate-400">Qty</div>
                            <input type="number" value={item.qty} onChange={e => updateLineItem(item.id, "qty", e.target.value)} min="1"
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                          </div>
                          <div>
                            <div className="mb-0.5 text-[10px] text-slate-400">Unit Price</div>
                            <input type="number" value={item.unit_price} onChange={e => updateLineItem(item.id, "unit_price", e.target.value)} placeholder="0.00" min="0"
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                          </div>
                          <div>
                            <div className="mb-0.5 text-[10px] text-slate-400">CoS (internal)</div>
                            <input type="number" value={item.cost_of_sales} onChange={e => updateLineItem(item.id, "cost_of_sales", e.target.value)} placeholder="0.00" min="0"
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                          </div>
                        </div>
                        <div className="flex justify-end text-[11px] text-slate-500">
                          Line total: <span className="ml-1 font-semibold text-slate-700">{formatCurrency(lineTotal, form.currency || "GBP")}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => addLineItem()}
                    className="flex-1 flex items-center gap-1.5 rounded-lg border border-dashed border-indigo-300 px-3 py-1.5 text-[12px] font-medium text-indigo-600 hover:bg-indigo-50 transition justify-center dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-900/20">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                    Add Item
                  </button>
                  {catalogueProducts.length > 0 && (
                    <div className="relative">
                      <button type="button" onClick={() => { setCataloguePicker(v => !v); setCatalogueSearch(""); }}
                        className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition whitespace-nowrap dark:border-slate-600 dark:text-slate-400">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>
                        From Catalogue
                      </button>
                      {cataloguePicker && (
                        <div className="absolute bottom-full mb-1 right-0 z-50 w-64 rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                          <div className="p-2 border-b border-slate-100 dark:border-slate-800">
                            <input autoFocus value={catalogueSearch} onChange={e => setCatalogueSearch(e.target.value)}
                              placeholder="Search products…" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                          </div>
                          <div className="max-h-48 overflow-y-auto py-1">
                            {catalogueProducts.filter(p => !catalogueSearch || (p.name || "").toLowerCase().includes(catalogueSearch.toLowerCase())).map((p, i) => (
                              <button key={i} type="button" onClick={() => addLineItem(p)}
                                className="w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition">
                                <div className="text-sm text-slate-800 dark:text-slate-100 font-medium">{p.name}</div>
                                {p.base_price > 0 && <div className="text-[11px] text-slate-400">{formatCurrency(Number(p.base_price || 0) - Number(p.discount || 0), form.currency || "GBP")}</div>}
                              </button>
                            ))}
                            {catalogueProducts.filter(p => !catalogueSearch || (p.name || "").toLowerCase().includes(catalogueSearch.toLowerCase())).length === 0 && (
                              <div className="px-3 py-2 text-xs text-slate-400">No products found</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* VAT + Totals */}
                <div className="mt-3 rounded-xl bg-white border border-slate-200 px-4 py-3 space-y-2 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-500">Subtotal</span>
                    <span className="text-xs font-medium text-slate-700">{formatCurrency(liSubtotal, form.currency || "GBP")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs text-slate-500 shrink-0">VAT %</label>
                    <div className="flex items-center gap-2">
                      <input type="number" value={form.vat_rate} onChange={e => set("vat_rate")(e.target.value)} placeholder="0" min="0" max="100"
                        className="w-20 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm text-slate-900 text-right focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                      <span className="text-xs text-slate-400">=</span>
                      <span className="text-xs font-medium text-slate-700 w-24 text-right">{formatCurrency(liTotalVat, form.currency || "GBP")}</span>
                    </div>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-800 dark:text-slate-100 border-t border-slate-100 dark:border-slate-800 pt-2">
                    <span>Total</span><span>{formatCurrency(liGrandTotal, form.currency || "GBP")}</span>
                  </div>
                </div>
              </div>
            </>)}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Issue Date">
                {isView ? <div className="text-sm text-slate-900">{fmtDisplayDate(form.issued_at)}</div> :
                  <TextInput type="date" value={(form.issued_at || "").slice(0, 10)} onChange={set("issued_at")} />}
              </Field>
              <Field label="Valid For (days)">
                {isView ? <div className="text-sm text-slate-900">{form.validity_days || "30"} days</div> :
                  <TextInput type="number" value={form.validity_days} onChange={set("validity_days")} placeholder="30" />}
              </Field>
            </div>
            <Field label="Status">
              <SelectInput value={form.status} onChange={set("status")} options={STATUS_OPTIONS.quote} />
            </Field>
          </>) : null}
          {type === "expense" && (<>
            <Field label="Vendor / Supplier">
              {isView ? <div className="text-sm font-medium text-slate-900">{form.vendor_name || "—"}</div> :
                <TextInput value={form.vendor_name} onChange={set("vendor_name")} placeholder="Vendor name" />}
            </Field>
            <Field label="Reference">
              {isView ? <div className="text-sm text-slate-900">{form.reference || "—"}</div> :
                <TextInput value={form.reference} onChange={set("reference")} placeholder="EXP-001" />}
            </Field>
            <Field label="Description">
              {isView ? <div className="text-sm text-slate-900">{form.description || "—"}</div> :
                <TextInput value={form.description} onChange={set("description")} placeholder="What was this expense for?" />}
            </Field>
            <Field label="Amount (£)">
              {isView ? <div className="text-lg font-bold text-slate-900">£{Number(form.amount || 0).toLocaleString()}</div> :
                <TextInput type="number" value={form.amount} onChange={set("amount")} placeholder="0.00" />}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                {isView ? <div className="text-sm text-slate-900">{fmtDisplayDate(form.date)}</div> :
                  <TextInput type="date" value={form.date} onChange={set("date")} />}
              </Field>
              <Field label="Due Date">
                {isView ? <div className="text-sm text-slate-900">{fmtDisplayDate(form.due_date)}</div> :
                  <TextInput type="date" value={form.due_date} onChange={set("due_date")} />}
              </Field>
            </div>
            <Field label="Status">
              {isView ? <span className={statusCls(form.status)}>{form.status}</span> :
                <SelectInput value={form.status} onChange={set("status")} options={STATUS_OPTIONS.expense} />}
            </Field>
          </>)}
          {type === "contract" && (<>
            <Field label="Party Type">
              {isView ? <div className="text-sm text-slate-900 capitalize">{form.party_type}</div> :
                <SelectInput value={form.party_type} onChange={set("party_type")} options={["customer", "vendor"]} />}
            </Field>
            <Field label={form.party_type === "vendor" ? "Vendor" : "Customer"}>
              {isView ? <div className="text-sm font-medium text-slate-900">{form.party_name || "—"}</div> :
                <TextInput value={form.party_name} onChange={set("party_name")} placeholder="Party name" />}
            </Field>
            <Field label="Reference">
              {isView ? <div className="text-sm text-slate-900">{form.reference || "—"}</div> :
                <TextInput value={form.reference} onChange={set("reference")} placeholder="CON-001" />}
            </Field>
            <Field label="Contract Value (£)">
              {isView ? <div className="text-lg font-bold text-slate-900">£{Number(form.amount || 0).toLocaleString()}</div> :
                <TextInput type="number" value={form.amount} onChange={set("amount")} placeholder="0.00" />}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start Date">
                {isView ? <div className="text-sm text-slate-900">{fmtDisplayDate(form.issued_at)}</div> :
                  <TextInput type="date" value={(form.issued_at || "").slice(0, 10)} onChange={set("issued_at")} />}
              </Field>
              <Field label="End Date">
                {isView ? <div className="text-sm text-slate-900">{fmtDisplayDate(form.end_date)}</div> :
                  <TextInput type="date" value={form.end_date} onChange={set("end_date")} />}
              </Field>
            </div>
            <Field label="Status">
              {isView ? <span className={statusCls(form.status)}>{form.status}</span> :
                <SelectInput value={form.status} onChange={set("status")} options={STATUS_OPTIONS.contract} />}
            </Field>
          </>)}
        </div>
        {!isView && (
          <div className="border-t border-slate-100 px-6 py-4">
            {validationError && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{validationError}</p>
            )}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose}
                className="rounded-xl border border-slate-200 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" onClick={handleSave}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                {mode === "create" ? "Create" : "Save Changes"}
              </button>
            </div>
          </div>
        )}
        {isView && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-6 py-4">
            <button type="button" onClick={() => setShowShareModal(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              Share
            </button>
            {(type === "invoice" || type === "quote") && (
              <button type="button" onClick={downloadPDF}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download PDF
              </button>
            )}
            <button type="button" onClick={onClose} className="ml-auto rounded-xl border border-slate-200 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
    {showPaymentModal && type === "invoice" && onRecordPayment && (
      <RecordPaymentModal
        invoice={record}
        onRecord={onRecordPayment}
        onClose={() => setShowPaymentModal(false)}
      />
    )}
    {showShareModal && (
      <ShareModal
        record={record}
        type={type}
        workspaceName={workspaceName}
        customers={customers}
        onClose={() => setShowShareModal(false)}
      />
    )}
  </>, document.body);
}

// Returns true when a string looks like a raw UUID or UUID fragment — not user-set
function isUuidLike(str) {
  return !str || /^[0-9a-f-]{8,36}$/i.test(str.trim());
}
// Format a date as DDMMYY
function dateSuffix(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}
// Generate a ref like INV-10905026 (1st invoice on 09/05/26)
function dayRef(prefix, createdAt, existingRecords) {
  const d = new Date(createdAt || Date.now());
  const suffix = dateSuffix(d);
  const sameDay = existingRecords.filter(r => {
    const rd = new Date(r.created_at || 0);
    return dateSuffix(rd) === suffix;
  }).length;
  return `${prefix}-${sameDay + 1}${suffix}`;
}
// Build a stable id→label map sorted by creation date (oldest first)
function buildRefMap(records, prefix) {
  const sorted = [...records].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  const dayCounts = {};
  const map = new Map();
  sorted.forEach(r => {
    const stored = r.invoice_number || r.reference;
    if (!isUuidLike(stored) && stored) { map.set(r.id, stored); return; }
    const suffix = dateSuffix(new Date(r.created_at || Date.now()));
    dayCounts[suffix] = (dayCounts[suffix] || 0) + 1;
    map.set(r.id, `${prefix}-${dayCounts[suffix]}${suffix}`);
  });
  return map;
}

export default function BusinessOperationsPage() {
  const workspaceId = useWorkspaceStore(s => s.workspaceId);
  const wsCurrency = useWorkspaceStore(s => s.currency);
  const workspaceName = useWorkspaceStore(s => s.workspaceName);
  const { requests: proposalRequests, inbox: proposalInbox, fetchRequests: fetchProposalRequests, fetchInbox: fetchProposalInbox } = useProposalStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [activeTab, setActiveTab] = useState("Overview");
  const [salesSub, setSalesSub] = useState("Pipeline");
  const [procSub, setProcSub] = useState("Overview");
  // Read ?tab= and ?sub= from notification deep-links
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const tab = p.get("tab"); const sub = p.get("sub");
    if (tab) setActiveTab(tab);
    if (sub) {
      if (tab === "Sales") setSalesSub(sub);
      if (tab === "Procurement") setProcSub(sub);
    }
  }, [location.search]);
  const [reqCreateTrigger, setReqCreateTrigger] = useState(0);
  const [contractSub, setContractSub] = useState("All Contracts");
  const [txnSub, setTxnSub] = useState("All Transactions");
  const [reportSub, setReportSub] = useState("Summary");

  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [rfqRequests, setRfqRequests] = useState([]);
  const [sentRfqs, setSentRfqs] = useState([]);
  const [rfqRespondTarget, setRfqRespondTarget] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [catalogueProducts, setCatalogueProducts] = useState([]);
  const [recordModal, setRecordModal] = useState(null);

  const invoiceRefMap = useMemo(() => buildRefMap(invoices, "INV"), [invoices]);
  const quoteRefMap = useMemo(() => buildRefMap(quotes, "QUO"), [quotes]);
  const contractRefMap = useMemo(() => buildRefMap(contracts, "CON"), [contracts]);
  const [paymentInvoice, setPaymentInvoice] = useState(null); // invoice to record payment for
  const [deliveryInvoice, setDeliveryInvoice] = useState(null); // invoice to mark as delivered
  const [shareItem, setShareItem] = useState(null); // { record, type }
  const [shareToast, setShareToast] = useState("");
  const [fxRates, setFxRates] = useState({}); // { "USD": 0.79, ... } — rate TO workspace currency
  const [reportRange, setReportRange] = useState("6m");
  const [showRangeMenu, setShowRangeMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const reportMonths = useMemo(() => {
    const wsIso = (wsCurrency || "GBP").match(/\(([A-Z]{3})\)/)?.[1]?.toUpperCase() || (wsCurrency || "GBP").toUpperCase();
    function toWsAmt(amount, cur) {
      const num = Number(amount || 0);
      const iso = (String(cur || "").match(/\(([A-Z]{3})\)/)?.[1] || String(cur || "").toUpperCase()).slice(0, 3);
      if (!iso || iso === wsIso) return num;
      const rate = fxRates[iso];
      return rate != null ? num * rate : num;
    }
    const rawAmt = r => Number(r?.total_amount || r?.amount || r?.price || 0);
    const invDate = inv => {
      if (inv.payments?.length > 0) return inv.payments[inv.payments.length - 1].paid_at;
      return inv.paid_at || inv.delivered_at || inv.issue_date || inv.issued_at || inv.created_at;
    };
    const expDate = e => e.date || e.expense_date || e.issue_date || e.created_at;
    const monthCount = reportRange === "1y" ? 12 : reportRange === "6m" ? 6 : reportRange === "90d" ? 3 : 1;
    const now = new Date();
    return Array.from({ length: monthCount }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (monthCount - 1 - i), 1);
      const y = d.getFullYear(), mo = d.getMonth();
      const label = d.toLocaleDateString("en-GB", { month: "short", ...(monthCount === 12 ? { year: "2-digit" } : {}) });
      const rev = invoices
        .filter(inv => { const dd = new Date(invDate(inv) || 0); return dd.getFullYear() === y && dd.getMonth() === mo && ["paid","delivered"].includes((inv.status||"").toLowerCase()); })
        .reduce((s, inv) => s + toWsAmt(rawAmt(inv), inv.currency), 0);
      const cost = expenses
        .filter(e => { const dd = new Date(expDate(e) || 0); return dd.getFullYear() === y && dd.getMonth() === mo; })
        .reduce((s, e) => s + toWsAmt(rawAmt(e), e.currency), 0);
      return { label, rev, cost };
    });
  }, [invoices, expenses, fxRates, wsCurrency, reportRange]);

  const procCycleDays = useMemo(() => {
    const now = Date.now();
    const cutoffMs = reportRange === "1y" ? now - 365 * 86400000
      : reportRange === "6m" ? now - 183 * 86400000
      : reportRange === "90d" ? now - 90 * 86400000
      : now - 30 * 86400000;
    const awarded = rfqRequests.filter(r => r.status === "awarded" && r.awarded_at && r.created_at
      && new Date(r.awarded_at).getTime() >= cutoffMs);
    if (!awarded.length) return null;
    const avg = awarded.reduce((s, r) => s + (new Date(r.awarded_at) - new Date(r.created_at)) / 86400000, 0) / awarded.length;
    return Math.round(avg);
  }, [rfqRequests, reportRange]);

  useEffect(() => {
    if (workspaceId) { fetchProposalRequests(); fetchProposalInbox(); }
  }, [workspaceId, fetchProposalRequests, fetchProposalInbox]);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    let alive = true;
    apiRequest(`/validation/${workspaceId}`, "GET")
      .then(ws => {
        if (!alive) return;
        const fin = ws?.data?.financials || {};
        const cat = ws?.data?.catalogue || ws?.data || {};
        setInvoices(Array.isArray(fin.invoices) ? fin.invoices : []);
        setExpenses(Array.isArray(fin.expenses) ? fin.expenses : []);
        setContracts(Array.isArray(fin.contracts) ? fin.contracts : []);
        setQuotes(Array.isArray(fin.quotes) ? fin.quotes : Array.isArray(fin.quotations) ? fin.quotations : []);
        setRfqRequests(Array.isArray(fin.rfq_requests) ? fin.rfq_requests : []);
        setSentRfqs(Array.isArray(fin.sent_rfqs) ? fin.sent_rfqs : []);
        setCustomers(Array.isArray(cat.customers) ? cat.customers : []);
        setCatalogueProducts(Array.isArray(cat.products) ? cat.products : []);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [workspaceId]);


  // Fetch exchange rates for foreign-currency records
  useEffect(() => {
    if (!wsCurrency) return;
    const wsIso = ((wsCurrency.match(/\(([A-Z]{3})\)\s*$/) || wsCurrency.match(/^([A-Z]{3})$/i)) || [])[1]?.toUpperCase() || wsCurrency.toUpperCase();
    const allRecs = [...invoices, ...quotes, ...expenses];
    const foreign = new Set(
      allRecs.map(r => {
        const c = String(r.currency || r.source_currency || "").trim();
        return ((c.match(/\(([A-Z]{3})\)\s*$/) || c.match(/^([A-Z]{3})$/i)) || [])[1]?.toUpperCase() || c.toUpperCase();
      }).filter(iso => iso && iso !== wsIso && iso.length === 3)
    );
    if (!foreign.size) return;
    let alive = true;
    Promise.all([...foreign].map(async from => {
      try {
        const data = await apiRequest(`/integrations/currency-rate?from_currency=${from}&to_currency=${wsIso}`, "GET");
        return { from, rate: data?.rate ?? null };
      } catch { return { from, rate: null }; }
    })).then(results => {
      if (!alive) return;
      const next = {};
      results.forEach(({ from, rate }) => { if (rate != null) next[from] = rate; });
      setFxRates(prev => ({ ...prev, ...next }));
    });
    return () => { alive = false; };
  }, [invoices, quotes, expenses, wsCurrency]); // eslint-disable-line

  const m = useMemo(() => {
    // Helpers
    const st = v => String(v || "").toLowerCase().trim();
    const rawAmt = r => Number(r?.total_amount || r?.amount || r?.price || r?.subtotal_amount || 0);

    // Currency helpers
    function _wsIso() {
      const c = String(wsCurrency || "GBP");
      return (((c.match(/\(([A-Z]{3})\)\s*$/) || c.match(/^([A-Z]{3})$/i)) || [])[1])?.toUpperCase() || c.toUpperCase();
    }
    function _resolveIso(cur) {
      if (!cur) return null;
      return (((String(cur).match(/\(([A-Z]{3})\)\s*$/) || String(cur).match(/^([A-Z]{3})$/i)) || [])[1])?.toUpperCase() || String(cur).toUpperCase();
    }
    function toWs(amount, cur) {
      const num = Number(amount || 0);
      const fromIso = _resolveIso(cur);
      if (!fromIso) return num;
      const wsIso = _wsIso();
      if (fromIso === wsIso) return num;
      const rate = fxRates[fromIso];
      return rate != null ? Math.round(num * rate * 100) / 100 : num;
    }
    function receivedAmt(i) {
      if (i.payments && i.payments.length > 0) return i.payments.reduce((s, p) => s + Number(p.amount), 0);
      return (i.payment_type === "partial" && i.paid_amount != null) ? Number(i.paid_amount) : rawAmt(i);
    }

    // Date range cutoff
    const now = Date.now();
    const cutoffMs = reportRange === "1y" ? now - 365 * 86400000
      : reportRange === "6m" ? now - 183 * 86400000
      : reportRange === "90d" ? now - 90 * 86400000
      : now - 30 * 86400000;
    const inRange = (dateStr) => dateStr && new Date(dateStr).getTime() >= cutoffMs;
    const invAnchor = i => {
      if (i.payments?.length > 0) return i.payments[i.payments.length - 1].paid_at;
      return i.paid_at || i.delivered_at || i.issue_date || i.issued_at || i.created_at;
    };
    const expAnchor = e => e.date || e.expense_date || e.issue_date || e.created_at;
    const qAnchor = q => q.sent_at || q.issue_date || q.created_at;
    const cAnchor = c => c.start_date || c.created_at;

    // Invoices (filtered by range)
    const paidInvoices = invoices.filter(i => st(i.status) === "paid" && inRange(invAnchor(i)));
    const deliveredInvoices = invoices.filter(i => st(i.status) === "delivered" && inRange(invAnchor(i)));
    const cashIn = paidInvoices.reduce((s, i) => s + toWs(receivedAmt(i), i.currency), 0);
    const receivables = deliveredInvoices.reduce((s, i) => s + toWs(rawAmt(i), i.currency), 0)
      + paidInvoices.filter(i => receivedAmt(i) < rawAmt(i)).reduce((s, i) => s + toWs(Math.max(0, rawAmt(i) - receivedAmt(i)), i.currency), 0);
    const today = new Date(); today.setHours(0,0,0,0);
    const overdueInvoices = invoices.filter(i => {
      const s = st(i.status);
      if (["paid","delivered","cancelled"].includes(s)) return false;
      const due = i.due_date ? new Date(i.due_date) : null;
      return due && due < today;
    }).length;
    const totalRevenue = [...paidInvoices, ...deliveredInvoices].reduce((s, i) => s + toWs(rawAmt(i), i.currency), 0);

    // Expenses (filtered by range)
    const paidExpenses = expenses.filter(e => st(e.status) === "paid" && inRange(expAnchor(e)));
    const cashOut = paidExpenses.reduce((s, e) => s + toWs(rawAmt(e), e.currency), 0);
    const payables = expenses
      .filter(e => ["pending","overdue","draft"].includes(st(e.status)) && inRange(expAnchor(e)))
      .reduce((s, e) => s + toWs(rawAmt(e), e.currency), 0);

    // Contracts (active ones regardless of range; contract value filtered by range)
    const activeContracts = contracts.filter(c => ["active","signed"].includes(st(c.status)) || !c.status).length;
    const awaitingApproval = contracts.filter(c => ["pending","awaiting_approval"].includes(st(c.status))).length;
    const expiringSoon = contracts.filter(c => st(c.status) === "expiring_soon").length;
    const rangeContracts = contracts.filter(c => inRange(cAnchor(c)));
    const totalContractValue = rangeContracts.reduce((s, c) => s + toWs(rawAmt(c), c.currency), 0);

    // Quotes (filtered by range)
    const rangeQuotes = quotes.filter(q => inRange(qAnchor(q)));
    const proposalsSubmitted = rangeQuotes.filter(q => ["sent","viewed","submitted"].includes(st(q.status))).length;
    const quotationsSent = rangeQuotes.filter(q => st(q.status) === "sent").length;
    const quotationsViewed = rangeQuotes.filter(q => st(q.status) === "viewed").length;
    const awaitingResponse = rangeQuotes.filter(q => ["pending","awaiting_response"].includes(st(q.status))).length;
    const wonQuotes = rangeQuotes.filter(q => ["won","accepted"].includes(st(q.status))).length;
    const winRate = rangeQuotes.length > 0 ? Math.round((wonQuotes / rangeQuotes.length) * 100) : 0;
    const potentialValue = rangeQuotes
      .filter(q => !["rejected","expired"].includes(st(q.status)))
      .reduce((s, q) => s + toWs(rawAmt(q), q.currency), 0);

    // RFQ (filtered by range)
    const rangeRfqs = rfqRequests.filter(r => inRange(r.created_at));
    const activeRfqs = rangeRfqs.filter(r => !["archived","cancelled"].includes(st(r.status))).length;
    const rfqProposalsReceived = rangeRfqs.reduce((s, r) => s + (Number(r.proposals_received) || 0), 0);
    const awaitingEvaluation = rangeRfqs.filter(r => ["under_evaluation","awaiting_evaluation","evaluating"].includes(st(r.status))).length;
    const upcomingDeadlines = rfqRequests.filter(r => {
      if (!r.deadline) return false;
      const diff = new Date(r.deadline).getTime() - Date.now();
      return diff > 0 && diff < 7 * 86400000;
    }).length;

    return {
      activeContracts, awaitingApproval, expiringSoon, totalContractValue,
      cashIn, cashOut, receivables, payables, netCash: cashIn - cashOut, totalRevenue,
      proposalsSubmitted, quotationsSent, quotationsViewed, awaitingResponse, potentialValue,
      activeRfqs, rfqProposalsReceived, awaitingEvaluation, upcomingDeadlines,
      wonQuotes, winRate, overdueInvoices,
    };
  }, [invoices, expenses, contracts, quotes, rfqRequests, fxRates, wsCurrency, reportRange]);

  function _wsIso() {
    const c = String(wsCurrency || "GBP");
    return (((c.match(/\(([A-Z]{3})\)\s*$/) || c.match(/^([A-Z]{3})$/i)) || [])[1])?.toUpperCase() || c.toUpperCase();
  }
  function _resolveIso(cur) {
    if (!cur) return null;
    return (((String(cur).match(/\(([A-Z]{3})\)\s*$/) || String(cur).match(/^([A-Z]{3})$/i)) || [])[1])?.toUpperCase() || String(cur).toUpperCase();
  }
  function formatMoney(value, overrideCurrency) {
    const num = Number(value || 0);
    if (overrideCurrency) {
      const fromIso = _resolveIso(overrideCurrency);
      const wsIso = _wsIso();
      if (fromIso && fromIso !== wsIso && fxRates[fromIso] != null) {
        const converted = formatCurrency(Math.round(num * fxRates[fromIso] * 100) / 100, wsIso);
        return `${converted} (${formatCurrency(num, fromIso)})`;
      }
    }
    return formatCurrency(num, overrideCurrency || wsCurrency || "GBP");
  }

  function toWsConverted(amount, cur) {
    const num = Number(amount || 0);
    const fromIso = _resolveIso(cur);
    const ws = _wsIso();
    if (!fromIso || fromIso === ws) return num;
    const rate = fxRates[fromIso];
    return rate != null ? num * rate : num;
  }
  function receivedAmt(i) {
    if (i.payments && i.payments.length > 0) return i.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    return (i.payment_type === "partial" && i.paid_amount != null) ? Number(i.paid_amount) : Number(i.total_amount || i.amount || 0);
  }

  async function persist(next) {
    if (!workspaceId) return;
    await apiRequest(`/validation/${workspaceId}`, "PATCH", { data: { financials: next } });
    window.dispatchEvent(new CustomEvent("ea:workspace:refresh"));
  }

  function deleteItem(type, id) {
    setConfirmDialog({
      message: `Delete this ${type}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        if (type === "invoice") {
          const next = invoices.filter(i => i.id !== id);
          setInvoices(next);
          await persist({ invoices: next, quotes, expenses, contracts });
        } else if (type === "quote") {
          const next = quotes.filter(q => q.id !== id);
          setQuotes(next);
          await persist({ invoices, quotes: next, expenses, contracts });
        } else if (type === "expense") {
          const next = expenses.filter(e => e.id !== id);
          setExpenses(next);
          await persist({ invoices, quotes, expenses: next, contracts });
        } else if (type === "contract") {
          const next = contracts.filter(c => c.id !== id);
          setContracts(next);
          await persist({ invoices, quotes, expenses, contracts: next });
        }
      },
      onCancel: () => setConfirmDialog(null),
    });
  }


  function shareRecord(record, type = "invoice") {
    setShareItem({ record, type });
  }

  function shareQuote(q) {
    setShareItem({ record: q, type: "quote" });
  }

  function _reportData() {
    const now = Date.now();
    const cutoffMs = reportRange === "1y" ? now - 365 * 86400000
      : reportRange === "6m" ? now - 183 * 86400000
      : reportRange === "90d" ? now - 90 * 86400000
      : now - 30 * 86400000;
    const invDate = i => {
      if (i.payments?.length > 0) return i.payments[i.payments.length - 1].paid_at;
      return i.paid_at || i.delivered_at || i.issue_date || i.issued_at || i.created_at;
    };
    const expDate = e => e.date || e.expense_date || e.issue_date || e.created_at;
    const inRange = d => d && new Date(d).getTime() >= cutoffMs;
    const getRef = (record, map) => {
      const stored = record.reference || record.invoice_number || record.quote_number || "";
      if (!isUuidLike(stored) && stored) return stored;
      return map?.get(record.id) || "—";
    };
    const rangeLabel = { "30d": "Last30Days", "90d": "Last90Days", "6m": "Last6Months", "1y": "LastYear" }[reportRange] || "Report";
    const rangeName = { "30d": "Last 30 Days", "90d": "Last 90 Days", "6m": "Last 6 Months", "1y": "Last Year" }[reportRange] || "";
    const rows = [
      ...invoices.filter(i => inRange(invDate(i))).map(i => ({
        type: "Invoice", party: i.customer_name || i.counterparty_name || "—",
        reference: getRef(i, invoiceRefMap),
        description: i.description || i.product_name || "—",
        amount: Number(i.total_amount || i.amount || 0), currency: i.currency || wsCurrency || "",
        status: i.status || "—", date: invDate(i)?.slice(0,10) || "—"
      })),
      ...expenses.filter(e => inRange(expDate(e))).map(e => ({
        type: "Expense", party: e.vendor_name || e.party_name || "—",
        reference: getRef(e, null),
        description: e.description || e.category || "—",
        amount: Number(e.total_amount || e.amount || 0), currency: e.currency || wsCurrency || "",
        status: e.status || "—", date: expDate(e)?.slice(0,10) || "—"
      })),
      ...quotes.filter(q => inRange(q.sent_at || q.issue_date || q.created_at)).map(q => ({
        type: "Quote", party: q.customer_name || q.counterparty_name || "—",
        reference: getRef(q, quoteRefMap),
        description: q.description || q.title || "—",
        amount: Number(q.total_amount || q.amount || 0), currency: q.currency || wsCurrency || "",
        status: q.status || "—", date: (q.sent_at || q.issue_date || q.created_at)?.slice(0,10) || "—"
      })),
    ];
    return { rows, rangeLabel, rangeName };
  }

  function exportCSV() {
    const { rows, rangeLabel } = _reportData();
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Type","Party","Reference","Description","Amount","Currency","Status","Date"];
    const lines = [header, ...rows.map(r => [r.type,r.party,r.reference,r.description,r.amount,r.currency,r.status,r.date])];
    const csv = lines.map(r => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `BusinessReport_${rangeLabel}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPDF() {
    const { rows, rangeName, rangeLabel } = _reportData();
    const fmtAmt = (n, cur) => {
      const iso = (String(cur||"").match(/\(([A-Z]{3})\)/)?.[1] || String(cur||"")).toUpperCase().slice(0,3) || "GBP";
      try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: iso, maximumFractionDigits: 2 }).format(n); }
      catch { return `${iso} ${Number(n).toFixed(2)}`; }
    };
    const wsIso = (String(wsCurrency||"GBP").match(/\(([A-Z]{3})\)/)?.[1] || String(wsCurrency||"GBP")).toUpperCase().slice(0,3);
    const totalRev = rows.filter(r => r.type === "Invoice").reduce((s, r) => s + r.amount, 0);
    const totalCost = rows.filter(r => r.type === "Expense").reduce((s, r) => s + r.amount, 0);
    const generatedDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const filename = `BusinessReport_${rangeLabel}.pdf`;

    function buildWithJsPDF(jsPDF) {
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      // Header bar
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, W, 18, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(13); doc.setFont("helvetica", "bold");
      doc.text("Business Operations Report", 10, 12);
      doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.text(`Period: ${rangeName}  ·  Generated: ${generatedDate}`, W - 10, 12, { align: "right" });
      // KPI summary boxes
      const kpis = [
        { label: "Total Revenue", val: fmtAmt(totalRev, wsIso) },
        { label: "Total Costs", val: fmtAmt(totalCost, wsIso) },
        { label: "Net", val: fmtAmt(totalRev - totalCost, wsIso) },
        { label: "Transactions", val: String(rows.length) },
      ];
      const boxW = (W - 20) / kpis.length;
      kpis.forEach((k, i) => {
        const x = 10 + i * boxW;
        doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240);
        doc.roundedRect(x, 22, boxW - 4, 18, 2, 2, "FD");
        doc.setTextColor(100, 116, 139); doc.setFontSize(7); doc.setFont("helvetica", "normal");
        doc.text(k.label.toUpperCase(), x + 4, 29);
        doc.setTextColor(15, 23, 42); doc.setFontSize(12); doc.setFont("helvetica", "bold");
        doc.text(k.val, x + 4, 36);
      });
      // Table
      const cols = ["Type","Party","Reference","Description","Amount","Status","Date"];
      const colW = [22, 42, 30, 60, 28, 22, 22];
      let y = 46;
      // Header row
      doc.setFillColor(241, 245, 249); doc.rect(10, y, W - 20, 7, "F");
      doc.setTextColor(71, 85, 105); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      let cx = 10;
      cols.forEach((c, i) => { doc.text(c, cx + 2, y + 5); cx += colW[i]; });
      y += 7;
      doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      if (rows.length === 0) {
        doc.setTextColor(148, 163, 184);
        doc.text("No transactions in this period", W / 2, y + 8, { align: "center" });
      } else {
        rows.forEach((r, idx) => {
          if (y > doc.internal.pageSize.getHeight() - 15) { doc.addPage(); y = 15; }
          if (idx % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(10, y, W - 20, 7, "F"); }
          doc.setTextColor(30, 41, 59);
          cx = 10;
          const cells = [r.type, r.party, r.reference, r.description, fmtAmt(r.amount, r.currency), r.status, r.date];
          cells.forEach((cell, i) => {
            const text = String(cell ?? "");
            const maxW = colW[i] - 3;
            const truncated = doc.getStringUnitWidth(text) * 8 / doc.internal.scaleFactor > maxW
              ? doc.splitTextToSize(text, maxW)[0] + "…" : text;
            doc.text(truncated, cx + 2, y + 5);
            cx += colW[i];
          });
          doc.setDrawColor(241, 245, 249);
          doc.line(10, y + 7, W - 10, y + 7);
          y += 7;
        });
      }
      doc.save(filename);
    }

    if (window.jspdf?.jsPDF) {
      buildWithJsPDF(window.jspdf.jsPDF);
    } else {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = () => buildWithJsPDF(window.jspdf.jsPDF);
      document.head.appendChild(s);
    }
  }

  function openCreate(type) {
    const prefix = type === "invoice" ? "INV" : type === "quote" ? "QUO" : type === "expense" ? "EXP" : "CON";
    const existingList = type === "invoice" ? invoices : type === "quote" ? quotes : type === "expense" ? expenses : contracts;
    const nextRef = dayRef(prefix, Date.now(), existingList);
    setRecordModal({ mode: "create", type, record: null, nextRef });
  }

  function _withComputedRef(type, record) {
    const stored = record?.reference || record?.invoice_number || record?.quote_number || "";
    if (!isUuidLike(stored) && stored) return record;
    const map = type === "invoice" ? invoiceRefMap : type === "quote" ? quoteRefMap : type === "contract" ? contractRefMap : null;
    const computed = map?.get(record?.id);
    return computed ? { ...record, reference: computed } : record;
  }

  function openEdit(type, record) {
    setRecordModal({ mode: "edit", type, record: _withComputedRef(type, record) });
  }

  function openView(type, record, opts = {}) {
    setRecordModal({ mode: "view", type, record: _withComputedRef(type, record), ...opts });
  }

  async function markAsPaid(type, id) {
    return markAsStatus(type, id, "paid");
  }

  async function recordDelivery(invoiceId, deliveredAt) {
    const now = new Date().toISOString();
    const next = invoices.map(i => i.id === invoiceId ? { ...i, status: "delivered", delivered_at: deliveredAt || now, updated_at: now } : i);
    setInvoices(next);
    await persist({ invoices: next, quotes, expenses, contracts });
  }

  async function markAsStatus(type, id, status) {
    const now = new Date().toISOString();
    if (type === "invoice") {
      const statusStamp = status === "paid" ? { paid_at: now } : {};
      const next = invoices.map(i => i.id === id ? { ...i, status, updated_at: now, ...statusStamp } : i);
      setInvoices(next);
      await persist({ invoices: next, quotes, expenses, contracts });
    } else if (type === "expense") {
      const next = expenses.map(e => e.id === id ? { ...e, status, updated_at: now } : e);
      setExpenses(next);
      await persist({ invoices, quotes, expenses: next, contracts });
    } else if (type === "quote") {
      const next = quotes.map(q => q.id === id ? { ...q, status, updated_at: now } : q);
      setQuotes(next);
      await persist({ invoices, quotes: next, expenses, contracts });
    } else if (type === "contract") {
      const next = contracts.map(c => c.id === id ? { ...c, status, updated_at: now } : c);
      setContracts(next);
      await persist({ invoices, quotes, expenses, contracts: next });
    }
  }

  function saveRecord(saved) {
    const type = recordModal?.type;
    let persistPayload = null;
    if (type === "invoice") {
      const existing = invoices.find(i => i.id === saved.id);
      if (!existing && (!saved.reference || isUuidLike(saved.reference))) {
        saved.reference = dayRef("INV", new Date(), invoices);
        saved.invoice_number = saved.reference;
      }
      const next = existing ? invoices.map(i => i.id === saved.id ? saved : i) : [...invoices, { ...saved, created_at: new Date().toISOString() }];
      setInvoices(next);
      persistPayload = { invoices: next, quotes, expenses, contracts };
    } else if (type === "quote") {
      const existing = quotes.find(q => q.id === saved.id);
      if (!existing && (!saved.reference || isUuidLike(saved.reference))) {
        saved.reference = dayRef("QUO", new Date(), quotes);
      }
      const next = existing ? quotes.map(q => q.id === saved.id ? saved : q) : [...quotes, { ...saved, created_at: new Date().toISOString() }];
      setQuotes(next);
      persistPayload = { invoices, quotes: next, expenses, contracts };
    } else if (type === "expense") {
      const existing = expenses.find(e => e.id === saved.id);
      if (!existing && (!saved.reference || isUuidLike(saved.reference))) {
        saved.reference = dayRef("EXP", new Date(), expenses);
      }
      const next = existing ? expenses.map(e => e.id === saved.id ? saved : e) : [...expenses, { ...saved, created_at: new Date().toISOString() }];
      setExpenses(next);
      persistPayload = { invoices, quotes, expenses: next, contracts };
    } else if (type === "contract") {
      const existing = contracts.find(c => c.id === saved.id);
      if (!existing && (!saved.reference || isUuidLike(saved.reference))) {
        saved.reference = dayRef("CON", new Date(), contracts);
      }
      const next = existing ? contracts.map(c => c.id === saved.id ? saved : c) : [...contracts, { ...saved, created_at: new Date().toISOString() }];
      setContracts(next);
      persistPayload = { invoices, quotes, expenses, contracts: next };
    }
    setRecordModal(null); // close immediately — persist happens in background
    if (persistPayload) persist(persistPayload).catch(() => {});
  }

  async function recordPayment(invoiceId, amount, paidAt, note) {
    const newPayment = { id: crypto.randomUUID(), amount: Number(amount), paid_at: paidAt || new Date().toISOString(), note: note || null };
    const next = invoices.map(inv => {
      if (inv.id !== invoiceId) return inv;
      const payments = [...(inv.payments || []), newPayment];
      const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
      const total = Number(inv.total_amount || inv.subtotal_amount || inv.amount || 0);
      return { ...inv, payments, paid_amount: totalPaid,
        payment_type: totalPaid >= total ? "full" : "partial",
        status: "paid", paid_at: inv.paid_at || paidAt || new Date().toISOString(),
        updated_at: new Date().toISOString() };
    });
    setInvoices(next);
    await persist({ invoices: next, quotes, expenses, contracts });
  }

  // ---- Icons ----
  const IDoc = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>;
  const IDownload = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="21" x2="12" y2="9"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>;
  const ISend = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
  const IClock = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
  const ICheck = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
  const IPound = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="6" y1="12" x2="14" y2="12"/><path d="M8 20h10"/><path d="M8 12V7.5A3.5 3.5 0 0 1 15 7v.5"/><path d="M8 12v4a2 2 0 0 1-2 2"/></svg>;
  const ICalendar = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
  const ICashIn = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="21" x2="12" y2="9"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>;
  const ICashOut = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="16 7 12 3 8 7"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>;
  const IWallet = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><circle cx="17.5" cy="16" r="1"/></svg>;
  const ICard = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>;
  const ITrend = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>;
  const ITarget = <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;

  const reportRangeLabel = { "30d": "Last 30 Days", "90d": "Last 90 Days", "6m": "Last 6 Months", "1y": "Last Year" };

  // --- Header action buttons per tab ---
  const headerActions = {
    Sales: salesSub === "Receipts" ? null : <button type="button" onClick={() => {
      if (salesSub === "Invoices") openCreate("invoice");
      else openCreate("quote");
    }} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"><span className="text-lg leading-none">+</span> Create</button>,
    Procurement: <button type="button" onClick={() => { setProcSub("Requests"); setReqCreateTrigger(v => v + 1); }} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"><span className="text-lg leading-none">+</span> New Request</button>,
    Contracts: <button type="button" onClick={() => openCreate("contract")} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"><span className="text-lg leading-none">+</span> Create Contract</button>,
    Transactions: <button type="button" onClick={() => openCreate("invoice")} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"><span className="text-lg leading-none">+</span> New Transaction</button>,
    Reports: <div className="flex gap-2 relative">
      <div className="relative">
        <button type="button" onClick={() => setShowRangeMenu(v => !v)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          {reportRangeLabel[reportRange]}
          <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        {showRangeMenu && createPortal(
          <div className="fixed inset-0 z-40" onClick={() => setShowRangeMenu(false)}>
            <div className="absolute right-0 mt-1 w-40 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden"
              style={{ top: document.querySelector("[data-range-btn]")?.getBoundingClientRect().bottom + 4 + window.scrollY || 120, right: 24 }}
              onClick={e => e.stopPropagation()}>
              {Object.entries(reportRangeLabel).map(([k, v]) => (
                <button key={k} type="button"
                  className={`block w-full px-4 py-2 text-left text-sm hover:bg-slate-50 ${reportRange === k ? "font-semibold text-indigo-600" : "text-slate-700"}`}
                  onClick={() => { setReportRange(k); setShowRangeMenu(false); }}>
                  {v}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
      </div>
      <div className="relative">
        <div className="inline-flex rounded-xl overflow-hidden border border-indigo-600">
          <button type="button" onClick={exportCSV}
            className="inline-flex items-center gap-1.5 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export Report</button>
          <button type="button" onClick={() => setShowExportMenu(v => !v)}
            className="flex items-center px-2 bg-indigo-700 hover:bg-indigo-800 text-white border-l border-indigo-500 transition">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
        {showExportMenu && createPortal(
          <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)}>
            <div className="absolute right-6 mt-1 w-40 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden"
              style={{ top: (document.querySelector("[data-export-btn]")?.getBoundingClientRect().bottom ?? 60) + 4 + window.scrollY }}
              onClick={e => e.stopPropagation()}>
              <button type="button" onClick={() => { exportCSV(); setShowExportMenu(false); }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Export as CSV</button>
              <button type="button" onClick={() => { exportPDF(); setShowExportMenu(false); }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/><polyline points="9 9 10 9 14 9"/></svg>
                Export as PDF</button>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>,
  };

  return (
    <div>
      <PageHeader
        title="Business Operations"
        badge={{ tone: "brand", text: "Live" }}
        description="Manage sales, procurement, contracts and business transactions with live operational intelligence."
        actions={headerActions[activeTab] || null}
      />

      {/* Main tab bar - pill style */}
      <div className="mt-4 flex gap-1 rounded-xl bg-slate-100 p-1 overflow-x-auto">
        {MAIN_TABS.map(t => (
          <button key={t} type="button" onClick={() => setActiveTab(t)}
            className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition min-w-max
              ${activeTab === t ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">

        {/* ===== OVERVIEW ===== */}
        {activeTab === "Overview" && (
          <>
            <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
              <KpiCard icon={IDoc} label="Active Requests" value={m.activeRfqs} numColor="text-blue-600" iconBg="bg-blue-50" iconColor="text-blue-600" />
              <KpiCard icon={IDownload} label="Proposals Received" value={m.rfqProposalsReceived} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
              <KpiCard icon={ISend} label="Proposals Submitted" value={m.proposalsSubmitted} numColor="text-teal-600" iconBg="bg-teal-50" iconColor="text-teal-600" />
              <KpiCard icon={IClock} label="Awaiting Action" value={m.awaitingResponse + m.awaitingEvaluation} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
              <KpiCard icon={ICheck} label="Active Contracts" value={m.activeContracts} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
              <KpiCard icon={IPound} label="Receivables" value={fmtMoney(m.receivables)} numColor="text-indigo-600" iconBg="bg-indigo-50" iconColor="text-indigo-600" />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="mb-4 text-sm font-bold text-indigo-600">Proposal Activity</div>
                <div className="space-y-3">
                  {[
                    { dot: "bg-emerald-500", label: "Received", val: m.rfqProposalsReceived },
                    { dot: "bg-blue-500", label: "Shortlisted", val: m.quotationsViewed },
                    { dot: "bg-amber-500", label: "Under Review", val: m.awaitingEvaluation },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2.5">
                        <span className={`h-2 w-2 rounded-full ${row.dot} shrink-0`} />
                        <span className="text-slate-700">{row.label}</span>
                      </div>
                      <span className="font-semibold text-slate-900">{row.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="mb-4 text-sm font-bold text-indigo-600">Commercial Pipeline</div>
                <div className="space-y-3">
                  {[
                    { dot: "bg-emerald-500", label: "Requests Open", val: m.activeRfqs },
                    { dot: "bg-blue-500", label: "Quotations Pending", val: m.awaitingResponse },
                    { dot: "bg-amber-500", label: "Contracts Awaiting Approval", val: m.awaitingApproval },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2.5">
                        <span className={`h-2 w-2 rounded-full ${row.dot} shrink-0`} />
                        <span className="text-slate-700">{row.label}</span>
                      </div>
                      <span className="font-semibold text-slate-900">{row.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="mb-4 text-sm font-bold text-slate-900">Operational Intelligence</div>
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-500">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                  </div>
                  <p className="text-sm text-slate-600">{m.awaitingResponse > 0 ? `${m.awaitingResponse} bids require attention` : "Pipeline is on track"}</p>
                </div>
                <button type="button" onClick={() => { setActiveTab("Reports"); setReportSub("Summary"); }} className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition">
                  View Reports
                </button>
              </div>
            </div>
          </>
        )}

        {/* ===== SALES ===== */}
        {activeTab === "Sales" && (
          <>
            <SubTabs tabs={["Pipeline", "Quotations", "Invoices", "Receipts"]} active={salesSub} onChange={setSalesSub} />
            {salesSub === "Pipeline" && (
              <>
                <div className="flex gap-3 overflow-x-auto">
                  <KpiCard icon={ISend} label="Proposals Submitted" value={m.proposalsSubmitted} numColor="text-teal-600" iconBg="bg-teal-50" iconColor="text-teal-600" />
                  <KpiCard icon={IDoc} label="Quotations Sent" value={m.quotationsSent} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                  <KpiCard icon={IClock} label="Awaiting Response" value={m.awaitingResponse} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                  <KpiCard icon={IPound} label="Potential Value" value={fmtMoney(m.potentialValue)} numColor="text-indigo-600" iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="mb-3 text-sm font-semibold text-slate-900">Sales Pipeline</div>
                  <Pipeline stages={[
                    { label: "Draft", value: quotes.filter(q => !q.status || q.status === "draft").length, bg: "bg-slate-100", textColor: "text-slate-500" },
                    { label: "Submitted", value: quotes.filter(q => q.status === "sent").length, bg: "bg-blue-100", textColor: "text-blue-600" },
                    { label: "Viewed", value: quotes.filter(q => q.status === "viewed").length, bg: "bg-teal-100", textColor: "text-teal-600" },
                    { label: "Negotiation", value: quotes.filter(q => q.status === "negotiation" || q.status === "in_negotiation").length, bg: "bg-amber-100", textColor: "text-amber-600" },
                    { label: "Won", value: m.wonQuotes, bg: "bg-emerald-100", textColor: "text-emerald-600" },
                  ]} />
                </div>

                <IntelBox
                  message={m.awaitingResponse > 0 ? `${m.awaitingResponse} bids awaiting response - follow up to improve win rate` : m.wonQuotes > 0 ? `Win rate is ${m.winRate}% - check Sales Performance for trends` : quotes.length === 0 ? "No quotations yet" : "Sales pipeline is healthy"}
                  btnLabel="View Sales Report"
                  onBtn={() => { setActiveTab("Reports"); setReportSub("Sales Performance"); }}
                />

                <TableSection
                  title="Recent Sales Activity"
                  searchPlaceholder="Search sales activity..."
                  cols={["Customer", "Type", "Reference", "Value", "Status", "Updated", "Action"]}
                  rows={[...quotes].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 8).map(q => ({
                    Customer: q.customer_name || q.recipient || "—",
                    Type: <span className="capitalize">{q.type || "Quotation"}</span>,
                    Reference: quoteRefMap.get(q.id) || "—",
                    Value: (q.total_amount || q.amount) ? `£${Number(q.total_amount || q.amount).toLocaleString()}` : "—",
                    Status: <StatusPill status={q.status || "Draft"} />,
                    Updated: fmtDate(q.updated_at || q.created_at),
                    Action: <ActionMenu items={[{ label: "View", onClick: () => openView("quote", q) }, { label: "Edit", onClick: () => openEdit("quote", q) }, ...(["draft", ""].includes(q.status || "") ? [{ label: "Mark as Sent", onClick: () => markAsStatus("quote", q.id, "sent") }] : []), ...(!["won", "rejected"].includes(q.status || "") ? [{ label: "Mark as Won", onClick: () => markAsStatus("quote", q.id, "won") }] : []), { label: "Share", onClick: () => shareQuote(q) }, { label: "Delete", tone: "danger", onClick: () => deleteItem("quote", q.id) }]} />,
                  }))}
                  emptyText="No sales activity yet"
                />
              </>
            )}
            {salesSub === "Quotations" && (
              <>
                <div className="flex gap-3 overflow-x-auto">
                  <KpiCard icon={IDoc} label="Sent Quotations" value={quotes.length} numColor="text-blue-600" iconBg="bg-blue-50" iconColor="text-blue-600" />
                  <KpiCard icon={IClock} label="Awaiting Response" value={m.awaitingResponse} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                  <KpiCard icon={ISend} label="Inbound RFQs" value={rfqRequests.length} numColor="text-rose-600" iconBg="bg-rose-50" iconColor="text-rose-600" />
                  <KpiCard icon={IPound} label="Total Value" value={fmtMoney(m.potentialValue)} numColor="text-indigo-600" iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                </div>
                <TableSection
                  title="Sent Quotations"
                  searchPlaceholder="Search quotations..."
                  cols={["Customer", "Reference", "Description", "Amount", "Status", "Date", "Action"]}
                  rows={[...quotes].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(q => ({
                    Customer: q.customer_name || q.recipient || "—",
                    Reference: quoteRefMap.get(q.id) || "—",
                    Description: q.description || q.title || "—",
                    Amount: formatMoney(Number(q.total_amount || q.amount || 0), q.currency),
                    Status: <StatusPill status={q.status || "Draft"} />,
                    Date: fmtDate(q.created_at || q.updated_at),
                    Action: <ActionMenu items={[{ label: "View", onClick: () => openView("quote", q) }, { label: "Edit", onClick: () => openEdit("quote", q) }, ...(["draft", ""].includes(q.status || "") ? [{ label: "Mark as Sent", onClick: () => markAsStatus("quote", q.id, "sent") }] : []), ...(!["won", "rejected"].includes(q.status || "") ? [{ label: "Mark as Won", onClick: () => markAsStatus("quote", q.id, "won") }] : []), { label: "Share", onClick: () => shareQuote(q) }, { label: "Delete", tone: "danger", onClick: () => deleteItem("quote", q.id) }]} />,
                  }))}
                  emptyText="No quotations yet"
                />
                {/* Inbound RFQs — buyers who requested a quote from us via Marketplace */}
                <TableSection
                  title="Inbound RFQs"
                  searchPlaceholder="Search inbound requests..."
                  cols={["From", "Items", "Message", "Status", "Received", "Action"]}
                  rows={[...rfqRequests].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(r => ({
                    From: r.customer_name || r.customer_email || "—",
                    Items: Array.isArray(r.items) ? r.items.map(i => `${i.quantity || 1}× ${i.name}`).join(", ") : "—",
                    Message: r.message || "—",
                    Status: <StatusPill status={r.status === "approved" ? "Responded" : r.status === "rejected" ? "Declined" : "Pending"} />,
                    Received: fmtDate(r.created_at),
                    Action: <ActionMenu items={[
                      ...(r.status === "pending" ? [
                        { label: "Respond with Quote", onClick: () => setRfqRespondTarget(r) },
                        { label: "Decline", onClick: async () => { await apiRequest(`/marketplace/rfq/${r.id}/reject`, "POST"); persist(null); } },
                      ] : []),
                      ...(r.quote_id ? [{ label: "View Quote", onClick: () => { const q = quotes.find(q => q.id === r.quote_id); if (q) openView("quote", q); } }] : []),
                    ]} />,
                  }))}
                  emptyText="No inbound RFQs yet"
                />
              </>
            )}
            {salesSub === "Invoices" && (
              <>
                <div className="flex gap-3 overflow-x-auto">
                  <KpiCard icon={IDoc} label="Total Invoices" value={invoices.length} numColor="text-blue-600" iconBg="bg-blue-50" iconColor="text-blue-600" />
                  <KpiCard icon={ICheck} label="Paid" value={invoices.filter(i => i.status === "paid").length} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                  <KpiCard icon={IClock} label="Overdue" value={m.overdueInvoices} numColor="text-rose-600" iconBg="bg-rose-50" iconColor="text-rose-600" />
                  <KpiCard icon={IPound} label="Receivables" value={fmtMoney(m.receivables)} numColor="text-indigo-600" iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                </div>
                <TableSection
                  title="Invoices"
                  searchPlaceholder="Search invoices..."
                  filterValues={["draft","sent","delivered","paid","overdue","partial"]}
                  cols={["Customer", "Invoice #", "Description", "Amount", "Status", "Due Date", "Action"]}
                  rows={[...invoices].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(inv => ({
                    _filter: (inv.status || "draft").toLowerCase(),
                    Customer: inv.customer_name || inv.recipient || inv.counterparty_name || "—",
                    "Invoice #": invoiceRefMap.get(inv.id) || "—",
                    Description: inv.description || inv.product_name || (Array.isArray(inv.product_names) ? inv.product_names.join(', ') : inv.product_names) || inv.title || "—",
                    Amount: formatMoney(Number(inv.total_amount || inv.amount || 0), inv.currency),
                    Status: <StatusPill status={inv.status || "Draft"} paymentType={inv.payment_type} />,
                    "Due Date": fmtDate(inv.due_date || inv.created_at),
                    Action: <ActionMenu items={[{ label: "View Invoice", onClick: () => openView("invoice", inv) }, { label: "Edit", onClick: () => openEdit("invoice", inv) }, ...(  (inv.status||"").toLowerCase() !== "delivered" ? [{ label: "Mark as Delivered", onClick: () => setDeliveryInvoice(inv) }] : [{ label: "Mark as UnDelivered", onClick: () => markAsStatus("invoice", inv.id, "sent") }]), { label: "Record Payment", onClick: () => setPaymentInvoice(inv) }, { label: "Share", onClick: () => shareRecord(inv) }, { label: "Delete", tone: "danger", onClick: () => deleteItem("invoice", inv.id) }]} />,
                  }))}
                  emptyText="No invoices yet"
                />
              </>
            )}
            {salesSub === "Receipts" && (() => {
              const paidInvoices = invoices.filter(i => i.status === "paid" || i.status === "partial").sort((a, b) => new Date(b.paid_at || b.created_at || 0) - new Date(a.paid_at || a.created_at || 0));
              const totalReceived = paidInvoices.reduce((s, i) => {
                const pmts = (i.payments || []).reduce((ps, p) => ps + Number(p.amount || 0), 0);
                return s + (pmts > 0 ? pmts : Number(i.total_amount || i.amount || 0));
              }, 0);
              return (
                <>
                  <div className="flex gap-3 overflow-x-auto">
                    <KpiCard icon={ICheck} label="Receipts Issued" value={paidInvoices.length} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                    <KpiCard icon={ICheck} label="Fully Paid" value={invoices.filter(i => i.status === "paid").length} numColor="text-teal-600" iconBg="bg-teal-50" iconColor="text-teal-600" />
                    <KpiCard icon={IClock} label="Partial Payments" value={invoices.filter(i => i.status === "partial").length} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                    <KpiCard icon={IPound} label="Total Received" value={fmtMoney(totalReceived)} numColor="text-indigo-600" iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                  </div>
                  <TableSection
                    title="Receipts"
                    searchPlaceholder="Search receipts..."
                    cols={["Customer", "Invoice #", "Amount", "Date Paid", "Status", "Action"]}
                    rows={paidInvoices.map(r => ({
                      Customer: r.customer_name || r.recipient || r.counterparty_name || "—",
                      "Invoice #": invoiceRefMap.get(r.id) || "—",
                      Amount: formatMoney(Number(r.total_amount || r.amount || 0), r.currency),
                      "Date Paid": fmtDate(r.paid_at || r.date || r.created_at),
                      Status: <StatusPill status={r.status} paymentType={r.payment_type} />,
                      Action: <ActionMenu items={[{ label: "View Receipt", onClick: () => openView("invoice", r, { receiptMode: true }) }, { label: "View Invoice", onClick: () => openView("invoice", r) }]} />,
                    }))}
                    emptyText="No receipts yet"
                  />
                </>
              );
            })()}
          </>
        )}

        {/* ===== PROCUREMENT ===== */}
        {activeTab === "Procurement" && (
          <>
            <SubTabs tabs={["Overview", "Requests", "Sent RFQs", "Inbox", "Activity", "Evaluations", "Awards"]} active={procSub} onChange={setProcSub} />
            {procSub === "Overview" && (() => {
              const activeReqs = proposalRequests.filter(r => r.status === "PUBLISHED");
              const totalProposals = proposalRequests.reduce((s, r) => s + (r.submission_count || 0), 0);
              const withProposals = proposalRequests.filter(r => r.status === "PUBLISHED" && r.submission_count > 0).length;
              const procUpcoming = proposalRequests.filter(r => {
                if (!r.deadline) return false;
                const diff = new Date(r.deadline).getTime() - Date.now();
                return diff > 0 && diff < 7 * 86400000;
              }).length;
              return (
                <>
                  <div className="flex gap-3 overflow-x-auto">
                    <KpiCard icon={IDoc} label="Active Requests" value={activeReqs.length} numColor="text-blue-600" iconBg="bg-blue-50" iconColor="text-blue-600" />
                    <KpiCard icon={IDownload} label="Proposals Received" value={totalProposals} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                    <KpiCard icon={IClock} label="Awaiting Evaluation" value={withProposals} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                    <KpiCard icon={ICalendar} label="Upcoming Deadlines" value={procUpcoming} numColor="text-indigo-600" iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                    <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Procurement Pipeline</div>
                    <Pipeline stages={[
                      { label: "Draft", value: proposalRequests.filter(r => r.status === "DRAFT").length, bg: "bg-slate-100", textColor: "text-slate-500" },
                      { label: "Published", value: proposalRequests.filter(r => r.status === "PUBLISHED").length, bg: "bg-blue-100", textColor: "text-blue-600" },
                      { label: "Has Proposals", value: withProposals, bg: "bg-teal-100", textColor: "text-teal-600" },
                      { label: "Paused", value: proposalRequests.filter(r => r.status === "PAUSED").length, bg: "bg-amber-100", textColor: "text-amber-600" },
                      { label: "Closed", value: proposalRequests.filter(r => r.status === "CLOSED" || r.status === "EXPIRED").length, bg: "bg-emerald-100", textColor: "text-emerald-600" },
                    ]} />
                  </div>
                  <IntelBox
                    message={procUpcoming > 0 ? `${procUpcoming} request${procUpcoming > 1 ? "s" : ""} close within 7 days — review before deadline` : totalProposals > 0 ? `${totalProposals} proposal${totalProposals > 1 ? "s" : ""} received across ${activeReqs.length} active request${activeReqs.length !== 1 ? "s" : ""}` : proposalRequests.length > 0 ? "Requests published — awaiting proposals" : "No procurement requests yet"}
                    btnLabel="View Reports"
                    onBtn={() => { setActiveTab("Reports"); setReportSub("Procurement"); }}
                  />
                  <TableSection
                    title="Recent Activity"
                    searchPlaceholder="Search requests..."
                    cols={["Request", "Status", "Proposals", "Deadline", "Action"]}
                    rows={[...proposalRequests].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)).slice(0, 10).map(r => ({
                      Request: r.title || "—",
                      Status: <StatusPill status={r.status || "DRAFT"} />,
                      Proposals: r.submission_count ?? 0,
                      Deadline: r.deadline ? new Date(r.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
                      Action: <ActionMenu items={[
                        { label: "View Requests", onClick: () => setProcSub("Requests") },
                        { label: "View Evaluations", onClick: () => setProcSub("Evaluations") },
                      ]} />,
                    }))}
                    emptyText="No recent activity"
                  />
                </>
              );
            })()}
            {procSub === "Requests" && <div className="mt-2"><RequestsTab createTrigger={reqCreateTrigger} /></div>}
            {procSub === "Sent RFQs" && (
              <>
                <div className="flex gap-3 overflow-x-auto mt-2">
                  <KpiCard icon={IDoc} label="Total Sent" value={sentRfqs.length} numColor="text-violet-600" iconBg="bg-violet-50" iconColor="text-violet-600" />
                  <KpiCard icon={ICheck} label="Quote Received" value={sentRfqs.filter(r => r.status === "approved").length} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                  <KpiCard icon={IClock} label="Pending" value={sentRfqs.filter(r => r.status === "pending" || !r.status).length} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                </div>
                <TableSection
                  title="RFQs We Sent to Vendors"
                  searchPlaceholder="Search sent RFQs..."
                  cols={["Vendor", "Items", "Message", "Status", "Sent", "Action"]}
                  rows={[...sentRfqs].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(r => ({
                    Vendor: r.recipient_company_name || "—",
                    Items: Array.isArray(r.items) ? r.items.map(i => `${i.quantity || 1}× ${i.name}`).join(", ") : "—",
                    Message: r.message || "—",
                    Status: <StatusPill status={r.status === "approved" ? "Quote Received" : r.status === "rejected" ? "Declined" : "Pending"} />,
                    Sent: fmtDate(r.created_at),
                    Action: <ActionMenu items={[{ label: "Go to Marketplace", onClick: () => navigate("/marketplace") }]} />,
                  }))}
                  emptyText="No RFQs sent yet. Go to Marketplace to request quotes from vendors."
                />
              </>
            )}
            {procSub === "Inbox" && <div className="mt-2"><InboxTab /></div>}
            {procSub === "Activity" && <div className="mt-2"><ActivityTab /></div>}
            {procSub === "Evaluations" && (() => {
              const ACTIVE_REVIEW = ["UNDER_REVIEW","SHORTLISTED","PREFERRED","NEGOTIATION"];
              const activeReviewCount = proposalInbox.filter(p => ACTIVE_REVIEW.includes(p.status)).length;
              const unlinked = proposalInbox.filter(p => !p.request_id && !["DECLINED","WITHDRAWN","EXPIRED","ARCHIVED"].includes(p.status));
              return (
              <>
                <div className="mb-4">
                  <div className="text-[15px] font-bold text-slate-800 dark:text-slate-100">Evaluations</div>
                  <div className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">Review and compare vendor proposals received against your procurement requests.</div>
                </div>
                <div className="flex gap-3 overflow-x-auto">
                  <KpiCard icon={IClock} label="Under Evaluation"
                    value={activeReviewCount || proposalRequests.filter(r => r.status === "PUBLISHED" && r.submission_count > 0).length}
                    numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                  <KpiCard icon={ICalendar} label="Upcoming Deadlines"
                    value={proposalRequests.filter(r => {
                      if (!r.deadline) return false;
                      const diff = new Date(r.deadline).getTime() - Date.now();
                      return diff > 0 && diff < 7 * 86400000;
                    }).length}
                    numColor="text-indigo-600" iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                  {unlinked.length > 0 && <KpiCard icon={IDoc} label="Unlinked Proposals"
                    value={unlinked.length}
                    numColor="text-orange-500" iconBg="bg-orange-50" iconColor="text-orange-500" />}
                </div>
                <TableSection title="Evaluations" searchPlaceholder="Search evaluations..."
                  cols={["Request", "Proposals", "Deadline", "Status", "Action"]}
                  rows={proposalRequests.map(r => ({
                    Request: r.title || "—",
                    Proposals: r.submission_count ?? 0,
                    Deadline: r.deadline ? new Date(r.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
                    Status: <StatusPill status={r.status || "DRAFT"} />,
                    Action: <ActionMenu items={[
                      { label: "View Proposals", onClick: () => setProcSub("Inbox") },
                      { label: "View Request", onClick: () => setProcSub("Requests") },
                    ]} />,
                  }))}
                  emptyText="No proposal requests yet"
                />
              </>
              );
            })()}
            {procSub === "Awards" && (() => {
              const awarded = proposalInbox.filter(p => p.status === "AWARDED");
              const reqMap = new Map(proposalRequests.map(r => [r.id, r]));
              return (<>
                <div className="mb-4">
                  <div className="text-[15px] font-bold text-slate-800 dark:text-slate-100">Awards</div>
                  <div className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">Contracts awarded to vendors after evaluation and negotiation. Award a contract from the Inbox once in Negotiation stage.</div>
                </div>
                <TableSection title="Awards" searchPlaceholder="Search awards..."
                  cols={["Request", "Vendor", "Value", "Awarded", "Action"]}
                  rows={awarded.map(p => ({
                    Request: reqMap.get(p.request_id)?.title || p.request_title || "—",
                    Vendor: p.proposer_name || p.company_name || "—",
                    Value: p.total_value != null ? fmtMoney(Number(p.total_value)) : (p.budget != null ? fmtMoney(Number(p.budget)) : "—"),
                    Awarded: fmtDate(p.awarded_at || p.updated_at),
                    Action: <ActionMenu items={[{ label: "View Proposal", onClick: () => setProcSub("Inbox") }]} />,
                  }))}
                  emptyText="No awards yet. Award a contract from Procurement Inbox after negotiation."
                />
              </>);
            })()}
          </>
        )}

        {/* ===== CONTRACTS ===== */}
        {activeTab === "Contracts" && (
          <>
            <SubTabs tabs={["All Contracts", "Customer Contracts", "Vendor Contracts", "Drafts & Approvals", "Renewals"]} active={contractSub} onChange={setContractSub} />
            {contractSub === "All Contracts" && (
              <>
                <div className="flex gap-3 overflow-x-auto">
                  <KpiCard icon={IDoc} label="Active Contracts" value={m.activeContracts} numColor="text-blue-600" iconBg="bg-blue-50" iconColor="text-blue-600" />
                  <KpiCard icon={IClock} label="Awaiting Approval" value={m.awaitingApproval} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                  <KpiCard icon={ICalendar} label="Expiring Soon" value={m.expiringSoon} numColor="text-orange-500" iconBg="bg-orange-50" iconColor="text-orange-500" />
                  <KpiCard icon={IPound} label="Total Contract Value" value={fmtMoney(m.totalContractValue)} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="mb-3 text-sm font-semibold text-slate-900">Contract Lifecycle</div>
                  <Pipeline stages={[
                    { label: "Draft", value: contracts.filter(c => c.status === "draft").length, bg: "bg-slate-100", textColor: "text-slate-500" },
                    { label: "Awaiting Approval", value: m.awaitingApproval, bg: "bg-amber-100", textColor: "text-amber-600" },
                    { label: "Active", value: m.activeContracts, bg: "bg-emerald-100", textColor: "text-emerald-600" },
                    { label: "Expiring Soon", value: m.expiringSoon, bg: "bg-orange-100", textColor: "text-orange-500" },
                    { label: "Expired", value: contracts.filter(c => c.status === "expired").length, bg: "bg-rose-100", textColor: "text-rose-600" },
                  ]} />
                </div>

                <IntelBox
                  message={m.expiringSoon > 0 ? `${m.expiringSoon} contracts expire within 30 days - renew to avoid lapse` : m.awaitingApproval > 0 ? `${m.awaitingApproval} contracts awaiting approval` : contracts.length === 0 ? "No contracts yet" : "All contracts are current"}
                  btnLabel="Review Risks"
                  onBtn={() => { setActiveTab("Reports"); setReportSub("Contracts"); }}
                />

                <TableSection
                  title="Recent Contracts"
                  searchPlaceholder="Search contracts..."
                  cols={["Party", "Contract Type", "Reference", "Value", "End Date", "Status", "Source", "Action"]}
                  rows={[...contracts].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)).slice(0, 8).map(c => ({
                    Party: c.party_name || c.vendor_name || c.customer_name || "—",
                    "Contract Type": <StatusPill status={c.party_type === "customer" ? "Customer" : c.party_type === "vendor" ? "Vendor" : "—"} />,
                    Reference: contractRefMap.get(c.id) || "—",
                    Value: (c.price || c.amount || c.value) ? `£${Number(c.price || c.amount || c.value).toLocaleString()}` : "—",
                    "End Date": c.end_date ? new Date(c.end_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
                    Status: <StatusPill status={c.status || "Active"} />,
                    Source: c.source || "Manual",
                    Action: <ActionMenu items={[{ label: "View", onClick: () => openView("contract", c) }, { label: "Edit", onClick: () => openEdit("contract", c) }, ...(c.status !== "active" ? [{ label: "Mark as Active", onClick: () => markAsStatus("contract", c.id, "active") }] : []), { label: "Delete", tone: "danger", onClick: () => deleteItem("contract", c.id) }]} />,
                  }))}
                  emptyText="No contracts yet"
                />
              </>
            )}
            {contractSub === "Customer Contracts" && (
              <TableSection title="Customer Contracts" searchPlaceholder="Search customer contracts..."
                cols={["Customer", "Reference", "Value", "End Date", "Status", "Action"]}
                rows={contracts.filter(c => c.party_type === "customer" || (!c.party_type && c.customer_name)).map(c => ({
                  Customer: c.party_name || c.customer_name || "—",
                  Reference: c.reference || c.id?.slice(0, 10) || "—",
                  Value: (c.price || c.amount || c.value) ? fmtMoney(Number(c.price || c.amount || c.value)) : "—",
                  "End Date": c.end_date ? new Date(c.end_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
                  Status: <StatusPill status={c.status || "Active"} />,
                  Action: <ActionMenu items={[{ label: "View", onClick: () => openView("contract", c) }, { label: "Edit", onClick: () => openEdit("contract", c) }, ...(c.status !== "active" ? [{ label: "Mark as Active", onClick: () => markAsStatus("contract", c.id, "active") }] : []), { label: "Delete", tone: "danger", onClick: () => deleteItem("contract", c.id) }]} />,
                }))}
                emptyText="No customer contracts yet"
              />
            )}
            {contractSub === "Vendor Contracts" && (
              <TableSection title="Vendor Contracts" searchPlaceholder="Search vendor contracts..."
                cols={["Vendor", "Reference", "Value", "End Date", "Status", "Action"]}
                rows={contracts.filter(c => c.party_type === "vendor" || (!c.party_type && c.vendor_name)).map(c => ({
                  Vendor: c.party_name || c.vendor_name || "—",
                  Reference: c.reference || c.id?.slice(0, 10) || "—",
                  Value: (c.price || c.amount || c.value) ? fmtMoney(Number(c.price || c.amount || c.value)) : "—",
                  "End Date": c.end_date ? new Date(c.end_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
                  Status: <StatusPill status={c.status || "Active"} />,
                  Action: <ActionMenu items={[{ label: "View", onClick: () => openView("contract", c) }, { label: "Edit", onClick: () => openEdit("contract", c) }, ...(c.status !== "active" ? [{ label: "Mark as Active", onClick: () => markAsStatus("contract", c.id, "active") }] : []), { label: "Delete", tone: "danger", onClick: () => deleteItem("contract", c.id) }]} />,
                }))}
                emptyText="No vendor contracts yet"
              />
            )}
            {contractSub === "Drafts & Approvals" && (
              <TableSection title="Drafts & Approvals" searchPlaceholder="Search..."
                cols={["Party", "Reference", "Value", "Status", "Updated", "Action"]}
                rows={contracts.filter(c => c.status === "draft" || c.status === "pending" || c.status === "awaiting_approval").map(c => ({
                  Party: c.party_name || c.customer_name || c.vendor_name || "—",
                  Reference: c.reference || c.id?.slice(0, 10) || "—",
                  Value: (c.price || c.amount || c.value) ? fmtMoney(Number(c.price || c.amount || c.value)) : "—",
                  Status: <StatusPill status={c.status || "Draft"} />,
                  Updated: fmtDate(c.updated_at || c.created_at),
                  Action: <ActionMenu items={[{ label: "Review", onClick: () => openView("contract", c) }, { label: "Edit", onClick: () => openEdit("contract", c) }, { label: "Approve & Activate", onClick: () => markAsStatus("contract", c.id, "active") }, { label: "Delete", tone: "danger", onClick: () => deleteItem("contract", c.id) }]} />,
                }))}
                emptyText="No drafts or approvals pending"
              />
            )}
            {contractSub === "Renewals" && (
              <TableSection title="Renewals" searchPlaceholder="Search renewals..."
                cols={["Party", "Reference", "Value", "Expires", "Status", "Action"]}
                rows={contracts.filter(c => c.status === "expiring_soon" || c.status === "expired").map(c => ({
                  Party: c.party_name || c.customer_name || c.vendor_name || "—",
                  Reference: c.reference || c.id?.slice(0, 10) || "—",
                  Value: (c.price || c.amount || c.value) ? fmtMoney(Number(c.price || c.amount || c.value)) : "—",
                  Expires: c.end_date ? new Date(c.end_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
                  Status: <StatusPill status={c.status || "Expiring Soon"} />,
                  Action: <ActionMenu items={[{ label: "Renew / Edit", onClick: () => openEdit("contract", c) }, { label: "View", onClick: () => openView("contract", c) }, { label: "Mark as Active", onClick: () => markAsStatus("contract", c.id, "active") }]} />,
                }))}
                emptyText="No upcoming renewals"
              />
            )}
          </>
        )}

        {/* ===== TRANSACTIONS ===== */}
        {activeTab === "Transactions" && (
          <>
            <SubTabs tabs={["All Transactions", "Invoices", "Expenses", "Receipts", "Payments"]} active={txnSub} onChange={setTxnSub} />
            {txnSub === "All Transactions" && (
              <>
                <div className="flex gap-3 overflow-x-auto">
                  <KpiCard icon={ICashIn} label="Cash In" value={fmtMoney(m.cashIn)} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                  <KpiCard icon={ICashOut} label="Cash Out" value={fmtMoney(m.cashOut)} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                  <KpiCard icon={IWallet} label="Receivables" value={fmtMoney(m.receivables)} numColor="text-indigo-600" iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                  <KpiCard icon={ICard} label="Payables" value={fmtMoney(m.payables)} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="mb-4 text-sm font-semibold text-slate-900">Cash Movement</div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <div className="text-xs text-slate-500">Received (Invoices)</div>
                        <div className="mt-1 text-xl font-bold text-emerald-600">{fmtMoney(m.cashIn)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Paid Out (Expenses)</div>
                        <div className="mt-1 text-xl font-bold text-amber-500">{fmtMoney(m.cashOut)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Net Cash Movement</div>
                        <div className={`mt-1 text-xl font-bold ${m.netCash >= 0 ? "text-indigo-600" : "text-rose-600"}`}>{fmtMoney(m.netCash)}</div>
                      </div>
                    </div>
                  </div>
                  <IntelBox
                    message={m.overdueInvoices > 0 ? `${m.overdueInvoices} overdue invoices affecting cash flow - chase payments` : invoices.length === 0 ? "No invoices yet — create your first invoice to track cash flow" : "Cash flow is healthy"}
                    btnLabel="View Cash Impact"
                    onBtn={() => { setActiveTab("Reports"); setReportSub("Transactions"); }}
                  />
                </div>

                <TableSection
                  title="Recent Transactions"
                  searchPlaceholder="Search transactions..."
                  cols={["Type", "Party", "Reference", "Amount", "Date", "Status", "Linked Record", "Action"]}
                  rows={[
                    ...invoices.map(i => ({ ...i, _t: "Invoice", _party: i.party_name || i.customer_name || i.recipient || "—", _linked: i.contract_id || "—", amount: i.total_amount || i.amount })),
                    ...expenses.map(e => ({ ...e, _t: "Expense", _party: e.vendor_name || e.party_name || e.counterparty_name || "—", _linked: e.contract_id || "—", amount: e.total_amount || e.amount || e.price })),
                  ].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)).slice(0, 8).map(t => ({
                    Type: <StatusPill status={t._t} />,
                    Party: t._party,
                    Reference: (!isUuidLike(t.reference) && t.reference) ? t.reference : "—",
                    Amount: formatMoney(Number(t.total_amount || t.amount || 0), t.currency),
                    Date: fmtDate(t.date || t.created_at),
                    Status: <StatusPill status={t.status || "Pending"} paymentType={t.payment_type} />,
                    "Linked Record": t._linked,
                    Action: <ActionMenu items={[{ label: "View", onClick: () => openView(t._t === "Expense" ? "expense" : "invoice", t) }, { label: "Edit", onClick: () => openEdit(t._t === "Expense" ? "expense" : "invoice", t) }, ...(t._t === "Expense" && (t.status||"").toLowerCase() !== "paid" ? [{ label: "Mark as Paid", onClick: () => markAsPaid("expense", t.id) }] : []), ...(t._t !== "Expense" && (t.status||"").toLowerCase() !== "delivered" ? [{ label: "Mark as Delivered", onClick: () => markAsStatus("invoice", t.id, "delivered") }] : []), ...(t._t !== "Expense" && (t.status||"").toLowerCase() === "delivered" ? [{ label: "Mark as UnDelivered", onClick: () => markAsStatus("invoice", t.id, "sent") }] : []), ...(t._t !== "Expense" ? [{ label: "Record Payment", onClick: () => setPaymentInvoice(t) }] : []), { label: "Share", onClick: () => shareRecord(t) }, { label: "Delete", tone: "danger", onClick: () => deleteItem(t._t === "Expense" ? "expense" : "invoice", t.id) }]} />,
                  }))}
                  emptyText="No transactions yet"
                />
              </>
            )}
            {txnSub === "Invoices" && (
              <>
                <div className="flex gap-3 overflow-x-auto">
                  <KpiCard icon={IDoc} label="Total Invoices" value={invoices.length} numColor="text-blue-600" iconBg="bg-blue-50" iconColor="text-blue-600" />
                  <KpiCard icon={ICheck} label="Paid" value={invoices.filter(i => i.status === "paid").length} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                  <KpiCard icon={IClock} label="Overdue" value={m.overdueInvoices} numColor="text-rose-600" iconBg="bg-rose-50" iconColor="text-rose-600" />
                  <KpiCard icon={IPound} label="Outstanding" value={fmtMoney(m.receivables)} numColor="text-indigo-600" iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                </div>
                <TableSection title="Invoices" searchPlaceholder="Search invoices..."
                  filterValues={["draft","sent","delivered","paid","overdue","partial"]}
                  cols={["Customer", "Invoice #", "Description", "Amount", "Status", "Due Date", "Action"]}
                  rows={[...invoices].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(inv => ({
                    Customer: inv.customer_name || inv.party_name || "—",
                    "Invoice #": invoiceRefMap.get(inv.id) || "—",
                    Description: inv.description || inv.product_name || (Array.isArray(inv.product_names) ? inv.product_names.join(', ') : inv.product_names) || inv.title || "—",
                    Amount: formatMoney(Number(inv.total_amount || inv.amount || 0), inv.currency),
                    Status: <StatusPill status={inv.status || "Draft"} paymentType={inv.payment_type} />,
                    "Due Date": fmtDate(inv.due_date || inv.created_at),
                    Action: <ActionMenu items={[{ label: "View Invoice", onClick: () => openView("invoice", inv) }, { label: "Edit", onClick: () => openEdit("invoice", inv) }, ...(  (inv.status||"").toLowerCase() !== "delivered" ? [{ label: "Mark as Delivered", onClick: () => setDeliveryInvoice(inv) }] : [{ label: "Mark as UnDelivered", onClick: () => markAsStatus("invoice", inv.id, "sent") }]), { label: "Record Payment", onClick: () => setPaymentInvoice(inv) }, { label: "Share", onClick: () => shareRecord(inv) }, { label: "Delete", tone: "danger", onClick: () => deleteItem("invoice", inv.id) }]} />,
                  }))}
                  emptyText="No invoices yet"
                />
              </>
            )}
            {txnSub === "Expenses" && (
              <>
                <div className="flex gap-3 overflow-x-auto">
                  <KpiCard icon={IDoc} label="Total Expenses" value={expenses.length} numColor="text-blue-600" iconBg="bg-blue-50" iconColor="text-blue-600" />
                  <KpiCard icon={ICheck} label="Paid" value={expenses.filter(e => e.status === "paid").length} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                  <KpiCard icon={IClock} label="Pending" value={expenses.filter(e => e.status === "pending" || !e.status).length} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                  <KpiCard icon={IPound} label="Total" value={fmtMoney(expenses.reduce((s, e) => s + (Number(e.total_amount || e.amount || e.price) || 0), 0))} numColor="text-rose-600" iconBg="bg-rose-50" iconColor="text-rose-600" />
                </div>
                <TableSection title="Expenses" searchPlaceholder="Search expenses..."
                  cols={["Vendor", "Reference", "Description", "Amount", "Status", "Date", "Action"]}
                  rows={[...expenses].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(e => ({
                    Vendor: e.vendor_name || e.party_name || "—",
                    Reference: e.reference || e.id?.slice(0, 8) || "—",
                    Description: e.description || e.title || "—",
                    Amount: formatMoney(Number(e.total_amount || e.amount || e.price || 0), e.currency),
                    Status: <StatusPill status={e.status || "Pending"} />,
                    Date: fmtDate(e.date || e.created_at),
                    Action: <ActionMenu items={[{ label: "View", onClick: () => openView("expense", e) }, { label: "Edit", onClick: () => openEdit("expense", e) }, ...(e.status !== "paid" ? [{ label: "Mark as Paid", onClick: () => markAsPaid("expense", e.id) }] : []), { label: "Delete", tone: "danger", onClick: () => deleteItem("expense", e.id) }]} />,
                  }))}
                  emptyText="No expenses yet"
                />
              </>
            )}
            {txnSub === "Receipts" && (
              <TableSection title="Receipts" searchPlaceholder="Search receipts..."
                cols={["Party", "Reference", "Amount", "Date", "Status", "Action"]}
                rows={invoices.filter(i => i.status === "paid" || i.status === "partial").sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(r => ({
                  Party: r.customer_name || r.party_name || "—",
                  Reference: r.reference || r.id?.slice(0, 8) || "—",
                  Amount: formatMoney(receivedAmt(r), r.currency),
                  Date: fmtDate(r.paid_at || r.date || r.created_at),
                  Status: <StatusPill status={r.status || "paid"} />,
                  Action: <ActionMenu items={[{ label: "View", onClick: () => openView("invoice", r, { receiptMode: true }) }]} />,
                }))}
                emptyText="No receipts yet"
              />
            )}
            {txnSub === "Payments" && (
              <TableSection title="Payments" searchPlaceholder="Search payments..."
                cols={["Party", "Reference", "Amount", "Date", "Status", "Action"]}
                rows={expenses.filter(e => e.status === "paid").sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(p => ({
                  Party: p.vendor_name || p.supplier_name || p.party_name || "—",
                  Reference: p.reference || p.id?.slice(0, 8) || "—",
                  Amount: formatMoney(Number(p.total_amount || p.amount || 0), p.currency),
                  Date: fmtDate(p.paid_at || p.date || p.created_at),
                  Status: <StatusPill status="paid" />,
                  Action: <ActionMenu items={[{ label: "View", onClick: () => openView("expense", p) }]} />,
                }))}
                emptyText="No outgoing payments yet"
              />
            )}
          </>
        )}

        {/* ===== REPORTS ===== */}
        {activeTab === "Reports" && (
          <>
            <SubTabs tabs={["Summary", "Sales Performance", "Procurement", "Contracts", "Transactions"]} active={reportSub} onChange={setReportSub} />
            {reportSub === "Summary" && (() => {
              const W = 500, H = 140;
              const revPts = reportMonths.map(m => m.rev);
              const costPts = reportMonths.map(m => m.cost);
              const allY = [...revPts, ...costPts];
              const yMax = Math.max(...allY, 1) * 1.18;
              const xs = reportMonths.map((_, i) => (i / Math.max(reportMonths.length - 1, 1)) * W);
              const ry = revPts.map(v => H - (v / yMax) * (H - 20) - 10);
              const cy = costPts.map(v => H - (v / yMax) * (H - 20) - 10);
              const pathR = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(0)},${ry[i].toFixed(0)}`).join(" ");
              const pathC = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(0)},${cy[i].toFixed(0)}`).join(" ");
              const fillR = pathR + ` L${xs[xs.length - 1]},${H} L0,${H} Z`;
              const yLabels = [0, 0.25, 0.5, 0.75, 1].map(f => ({ y: H - f * (H - 20) - 10, label: fmtMoney(yMax * f, 0) }));
              const reportLib = [
                { icon: ITrend, title: "Sales & Proposal Performance", sub: "Pipeline, conversion and commercial value", tab: "Sales Performance" },
                { icon: IDownload, title: "Procurement & Vendor Performance", sub: "Requests, response quality and cycle time", tab: "Procurement" },
                { icon: ICheck, title: "Contract Risk & Commitments", sub: "Approvals, renewals and exposure", tab: "Contracts" },
                { icon: ICard, title: "Transaction & Cash Movement", sub: "Receivables, payables and cash impact", tab: "Transactions" },
              ];
              return (
                <>
                  <div className="flex gap-3 overflow-x-auto">
                    <KpiCard icon={ITrend} label="Revenue" value={fmtMoney(m.totalRevenue)} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                    <KpiCard icon={ITarget} label="Proposal Win Rate" value={`${m.winRate}%`} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                    <KpiCard icon={IClock} label="Procurement Cycle" value={procCycleDays != null ? `${procCycleDays}d` : "—"} numColor="text-indigo-600" iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                    <KpiCard icon={ICard} label="Net Cash Movement" value={fmtMoney(m.netCash)} numColor={m.netCash >= 0 ? "text-indigo-600" : "text-rose-600"} iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-5">
                      <div className="mb-4 text-sm font-semibold text-slate-900">Commercial Performance</div>
                      {allY.every(v => v === 0) ? (
                        <div className="flex h-32 items-center justify-center text-sm text-slate-400">No revenue or cost data yet</div>
                      ) : (
                        <svg viewBox={`-48 0 ${W + 58} ${H + 30}`} className="w-full" style={{ height: 160 }}>
                          {yLabels.map((l, i) => (
                            <g key={i}>
                              <line x1="0" y1={l.y} x2={W} y2={l.y} stroke="#f1f5f9" strokeWidth="1" />
                              <text x="-4" y={l.y + 4} textAnchor="end" fontSize="9" fill="#94a3b8">{l.label}</text>
                            </g>
                          ))}
                          <path d={fillR} fill="rgba(59,130,246,0.07)" />
                          <path d={pathR} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                          {xs.map((x, i) => <circle key={i} cx={x} cy={ry[i]} r="4" fill="#3b82f6" />)}
                          <path d={pathC} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                          {xs.map((x, i) => <circle key={i} cx={x} cy={cy[i]} r="4" fill="#f97316" />)}
                          {reportMonths.map((mo, i) => <text key={mo.label + i} x={xs[i]} y={H + 20} textAnchor="middle" fontSize="11" fill="#94a3b8">{mo.label}</text>)}
                        </svg>
                      )}
                      <div className="mt-2 flex items-center gap-5 text-xs text-slate-500">
                        <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-5 rounded" style={{ background: "#3b82f6" }} /> Revenue</div>
                        <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-5 rounded" style={{ background: "#f97316" }} /> Costs</div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <div className="mb-4 text-sm font-semibold text-slate-900">Operations Intelligence</div>
                      <div className="space-y-3">
                        <div className="flex items-start gap-2.5 text-sm text-slate-700">
                          <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/></svg>
                          {m.winRate > 0 ? `Proposal win rate: ${m.winRate}%` : "No proposals won yet"}
                        </div>
                        <div className="flex items-start gap-2.5 text-sm text-slate-700">
                          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          {m.expiringSoon > 0 ? `${m.expiringSoon} contract${m.expiringSoon > 1 ? "s" : ""} expiring soon` : "No contracts expiring soon"}
                        </div>
                        <div className="flex items-start gap-2.5 text-sm text-slate-700">
                          <svg className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                          {m.overdueInvoices > 0 ? `${m.overdueInvoices} overdue invoice${m.overdueInvoices > 1 ? "s" : ""} affecting cash flow` : "No overdue invoices"}
                        </div>
                        {m.receivables > 0 && (
                          <div className="flex items-start gap-2.5 text-sm text-slate-700">
                            <svg className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                            {fmtMoney(m.receivables)} outstanding receivables
                          </div>
                        )}
                      </div>
                      <button type="button" onClick={() => setActiveTab("Sales")}
                        className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition">View Sales Detail</button>
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 text-sm font-semibold text-slate-900">Report Library</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {reportLib.map(r => (
                        <div key={r.title} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">{r.icon}</div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-slate-800 leading-snug">{r.title}</div>
                            <div className="mt-0.5 text-[11px] text-slate-400">{r.sub}</div>
                          </div>
                          <button type="button" onClick={() => setReportSub(r.tab)}
                            className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 transition">View</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              );
            })()}
            {reportSub === "Sales Performance" && (
              <>
                <div className="flex gap-3 overflow-x-auto">
                  <KpiCard icon={ITrend} label="Total Revenue" value={fmtMoney(m.totalRevenue)} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                  <KpiCard icon={ITarget} label="Win Rate" value={`${m.winRate}%`} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                  <KpiCard icon={IDoc} label="Proposals Sent" value={m.proposalsSubmitted} numColor="text-teal-600" iconBg="bg-teal-50" iconColor="text-teal-600" />
                  <KpiCard icon={ICheck} label="Won Deals" value={m.wonQuotes} numColor="text-blue-600" iconBg="bg-blue-50" iconColor="text-blue-600" />
                </div>
                <TableSection title="Sales Performance by Customer" searchPlaceholder="Search..."
                  cols={["Customer", "Proposals", "Won", "Revenue", "Receivables"]}
                  rows={[...new Set([...invoices.map(i => i.customer_name), ...quotes.map(q => q.customer_name)].filter(Boolean))].map(name => ({
                    Customer: name,
                    Proposals: quotes.filter(q => q.customer_name === name).length,
                    Won: quotes.filter(q => q.customer_name === name && (q.status === "won" || q.status === "accepted")).length,
                    Revenue: fmtMoney(invoices.filter(i => i.customer_name === name && ["paid","delivered"].includes((i.status||"").toLowerCase())).reduce((s, i) => s + toWsConverted(i.total_amount || i.amount || 0, i.currency), 0)),
                    Receivables: fmtMoney(invoices.filter(i => i.customer_name === name && ["sent","overdue","delivered"].includes((i.status||"").toLowerCase())).reduce((s, i) => s + toWsConverted(i.total_amount || i.amount || 0, i.currency), 0)),
                  }))}
                  emptyText="No sales data yet"
                />
              </>
            )}
            {reportSub === "Procurement" && (
              <>
                <div className="flex gap-3 overflow-x-auto">
                  <KpiCard icon={IDoc} label="Total Requests" value={proposalRequests.length} numColor="text-blue-600" iconBg="bg-blue-50" iconColor="text-blue-600" />
                  <KpiCard icon={IDownload} label="Proposals Received" value={proposalRequests.reduce((s, r) => s + (r.submission_count || 0), 0)} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                  <KpiCard icon={ICheck} label="Published" value={proposalRequests.filter(r => r.status === "PUBLISHED").length} numColor="text-teal-600" iconBg="bg-teal-50" iconColor="text-teal-600" />
                  <KpiCard icon={IPound} label="Total Spend" value={fmtMoney(m.cashOut)} numColor="text-rose-600" iconBg="bg-rose-50" iconColor="text-rose-600" />
                </div>
                <TableSection title="Procurement Summary" searchPlaceholder="Search..."
                  cols={["Request", "Type", "Proposals", "Status", "Deadline"]}
                  rows={proposalRequests.map(r => ({
                    Request: r.title || "—",
                    Type: r.type || "General",
                    Proposals: r.submission_count ?? 0,
                    Status: <StatusPill status={r.status || "DRAFT"} />,
                    Deadline: r.deadline ? new Date(r.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
                  }))}
                  emptyText="No procurement requests yet"
                />
              </>
            )}
            {reportSub === "Contracts" && (
              <>
                <div className="flex gap-3 overflow-x-auto">
                  <KpiCard icon={IDoc} label="Total Contracts" value={contracts.length} numColor="text-blue-600" iconBg="bg-blue-50" iconColor="text-blue-600" />
                  <KpiCard icon={ICheck} label="Active" value={m.activeContracts} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                  <KpiCard icon={IClock} label="Expiring Soon" value={m.expiringSoon} numColor="text-orange-500" iconBg="bg-orange-50" iconColor="text-orange-500" />
                  <KpiCard icon={IPound} label="Total Value" value={fmtMoney(m.totalContractValue)} numColor="text-indigo-600" iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                </div>
                <TableSection title="Contracts Overview" searchPlaceholder="Search..."
                  cols={["Party", "Type", "Value", "End Date", "Status"]}
                  rows={contracts.map(c => ({
                    Party: c.party_name || c.customer_name || c.vendor_name || "—",
                    Type: c.party_type === "customer" ? "Customer" : c.party_type === "vendor" ? "Vendor" : "—",
                    Value: (c.price || c.amount || c.value) ? fmtMoney(Number(c.price || c.amount || c.value)) : "—",
                    "End Date": c.end_date ? new Date(c.end_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
                    Status: <StatusPill status={c.status || "Active"} />,
                  }))}
                  emptyText="No contracts data yet"
                />
              </>
            )}
            {reportSub === "Transactions" && (
              <>
                <div className="flex gap-3 overflow-x-auto">
                  <KpiCard icon={ICashIn} label="Total In" value={fmtMoney(m.cashIn)} numColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                  <KpiCard icon={ICashOut} label="Total Out" value={fmtMoney(m.cashOut)} numColor="text-amber-500" iconBg="bg-amber-50" iconColor="text-amber-500" />
                  <KpiCard icon={IWallet} label="Net" value={fmtMoney(m.netCash)} numColor={m.netCash >= 0 ? "text-indigo-600" : "text-rose-600"} iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                  <KpiCard icon={IDoc} label="Total Records" value={invoices.length + expenses.length} numColor="text-blue-600" iconBg="bg-blue-50" iconColor="text-blue-600" />
                </div>
                <TableSection title="Transactions Summary" searchPlaceholder="Search..."
                  cols={["Type", "Party", "Amount", "Date", "Status"]}
                  rows={[
                    ...invoices.map(i => ({ _t: "Invoice", _party: i.customer_name || i.party_name || "—", _amt: Number(i.total_amount || i.amount || 0), _cur: i.currency, date: i.date || i.created_at, status: i.status })),
                    ...expenses.map(e => ({ _t: "Expense", _party: e.vendor_name || e.party_name || "—", _amt: Number(e.total_amount || e.amount || e.price || 0), _cur: e.currency, date: e.date || e.created_at, status: e.status })),
                  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 20).map(r => ({
                    Type: <StatusPill status={r._t} />,
                    Party: r._party,
                    Amount: formatMoney(r._amt, r._cur),
                    Date: fmtDate(r.date),
                    Status: <StatusPill status={r.status || "Pending"} />,
                  }))}
                  emptyText="No transaction data yet"
                />
              </>
            )}
          </>
        )}
      </div>

      {shareToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-xl">
          {shareToast}
        </div>
      )}

      {shareItem && (
        <ShareModal
          record={shareItem.record}
          type={shareItem.type}
          workspaceName={workspaceName}
          customers={customers}
          onClose={() => setShareItem(null)}
        />
      )}

      {deliveryInvoice && (
        <RecordDeliveryModal
          invoice={deliveryInvoice}
          onRecord={recordDelivery}
          onClose={() => setDeliveryInvoice(null)}
        />
      )}

      {paymentInvoice && (
        <RecordPaymentModal
          invoice={paymentInvoice}
          onRecord={recordPayment}
          onClose={() => setPaymentInvoice(null)}
        />
      )}

      {rfqRespondTarget && (
        <RfqRespondModal
          rfq={rfqRespondTarget}
          wsCurrency={wsCurrency}
          onClose={() => setRfqRespondTarget(null)}
          onDone={() => { setRfqRespondTarget(null); persist(null); }}
        />
      )}

      {recordModal && (
        <RecordModal
          mode={recordModal.mode}
          type={recordModal.type}
          record={recordModal.record}
          customers={customers}
          catalogueProducts={catalogueProducts}
          allKnownCustomers={[...new Set([
            ...invoices.map(i => i.customer_name),
            ...quotes.map(q => q.customer_name),
          ].filter(Boolean))]}
          workspaceName={workspaceName}
          onSave={saveRecord}
          onRecordPayment={recordPayment}
          onClose={() => setRecordModal(null)}
          refLabel={
            recordModal.type === "invoice" ? invoiceRefMap.get(recordModal.record?.id) :
            recordModal.type === "quote" ? quoteRefMap.get(recordModal.record?.id) :
            recordModal.type === "contract" ? contractRefMap.get(recordModal.record?.id) :
            undefined
          }
          nextRef={recordModal.nextRef}
          receiptMode={recordModal.receiptMode}
        />
      )}

      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmDialog(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-900">Confirm Delete</div>
            <div className="mt-2 text-xs text-slate-500">{confirmDialog.message}</div>
            <div className="mt-5 flex gap-3 justify-end">
              <button type="button" onClick={confirmDialog.onCancel}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={confirmDialog.onConfirm}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
