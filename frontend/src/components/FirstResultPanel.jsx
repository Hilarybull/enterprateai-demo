import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import FirstValueCard, { EditAnswers, PremiumConfirm, actionsOf, latestOf, openOf, useFreeActions } from "./FirstValueCard";
import { trackGoal } from "./GoalLauncher";

// The first result inside the Agent card (dark Agent styling, PRD 12.2), above the Agent's four action cards (which stay):
// the title, its band and evidence coverage (kept apart, PRD 5.2); three key numbers; the gaps, failed apart from not known
// yet; then every action as a button (nothing hidden in a menu) and an X to dismiss it. The same for every result type.
// Every figure is the server's deterministic result: nothing is worked out here. The drawer, the gate and the toast open
// in a portal on the page, so nothing inside the Agent card can clip them.

const BAND_TONE = { Strong: "bg-emerald-50 text-emerald-700 ring-emerald-200", Fair: "bg-amber-50 text-amber-700 ring-amber-200",
  Weak: "bg-rose-50 text-rose-700 ring-rose-200", "Not ready yet": "bg-rose-50 text-rose-700 ring-rose-200", "Not ready": "bg-rose-50 text-rose-700 ring-rose-200",
  Ready: "bg-emerald-50 text-emerald-700 ring-emerald-200", "Conditionally ready": "bg-amber-50 text-amber-700 ring-amber-200",
  "Insufficient evidence": "bg-slate-50 text-slate-600 ring-slate-200" };
// Short names for the buttons on the panel (the drawer keeps the full ones).
const SHORT = { "Save the price in your catalogue": "Save price to catalogue", "Add it to your catalogue": "Add to catalogue",
"Set up your Marketplace profile": "Set up Marketplace profile" };
const outline = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 max-md:w-full dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

/** The gaps in the states the drawer shows them: failed, early evidence, not known yet (one group named by its count alone). */
export function gapsLine(gaps) {
  const groups = [["failed", gaps?.failed || []], ["with early evidence", gaps?.early || []], ["not known yet", gaps?.unknown || []]].filter(([, list]) => list.length);
  const n = groups.reduce((t, [, list]) => t + list.length, 0);
  if (!n) return "No gaps found";
  if (groups.length === 1) return `${n} gap${n === 1 ? "" : "s"}: ${groups[0][1].join(", ")}`;
  return groups.map(([word, list]) => `${list.length} ${word}: ${list.join(", ")}`).join(" · ");
}

const onPage = (node) => (typeof document !== "undefined" ? createPortal(node, document.body) : node);

/** The right-hand drawer (480px; the full screen on a phone) with the whole result and every action, as the old card had. */
export function FirstResultDrawer({ result, open, onClose, onPremium = null, initialServed = null, onDismiss = null }) {
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    panel.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);
  if (!open || !result) return null;
  return onPage(
    <div className="fixed inset-0 z-50" data-result-drawer>
      <button type="button" aria-label="Close the details" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-slate-900/40" />
      <aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={result.headline}
        className="absolute inset-y-0 right-0 flex w-full flex-col overflow-y-auto bg-white shadow-2xl outline-none sm:w-[480px] dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{result.headline}</p>
          <button type="button" onClick={onClose} className="text-[13px] font-semibold text-slate-500 hover:text-slate-700">Close</button>
        </div>
        <div className="p-4">
          <FirstValueCard result={result} onPremium={onPremium} initialServed={initialServed} onDismiss={onDismiss} className="border-0 p-0 shadow-none sm:p-0" />
        </div>
      </aside>
    </div>,
  );
}

