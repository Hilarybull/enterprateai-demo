import { useEffect, useRef, useState } from "react";
import { resultHome } from "../lib/resultHome";
import { getRun } from "../lib/agent";
import { relatedServices } from "../lib/related";
import { toast } from "../lib/toast";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { trackGoal } from "./GoalLauncher";
import { useWorkspaceStore } from "../store/workspace";
import { InlineResearch, premiumFlow } from "./ResearchReview";
import { refusalMessage } from "../lib/entitlement";
import { creditCopy } from "../lib/creditCopy";
import { NextSteps, PackLine, SavedNotice, StatusLine, stepsOf, useResearchRun, useStepPrices } from "./ResultSummary";
import { hasFundingPack } from "../lib/plans";
import WhatNext from "./WhatNext";
import { useAuthStore } from "../store/auth";

// The free first result for a goal (First-Value PRD 12.2): what was checked, the score or the
// count, how much of the evidence is known (its own figure, never folded into the score), what
// looks ready, and what is missing, with what failed kept apart from what simply is not known yet.
// The premium step is offered after this, and its gate is shown only when it is chosen (12.3).
// Everything on it comes from the server's deterministic result: nothing here is worked out or worded by a model.

const KEY = "ea_first_value_session";

/** Remember which task's result to show first on the dashboard (until it is dismissed or acted on). */
export function rememberFirstValue(sessionId) {
  try { localStorage.setItem(KEY, sessionId); } catch { /* shown on the start page either way */ }
  // Fresh: the dashboard shows the full card once, right after this run; on the next visit it is a strip (the owner, 20 Oct).
  try { sessionStorage.setItem(FRESH, sessionId); } catch { /* a strip then */ }
}
const FRESH = "ea_first_value_fresh";
const forget = () => { try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ } };
/** A homepage task that is not a check (an invoice, a quotation): the dashboard opens on THAT task, not an older result. */
export const forgetFirstValue = forget;
const remembered = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

// The result carries what its "Edit answers" needs (the questions asked and the answers given), and the task it is from.
const withEdit = (res) => (res?.result ? { ...res, result: { ...res.result, _edit: res.edit || null, _session: res.session_id } } : res);
export const fetchFirstValue = (sessionId) => apiRequest(`/task-sessions/${sessionId}/first-value`, "GET").then(withEdit);

/** Edit and run again, on the result itself (the owner's QA, 15 Oct): the answers this request was given, changed in
 *  place; Save and check again updates the case or plan it set up and shows the new result. Free. */
// The amount as typed, shown with separators: "50000" reads "50,000"; "50k" stays as typed until saved.
const moneyShown = (v) => { const t = String(v ?? ""); return /^\d+(\.\d+)?$/.test(t) ? Number(t).toLocaleString("en-GB", { maximumFractionDigits: 2 }) : t; };
const moneyTyped = (t) => { const raw = String(t || "").replace(/,/g, "").trim(); const k = raw.match(/^(\d+(?:\.\d+)?)\s*k$/i); const m = raw.match(/^(\d+(?:\.\d+)?)\s*m$/i);
  return k ? String(Number(k[1]) * 1000) : m ? String(Number(m[1]) * 1000000) : raw; };

