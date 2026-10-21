import { getCurrencySymbol } from "../lib/currencies";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { MoneyInput } from "./readiness/Fields";

// "What to do next" after a funding check (the owner's brief, 21 Oct): at most three rows, each one title, one reason
// tied to the gap, its cost and ONE button. A free inline one (your price and cost) is done right here; a paid one opens
// the spending modal first (focus on "Not now"); a locked one says which plan has it.

const ICON = {
  catalogue: "M4 7h16M4 12h16M4 17h10", scenario: "M4 19V5m0 14h16M8 15l3-4 3 2 4-6", plan: "M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4",
  validation: "M5 12l4 4 10-10", operations: "M4 19h16M7 16V9m5 7V5m5 11v-4", team: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0",
  pack: "M4 7l8-4 8 4-8 4-8-4zm0 5l8 4 8-4M4 17l8 4 8-4", letter: "M4 6h16v12H4zM4 6l8 7 8-7", options: "M12 3v18M3 12h18",
};

export function useNextActions(sessionId) {
  const [items, setItems] = useState(null);
  const load = useCallback(() => {
    if (!sessionId) { setItems(null); return; }
    apiRequest(`/task-sessions/${sessionId}/next-actions`, "GET").then((r) => setItems(r?.items || [])).catch(() => setItems([]));
  }, [sessionId]);
  useEffect(() => { load(); }, [load]);
  return { items, reload: load };
}

/** "Your catalogue says ₦4,000 a sale…; your case says ₦1,000…": one press for the right pair, both kept the same after. */
function ConflictForm({ businessId, item, onSaved }) {
  const p = item.prefill || {};
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const sign = getCurrencySymbol(p.currency);
  const money = (v) => (v == null ? "" : `${sign}${Number(v).toLocaleString("en-GB")}`);
  const pair = (x) => [money(x?.price), x?.cost != null ? `${money(x.cost)} cost` : ""].filter(Boolean).join(" and ");
  const choose = async (which) => {
    if (busy) return;
    setBusy(true);
    setProblem("");
    try {
      const pick = p[which] || {};
      if (which === "catalogue") {
        await apiRequest(`/businesses/${businessId}/assessment/funding/use-figures`, "POST",
          { figures: { ...(pick.price != null ? { price: Number(pick.price) } : {}), ...(pick.cost != null ? { cost: Number(pick.cost) } : {}) } });
      } else {
        await apiRequest(`/businesses/${businessId}/catalogue/from-check`, "POST",
          { name: p.name || "My main offer", base_price: Number(pick.price), ...(pick.cost != null ? { cost_of_sales: Number(pick.cost) } : {}), ...(p.currency ? { currency: p.currency } : {}) });
      }
      await onSaved?.();
    } catch { setProblem("That couldn't be saved just now. Nothing was changed. Try again."); }
    finally { setBusy(false); }
  };
  const btn = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 hover:border-brand-300 disabled:opacity-60 max-sm:w-full";
  return (
    <div className="mt-2 flex flex-wrap gap-2" data-next-conflict-form>
      <button type="button" disabled={busy} onClick={() => choose("catalogue")} className={btn} data-use-catalogue>Use the catalogue: {pair(p.catalogue)}</button>
      <button type="button" disabled={busy} onClick={() => choose("case")} className={btn} data-use-case>Use my case: {pair(p.case)}</button>
      {problem && <p role="alert" className="w-full text-[12px] text-rose-700">{problem}</p>}
    </div>
  );
}

function CatalogueForm({ businessId, item, onSaved }) {
  const p = item.prefill || {};
  const [price, setPrice] = useState(p.price ? String(p.price) : "");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const save = async () => {
    if (!Number(price) || busy) return;
    setBusy(true);
    setProblem("");
    try {
      await apiRequest(`/businesses/${businessId}/catalogue/from-check`, "POST",
        { name: p.name || "My main offer", base_price: Number(price), ...(Number(cost) ? { cost_of_sales: Number(cost) } : {}), ...(p.currency ? { currency: p.currency } : {}) });
      // The case too, then checked again (the owner's QA, 21 Oct: the catalogue changed, the case still said the old price).
      // No case yet: the catalogue alone is saved.
      await apiRequest(`/businesses/${businessId}/assessment/${p.kind || "funding"}/use-figures`, "POST",
        { figures: { price: Number(price), ...(Number(cost) ? { cost: Number(cost) } : {}) } }).catch(() => null);
      await onSaved?.();
    } catch { setProblem("That couldn't be saved just now. Nothing was changed. Try again."); }
    finally { setBusy(false); }
  };
  const field = "w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950";
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end" data-next-catalogue-form>
      <label className="block min-w-0 text-[12px] text-slate-600">Price per sale{p.price ? " (worked out from your chat)" : ""}
        <MoneyInput value={price} currency={p.currency} onChange={setPrice} className={field} aria-label="Price per sale" /></label>
      <label className="block min-w-0 text-[12px] text-slate-600">What one sale costs you
        <MoneyInput value={cost} currency={p.currency} onChange={setCost} className={field} aria-label="What one sale costs you" /></label>
      <button type="button" onClick={save} disabled={busy || !Number(price)} className="rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60 max-sm:w-full">
        {busy ? "Saving…" : "Save and check again"}</button>
      {problem && <p role="alert" className="text-[12px] text-rose-700 sm:col-span-3">{problem}</p>}
    </div>
  );
}