/** The plan gate (PRD 12.3), as a modal: upgrade, carry on with the free tools, or save for later. Esc or a click outside closes it. */
export function PremiumGateModal({ gate, onClose, onSave }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!gate) return undefined;
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [gate, onClose]);
  if (!gate) return null;
  return onPage(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" data-premium-gate>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-slate-900/40" />
      <div role="dialog" aria-modal="true" aria-label="Before you continue" className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
        <p className="text-[14px] leading-6 text-slate-800 dark:text-slate-200">{gate.message}</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {gate.primary && (
            <button type="button" onClick={() => { trackGoal("premium_upgrade_clicked", { where: "app" }); navigate(gate.primary.to); }}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">{gate.primary.label}</button>
          )}
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Continue with free tools</button>
          <button type="button" onClick={onSave} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Save for later</button>
        </div>
      </div>
    </div>,
  );
}

/** "Result dismissed" with Undo, for 5 seconds, at the bottom of the page. */
export function UndoToast({ open, text, onUndo, onDone, ms = 5000, undoLabel = "Undo" }) {
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(onDone, ms);
    return () => clearTimeout(timer);
  }, [open, onDone, ms]);
  if (!open) return null;
  return onPage(
    <div role="status" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-[13px] text-white shadow-2xl" data-undo-toast>
      <span className="min-w-0">{text}</span>
      <button type="button" onClick={onUndo} className="shrink-0 font-semibold text-indigo-200 underline-offset-2 hover:underline">{undoLabel}</button>
    </div>,
  );
}

/** Runs `fn` (a close: Dismiss, Save for later) with the page's scroll position kept where it was, through the re-render
 *  and the collapse (the page never jumps). */
export function keepingScroll(fn) {
  if (typeof window === "undefined") return fn();
  const y = window.scrollY;
  const out = fn();
  const hold = () => { if (window.scrollY !== y) window.scrollTo({ top: y, behavior: "instant" }); };
  hold();
  requestAnimationFrame(() => { hold(); requestAnimationFrame(hold); });
  setTimeout(hold, 260);      // after the 220ms fold
  return out;
}