export function EditAnswers({ result, onUpdated, className = "", onDirty = () => {} }) {
  const edit = result?._edit;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const start = () => { setValues({ ...(edit.answers || {}) }); setProblem(""); setOpen(true); };
  const put = (k, v) => setValues((had) => ({ ...had, [k]: v }));
  const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => String(v ?? "") !== String((edit.answers || {})[k] ?? "")));
  const dirty = open && Object.keys(changed).length > 0;
  useEffect(() => { onDirty(dirty); }, [dirty]);      // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // While the form is open the floating chat button stays out of the way of its buttons (mobile).
    if (!open || typeof document === "undefined") return undefined;
    document.body.dataset.formOpen = "1";
    return () => { delete document.body.dataset.formOpen; };
  }, [open]);
  const save = async () => {
    setBusy(true);
    setProblem("");
    try {
      const res = withEdit(await apiRequest(`/task-sessions/${result._session}/answers`, "POST", { answers: changed }, { timeoutMs: 30000 }));
      onUpdated?.(res.result);
      setOpen(false);
    } catch {
      setProblem("That didn't go through. Nothing was changed. Try again.");
    } finally { setBusy(false); }
  };
  const field = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
  if (!edit?.questions?.length || !result?._session) return null;
  if (!open) {
    return <button type="button" onClick={start} data-edit-answers className={`text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline max-sm:py-1 ${className}`}>Edit answers</button>;
  }
  return (
    // One card on mobile (no card inside the card); its own panel from 768px.
    <div className="w-full pb-16 md:rounded-xl md:border md:border-slate-200 md:bg-slate-50 md:p-4 md:pb-4 dark:md:border-slate-700 dark:md:bg-slate-900/60" data-edit-form>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Your answers</p>
      <p className="mt-0.5 text-[12.5px] text-slate-500">Change any of them, then check again. The {result.assessment_type === "launch_readiness_initial" ? "launch plan" : "funding case"} is updated with what you change.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {edit.questions.map((q) => (
          <label key={q.key} className="block text-[13px] font-medium text-slate-700 dark:text-slate-200">
            {/* Two lines kept for every label, so the inputs in a row line up when one wraps. */}
            <span className="block md:min-h-[2.5rem]">{q.label}</span>
            {q.key === "amount" ? (
              <span className="mt-1 flex items-center rounded-lg border border-slate-200 bg-white focus-within:border-brand-500 dark:border-slate-700 dark:bg-slate-950" data-money-input>
                <span className="pl-3 text-sm font-semibold text-slate-500">{result.currency_sign || ""}</span>
                <input value={moneyShown(values[q.key])} onChange={(e) => put(q.key, moneyTyped(e.target.value))} inputMode="decimal" aria-label={q.label}
                  className="w-full rounded-lg bg-transparent px-2 py-2 text-sm text-slate-900 outline-none dark:text-slate-100" placeholder="For example 50,000 or 50k" />
              </span>
            ) : q.key === "timing" ? (
              <span className="mt-1 flex flex-wrap items-center gap-2" data-month-input>
                <input type="month" value={/^\d{4}-\d{2}$/.test(String(values[q.key] || "")) ? values[q.key] : ""} onChange={(e) => put(q.key, e.target.value)}
                  disabled={values[q.key] === "unknown"} aria-label={q.label} className={`${field} mt-0 min-w-0 flex-1`} />
                <label className="inline-flex items-center gap-1.5 text-[12.5px] font-normal text-slate-600">
                  <input type="checkbox" checked={values[q.key] === "unknown"} onChange={(e) => put(q.key, e.target.checked ? "unknown" : "")} /> Not sure
                </label>
                {values[q.key] && !/^\d{4}-\d{2}$/.test(String(values[q.key])) && values[q.key] !== "unknown" && <span className="w-full text-[11.5px] font-normal text-slate-500">You said: {values[q.key]}. Pick a month to make it a date.</span>}
              </span>
            ) : q.options?.length ? (
              <select value={values[q.key] ?? ""} onChange={(e) => put(q.key, e.target.value)} className={field} aria-label={q.label}>
                <option value="">Not answered</option>
                {q.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                {q.unsure && !q.options.some((o) => o.value === "unknown") && <option value="unknown">{q.unsure}</option>}
              </select>
            ) : (
              <input value={values[q.key] ?? ""} onChange={(e) => put(q.key, e.target.value)} className={field} aria-label={q.label}
                inputMode={q.type === "number" ? "decimal" : undefined} list={q.chips?.length ? `chips-${q.key}` : undefined} />
            )}
            {q.chips?.length > 0 && <datalist id={`chips-${q.key}`}>{q.chips.map((c) => <option key={c.value} value={c.value} />)}</datalist>}
          </label>
        ))}
      </div>
      {problem && <p role="alert" className="mt-2 text-[12.5px] text-rose-700">{problem}</p>}
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-600 hover:text-slate-900 sm:w-auto sm:border-0 sm:py-1.5">Cancel</button>
        <button type="button" onClick={save} disabled={busy || !Object.keys(changed).length} data-edit-save
          title={!Object.keys(changed).length ? "Change an answer to save" : undefined}
          className="w-full rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 sm:w-auto sm:py-1.5">{busy ? "Checking again…" : "Save and check again"}</button>
      </div>
    </div>
  );
}

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
  // The full check can't score yet (too little evidence): the score worked out from this request's answers is the one shown,
  // never "No score yet" over a request just answered (the owner's QA, 15 Oct). The full check is said beside it.
  if (typeof full.score !== "number" && typeof result?.score === "number") {
    const where = full.kind === "funding" ? `/funding/${full.case_id}` : full.kind === "launch" ? `/launch/${full.initiative_id}` : null;
    return { full: null, score: first, band: result?.band, coverage: result?.evidence_coverage ?? 0, source: "From your answers", to: where,
      open: full.kind === "funding" ? "Open funding case" : full.kind === "launch" ? "Open launch plan" : null,
      // One set of numbers (A6): the score and the coverage shown are this snapshot's; the full check is named, with no second figure.
      earlier: "Full check: not enough evidence to score yet", unscoredCheck: full };
  }
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
    // The result itself, the idea check's page (G4, 23 Oct: this opened an empty Idea Validation form)
    case "idea_viability_initial": return { label: "Open idea check", to: "/check/idea" };
    default: return null;
  }
}

