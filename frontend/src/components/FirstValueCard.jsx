import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { trackGoal } from "./GoalLauncher";
import { useWorkspaceStore } from "../store/workspace";
import { premiumFlow } from "./ResearchReview";
import { refusalMessage } from "../lib/entitlement";
import { creditCopy } from "../lib/creditCopy";

// The free first result for a goal (First-Value PRD 12.2): what was checked, the score or the
// count, how much of the evidence is known (its own figure, never folded into the score), what
// looks ready, and what is missing, with what failed kept apart from what simply is not known yet.
// The premium step is offered after this, and its gate is shown only when it is chosen (12.3).
// Everything on it comes from the server's deterministic result: nothing here is worked out or worded by a model.

const KEY = "ea_first_value_session";

/** Remember which task's result to show first on the dashboard (until it is dismissed or acted on). */
export function rememberFirstValue(sessionId) {
  try { localStorage.setItem(KEY, sessionId); } catch { /* shown on the start page either way */ }
}
const forget = () => { try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ } };
/** A homepage task that is not a check (an invoice, a quotation): the dashboard opens on THAT task, not an older result. */
export const forgetFirstValue = forget;
const remembered = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export const fetchFirstValue = (sessionId) => apiRequest(`/task-sessions/${sessionId}/first-value`, "GET");

const CLASS_LABEL = { ready: "Ready", conditionally_ready: "Conditionally ready", not_ready: "Not ready", insufficient_evidence: "Insufficient evidence" };
const shortDay = (at) => { try { return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); } catch { return ""; } };
const outOf = (n) => (typeof n === "number" ? `${Number.isInteger(n) ? n : n.toFixed(1)}/100` : "No score yet");

/** One result, one set of numbers (PRD 5.1, SIF-11): the latest check when there is one (a funding case's or a launch's full
 *  check), labelled with where it is from, and the first result kept as "Earlier". Both the Agent card and the drawer read
 *  this, so they always show the same snapshot. */
export function latestOf(result) {
  const full = result?.assessment?.assessment_id ? result.assessment : null;
  const first = typeof result?.score === "number" ? outOf(result.score) : String(result?.score ?? "");
  if (!full) return { full: null, score: first, band: result?.band, coverage: result?.evidence_coverage ?? 0, source: "First result", earlier: null };
  const where = full.kind === "funding" ? `/funding/${full.case_id}` : full.kind === "launch" ? `/launch/${full.initiative_id}` : null;
  return { full, score: outOf(full.score), band: CLASS_LABEL[full.classification] || "Not checked yet", coverage: full.evidence_coverage ?? 0,
    source: `${full.title ? `${full.title} · ` : ""}Full check${full.as_of ? ` · ${shortDay(full.as_of)}` : ""}`, to: where,
    open: full.kind === "funding" ? "Open funding case" : full.kind === "launch" ? "Open launch plan" : null,
    earlier: `Earlier: ${first} (first result)` };
}

// The full assessment's classification, as LR §8 / FR §8 word it.
const CLASS_WORD = { ready: "Ready", conditionally_ready: "Conditionally ready", not_ready: "Not ready", insufficient_evidence: "Insufficient evidence" };

/** A free next action that does the thing: saves to the catalogue in one press, starts a task, or opens the page. Shared by
 *  the card (the dashboard's detail drawer) and the result panel in the Agent card, so both behave the same. */
// Not a step for this result (removed 15 Oct): a result saved before then still carries it, and it is never shown.
const RETIRED_ACTIONS = new Set(["Record your invoices and customers"]);

/** One "Open …" per result, to its own page (the owner's QA, 15 Oct): never a second copy of the result in a drawer. */
export function openOf(result) {
  const a = result?.assessment?.assessment_id ? result.assessment : null;
  switch (result?.assessment_type) {
    case "funding_readiness_initial": return { label: "Open funding case", to: a?.case_id ? `/funding/${a.case_id}?tab=results` : "/funding?tab=results" };
    case "launch_readiness_initial": return { label: "Open launch plan", to: a?.initiative_id ? `/launch/${a.initiative_id}?tab=results` : "/launch" };
    case "pricing_health_initial": return { label: "Open pricing check", to: "/check/pricing" };
    case "customer_growth_foundation": return { label: "Open growth checklist", to: "/check/customers" };
    case "idea_viability_initial": return { label: "Open in Idea Validation", to: result?.draft_id ? `/validation?draft=${encodeURIComponent(result.draft_id)}` : "/validation" };
    default: return null;
  }
}

