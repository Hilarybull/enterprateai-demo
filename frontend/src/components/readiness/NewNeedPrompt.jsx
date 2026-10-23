// A title that names a different need from the case's purpose (the owner's QA, 23 Oct: "Funds for Party" over a
// marketing case) is asked about, never taken as a rename: start a new need (the old one goes to History with its
// milestones and spending lines), or keep it as the same need under the new title.
import { useState } from "react";
import { moneyLabel } from "../../lib/readiness";

const STOP = new Set(["fund", "funds", "funding", "loan", "loans", "grant", "grants", "equity", "investment", "investor", "investors", "money",
  "for", "the", "and", "our", "new", "naira", "with", "raise", "raising", "case", "need", "needs", "help", "from", "into", "more", "some"]);
const words = (t) => String(t || "").toLowerCase().replace(/[₦£$€]?\d[\d,.]*\s?(?:k|m|bn|million|billion)?\b/g, " ")
  .match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)) || [];
const stem = (w) => w.slice(0, 5);

/** True when the title's own words share nothing with what the case is for. */
export function titleNamesNewNeed(title, purpose) {
  const t = words(title);
  const p = new Set(words(purpose).map(stem));
  return t.length > 0 && p.size > 0 && !t.some((w) => p.has(stem(w)));
}

/** "Funds for Party" → "Party": what the title says the money is for. */
export function purposeFromTitle(title) {
  const s = String(title || "").trim()
    .replace(/^(?:[₦£$€]?\s?\d[\d,.]*\s?(?:k|m|bn|million|billion)?\s+)?(?:funds?|funding|loan|grant|equity(?: investment)?|investment|money)?\s*(?:for|to)\s+/i, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const keyOf = (id, title) => `ea:same-need:${id}:${String(title || "").trim().toLowerCase()}`;
const dismissed = (id, title) => { try { return window.localStorage.getItem(keyOf(id, title)) === "1"; } catch { return false; } };

export default function NewNeedPrompt({ subjectId, data, onNewNeed, disabled = false }) {
  const [purpose, setPurpose] = useState(() => purposeFromTitle(data.title));
  const [amount, setAmount] = useState(data.target_amount ?? "");
  const [busy, setBusy] = useState(false);
  const [same, setSame] = useState(() => dismissed(subjectId, data.title));
  if (same || !onNewNeed || !titleNamesNewNeed(data.title, data.purpose)) return null;
  const keep = () => { try { window.localStorage.setItem(keyOf(subjectId, data.title), "1"); } catch { /* per viewer only */ } setSame(true); };
  const start = async () => {
    setBusy(true);
    try { await onNewNeed({ title: String(data.title).trim(), purpose: purpose.trim(), target_amount: Number(String(amount).replace(/,/g, "")) || null }); }
    finally { setBusy(false); }
  };
  const input = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  return (
    <div role="group" aria-label="A new funding need?" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30" data-new-need>
      <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Is this a new funding need?</p>
      <p className="mt-1 text-[13px] text-slate-700 dark:text-slate-300">
        {`Your title says "${String(data.title).trim()}", but this case is for ${String(data.purpose).trim()}. A new need sets the old one aside in History, with its milestones and spending lines.`}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-200">What is the new funding for?
          <input className={input} value={purpose} onChange={(e) => setPurpose(e.target.value)} data-new-need-purpose /></label>
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-200">How much?{data.currency ? ` (${data.currency})` : ""}
          <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-new-need-amount />
          {Number(amount) > 0 && <span className="mt-1 block text-[12px] font-normal text-slate-500">{moneyLabel(Number(amount), data.currency)}</span>}</label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 max-sm:flex-col max-sm:items-stretch">
        <button type="button" disabled={disabled || busy || !purpose.trim()} onClick={start}
          className="rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50" data-new-need-start>
          {busy ? "Starting…" : "Start a new need"}</button>
        <button type="button" disabled={busy} onClick={keep} className="text-[13px] font-semibold text-slate-700 hover:underline dark:text-slate-200" data-new-need-same>
          Same need, keep my title</button>
      </div>
    </div>
  );
}