export default function FirstResultPanel({ firstResult, pinned = null }) {
  const { result, premium, dismiss: dismissNow, saveForLater: saveNow } = firstResult;
  const dismiss = () => keepingScroll(dismissNow);
  const saveForLater = () => keepingScroll(saveNow);
  const navigate = useNavigate();
  const [details, setDetails] = useState(false);      // the research review, after Start: the slide-over is for that only
  const [served, setServed] = useState(null);
  const [gate, setGate] = useState(null);
  const [working, setWorking] = useState(false);
  const [closing, setClosing] = useState(false);
  const [ask, setAsk] = useState(null);      // the premium step's price, before it starts
  const [researching, setResearching] = useState(false);
  const busy = useRef(false);
  const { act, done, priceModal } = useFreeActions(result, { onSaved: saveForLater, setServed });
  if (!result) return null;
  // The same snapshot as the drawer: the latest check when there is one (with the first result as "Earlier"), else the first result.
  const latest = latestOf(result);
  // The case it is about, by name ("Funding readiness · Pay for new office · £250k loan"), never only the check's generic name.
  const named = latest.full || latest.unscoredCheck;      // the case it is about, scored or not yet
  const kindWord = named?.kind === "funding" ? "Funding readiness" : named?.kind === "launch" ? "Launch readiness" : "";
  const heading = named?.title ? `${kindWord || result.headline} · ${named.title}` : result.headline;
  const coverage = Math.max(0, Math.min(100, Number(latest.coverage) || 0));
  const numbers = latest.full ? `Latest check: ${latest.score}${latest.full.as_of ? ` · ${latest.source.split(" · ").pop()}` : ""}` : (result.key_numbers || []).join(" · ");
  const gapText = latest.full ? `${latest.earlier}${typeof latest.full.blocker_count === "number" ? ` · ${latest.full.blocker_count} blocker${latest.full.blocker_count === 1 ? "" : "s"} in the full check` : ""}` : gapsLine(result.gaps);
  // The main button follows the research (the owner's QA, 15 Oct): none yet, its price first; findings waiting, "Review
  // findings (5)"; adopted, the pack is the next step and the research is never offered again unless the answers change.
  const rs = result.research || { state: "none" };
  const workspaceId = useWorkspaceStore((st) => st.workspaceId);
  const all = actionsOf(result).filter((a) => !a.save);
  const pack = all.find((a) => /funding pack/i.test(a.label || ""));
  const primary = rs.state === "none" ? result.premium_next_action
    : rs.state === "review" ? { label: `Review findings (${rs.findings || 0})`, review: rs.run_id }
    : (pack || null);
  const refresh = rs.state === "stale" ? { label: `Refresh research · up to ${rs.max} credits` } : null;
  const others = all.filter((a) => a !== primary);

  // Review-type work opens on its own page (the case's Research section), never in the side panel (the owner's QA, 15 Oct).
  const reviewPage = (runId) => {
    const a = result?.assessment?.assessment_id ? result.assessment : null;
    const base = result?.assessment_type === "launch_readiness_initial" ? (a?.initiative_id ? `/launch/${a.initiative_id}` : "/launch")
      : (a?.case_id ? `/funding/${a.case_id}` : "/funding");
    return `${base}?tab=research${runId ? `&run=${encodeURIComponent(runId)}` : ""}#review`;
  };
  async function openReview(runId) { navigate(reviewPage(runId)); }

  async function startPremium() {
    if (busy.current || !primary) return;
    if (primary.review) { await openReview(primary.review); return; }
    if (primary.to) { navigate(primary.to); return; }
    trackGoal("first_value_premium_clicked", { where: "app" });
    // The plan first, then the credits (PRD 4.1): an ineligible owner sees the gate; an eligible one the cost, in the drawer.
    if (result.premium_gate && result.premium_gate.allowed === false) { setGate(result.premium_gate); return; }
    if (!premium) { const open = openOf(result); if (open) navigate(open.to); return; }
    await runPremium();
  }
  async function runPremium() {
    if (busy.current || !premium) return;
    busy.current = true;
    setWorking(true);
    try {
      const out = await premium();
      if (out?.gate) setGate(out.gate);
      else if (out?.confirm) setAsk(out);      // its price and Start, in a modal (F-2)
      else if (out?.research) navigate(reviewPage(out.research.id));      // the same research again: opened on its page, free
      else if (out) { setServed(out); setDetails(true); }
    } finally { busy.current = false; setWorking(false); }
  }
  // "Refresh research · up to 60 credits": the answers changed, or the last research is over 30 days old.
  const startRefresh = () => runPremium();
  async function research() {
    if (!ask || busy.current) return;
    busy.current = true;
    setResearching(true);
    try {
      const next = await ask.start();
      setAsk(null);
      if (next?.gate) setGate(next.gate);
      else if (next?.research) navigate(reviewPage(next.research.id));      // the findings, reviewed on the case page
      else if (next) { setServed(next); setDetails(true); }
    } finally { busy.current = false; setResearching(false); }
  }
  // Dismissed: the panel folds away, then the result goes (kept in Agent Centre > Results; Undo for 5 seconds).
  const fold = () => keepingScroll(() => { setClosing(true); setTimeout(() => { setClosing(false); dismiss(); }, 220); });

  return (
    <div className={`grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out ${closing ? "mt-0 grid-rows-[0fr] opacity-0" : "mt-4 grid-rows-[1fr] opacity-100"}`} data-first-result-wrap>
      <div className="min-h-0 overflow-hidden">
        <div className="relative rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100" data-first-result-panel data-band={latest.band}>
          {pinned && (
            // Pinned too: one card, the pin in its corner. Unpinning keeps this card.
            <button type="button" aria-label="Unpin" title="Pinned to your dashboard. Unpin" onClick={pinned.onUnpin} data-result-pin
              className="absolute right-10 top-2 flex h-8 w-8 items-center justify-center rounded-full text-brand-600 hover:bg-slate-100 hover:text-slate-700">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" stroke="currentColor" strokeWidth={2}><path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3z" /></svg>
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={fold} data-result-dismiss
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          {/* Row 1: the result, its band, and how much of the evidence is known (its own figure, never folded into the band). */}
          <div className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 ${pinned ? "pr-[4.5rem]" : "pr-9"} max-md:flex-col max-md:items-start`}>
            <p className="min-w-0 truncate text-[15px] font-semibold" title={heading} data-result-title>{heading}</p>
            {latest.band && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${BAND_TONE[latest.band] || BAND_TONE["Insufficient evidence"]}`} data-result-band>{latest.band}</span>}
            <span className="flex shrink-0 items-center gap-2 text-[12px] text-slate-500 md:ml-auto" data-result-coverage title={`Evidence coverage ${coverage}%`}>
              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${coverage}%` }} /></span>
              {coverage}% evidence
            </span>
          </div>
          {/* Row 2: three key numbers on one line (two at most at 1024; stacked on a phone). */}
          {numbers && <p className="mt-2 truncate text-[14px] font-medium text-slate-800 dark:text-slate-100 lg:max-xl:line-clamp-2 lg:max-xl:whitespace-normal max-md:whitespace-normal" title={numbers} data-result-numbers>{numbers}</p>}
          {/* Row 3: the gaps, failed apart from not known yet. */}
          <p className="mt-1 truncate text-[12.5px] text-slate-500 max-md:whitespace-normal" title={gapText} data-result-gaps>{gapText}</p>
          {/* P1.13: one verdict for a funding check, each blocker a link to fix it, and what the score means. */}
          {latest.full?.kind === "funding" && (
            <div className="mt-1.5 text-[13px] text-slate-800 dark:text-slate-100" data-funding-verdict>
              {latest.full.classification === "ready" ? <p className="font-semibold">Ready to approach funders</p> : (
                <p><span className="font-semibold">Not ready to approach funders yet</span>
                  {(latest.full.top_blockers || []).length > 0 && <>: {(latest.full.top_blockers || []).map((b, n) => (
                    <span key={b.code}>{n > 0 && ", "}<a href={b.to} onClick={(e) => { e.preventDefault(); navigate(b.to); }} className="text-brand-700 underline underline-offset-2 hover:text-brand-800" data-blocker-link>{b.label}</a></span>
                  ))}</>}</p>
              )}
              <p className="mt-0.5 text-[12px] text-slate-500" data-funding-disclaimer>This shows how prepared you are, not whether funding will be given.</p>
            </div>
          )}
          {/* Every action is a button: the primary one solid, the rest outlined, wrapping onto a second line when needed. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 max-md:flex-col max-md:items-stretch" data-result-actions>
            {primary && (
              <button type="button" onClick={startPremium} disabled={working} aria-busy={working} data-result-primary
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-70 max-md:w-full">
                {working && <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {working ? "Working on it…" : primary.label}
              </button>
            )}
            {refresh && <button type="button" onClick={startRefresh} className={outline} data-result-refresh>{refresh.label}</button>}
            {others.map((a) => <button key={a.label} type="button" onClick={() => act(a)} className={outline} title={a.label}>{SHORT[a.label] || a.label}</button>)}
            <button type="button" onClick={saveForLater} className={outline} data-result-save>Save for later</button>
            {/* Edit and run again, right here (the owner's QA, 15 Oct). */}
            <EditAnswers result={result} onUpdated={(r) => firstResult.setResult?.((had) => ({ ...r, premium_gate: had?.premium_gate }))} />
          </div>
          {done && <p role="status" className={`mt-2 text-[12px] ${done.error ? "text-rose-700" : "text-emerald-700"}`}>{done.error || done.text}</p>}
        </div>
      </div>
      <FirstResultDrawer result={result} open={details} onClose={() => { setDetails(false); setServed(null); }} onPremium={premium} initialServed={served}
        onDismiss={() => { setDetails(false); fold(); }} />
      <PremiumGateModal gate={gate} onClose={() => setGate(null)} onSave={() => { setGate(null); saveForLater(); }} />
      {priceModal}
      <PremiumConfirm result={result} confirm={ask?.confirm} working={researching} onStart={research} onClose={() => setAsk(null)} />
    </div>
  );
}