// Why each next action helps, in one line, for its card
const NEXT_WHY = {
  "Add it to your catalogue": "Your price and cost per sale, kept in one place for the launch.",
  "Set up your Marketplace profile": "So your first customers can find you.",
  "Write a business plan": "The plan behind the launch, in one document.",
  "Create a quotation": "Ready for the first order.",
};
const kindOfResult = (r) => (r?.assessment?.kind || (String(r?.assessment_type || "").startsWith("launch") ? "launch" : String(r?.assessment_type || "").startsWith("funding") ? "funding" : ""));

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
  // The funding pack is on Decision Engine and above: on a lower plan the button says so and opens the plans.
  const { subscription, platformGrants } = useAuthStore.getState();
  if (!hasFundingPack(subscription, platformGrants)) {
    for (const a of list) {
      if (/^(Prepare my|View) funding pack/.test(a.label || "")) Object.assign(a, { label: "Funding pack (Decision Engine plan)", to: "/pricing", locked: true });
    }
  }
  const open = openOf(result);
  if (open && !list.some((a) => /^Open /.test(a.label || ""))) {
    const at = list.findIndex((a) => a.save);
    list.splice(at < 0 ? list.length : at, 0, open);
  }
  return list;
}

/** A task started from a page, followed for a little while (the owner's QA, 23 Oct: "I had to click Follow it to know the
 *  Agent needs something from me"): a question from the Agent, or the draft ready, said in a toast with one button. */
export function followRun(runId, label, navigate, { every = 4000, tries = 30 } = {}) {
  let n = 0;
  const look = async () => {
    n += 1;
    let run = null;
    try { run = (await getRun(runId))?.run; } catch { run = null; }
    const steps = run?.steps || [];
    const asking = steps.find((x) => x.state === "awaiting_input");
    if (asking) {
      toast({ id: `run-${runId}`, kind: "info", title: "The Agent needs your answer.", detail: asking.question || asking.message || label || "",
        actions: [{ label: "Answer", onClick: () => navigate(`/agent/runs/${runId}`) }] });
      return;
    }
    if (["succeeded", "awaiting_approval"].includes(run?.status)) {
      const to = (run?.outcome?.links || [])[0]?.to || `/agent/runs/${runId}`;
      toast({ id: `run-${runId}`, kind: "success", title: `${label || "Your draft"} is ready to review.`, detail: "",
        actions: [{ label: "Open it", onClick: () => navigate(to) }] });
      return;
    }
    if (["failed", "cancelled"].includes(run?.status)) return;
    if (n < tries) setTimeout(look, every);
  };
  setTimeout(look, every);
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
      // Started from a launch plan: that plan's own offering, never another one's (the owner's QA, 23 Oct: a business plan
      // drafted from the drone cleaning plan was about the car wash)
      const plan = result?.assessment?.kind === "launch" || String(result?.assessment_type || "").startsWith("launch") ? result?.assessment?.initiative_id : null;
      const params = { ...(a.params || {}), ...(plan ? { subject_id: plan } : {}) };
      const out = await apiRequest("/agent/requests", "POST", { business_id: workspaceId, capability: a.capability, params, source_channel: "ui_action", background: true, confirmed: true });      // its price was just shown
      if (out?.run?.id) { setServed({ started: true, run_id: out.run.id, capability: a.capability, label: a.label }); followRun(out.run.id, a.label, navigate); }      // said once, with "Follow it" (never a second line)
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
      // Asked twice before giving up (the owner's QA, 23 Oct: "Its price couldn't be checked" on a slow moment); never a
      // dead end: without a price, its own page opens, where it starts with its price shown
      for (let n = 0; n < 2 && !price; n += 1) {
        try { price = await apiRequest(`/businesses/${workspaceId}/agent/price/${a.capability}`, "GET"); } catch { price = null; }
      }
      if (!price && a.to) { navigate(a.to); return; }
      if (!price) { setDone({ error: "Its price couldn't be checked just now, so nothing was started. Try again in a moment." }); return; }
      if (!price.credits) { await start(a); return; }
      setAsking({ action: a, title: a.label || price.title, credits: price.credits, balance: price.balance });
      window.dispatchEvent(new CustomEvent("ea:credits:refresh"));      // the sidebar says the same balance as the price
      return;
    }
    if (a.to) navigate(a.to);
  };
  const priceModal = <PriceConfirm asking={asking} onStart={() => { const a = asking.action; setAsking(null); start(a); }} onClose={() => setAsking(null)} />;
  return { act, done, setDone, asking, priceModal };
}

/** The premium step before it starts (PRD 12.3, 4.1): what it will do, its one price ("60 credits", charged only if checked sources are found),
 *  Start or Not now. While it works, what it is looking at, one line at a time. Esc or a click outside closes it. */
