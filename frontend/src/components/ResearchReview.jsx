import { useState } from "react";
import { apiRequest } from "../api/client";
import { refusalMessage } from "../lib/entitlement";

// QA PF3/R7/R9 (First-Value PRD 8.4, 9.4, 10.4, 11.5, 13): an answer for every gap, before anything is asked.
//   Researched:  found, with its sources (title, site, date, link) and what it is used for.
//   Estimate:    a benchmark for a figure only you know for sure, with its source. Please confirm.
//   Calculated:  worked out from known figures, with the working (and where each figure came from).
//   From your …: a figure the workspace already had. Edit it if it has changed.
//   A question:  only what nothing else could answer ("Only you know"), or what the research couldn't find.
// Nothing counts until it is adopted. Then the check runs again, criterion by criterion, with its sources.

const CONFIDENCE = (c) => (c >= 0.7 ? "High" : c >= 0.4 ? "Medium" : "Low");
const STATE_WORD = { met: "Met", partially_met: "Partly met", unmet: "Not met", unknown: "Not known yet" };
const money = (v) => Number(v || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 });
const pill = (on) => `rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition ${on ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600 hover:border-brand-300"}`;

function badge(i) {
  if (i.kind === "researched") return ["Researched", "bg-sky-50 text-sky-800"];
  if (i.kind === "reused") return [i.source_note || "Already on record", "bg-emerald-50 text-emerald-800"];
  if (i.basis === "calculated") return ["Calculated", "bg-indigo-50 text-indigo-800"];
  if (i.basis === "benchmark") return ["Estimate, please confirm", "bg-amber-50 text-amber-800"];
  if (i.kind === "question") return [i.tag || "Only you know", i.tag === "Only you know" ? "bg-violet-50 text-violet-800" : "bg-amber-50 text-amber-800"];
  return ["Estimate", "bg-amber-50 text-amber-800"];
}

function Sources({ list }) {
  if (!list?.length) return null;
  return (
    <ul className="mt-1 space-y-0.5" data-research-sources>
      {list.map((s) => (
        <li key={s.url} className="text-[12px] text-slate-500">
          <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-brand-700 underline-offset-2 hover:underline">{s.title || s.url}</a>
          {s.site ? ` · ${s.site}` : ""}{s.date ? ` · ${s.date}` : " · no date given"}
        </li>
      ))}
    </ul>
  );
}