/** The block, directly under the score. `act` is the result's own action runner (its price modal for paid tasks). */
export default function WhatNext({ sessionId, businessId, act = null, onChanged = null }) {
  const navigate = useNavigate();
  const { items, reload } = useNextActions(sessionId);
  const [open, setOpen] = useState(null);
  const [saved, setSaved] = useState(null);      // "Saved. Your score is now 62/100.", after the free step
  if (!items?.length) return saved ? <p role="status" className="mt-5 text-[13px] font-semibold text-emerald-800" data-next-saved>{saved}</p> : null;
  const run = (i) => {
    if (!i.allowed) { navigate(i.upgrade?.to || "/pricing"); return; }
    if (i.kind === "inline") { setOpen((k) => (k === i.key ? null : i.key)); return; }
    if (i.kind === "open" && i.to) { navigate(i.to); return; }
    if (i.capability && act) act({ capability: i.capability, label: i.title, params: i.prefill || {} });
  };
  return (
    <section className="mt-5" aria-label="What to do next" data-what-next>
      <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">What to do next</h3>
      {saved && <p role="status" className="mt-1 text-[13px] font-semibold text-emerald-800" data-next-saved>{saved}</p>}
      <ol className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
        {items.map((i) => (
          <li key={i.key} className="p-3" data-next-action={i.key}>
            <div className="flex items-center gap-3 max-sm:flex-col max-sm:items-stretch">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 max-sm:hidden dark:bg-brand-950/40 dark:text-brand-300">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={ICON[i.key] || ICON.options} /></svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100" data-next-title>{i.title} <span className="font-normal text-slate-500">· {i.cost}</span></p>
                <p className="text-[12.5px] text-slate-600 dark:text-slate-300">{i.reason}</p>
              </div>
              <button type="button" onClick={() => run(i)} data-next-start
                className={`rounded-lg px-4 py-2 text-[13px] font-semibold max-sm:w-full ${i.allowed ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-slate-300 bg-white text-slate-700"}`}>
                {i.allowed ? i.button : "Upgrade"}</button>
            </div>
            {open === i.key && i.kind === "inline" && i.key === "catalogue" && i.prefill?.conflict && (
              <ConflictForm businessId={businessId} item={i} onSaved={async () => {
                setOpen(null);
                const r = await onChanged?.();
                setSaved(typeof r?.score === "number" ? `Saved. Your score is now ${Math.round(r.score)}/100.` : "Saved. Score paused: a few figures are still missing.");
                reload();
              }} />
            )}
            {open === i.key && i.kind === "inline" && i.key === "catalogue" && !i.prefill?.conflict && (
              <CatalogueForm businessId={businessId} item={i} onSaved={async () => {
                setOpen(null);
                const r = await onChanged?.();
                setSaved(typeof r?.score === "number" ? `Saved. Your score is now ${Math.round(r.score)}/100.` : "Saved. Score paused: a few figures are still missing.");
                reload();
              }} />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** One line on the dashboard's Agent card: the top suggestion, its cost, Start. */
export function NextLine({ sessionId, what = "loan" }) {
  const navigate = useNavigate();
  const { items } = useNextActions(sessionId);
  const top = items?.[0];
  if (!top) return null;
  const go = () => navigate(top.to && top.kind === "open" ? top.to : top.session_id ? `/resume/${top.session_id}` : "/dashboard");
  return (
    <p className="line-clamp-2 text-[13px] text-white/90" data-next-line>
      Next for your {what}: <span className="font-semibold">{top.title}</span> · {top.cost}{" "}
      <button type="button" onClick={go} className="ml-1 rounded-md bg-white/15 px-2 py-0.5 font-semibold text-white hover:bg-white/25">{top.allowed ? top.button : "Upgrade"}</button>
    </p>
  );
}