/** A spending dialog's guard (the owner's QA, 17 Oct: a space typed in the form pressed Start and spent 40 credits). */
function useDeliberate(open) {
  const openedAt = useRef(0);
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    openedAt.current = Date.now();
    const trap = (e) => {
      if (e.key !== "Tab" || !panel.current) return;
      const list = [...panel.current.querySelectorAll("button:not([disabled]), a[href], input, select, textarea")];
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!panel.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", trap);
    return () => window.removeEventListener("keydown", trap);
  }, [open]);
  const spend = (go) => ({
    onKeyDown: (e) => { if (e.key === " " || e.key === "Spacebar") e.preventDefault(); },
    onKeyUp: (e) => { if (e.key === " " || e.key === "Spacebar") e.preventDefault(); },
    onClick: (e) => {
      // A key carried over from typing in the form behind (pressed just before it opened) never spends.
      if (Date.now() - openedAt.current < 600 && Date.now() - (window.__eaLastKeyAt || 0) < 800 && e.detail === 0) return;
      if (e.detail === 0 && window.__eaLastKey === " ") return;      // a space never spends
      go();
    },
  });
  return { panel, spend };
}
if (typeof window !== "undefined" && !window.__eaKeyWatch) {
  window.__eaKeyWatch = true;
  window.addEventListener("keydown", (e) => { window.__eaLastKey = e.key; window.__eaLastKeyAt = Date.now(); }, true);
}

/** "Market in Nigeria" as "market in Nigeria": only the first letter, so a place keeps its capital (the owner's QA, 21 Oct). */
const lowerFirst = (t) => { const s = String(t); return s.charAt(0).toLowerCase() + s.slice(1); };

export function PremiumConfirm({ result, confirm: given, working: busy, onStart, onClose, title = null }) {
  // Opened at once with the price still being worked out (the owner's QA, 21 Oct): Start waits for it.
  const pending = Boolean(given?.pending);
  const confirm = given;
  const working = busy && !pending;
  const { panel, spend } = useDeliberate(Boolean(confirm));
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
  const price = pending ? "Working out the price…" : creditCopy.confirmVariable({ action: confirm.action || "Research your gaps", max: confirm.max ?? confirm.cost, balance: confirm.balance });
  const steps = (result?.blockers || []).length;
  const plan = confirm.plan || {};
  const n = (k) => Number(plan[k]) || 0;
  // What it will do, in plain words, one line each (only what applies).
  const doing = [
    n("research") + n("estimate") && `Look up ${n("research") + n("estimate")} ${n("research") + n("estimate") === 1 ? "thing" : "things"} funders ask about${(confirm.topics || []).length ? `: ${confirm.topics.slice(0, 3).map(lowerFirst).join(", ")}${confirm.topics.length > 3 ? " and more" : ""}` : ""}`,
    n("worked_out") && `Work out ${n("worked_out")} ${n("worked_out") === 1 ? "figure" : "figures"} from what you told me`,
    n("asked") && `Ask you ${n("asked")} ${n("asked") === 1 ? "question" : "questions"} only you can answer`,
  ].filter(Boolean);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" data-premium-confirm>
      <button type="button" aria-label="Close" disabled={working} onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-slate-900/40" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Before I start" className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900" data-fv-confirm>
        <h2 className="text-[17px] font-semibold text-slate-900 dark:text-slate-100" data-fv-confirm-title>
          {title || (steps > 1 ? `Do all ${steps} steps for you` : steps === 1 ? "Do this step for you" : "Research what is missing")}</h2>
        <p className="mt-1.5 text-[14px] leading-6 text-slate-600 dark:text-slate-300">I'll research and draft each one. You check and change anything before it counts.</p>
        {doing.length > 0 && (
          <ul className="mt-4 space-y-2" data-fv-doing>
            {doing.map((line) => (
              <li key={line} className="flex gap-2.5 text-[13.5px] leading-5 text-slate-700 dark:text-slate-200">
                <span aria-hidden="true" className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5L19 7" /></svg>
                </span>{line}
              </li>
            ))}
          </ul>
        )}
        {confirm.not_connected && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900" data-not-connected>{confirm.not_connected}</p>}
        {/* The price before anything starts, in the credit wording every paid action uses. */}
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-[13.5px] font-medium leading-5 text-slate-900 dark:bg-slate-800/60 dark:text-slate-100" data-fv-cost aria-busy={pending || undefined}>{price}</p>
        {working && (live?.topics?.length ? (
          <ul role="status" className="mt-3 space-y-0.5 text-[12.5px] text-slate-600" data-fv-progress>
            {live.topics.map((t) => <li key={t.label}>{t.state === "done" ? (t.sources ? `${t.label}: ${t.sources} source${t.sources === 1 ? "" : "s"} found` : `${t.label}: nothing found`) : `Looking at ${lowerFirst(t.label)}…`}</li>)}
          </ul>
        ) : <p role="status" className="mt-3 text-[13px] text-slate-600" data-fv-progress>{looking.length ? `Looking at ${looking[shown]}…` : "Researching…"}</p>)}
        {/* "Not now" first and focused: nothing is spent by a key press or by accident. */}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" autoFocus disabled={working} onClick={onClose} data-not-now className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Not now</button>
          <button type="button" disabled={working || pending} aria-busy={working} data-fv-start {...spend(async () => {
            try { await onStart(); } finally { window.dispatchEvent(new CustomEvent("ea:credits:refresh")); }      // the sidebar balance, at once
          })}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70">
            {working && <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {working ? "Researching…" : "Start"}</button>
        </div>
      </div>
    </div>, document.body);
}

/** "Write a business plan · 40 credits": Start or Not now, in a modal on the page. Esc or a click outside closes it. */
export function PriceConfirm({ asking, onStart, onClose }) {
  const { panel, spend } = useDeliberate(Boolean(asking));
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
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Before I start" className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
        <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100" data-price-line>{creditCopy.confirmFixed({ action: asking.title, cost: asking.credits, balance: asking.balance })}</p>
        <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">Charged only when it is done. Nothing is sent to anyone.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" {...spend(() => { onStart(); window.dispatchEvent(new CustomEvent("ea:credits:refresh")); })} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Start</button>
          <button type="button" autoFocus onClick={onClose} data-not-now className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Not now</button>
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
    fetchFirstValue(id).then((res) => {
      if (!live || !res?.result || (res.business_id && res.business_id !== workspaceId)) return;
      // Its home is its case (the owner's QA, 22 Oct: 70/100 on the dashboard beside 53/100 on the case): not kept here
      if (resultHome(res.result)) { forget(); return; }
      setResult(res.result);
    }).catch(() => {});
    return () => { live = false; };
  }, [id, workspaceId]);
  const adopted = (out) => { if (out?.result) setResult((had) => ({ ...out.result, premium_gate: had?.premium_gate })); };
  // The full card only right after a fresh run; dismissed, or on the next visit, it is a strip like every pinned item.
  const [fresh, setFresh] = useState(() => { try { return Boolean(id) && sessionStorage.getItem(FRESH) === id; } catch { return false; } });
  useEffect(() => () => { try { if (sessionStorage.getItem(FRESH) === id) sessionStorage.removeItem(FRESH); } catch { /* collapsed anyway */ } }, [id]);
  const collapse = () => { setFresh(false); try { sessionStorage.removeItem(FRESH); } catch { /* collapsed for now */ } };
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
    dismiss, saveForLater: hide, onAdopted: adopted, dismissed, undo, forgetDismissed: () => setDismissed(null), fresh, collapse };
}