/** QA R7-3/R9-4: the funding case's drafts: use of funds, a forecast, the routes compared, the gaps and a summary. */
function FundingDrafts({ d }) {
  if (!d) return null;
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12.5px]" data-funding-drafts>
      <p className="text-[13px] font-semibold text-slate-900">Drafts for your funding case</p>
      {d.use_of_funds && (
        <table className="w-full text-left" data-use-of-funds><caption className="text-left font-semibold text-slate-700">Use of funds (estimate)</caption>
          <tbody>{d.use_of_funds.map((r) => <tr key={r.line}><td className="py-0.5 pr-2">{r.line}</td><td className="py-0.5 text-right tabular-nums">{money(r.amount)}</td><td className="py-0.5 pl-2 text-slate-500">{r.how}</td></tr>)}</tbody>
        </table>
      )}
      {d.forecast && (
        <div className="overflow-x-auto" data-forecast>
          <p className="font-semibold text-slate-700">12-month forecast (estimate, from your figures)</p>
          <table className="mt-1 min-w-[28rem] text-right tabular-nums"><thead><tr className="text-slate-500"><th className="pr-2 text-left">Month</th><th className="pr-2">In</th><th className="pr-2">Out</th><th className="pr-2">Profit</th><th>Cash</th></tr></thead>
            <tbody>{d.forecast.map((r) => <tr key={r.month}><td className="pr-2 text-left">{r.month}</td><td className="pr-2">{money(r.revenue)}</td><td className="pr-2">{money(r.costs)}</td><td className="pr-2">{money(r.profit)}</td><td>{money(r.cash)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div data-routes>
        <p className="font-semibold text-slate-700">Funding routes compared</p>
        <ul className="mt-1 space-y-1.5">{(d.routes || []).map((r) => (
          <li key={r.route} data-route={r.route}><span className="font-semibold">{r.name}{r.preferred ? " (your choice)" : ""}:</span> {r.what_it_is}
            {r.local ? <span className="block text-slate-700">{r.local}</span> : <span className="block text-slate-500">Nothing specific found with a source yet.</span>}
            <Sources list={r.sources} />
          </li>))}</ul>
      </div>
      {d.evidence_gaps?.length > 0 && (
        <div data-evidence-gaps><p className="font-semibold text-slate-700">Evidence gaps, and how to close each</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{d.evidence_gaps.map((g) => <li key={g.criterion}><span className="font-medium">{g.gap}.</span> {g.how_to_close}</li>)}</ul></div>
      )}
      {d.executive_summary && <div data-executive-summary><p className="font-semibold text-slate-700">Executive summary (draft)</p><p className="mt-1 text-slate-700">{d.executive_summary}</p></div>}
    </div>
  );
}

function Figures({ list }) {
  if (!list?.length) return null;
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-[12.5px]" data-figures>
      <p className="text-[13px] font-semibold text-slate-900">Your figures, worked out</p>
      <ul className="mt-1.5 space-y-2">{list.map((f) => (
        <li key={f.key} data-figure={f.key}>
          <span className="font-semibold text-slate-800">{f.label}: {f.value}</span>
          {f.met === false && <span className="ml-2 rounded bg-rose-50 px-1.5 text-[11px] font-semibold text-rose-700">Needs attention</span>}
          <ul className="mt-0.5 list-disc pl-5 text-slate-600">{f.working.map((w) => <li key={w}>{w}</li>)}</ul>
        </li>))}</ul>
    </div>
  );
}

export default function ResearchReview({ businessId, run, onAdopted = null }) {
  const items = (run.items || []).map((i) => ({ ...i, kind: i.kind || i.state }));
  const [decisions, setDecisions] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(run.status === "adopted" ? run : null);
  const set = (id, patch) => setDecisions((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const questions = items.filter((i) => i.kind === "question");
  const proposals = items.filter((i) => i.kind !== "question");
  // Every question answered or skipped, explicitly: "Not known yet" is never left by default.
  const open = questions.filter((i) => !(decisions[i.id]?.decision === "skip" || (decisions[i.id]?.decision === "answer" && String(decisions[i.id]?.value || "").trim())));
  const undecided = proposals.filter((i) => !decisions[i.id]?.decision);
  const adoptAll = () => setDecisions((d) => ({ ...d, ...Object.fromEntries(undecided.map((i) => [i.id, { decision: "accept" }])) }));

  async function adopt() {
    if (open.length) return;
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
        <Figures list={done.figures} />
        {done.changes?.length > 0 && (
          <table className="mt-3 w-full text-left text-[12.5px]" data-criteria-changes>
            <thead><tr className="text-emerald-800"><th className="font-medium">Criterion</th><th className="font-medium">Before</th><th className="font-medium">After</th><th className="font-medium">Based on</th></tr></thead>
            <tbody>{done.changes.map((c) => (
              <tr key={c.criterion} data-criterion={c.criterion} className={c.before !== c.after ? "font-semibold" : ""}>
                <td className="py-0.5 pr-2">{c.label}</td><td className="py-0.5 pr-2">{STATE_WORD[c.before] || c.before}</td><td className="py-0.5 pr-2">{STATE_WORD[c.after] || c.after}</td>
                <td className="py-0.5 text-[11.5px] font-normal text-emerald-800" data-basis>{c.basis || ""}</td>
              </tr>))}</tbody>
          </table>
        )}
        <FundingDrafts d={done.deliverables} />
        {done.sources_used?.length > 0 && (
          <div className="mt-3" data-sources-used>
            <p className="font-semibold">Sources</p>
            <ul className="mt-1 space-y-1">{done.sources_used.map((s) => (
              <li key={s.url} className="text-[12px]">
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-brand-700 underline">{s.title || s.url}</a>
                {s.site ? ` · ${s.site}` : ""}{s.date ? ` · ${s.date}` : ""}
                <span className="block text-emerald-900">Used for: {s.used_for.join("; ")}</span>
              </li>))}</ul>
          </div>
        )}
        <p className="mt-2 text-[12px] text-emerald-900">Researched and estimated figures stay marked as such until you confirm them. Nothing else on your business was changed.</p>
      </div>
    );
  }

  return (
    <section aria-label="Review the research" className="mt-3 rounded-xl border border-indigo-200 bg-white p-3.5" data-research-review>
      {run.research === "not_connected" && (
        <p role="note" data-not-connected className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12.5px] text-amber-900">
          Research isn't connected yet, so nothing was looked up and nothing was charged. What can be worked out from your figures, and asked, is below.</p>
      )}
      {run.error && <p role="note" data-research-error className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12.5px] text-rose-800">
        The research failed just now, so some things couldn't be looked up. Nothing was charged.</p>}
      {run.counts && <p className="text-[12px] text-slate-500" data-research-counts>
        {run.counts.researched} researched · {run.counts.estimated} estimated · {run.counts.reused} already on record · {run.counts.calculated} calculated · {run.counts.asked} to answer · {run.counts.sources} sources</p>}
      <p className="mt-1 text-[13px] font-semibold text-slate-900">An answer for every gap. Nothing counts until you adopt it.</p>
      {undecided.length > 0 && <button type="button" onClick={adoptAll} data-adopt-all className="mt-2 rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-[12px] font-semibold text-brand-800 hover:bg-brand-100">Adopt all ({undecided.length})</button>}
      <ul className="mt-2 space-y-3">
        {items.map((i) => {
          const d = decisions[i.id] || {};
          const [word, tone] = badge(i);
          return (
            <li key={i.id} className="rounded-lg border border-slate-100 p-2.5" data-research-item={i.topic || i.derive || i.field} data-kind={i.basis || i.kind}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-slate-500">{i.label}</span>
                <span data-research-state className={`rounded px-1.5 text-[11px] font-semibold ${tone}`}>{word}</span>
                {(i.kind === "researched" || i.basis === "benchmark") && <span className="text-[11px] text-slate-500" data-research-confidence>Confidence: {CONFIDENCE(i.confidence)}</span>}
              </div>
              {i.kind === "question" ? (
                <div className="mt-1.5" data-question>
                  <label className="block text-[13px] text-slate-800" htmlFor={`q-${i.id}`}>{i.question}</label>
                  {i.why && <p className="text-[11px] text-slate-500">{i.why}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <input id={`q-${i.id}`} inputMode={i.type === "number" ? "decimal" : undefined} value={d.decision === "answer" ? d.value || "" : ""}
                      onChange={(e) => set(i.id, { decision: "answer", value: e.target.value })}
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-500" />
                    <button type="button" aria-pressed={d.decision === "skip"} onClick={() => set(i.id, { decision: "skip", value: "" })} className={pill(d.decision === "skip")}>Skip</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-1 text-[13px] text-slate-800" data-research-value>{String(i.value)}{i.basis === "benchmark" && i.number != null ? ` (using ${money(i.number)})` : ""}</p>
                  {i.working?.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-slate-600" data-working>{i.working.map((w) => <li key={w}>{w}</li>)}</ul>}
                  <Sources list={i.sources} />
                  {i.used_for && <p className="mt-1 text-[11px] text-slate-500" data-used-for>Used for: {i.used_for}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Your decision: ${i.label}`}>
                    {[["accept", "Adopt"], ["edit", "Edit"], ["reject", "Reject"]].map(([k, label]) => (
                      <button key={k} type="button" aria-pressed={d.decision === k} onClick={() => set(i.id, { decision: k, value: k === "edit" ? d.value ?? String(i.number ?? i.value) : d.value })} className={pill(d.decision === k)}>{label}</button>
                    ))}
                  </div>
                  {d.decision === "edit" && (
                    <input aria-label={`Your version: ${i.label}`} value={d.value ?? ""} onChange={(e) => set(i.id, { value: e.target.value })}
                      className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-500" />
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <Figures list={run.figures} />
      <FundingDrafts d={run.deliverables} />
      {error && <p role="alert" className="mt-2 text-[12px] text-rose-700">{error}</p>}
      {open.length > 0 && <p className="mt-3 text-[12px] text-violet-800" data-questions-left>{open.length === 1 ? "1 question left" : `${open.length} questions left`}: answer or skip each.</p>}
      {undecided.length > 0 && <p className="mt-1 text-[12px] text-slate-500" data-undecided>{undecided.length} not adopted yet: they won't count unless you adopt them.</p>}
      <button type="button" disabled={busy || open.length > 0} onClick={adopt} aria-busy={busy} data-research-adopt
        className="mt-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {busy ? "Checking again…" : "Use what I adopted and check again"}
      </button>
    </section>
  );
}

/**
 * The premium step as a result card runs it (QA PF1/PF3): the plan first, then the cost to confirm, then research,
 * then the review. `base` is the premium path (a quick check's, or a homepage task's); `body` what it is sent.
 * `onAdopted(out)`: the adopted result, to replace the first-value card with (R9-4).
 */
export function premiumFlow({ base, body = {}, businessId = null, onError = () => {}, onAdopted = null }) {
  return async () => {
    try {
      const quote = await apiRequest(`${base}/quote`, "POST", body);
      if (!quote?.allowed) return { gate: quote?.gate };
      return { confirm: quote, start: async () => {
        try {
          const out = await apiRequest(base, "POST", body, { timeoutMs: 180000 });
          if (!out?.started) return { gate: out?.gate };
          return { research: out.research, render: <ResearchReview businessId={businessId || out.business_id} run={out.research} onAdopted={onAdopted} /> };
        } catch (e) { onError(refusalMessage(e, "The research couldn't be started just now. Nothing was charged.")); return null; }
      } };
    } catch (e) { onError(refusalMessage(e, "That couldn't be started just now. Nothing was charged.")); return null; }
  };
}
