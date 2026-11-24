import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import FirstValueCard, { PremiumConfirm, fetchFirstValue, latestOf, openOf, useFreeActions } from "./FirstValueCard";
import { FoundForYou, NextSteps, PackLine, SavedNotice, StatusLine, stepsOf, useResearchRun, useStepPrices } from "./ResultSummary";
import { premiumFlow } from "./ResearchReview";
import WhatNext from "./WhatNext";
import { hasFundingPack } from "../lib/plans";
import { useAuthStore } from "../store/auth";
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
          <span className="flex items-center gap-3">
            {openOf(result)?.to && <a href={openOf(result).to} data-open-full-page className="text-[13px] font-semibold text-brand-700 hover:underline">Open full page</a>}
            <button type="button" onClick={onClose} className="text-[13px] font-semibold text-slate-500 hover:text-slate-700">Close</button>
          </span>
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

export default function FirstResultPanel({ firstResult }) {
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
  const workspaceId = useWorkspaceStore((st) => st.workspaceId);
  const run = useResearchRun(workspaceId, result);      // the Agent's drafts for the steps, and its findings
  const prices = useStepPrices(result?._session || firstResult.sessionId, result);
  if (!result) return null;
  // The same snapshot as the drawer: the latest check when there is one (with the first result as "Earlier"), else the first result.
  const latest = latestOf(result);
  // The case it is about, by name ("Funding readiness · Pay for new office · £250k loan"), never only the check's generic name.
  const named = latest.full || latest.unscoredCheck;      // the case it is about, scored or not yet
  const kindWord = named?.kind === "funding" ? "Funding readiness" : named?.kind === "launch" ? "Launch readiness" : "";
  const heading = named?.title ? `${kindWord || result.headline} · ${named.title}` : result.headline;
  const rs = result.research || { state: "none" };

  // Review-type work opens on its own page (the case's Research section), never in the side panel (the owner's QA, 15 Oct).
  const reviewPage = (runId) => {
    const a = result?.assessment?.assessment_id ? result.assessment : null;
    const base = result?.assessment_type === "launch_readiness_initial" ? (a?.initiative_id ? `/launch/${a.initiative_id}` : "/launch")
      : (a?.case_id ? `/funding/${a.case_id}` : "/funding");
    return `${base}${runId ? `?run=${encodeURIComponent(runId)}` : ""}`;
  };
  async function openReview(runId) { navigate(reviewPage(runId)); }

  // One step's research ("Do it for me · 10 credits"), or every step's ("Do all for me"): the plan first, then its price
  // in the spending modal (focus on "Not now"), unless it is free. Nothing starts from typing.
  async function startStep(only) {
    trackGoal("first_value_premium_clicked", { where: "app" });
    if (result.premium_gate && result.premium_gate.allowed === false) { setGate(result.premium_gate); return; }
    const sid = result._session || firstResult.sessionId;
    if (only && !sid) return;
    await runPremium(only ? premiumFlow({ base: `/task-sessions/${sid}/premium`, body: { only: [only] }, onAdopted: firstResult.onAdopted }) : premium);
  }
  async function runPremium(flow = premium) {
    if (busy.current || !flow) return;
    busy.current = true;
    setWorking(true);
    setAsk({ confirm: { pending: true } });      // the modal at once, its price filling in (the owner's QA, 21 Oct)
    try {
      const out = await flow();
      if (!out?.confirm) setAsk(null);
      if (out?.gate) setGate(out.gate);
      else if (out?.confirm) setAsk((was) => (was ? out : null));      // its price and Start, in a modal (F-2); closed meanwhile, it stays closed
      else if (out?.research) navigate(reviewPage(out.research.id));      // the same research again: opened on its page, free
      else if (out) { setServed(out); setDetails(true); }
    } finally { busy.current = false; setWorking(false); }
  }
  async function research() {
    if (!ask || busy.current) return;
    busy.current = true;
    setResearching(true);
    try {
      const next = await ask.start();
      setAsk(null);
      if (next?.gate) setGate(next.gate);
      else if (next?.research) {
        // Its drafts in this card's step cards at once (the owner's QA, 21 Oct: no reload, no other page, one result).
        const r = (await fetchFirstValue(result._session || firstResult.sessionId).catch(() => null))?.result;
        if (r) firstResult.setResult?.((had) => ({ ...r, premium_gate: had?.premium_gate }));
        else navigate(reviewPage(next.research.id));
      }
      else if (next) { setServed(next); setDetails(true); }
    } finally { busy.current = false; setResearching(false); }
  }
  // Dismissed: the panel folds away, then the result goes (kept in Agent Centre > Results; Undo for 5 seconds).
  const fold = () => keepingScroll(() => { setClosing(true); setTimeout(() => { setClosing(false); dismiss(); }, 220); });

  return (
    <div className={`grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out ${closing ? "mt-0 grid-rows-[0fr] opacity-0" : "mt-4 grid-rows-[1fr] opacity-100"}`} data-first-result-wrap>
      <div className="min-h-0 overflow-hidden">
        <div className="relative rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100" data-first-result-panel data-band={latest.band}>
          <button type="button" aria-label="Dismiss" onClick={fold} data-result-dismiss
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          {/* The same pattern as the result page (the owner's brief, 17 Oct): the case's name, one score and one sentence,
              three next steps, three findings, the pack, then the links. Engine detail is on the full page. */}
          <div className="min-w-0 pr-9">
            {named?.title && kindWord && <p className="text-[12px] text-slate-500" data-result-eyebrow>{kindWord}</p>}
            <p className="text-[15px] font-semibold leading-5 text-slate-900 line-clamp-2 break-words dark:text-slate-100" title={heading} data-result-title>{named?.title || result.headline}</p>
            <div className="mt-1"><StatusLine result={result} latest={latest} /></div>
            {rs.state === "adopted" && <SavedNotice className="mt-2" />}
            {result.assessment_type === "funding_readiness_initial" && (result._session || firstResult.sessionId) && rs.state === "adopted" && (
              <WhatNext sessionId={result._session || firstResult.sessionId} businessId={workspaceId} act={act}
                onChanged={async () => { const r = (await fetchFirstValue(result._session || firstResult.sessionId).catch(() => null))?.result; if (r) firstResult.setResult?.((had) => ({ ...r, premium_gate: had?.premium_gate })); return r; }} />
            )}
          </div>
          {rs.state !== "adopted" && <NextSteps result={result} run={run} prices={prices} readyToggle={false} working={working} businessId={workspaceId}
            onApplied={async () => { const r = (await fetchFirstValue(result._session || firstResult.sessionId).catch(() => null))?.result; if (r) firstResult.setResult?.((had) => ({ ...r, premium_gate: had?.premium_gate })); return r; }} onReview={rs.run_id ? () => openReview(rs.run_id) : null} onDoIt={result.premium_next_action ? startStep : null}
            onAnswered={(res) => { if (res?.result) firstResult.setResult?.((had) => ({ ...res.result, _edit: res.edit || had?._edit, _session: res.session_id || had?._session, premium_gate: had?.premium_gate })); }} />}
          <FoundForYou businessId={workspaceId} result={result} run={run} onSeeAll={rs.run_id ? () => openReview(rs.run_id) : null} />
          <PackLine result={result} locked={!hasFundingPack(useAuthStore.getState().subscription, useAuthStore.getState().platformGrants)} businessId={workspaceId} onCreate={act} />
          {/* One link only (the owner's brief, 20 Oct): the steps carry their own buttons, the pack its one, and the answers
              are edited on the full page. Everything is saved as it goes. */}
          {openOf(result) && (
            <div className="mt-6 flex flex-wrap items-center gap-2" data-result-actions>
              <a href={openOf(result).to} onClick={(e) => { e.preventDefault(); navigate(openOf(result).to); }} className="text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline" data-result-open>Open full page</a>
            </div>
          )}
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
