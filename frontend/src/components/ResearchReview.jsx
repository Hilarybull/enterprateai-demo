import { useState } from "react";
import { apiRequest } from "../api/client";
import { refusalMessage } from "../lib/entitlement";

// QA PF3 (First-Value PRD 13): what the premium research found, to review item by item. Each finding says whether it
// was Researched (with its sources and their dates) or Estimated (no source), and how confident it is. Nothing is a
// fact until it is accepted; what is accepted becomes the check's next dataset version, and the check is run again.

const CONFIDENCE = (c) => (c >= 0.7 ? "High" : c >= 0.4 ? "Medium" : "Low");
const pill = (on) => `rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition ${on ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600 hover:border-brand-300"}`;

export default function ResearchReview({ businessId, run, onAdopted = null }) {
  const [decisions, setDecisions] = useState(() => Object.fromEntries((run.items || []).map((i) => [i.id, { decision: "accept" }])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(run.status === "adopted" ? run : null);
  const set = (id, patch) => setDecisions((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  if (run.status === "no_evidence" || run.status === "failed") {
    return (
      <p role="status" data-research-status={run.status} className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
        {run.status === "no_evidence"
          ? "I couldn't find evidence I could point to for what is missing, so I haven't proposed anything. Nothing was charged."
          : "The research couldn't be finished just now. Nothing was charged. Please try again in a moment."}
      </p>
    );
  }

  async function adopt() {
    setBusy(true);
    setError("");
    try {
      const out = await apiRequest(`/businesses/${businessId}/research/${run.id}/review`, "POST", { decisions });
      setDone(out.research);
      onAdopted?.(out);
    } catch (e) {
      setError(refusalMessage(e, "That couldn't be saved just now. Nothing was changed."));
    } finally { setBusy(false); }
  }

  if (done) {
    const b = done.before || {};
    const a = done.after || {};
    return (
      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-[13px] text-emerald-950" data-research-adopted>
        <p className="font-semibold">Added to your dataset (version {done.dataset_version}) and checked again.</p>
        <dl className="mt-2 grid gap-1 sm:grid-cols-2" data-before-after>
          <div><dt className="text-emerald-800">Score</dt><dd className="font-semibold" data-score-change>{b.score} → {a.score}{a.score_label ? ` ${a.score_label}` : ""}</dd></div>
          <div><dt className="text-emerald-800">Evidence coverage</dt><dd className="font-semibold" data-coverage-change>{b.evidence_coverage}% → {a.evidence_coverage}%</dd></div>
        </dl>
        <p className="mt-2 text-[12px] text-emerald-900">Researched and estimated evidence is shown as such until you confirm it. Nothing else on your business was changed.</p>
      </div>
    );
  }

  return (
    <section aria-label="Review the research" className="mt-3 rounded-xl border border-indigo-200 bg-white p-3.5" data-research-review>
      <p className="text-[13px] font-semibold text-slate-900">Here is what I found. Check each one: nothing is used until you accept it.</p>
      <ul className="mt-2 space-y-3">
        {(run.items || []).map((i) => {
          const d = decisions[i.id] || {};
          return (
            <li key={i.id} className="rounded-lg border border-slate-100 p-2.5" data-research-item={i.topic}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-slate-500">{i.label}</span>
                <span data-research-state className={`rounded px-1.5 text-[11px] font-semibold ${i.state === "researched" ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>
                  {i.state === "researched" ? "Researched" : "Estimated"}
                </span>
                <span className="text-[11px] text-slate-500" data-research-confidence>Confidence: {CONFIDENCE(i.confidence)}</span>
              </div>
              <p className="mt-1 text-[13px] text-slate-800">{i.value}</p>
              {i.sources?.length > 0 ? (
                <ul className="mt-1 space-y-0.5" data-research-sources>
                  {i.sources.map((s) => (
                    <li key={s.url} className="text-[12px] text-slate-500">
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-brand-700 underline-offset-2 hover:underline">{s.title || s.url}</a>
                      {s.date ? ` · ${s.date}` : " · no date given"}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-[12px] text-amber-800">No source to point to: an estimate, for you to check.</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Your decision: ${i.label}`}>
                {[["accept", "Accept"], ["edit", "Edit"], ["reject", "Reject"]].map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={d.decision === k} onClick={() => set(i.id, { decision: k, value: k === "edit" ? d.value ?? i.value : d.value })} className={pill(d.decision === k)}>{label}</button>
                ))}
              </div>
              {d.decision === "edit" && (
                <input aria-label={`Your version: ${i.label}`} value={d.value ?? ""} onChange={(e) => set(i.id, { value: e.target.value })}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-500" />
              )}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-2 text-[12px] text-rose-700">{error}</p>}
      <button type="button" disabled={busy} onClick={adopt} aria-busy={busy} data-research-adopt
        className="mt-3 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {busy ? "Checking again…" : "Use what I accepted and check again"}
      </button>
    </section>
  );
}


/**
 * The premium step as a result card runs it (QA PF1/PF3): the plan first, then the cost to confirm, then research,
 * then the review. `base` is the premium path (a quick check's, or a homepage task's); `body` what it is sent.
 * Returns what FirstValueCard shows: { gate } or { confirm, start }; start() gives { research, render } or { gate }.
 */
export function premiumFlow({ base, body = {}, businessId = null, onError = () => {} }) {
  return async () => {
    try {
      const quote = await apiRequest(`${base}/quote`, "POST", body);
      if (!quote?.allowed) return { gate: quote?.gate };
      return { confirm: quote, start: async () => {
        try {
          const out = await apiRequest(base, "POST", body, { timeoutMs: 120000 });
          if (!out?.started) return { gate: out?.gate };
          return { research: out.research, render: <ResearchReview businessId={businessId || out.business_id} run={out.research} /> };
        } catch (e) { onError(refusalMessage(e, "The research couldn't be started just now. Nothing was charged.")); return null; }
      } };
    } catch (e) { onError(refusalMessage(e, "That couldn't be started just now. Nothing was charged.")); return null; }
  };
}