/** A result's own actions: the retired ones left out, "/funding" links taken to the case this result is about, and its
 *  one "Open …" button (added for a result saved before it had one). */
export function actionsOf(result) {
  const caseId = result?.assessment?.kind === "funding" ? result.assessment.case_id : null;
  const list = (result?.free_next_actions || []).filter((a) => !RETIRED_ACTIONS.has(a.label)).map((a) => ({ ...a }))
    .map((a) => (caseId && typeof a.to === "string" && /^\/funding(\?|$)/.test(a.to) ? { ...a, to: a.to.replace(/^\/funding/, `/funding/${caseId}`) } : a));
  // P1.13: the pack's button says how far it is: "Prepare my funding pack", or "View funding pack (2 of 6 ready)".
  const pack = result?.assessment?.pack;
  for (const a of list) {
    if (a.label === "Prepare my funding pack" && pack?.total && pack.ready > 0) a.label = `View funding pack (${pack.ready} of ${pack.total} ready)`;
  }
  const open = openOf(result);
  if (open && !list.some((a) => /^Open /.test(a.label || ""))) {
    const at = list.findIndex((a) => a.save);
    list.splice(at < 0 ? list.length : at, 0, open);
  }
  return list;
}

export function useFreeActions(result, { onSaved = () => {}, setServed = () => {} } = {}) {
  const navigate = useNavigate();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const [done, setDone] = useState(null);      // what a free action did: { text, to? } or { error }
  const [asking, setAsking] = useState(null);      // a task that spends credits, its price shown before it starts: { action, title, credits }
  const inFlight = useRef(false);
  // PRD 15, SIF-17: nothing that spends credits starts before its price is shown ("Write a business plan · 40 credits",
  // Start or Not now). The price comes from the price list; nothing is held by asking it.
  const start = async (a) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const out = await apiRequest("/agent/requests", "POST", { business_id: workspaceId, capability: a.capability, params: a.params || {}, source_channel: "ui_action", background: true, confirmed: true });      // its price was just shown
      if (out?.run?.id) { setServed({ started: true, run_id: out.run.id }); setDone({ text: "Started. I'm working on it now.", to: `/agent/runs/${out.run.id}` }); }
      else setDone({ error: out?.message || "That couldn't be started just now. Nothing was charged." });
    } catch (e) {
      setDone({ error: refusalMessage(e, "That couldn't be started just now. Nothing was charged.") });
    } finally { inFlight.current = false; }
  };
  const act = async (a) => {
    if (a.save) { onSaved(); return; }
    if (a.catalogue && workspaceId) {
      // Saved in one press: the offering this check was about, with its price and cost when they were given.
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const out = await apiRequest(`/businesses/${workspaceId}/catalogue/from-check`, "POST", a.catalogue);
        const p = out?.product || a.catalogue;
        const price = typeof p.base_price === "number" && p.base_price > 0 ? ` at ${result?.currency_sign || "£"}${p.base_price.toLocaleString("en-GB")}` : "";
        setDone({ text: `${out?.created ? "Added" : "Updated"} in your catalogue: ${p.name}${price}.`, to: "/catalogue" });
        useWorkspaceStore.getState().refreshWorkspaceData?.();
      } catch {
        setDone({ error: "Couldn't save it to your catalogue. Try again." });
      } finally { inFlight.current = false; }
      return;
    }
    if (a.capability && workspaceId) {
      // A task: its price first. A free one (0 credits) starts at once.
      let price = null;
      try { price = await apiRequest(`/businesses/${workspaceId}/agent/price/${a.capability}`, "GET"); } catch { price = null; }
      if (!price) { setDone({ error: "Its price couldn't be checked just now, so nothing was started. Try again in a moment." }); return; }
      if (!price.credits) { await start(a); return; }
      setAsking({ action: a, title: a.label || price.title, credits: price.credits, balance: price.balance });
      return;
    }
    if (a.to) navigate(a.to);
  };
  const priceModal = <PriceConfirm asking={asking} onStart={() => { const a = asking.action; setAsking(null); start(a); }} onClose={() => setAsking(null)} />;
  return { act, done, setDone, asking, priceModal };
}