const KIND_WORD = { funding: "Funding readiness", launch: "Launch readiness" };

export default function FirstValueCard({ result: given, onDismiss = null, onContinue = null, continueLabel = "Open my dashboard", className = "", onPremium = null, extra = null,
  initialServed = null, onUpdated = null, hideStatus = false, hideOpen = false, embedded = false, run: runGiven = null, onRun = null }) {
  const navigate = useNavigate();
  const [edited, setEdited] = useState(null);      // the result after "Save and check again"
  useEffect(() => { setEdited(null); }, [given?._session]);
  // The case's own steps always come from the page (the case as it is now), never from a refreshed copy of the result,
  // which doesn't carry them (the owner's QA, 22 Oct: after an adopt the old steps came back).
  const result = edited ? { ...edited, ...(given?.case_steps ? { case_steps: given.case_steps } : {}) } : given;
  const asCards = embedded && kindOfResult(result) === "launch";      // a launch plan's page: what to do next as cards
  const [gate, setGate] = useState(false);      // the premium step was chosen: its gate, shown after the value and never before it
  const [saved, setSaved] = useState(false);
  const [served, setServed] = useState(initialServed);   // the server's answer to the premium step: a gate, a cost to confirm, or the research it did
  const [working, setWorking] = useState(false);      // QA PF8: the premium step is running (about 15 seconds): one press, never two
  const inFlight = useRef(false);      // set at once, so a double click inside one render still starts one request
  const [answersDirty, setAnswersDirty] = useState(false);
  const [saveFirst, setSaveFirst] = useState(false);
  const workspaceId = useWorkspaceStore((st) => st.workspaceId);
  const { subscription, platformGrants } = useAuthStore.getState();
  // The Agent's drafts for the steps, and its findings: the case page's newest run when it has one (the owner's QA, 21 Oct:
  // after Research again its drafts are on the Overview, in the steps, with Adopt), else the result's own.
  const fetched = useResearchRun(workspaceId, runGiven ? null : edited || given);
  const [runNow, setRunNow] = useState(null);
  const [detail, setDetail] = useState(null);      // the full review of the run just made here, folded
  const [detailOpen, setDetailOpen] = useState(false);
  // the newest run this card has seen: the one just made here, else the page's, else the result's own
  const run = (runNow && (!(runGiven || fetched) || runNow.id === (runGiven || fetched)?.id || runNow.created_at >= ((runGiven || fetched)?.created_at || "")) ? runNow : null) || runGiven || fetched;
  const prices = useStepPrices((edited || given)?._session, edited || given);      // each step's own price, shown on its button
  if (!result) return null;
  const failed = result.blockers.filter((b) => b.kind === "failed");
  // Drafts waiting: the steps, until each is adopted, edited or dismissed; then "What to do next", never both.
  const reviewing = (runNow || runGiven) ? (run || runNow || runGiven).status === "review" : result.research?.state !== "adopted";
  const missing = result.blockers.filter((b) => b.kind !== "failed");
  const numeric = typeof result.score === "number";
  // §2/§3: where the full assessment exists, its summary is the one shown (never a second score); until then the quick
  // check's own score, with its coverage beside it (no "Provisional" label: the owner, 17 Oct).
  const latest = latestOf(result);
  const full = latest.full;      // null when the full check can't score yet: the answers' score leads
  const g = served?.gate || result.premium_gate;
  const { act, done, setDone, priceModal } = useFreeActions(result, { onSaved: () => setSaved(true), setServed });
  const button = "rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
  // One step ("Do it for me · 10 credits") or all of them ("Do all for me"): the same research, only that step's share.
  async function premiumNow(only = null) {
    if (inFlight.current) return;
    if (answersDirty) { setSaveFirst(true); return; }      // never a spending step over unsaved answers
    trackGoal("first_value_premium_clicked", { where: "app" });
    const flow = only && result._session ? premiumFlow({ base: `/task-sessions/${result._session}/premium`, body: { only: [only] } }) : onPremium;
    if (!flow) { if (g?.allowed) navigate("/agent"); else setGate(true); return; }
    // QA PF1/PF3: the server checks the plan, then the cost (shown before anything starts), then researches. Research
    // already done opens again, free.
    inFlight.current = true;
    setWorking(true);
    setServed({ confirm: { pending: true } });
    try {
      // Its price in the modal first, free or not (focus on "Not now"): nothing starts from one press on the card.
      // Never a spinner for ever (the owner's QA, 23 Oct): the price request itself has its own limit (premiumFlow); a
      // research already done reopens free and may take longer, so nothing here cuts it short. Nothing back: said.
      const out = await flow().catch(() => null);
      if (!out) {
        setServed(null);
        toast({ kind: "error", title: "That couldn't be started just now.", detail: "Nothing was charged.", actions: [{ label: "Try again", onClick: () => premiumNow(only) }] });
        return;
      }
      if (out?.research && out.render && !out.confirm) {
        setRunNow(out.research);
        onRun?.(out.research);
        setDetail(out.render);
        setServed(null);
        return;
      }
      // Closed while the price was worked out: it stays closed.
      setServed((was) => (!was && out?.confirm ? null : out || null));
      if (out?.gate) setGate(true);
    } finally { inFlight.current = false; setWorking(false); }
  }

  return (
    <section aria-label={result.headline} data-first-value={result.assessment_type} data-m="fadeUp"
      className={`rounded-2xl border border-brand-200 bg-white p-5 text-left shadow-sm sm:p-6 dark:border-brand-900 dark:bg-slate-900 ${className}`}>
      <div className={`flex flex-wrap items-start justify-between gap-3 ${embedded ? "hidden" : ""}`} data-fv-head>
        <div className="min-w-0">
          {/* A small grey eyebrow and the case's own name (the owner's brief, 20 Oct). */}
          {(latest.full || latest.unscoredCheck)?.title && <p className="text-[12px] text-slate-500" data-fv-source>{KIND_WORD[(latest.full || latest.unscoredCheck).kind] || result.headline}</p>}
          <h2 className="mt-0.5 text-[16px] font-semibold text-slate-900 dark:text-slate-100" data-fv-title>{(latest.full || latest.unscoredCheck)?.title || result.headline}</h2>
        </div>
        {onDismiss && <button type="button" onClick={() => onDismiss()} className="text-[12px] font-semibold text-slate-500 underline-offset-2 hover:underline">Dismiss</button>}
      </div>

      {!hideStatus && <div className="mt-3"><StatusLine result={result} latest={latest} /></div>}
      {/* What to run next, directly under the score (the owner's brief, 21 Oct). */}
      {/* After the research is adopted, "What to do next" takes the place of the steps (the owner, 21 Oct): never both. */}
      {result.assessment_type === "funding_readiness_initial" && result._session && !reviewing && result.research?.state === "adopted" && (
        <WhatNext sessionId={result._session} businessId={workspaceId} act={act} onChanged={async () => { const r = (await fetchFirstValue(result._session).catch(() => null))?.result; if (r) { setEdited(r); onUpdated?.(r); } return r; }} />
      )}
      {served?.started && (() => {
        // Said where the action was pressed, with where the result will be (the owner's QA, 21 Oct: the funding pack's
        // notice was at the bottom of the card and pointed to the Catalogue).
        const caseId = result?.assessment?.case_id;
        const where = served.capability === "funding_pack_draft" && caseId ? { text: "When it's ready it will be on your funding case, under Documents.", to: `/funding/${caseId}?tab=documents`, label: "Open Documents" }
          : served.capability === "business_plan_draft" ? { text: "When it's ready it will be in Business Blueprints.", to: "/blueprint", label: "Open Business Blueprints" } : null;
        return (
          <p role="status" className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[13px] text-indigo-900" data-fv-started>
            Started{served.label ? `: ${served.label}` : ""}. I'm working on it now.{where ? ` ${where.text}` : ""}{" "}
            <a href={`/agent/runs/${served.run_id}`} onClick={(e) => { e.preventDefault(); navigate(`/agent/runs/${served.run_id}`); }} className="font-semibold underline">Follow it</a>
            {where && <>{" · "}<a href={where.to} onClick={(e) => { e.preventDefault(); navigate(where.to); }} className="font-semibold underline">{where.label}</a></>}
          </p>
        );
      })()}
      {result.metrics?.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px]" data-fv-metrics>
          {result.metrics.map((m) => <div key={m.label} className="flex gap-1.5"><dt className="text-slate-500">{m.label}:</dt><dd className="font-semibold text-slate-700 dark:text-slate-200">{m.value}</dd></div>)}
        </dl>
      )}

      {!reviewing && <SavedNotice />}
      {(reviewing || result.case_steps?.length > 0) && <NextSteps result={result} run={run} prices={prices} working={working} businessId={workspaceId}
        onApplied={async (out) => {
          if (out?.research) { setRunNow(out.research); onRun?.(out.research); }
          const r = (await fetchFirstValue(result._session).catch(() => null))?.result; if (r) { setEdited(r); onUpdated?.(r); } return r;
        }} onReview={onPremium ? () => premiumNow() : null} onDoIt={result.premium_next_action ? (only) => premiumNow(only) : null}
        onAnswered={(res) => { const r = withEdit(res)?.result; if (r) { setEdited(r); setServed(null); onUpdated?.(r); } }} />}
      {/* No "See all findings": "Review every finding in detail" below is the one way in (the owner, 21 Oct). */}
      {/* No separate "What I found for you" (the owner's QA, 21 Oct): the steps first; every finding and funding option in
          "Review every finding in detail". */}
      {!embedded && <PackLine result={result} locked={!hasFundingPack(subscription, platformGrants)} businessId={workspaceId} onCreate={act} />}

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
        // One primary (solid), the rest as text links; full width on a phone (the owner's brief, 17 Oct).
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 max-sm:flex-col max-sm:items-stretch" data-fv-actions>
          {/* One way to start the research (the owner's QA, 20 Oct): with next steps on screen, it is their "Help me become funding-ready" (the check's own words). */}
          {result.premium_next_action && !stepsOf(result).length && (!result.research || result.research.state === "none" || result.research.state === "stale") && <button type="button" data-fv-premium disabled={working} aria-busy={working} onClick={premiumNow}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70 max-sm:w-full">
            {working && <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {working ? "Working on it…" : result.premium_next_action.label}</button>}
          {!asCards && actionsOf(result).filter((a) => !a.save && !/funding pack/i.test(a.label || "") && !(hideOpen && /^Open /.test(a.label || ""))).slice(0, 3).map((a) => (
            <button key={a.label} type="button" onClick={() => act(a)}
              className={a.capability ? `${button} max-sm:w-full` : "text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline max-sm:py-1"}>
              {/^Open /.test(a.label || "") ? "Open full page" : a.label}</button>))}
          {!embedded && <EditAnswers result={result} onDirty={(d) => { setAnswersDirty(d); if (!d) setSaveFirst(false); }} onUpdated={(r) => { setEdited(r); setServed(null); onUpdated?.(r); }} />}
        </div>
      )}
      {asCards && (() => {
        // On a launch plan's page: what to do next as cards, as the funding case's Overview shows them (the owner's QA, 23 Oct:
        // "the recommended next features are not in card"), at most three
        const own = actionsOf(result).filter((a) => !a.save && !/funding pack/i.test(a.label || "") && !/^Open /.test(a.label || ""));
        // Always three (the owner's QA, 23 Oct: "it should recommend another related action to replace the done one"): the
        // result's own first, then the launch's related features, never one already offered in other words
        const covers = (key) => own.some((a) => (key === "plan" && a.capability === "business_plan_draft") || (key === "marketplace" && /marketplace/i.test(a.label || ""))
          || (key === "pricing" && a.catalogue));
        const related = relatedServices({ feature: "launch", subject: { id: result?.assessment?.initiative_id } })
          .filter((r) => !covers(r.key)).map((r) => ({ label: r.title, why: r.why, to: r.to, ...(r.cost === "Credits apply" ? { capability: null, paid: true } : {}) }));
        const next = [...own, ...related].slice(0, 3);
        if (!next.length) return null;
        return (
          <section className="mt-6 space-y-3" data-fv-next-cards>
            <h3 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">What to do next</h3>
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {next.map((a) => (
                <li key={a.label} className="flex h-full flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" data-fv-next-card>
                  <p className="text-[14.5px] font-semibold text-slate-900 dark:text-slate-100">{a.label}</p>
                  <p className="text-[13px] text-slate-600 dark:text-slate-300">{NEXT_WHY[a.label] || a.why || "The next thing that helps this launch."}</p>
                  <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                    <span className="text-[12px] text-slate-500 dark:text-slate-400">{a.capability || a.paid ? "Credits apply" : "Free"}</span>
                    <button type="button" onClick={() => act(a)} className="text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">Start →</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}
      {saveFirst && <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900" data-save-first>
        Save your answers first? Your changes in Your answers aren't saved yet. Save and check again, then research.</p>}
      {served?.needs && served.message && !served.started && <div className="mt-3" data-fv-needs>{served.render || <p className="text-[13px] text-slate-700">{served.message}</p>}</div>}
      {/* The premium step's price and Start, in a modal on the page: never below the fold (F-3). */}
      <PremiumConfirm result={result} confirm={served?.confirm} working={working} onClose={() => setServed(null)} onStart={async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setWorking(true);
        try {
          const next = await served.start();
          if (!next) toast({ kind: "error", title: "The research couldn't finish just now.", detail: "Nothing was charged.", actions: [{ label: "Try again", onClick: () => premiumNow() }] });
          else if (next.research) {
            // Said by the one toast (22 Oct): what it cost and what is left, or that nothing new was found
            const used = Number(next.research.charged_now ?? next.research.charged ?? 0);
            const found = Number(next.research.findings ?? 0);
            if (used > 0) toast({ kind: "success", title: `Done. Used ${used} credits.`, detail: typeof next.research.balance === "number" ? `${next.research.balance} left.` : "",
              actions: [{ label: "See results", onClick: () => document.querySelector("[data-funding-options], [data-next-steps]")?.scrollIntoView?.({ behavior: "smooth", block: "start" }) }] });
            else if (!found) toast({ kind: "success", title: "Nothing new found.", detail: "No credits used." });
            else toast({ kind: "success", title: "Done.", detail: "No credits used." });
            // Its drafts in the step cards at once, the one result (the owner's QA, 21 Oct: no reload, never a second block).
            setRunNow(next.research);
            onRun?.(next.research);
            setServed(null);
            setDetail(next.render || null);      // the full review, one press away (never a second block on its own)
            const r = (await fetchFirstValue(result._session).catch(() => null))?.result;
            if (r) { setEdited(r); onUpdated?.(r); }
          } else { setServed(next); if (next?.gate) setGate(true); }
        } finally { inFlight.current = false; setWorking(false); }
      }} />
      {served?.research && !detail && served.render}
      {/* Not on the case page (the owner, 21 Oct: "no need"): its research summary has every finding. Elsewhere, folded here. */}
      {!embedded && (detail || run?.items?.length > 0) && (
        <div className="mt-3" data-research-detail>
          <button type="button" onClick={() => setDetailOpen((v) => !v)} aria-expanded={detailOpen} data-research-detail-toggle
            className="text-[12.5px] font-semibold text-brand-700 underline-offset-2 hover:underline">{detailOpen ? "Hide the detail" : "Review every finding in detail"}</button>
          {detailOpen && (run ? <InlineResearch businessId={workspaceId} run={run} onAdopted={async () => { const r = (await fetchFirstValue(result._session).catch(() => null))?.result; if (r) { setEdited(r); onUpdated?.(r); } }} /> : detail)}
        </div>
      )}
      {extra}
      {done && (done.error
        ? <p role="alert" className="mt-2 text-[12px] font-medium text-rose-700">{done.error}</p>
        : <p role="status" className="mt-2 text-[12px] text-emerald-800" data-fv-done>{done.text}{done.to && <> <button type="button" onClick={() => navigate(done.to)} className="font-semibold underline">
          {/* The link says where it goes (the owner's QA, 21 Oct: "Open catalogue" opened a task) */}
          {done.label || (String(done.to).startsWith("/catalogue") ? "Open catalogue" : String(done.to).startsWith("/agent/runs") ? "Follow it" : "Open it")}</button></>}</p>)}
      {saved && <p role="status" className="mt-2 text-[12px] text-slate-600">Saved. You'll find this at the top of your dashboard.</p>}
      {priceModal}
      {/* The disclaimer last, in small grey text (the owner's brief, 20 Oct). */}
      {result.note && !embedded && <p className="mt-4 text-[12px] text-slate-500" data-fv-note>{result.note}</p>}
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
