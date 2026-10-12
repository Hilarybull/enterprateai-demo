import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { trackGoal } from "./GoalLauncher";
import { premiumFlow } from "./ResearchReview";

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
const remembered = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export const fetchFirstValue = (sessionId) => apiRequest(`/task-sessions/${sessionId}/first-value`, "GET");

export default function FirstValueCard({ result, onDismiss = null, onContinue = null, continueLabel = "Open my dashboard", className = "", onPremium = null, extra = null }) {
  const navigate = useNavigate();
  const [gate, setGate] = useState(false);      // the premium step was chosen: its gate, shown after the value and never before it
  const [saved, setSaved] = useState(false);
  const [served, setServed] = useState(null);   // the server's answer to the premium step: a gate, a cost to confirm, or the research it did
  const [working, setWorking] = useState(false);      // QA PF8: the premium step is running (about 15 seconds): one press, never two
  const inFlight = useRef(false);      // set at once, so a double click inside one render still starts one request
  if (!result) return null;
  const failed = result.blockers.filter((b) => b.kind === "failed");
  const missing = result.blockers.filter((b) => b.kind !== "failed");
  const numeric = typeof result.score === "number";
  const g = served?.gate || result.premium_gate;
  const act = (a) => (a.save ? setSaved(true) : a.to ? navigate(a.to) : null);
  const button = "rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

  return (
    <section aria-label={result.headline} data-first-value={result.assessment_type} data-m="fadeUp"
      className={`rounded-2xl border border-brand-200 bg-white p-5 text-left shadow-sm dark:border-brand-900 dark:bg-slate-900 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600">Your first result. Free.</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{result.headline}{result.classification && numeric ? `: ${result.classification}` : ""}</h2>
        </div>
        {onDismiss && <button type="button" onClick={() => { forget(); onDismiss(); }} className="text-[12px] font-semibold text-slate-500 underline-offset-2 hover:underline">Dismiss</button>}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
        <p data-fv-score className="text-3xl font-extrabold tabular-nums text-slate-950 dark:text-slate-100">
          {result.score}{result.score_label && <span className="ml-1.5 text-sm font-semibold text-slate-500">{result.score_label}</span>}
        </p>
        {/* Evidence coverage: how much is known. Shown beside the result, never as part of it. */}
        <div className="min-w-[10rem] flex-1" data-fv-coverage>
          <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">Evidence coverage {result.evidence_coverage}%</p>
          <div role="progressbar" aria-label="Evidence coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={result.evidence_coverage} className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="m-bar-fill h-full rounded-full bg-brand-500" style={{ width: `${result.evidence_coverage}%` }} />
          </div>
        </div>
      </div>

      {result.metrics?.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]" data-fv-metrics>
          {result.metrics.map((m) => <div key={m.label} className="flex gap-1.5"><dt className="text-slate-500">{m.label}:</dt><dd className="font-semibold text-slate-800 dark:text-slate-200">{m.value}</dd></div>)}
        </dl>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div data-fv-strengths>
          <h3 className="text-[13px] font-bold text-slate-900 dark:text-slate-100">What looks ready</h3>
          {result.strengths.length ? (
            <ul className="mt-1.5 space-y-1">{result.strengths.map((s) => (
              <li key={s} className="flex items-start gap-2 text-[13px] text-slate-700 dark:text-slate-200"><span aria-hidden="true" className="mt-0.5 text-emerald-600">✓</span>{s}</li>))}</ul>
          ) : <p className="mt-1.5 text-[13px] text-slate-500">Nothing can be confirmed yet.</p>}
        </div>
        <div data-fv-blockers>
          <h3 className="text-[13px] font-bold text-slate-900 dark:text-slate-100">What is missing</h3>
          <ul className="mt-1.5 space-y-1">
            {failed.map((b) => <li key={b.key} data-blocker="failed" className="flex items-start gap-2 text-[13px] text-slate-700 dark:text-slate-200"><span className="mt-0.5 rounded bg-rose-50 px-1.5 text-[11px] font-semibold text-rose-700">Blocker</span>{b.label}</li>)}
            {missing.map((b) => <li key={b.key} data-blocker={b.kind === "partial" ? "partial" : "unknown"} className="flex items-start gap-2 text-[13px] text-slate-700 dark:text-slate-200"><span className={`mt-0.5 shrink-0 rounded px-1.5 text-[11px] font-semibold ${b.kind === "partial" ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>{b.kind === "partial" ? "Early evidence" : "Not known yet"}</span>{b.label}</li>)}
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
          <button type="button" data-fv-premium disabled={working} aria-busy={working} onClick={async () => {
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
            {working ? "Working on it…" : result.premium_next_action.label}</button>
          {result.free_next_actions.map((a) => <button key={a.label} type="button" onClick={() => act(a)} className={button}>{a.label}</button>)}
          {onContinue && <button type="button" onClick={onContinue} className="ml-auto text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline">{continueLabel}</button>}
        </div>
      )}
      {served?.started && (
        <p role="status" className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[13px] text-indigo-900" data-fv-started>
          Started. I'm working on it now, with what you told me here.{" "}
          <a href={`/agent/runs/${served.run_id}`} onClick={(e) => { e.preventDefault(); navigate(`/agent/runs/${served.run_id}`); }} className="font-semibold underline">Follow it</a>
        </p>
      )}
      {served?.needs && served.message && !served.started && <div className="mt-3" data-fv-needs>{served.render || <p className="text-[13px] text-slate-700">{served.message}</p>}</div>}
      {served?.confirm && (
        // The cost, before anything starts (PRD 4.1): what will be researched, what it costs, the balance after.
        <div role="group" aria-label="Before I start" className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3.5 text-[13px] text-indigo-950" data-fv-confirm>
          <p>I'll research what is missing: {served.confirm.topics.join(", ").toLowerCase() || "the evidence for your gaps"}.</p>
          <p className="mt-1 font-semibold" data-fv-cost>{served.confirm.cost ? `${served.confirm.cost} AI Credits` : "No AI Credits"}{typeof served.confirm.balance === "number" && served.confirm.cost ? `: ${served.confirm.balance} → ${served.confirm.after}` : ""}. Charged only if I find something for you to review.</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" disabled={working} aria-busy={working} data-fv-start onClick={async () => {
              if (inFlight.current) return;
              inFlight.current = true;
              setWorking(true);
              try { const next = await served.start(); setServed(next); if (next?.gate) setGate(true); } finally { inFlight.current = false; setWorking(false); }
            }} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70">
              {working && <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {working ? "Researching… about 15 seconds" : "Start the research"}</button>
            <button type="button" disabled={working} onClick={() => setServed(null)} className={button}>Not now</button>
          </div>
        </div>
      )}
      {served?.research && served.render}
      {extra}
      {saved && <p role="status" className="mt-2 text-[12px] text-slate-600">Saved. You'll find this at the top of your dashboard.</p>}
      {!gate && <p className="mt-2 text-[12px] text-slate-500" data-fv-explains>{result.premium_next_action.explains}</p>}
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
  return state ? <FirstValueCard result={state} onDismiss={() => setState(null)} className={className}
    onPremium={id ? premiumFlow({ base: `/task-sessions/${id}/premium` }) : null} /> : null;
}