/** The premium step before it starts (PRD 12.3, 4.1): what it will do, its one price ("60 credits", charged only if checked sources are found),
 *  Start or Not now. While it works, what it is looking at, one line at a time. Esc or a click outside closes it. */
export function PremiumConfirm({ result, confirm, working, onStart, onClose }) {
  const [shown, setShown] = useState(0);
  const [live, setLive] = useState(null);      // each topic's state while it researches, from the server
  const looking = confirm?.looking_at || [];
  useEffect(() => {
    if (!working || looking.length < 2) return undefined;
    const timer = setInterval(() => setShown((n) => (n + 1) % looking.length), 4000);
    return () => clearInterval(timer);
  }, [working, looking.length]);
  useEffect(() => {
    if (!working || !confirm?.progressKey) { setLive(null); return undefined; }
    let on = true;
    const tick = () => apiRequest(`/research-progress/${confirm.progressKey}`, "GET").then((p) => { if (on && p?.topics?.length) setLive(p); }).catch(() => {});
    const timer = setInterval(tick, 1500);
    return () => { on = false; clearInterval(timer); };
  }, [working, confirm?.progressKey]);
  useEffect(() => {
    if (!confirm) return undefined;
    const key = (e) => { if (e.key === "Escape" && !working) onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [confirm, working, onClose]);
  if (!confirm || typeof document === "undefined") return null;
  const price = creditCopy.confirmVariable({ action: confirm.action || "Research your gaps", max: confirm.max ?? confirm.cost, balance: confirm.balance });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" data-premium-confirm>
      <button type="button" aria-label="Close" disabled={working} onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-slate-900/40" />
      <div role="dialog" aria-modal="true" aria-label="Before I start" className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" data-fv-confirm>
        <p className="text-[14px] leading-6 text-slate-800 dark:text-slate-200">{result?.premium_next_action?.explains || "I can research what is missing and help close the gaps."}</p>
        {confirm.not_connected && <p className="mt-2 text-[13px] text-amber-900" data-not-connected>{confirm.not_connected}</p>}
        <p className="mt-3 text-[14px] font-semibold text-slate-900 dark:text-slate-100" data-fv-cost>{price}</p>
        {working && (live?.topics?.length ? (
          <ul role="status" className="mt-2 space-y-0.5 text-[12.5px] text-slate-600" data-fv-progress>
            {live.topics.map((t) => <li key={t.label}>{t.state === "done" ? (t.sources ? `${t.label}: ${t.sources} source${t.sources === 1 ? "" : "s"} found` : `${t.label}: nothing found`) : `Looking at ${String(t.label).toLowerCase()}…`}</li>)}
          </ul>
        ) : <p role="status" className="mt-2 text-[13px] text-slate-600" data-fv-progress>{looking.length ? `Looking at ${looking[shown]}…` : "Researching…"}</p>)}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" autoFocus disabled={working} aria-busy={working} data-fv-start onClick={onStart}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70">
            {working && <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {working ? "Researching…" : "Start"}</button>
          <button type="button" disabled={working} onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Not now</button>
        </div>
      </div>
    </div>, document.body);
}

/** "Write a business plan · 40 credits": Start or Not now, in a modal on the page. Esc or a click outside closes it. */
export function PriceConfirm({ asking, onStart, onClose }) {
  useEffect(() => {
    if (!asking) return undefined;
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [asking, onClose]);
  if (!asking || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" data-price-confirm>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-slate-900/40" />
      <div role="dialog" aria-modal="true" aria-label="Before I start" className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
        <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100" data-price-line>{creditCopy.confirmFixed({ action: asking.title, cost: asking.credits, balance: asking.balance })}</p>
        <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">Charged only when it is done. Nothing is sent to anyone.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" autoFocus onClick={onStart} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Start</button>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Not now</button>
        </div>
      </div>
    </div>, document.body);
}

/** The first result kept for the dashboard: fetched once, replaced by what adopted research leaves, dismissed or saved for
 *  later (then the Agent card's tiles come back; the result stays in Agent Centre > Results). */
const HIDDEN = "ea_first_value_hidden";
export function useFirstResult() {
  const [result, setResult] = useState(null);
  const id = remembered();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  useEffect(() => {
    setResult(null);
    if (!id || !workspaceId) return undefined;
    let hidden = "";
    try { hidden = localStorage.getItem(HIDDEN) || ""; } catch { /* shown */ }
    if (hidden === id) return undefined;
    let live = true;
    // Only on the business it was worked out for: another workspace never shows it (a test task's cupcakes on a cleaning business).
    fetchFirstValue(id).then((res) => { if (live && res?.result && (!res.business_id || res.business_id === workspaceId)) setResult(res.result); }).catch(() => {});
    return () => { live = false; };
  }, [id, workspaceId]);
  const adopted = (out) => { if (out?.result) setResult((had) => ({ ...out.result, premium_gate: had?.premium_gate })); };
  const [dismissed, setDismissed] = useState(null);      // the result just dismissed: Undo brings it back for 5 seconds
  const hide = () => {
    try { localStorage.setItem(HIDDEN, id || ""); } catch { /* hidden for now */ }
    setResult(null);
  };
  const dismiss = () => { setDismissed(result); hide(); };
  const undo = () => {
    try { if (localStorage.getItem(HIDDEN) === id) localStorage.removeItem(HIDDEN); } catch { /* shown for now */ }
    setResult(dismissed);
    setDismissed(null);
  };
  return { result, sessionId: id, setResult, premium: id ? premiumFlow({ base: `/task-sessions/${id}/premium`, onAdopted: adopted }) : null,
    dismiss, saveForLater: hide, onAdopted: adopted, dismissed, undo, forgetDismissed: () => setDismissed(null) };
}

export default function FirstValueCard({ result, onDismiss = null, onContinue = null, continueLabel = "Open my dashboard", className = "", onPremium = null, extra = null,
  initialServed = null }) {
  const navigate = useNavigate();
  const [gate, setGate] = useState(false);      // the premium step was chosen: its gate, shown after the value and never before it
  const [saved, setSaved] = useState(false);
  const [served, setServed] = useState(initialServed);   // the server's answer to the premium step: a gate, a cost to confirm, or the research it did
  const [working, setWorking] = useState(false);      // QA PF8: the premium step is running (about 15 seconds): one press, never two
  const inFlight = useRef(false);      // set at once, so a double click inside one render still starts one request
  if (!result) return null;
  const failed = result.blockers.filter((b) => b.kind === "failed");
  const missing = result.blockers.filter((b) => b.kind !== "failed");
  const numeric = typeof result.score === "number";
  // §2/§3: where the full assessment exists, its summary is the one shown (never a second score); until then the quick
  // check's own score, labelled Provisional, with its coverage beside it.
  const full = result.assessment?.assessment_id ? result.assessment : null;
  const latest = latestOf(result);
  const g = served?.gate || result.premium_gate;
  const { act, done, setDone, priceModal } = useFreeActions(result, { onSaved: () => setSaved(true), setServed });
  const button = "rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

  return (
    <section aria-label={result.headline} data-first-value={result.assessment_type} data-m="fadeUp"
      className={`rounded-2xl border border-brand-200 bg-white p-5 text-left shadow-sm sm:p-6 dark:border-brand-900 dark:bg-slate-900 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600" data-fv-source>{latest.full ? latest.source : "Your first result"}</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{result.headline}{result.classification && numeric ? `: ${result.classification}` : ""}</h2>
          {result.adopted && <p data-fv-adopted className="mt-0.5 text-[12px] text-emerald-700">Updated with the research you adopted{result.adopted.version ? ` (version ${result.adopted.version})` : ""}.</p>}
        </div>
        {onDismiss && <button type="button" onClick={() => onDismiss()} className="text-[12px] font-semibold text-slate-500 underline-offset-2 hover:underline">Dismiss</button>}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
        {full ? (
          <p data-fv-score data-fv-assessment className="text-3xl font-extrabold tabular-nums text-slate-950 dark:text-slate-100">
            {latest.score}
            <span className="ml-1.5 text-sm font-semibold text-slate-500">{CLASS_WORD[full.classification] || ""}</span>
            <span className="mt-1 block text-[13px] font-medium text-slate-500" data-fv-earlier>{latest.earlier}
              {latest.to && <> · <a href={latest.to} onClick={(e) => { e.preventDefault(); navigate(latest.to); }} className="font-semibold text-brand-700 underline-offset-2 hover:underline">{latest.open}</a></>}</span>
          </p>
        ) : (
          <p data-fv-score className="text-3xl font-extrabold tabular-nums text-slate-950 dark:text-slate-100">
            {result.score}{result.score_label && <span className="ml-1.5 text-sm font-semibold text-slate-500">{result.score_label}</span>}
            {numeric && <span data-fv-provisional className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 align-middle text-[11px] font-semibold text-amber-800">Provisional</span>}
          </p>
        )}
        {/* Evidence coverage: how much is known. Shown beside the result, never as part of it. */}
        <div className="min-w-[10rem] flex-1" data-fv-coverage>
          <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">Evidence coverage {(full ? full.evidence_coverage : result.evidence_coverage) ?? 0}%</p>
          <div role="progressbar" aria-label="Evidence coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={(full ? full.evidence_coverage : result.evidence_coverage) ?? 0} className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="m-bar-fill h-full rounded-full bg-brand-500" style={{ width: `${(full ? full.evidence_coverage : result.evidence_coverage) ?? 0}%` }} />
          </div>
        </div>
      </div>

      {result.metrics?.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]" data-fv-metrics>
          {result.metrics.map((m) => <div key={m.label} className="flex gap-1.5"><dt className="text-slate-500">{m.label}:</dt><dd className="font-semibold text-slate-800 dark:text-slate-200">{m.value}</dd></div>)}
        </dl>
      )}

      {full && <p className="mt-5 text-[11px] font-bold uppercase tracking-widest text-slate-400" data-fv-first-lists>From your first result</p>}
      <div className={`${full ? "mt-2" : "mt-5"} grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]`}>
        <div data-fv-strengths>
          <h3 className="text-[13px] font-bold text-slate-900 dark:text-slate-100">What looks ready</h3>
          {result.strengths.length ? (
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">{result.strengths.map((s) => (
              <li key={s} className="flex items-baseline gap-2 py-1.5 text-[13px] leading-snug text-slate-700 dark:text-slate-200"><span aria-hidden="true" className="text-emerald-600">✓</span>{s}</li>))}</ul>
          ) : <p className="mt-1.5 text-[13px] text-slate-500">Nothing can be confirmed yet.</p>}
        </div>
        <div data-fv-blockers>
          <h3 className="text-[13px] font-bold text-slate-900 dark:text-slate-100">What is missing</h3>
          {/* Each gap on one row: its label in a column of its own, so the descriptions line up. */}
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            {failed.map((b) => <li key={b.key} data-blocker="failed" className="grid grid-cols-[6.5rem_minmax(0,1fr)] sm:grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-x-3 py-1.5 text-[13px] leading-snug text-slate-700 dark:text-slate-200"><span className="justify-self-start whitespace-nowrap rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">Blocker</span><span>{b.label}</span></li>)}
            {missing.map((b) => <li key={b.key} data-blocker={b.kind === "partial" ? "partial" : "unknown"} className="grid grid-cols-[6.5rem_minmax(0,1fr)] sm:grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-x-3 py-1.5 text-[13px] leading-snug text-slate-700 dark:text-slate-200"><span className={`justify-self-start whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${b.kind === "partial" ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>{b.kind === "partial" ? "Early evidence" : "Not known yet"}</span><span>{b.label}</span></li>)}
          </ul>
        </div>
      </div>
      {result.note && <p className="mt-3 text-[12px] text-slate-500" data-fv-note>{result.note}</p>}

      {gate && g && !g.allowed ? (
        <div role="status" data-fv-gate className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[13px] text-amber-950">
          <p>{g.message}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" onClick={() => { trackGoal("premium_upgrade_clicked", { where: "app" }); navigate(g.primary.to); }} className="rounded-xl bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-700">{g.primary.label}</button>
            {(g.secondary || []).map((x) => (x.save
              ? <button key={x.label} type="button" onClick={() => { setSaved(true); setGate(false); }} className={button}>{x.label}</button>
              : <button key={x.label} type="button" onClick={() => setGate(false)} className={button}>{x.label}</button>))}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2" data-fv-actions>
          {result.premium_next_action && <button type="button" data-fv-premium disabled={working} aria-busy={working} onClick={async () => {
            if (inFlight.current) return;
            trackGoal("first_value_premium_clicked", { where: "app" });
            if (!onPremium) { if (g?.allowed) navigate("/agent"); else setGate(true); return; }
            // QA PF1/PF3: the server checks the plan, then the cost (shown before anything starts), then researches.
            inFlight.current = true;
            setWorking(true);
            try {
              const out = await onPremium();
              setServed(out || null);
              if (out?.gate) setGate(true);
            } finally { inFlight.current = false; setWorking(false); }
          }}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70">
            {working && <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {working ? "Working on it…" : result.premium_next_action.label}</button>}
          {actionsOf(result).map((a) => <button key={a.label} type="button" onClick={() => act(a)} className={button}>{a.label}</button>)}
        </div>
      )}
      {served?.started && (
        <p role="status" className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[13px] text-indigo-900" data-fv-started>
          Started. I'm working on it now, with what you told me here.{" "}
          <a href={`/agent/runs/${served.run_id}`} onClick={(e) => { e.preventDefault(); navigate(`/agent/runs/${served.run_id}`); }} className="font-semibold underline">Follow it</a>
        </p>
      )}
      {served?.needs && served.message && !served.started && <div className="mt-3" data-fv-needs>{served.render || <p className="text-[13px] text-slate-700">{served.message}</p>}</div>}
      {/* The premium step's price and Start, in a modal on the page: never below the fold (F-3). */}
      <PremiumConfirm result={result} confirm={served?.confirm} working={working} onClose={() => setServed(null)} onStart={async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setWorking(true);
        try {
          const next = await served.start();
          if (!next) setDone({ error: "The research couldn't finish just now. Nothing was charged. Try again in a moment." });
          else { setServed(next); if (next?.gate) setGate(true); }
        } finally { inFlight.current = false; setWorking(false); }
      }} />
      {served?.research && served.render}
      {extra}
      {done && (done.error
        ? <p role="alert" className="mt-2 text-[12px] font-medium text-rose-700">{done.error}</p>
        : <p role="status" className="mt-2 text-[12px] text-emerald-800" data-fv-done>{done.text}{done.to && <> <button type="button" onClick={() => navigate(done.to)} className="font-semibold underline">Open catalogue</button></>}</p>)}
      {saved && <p role="status" className="mt-2 text-[12px] text-slate-600">Saved. You'll find this at the top of your dashboard.</p>}
      {priceModal}
      {onContinue && (
        <div className="mt-4 flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
          <button type="button" onClick={onContinue} className="text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline">{continueLabel}</button>
        </div>
      )}
    </section>
  );
}

/** On the dashboard: the same result as the first card, on every load until it is dismissed or acted on. */
export function FirstValueOnDashboard({ className = "" }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    const id = remembered();
    if (!id) return undefined;
    let live = true;
    fetchFirstValue(id).then((res) => { if (live && res?.result) setState(res.result); }).catch(() => {});
    return () => { live = false; };
  }, []);
  // QA PF3: the premium step here is the same research, from the homepage task's own answers.
  const id = remembered();
  // Adopted: the card is the result as the research left it, with its next step (never the first answers again).
  const adopted = (out) => { if (out?.result) setState((s) => ({ ...out.result, premium_gate: s?.premium_gate })); };
  return state ? <FirstValueCard result={state} onDismiss={() => { forget(); setState(null); }} className={className}
    onPremium={id ? premiumFlow({ base: `/task-sessions/${id}/premium`, onAdopted: adopted }) : null} /> : null;
}
