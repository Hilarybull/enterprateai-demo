import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { refusalMessage } from "../lib/entitlement";
import { getCurrencySymbol } from "../lib/currencies";
import { creditCopy } from "../lib/creditCopy";
import ResearchSummary from "./ResearchSummary";

// QA PF3/R7/R9 (First-Value PRD 8.4, 9.4, 10.4, 11.5, 13): an answer for every gap, before anything is asked.
//   Researched:  found, with its sources (title, site, date, link) and what it is used for.
//   Estimate:    a benchmark for a figure only you know for sure, with its source. Please confirm.
//   Calculated:  worked out from known figures, with the working (and where each figure came from).
//   From your …: a figure the workspace already had. Edit it if it has changed.
//   A question:  only what nothing else could answer ("Only you know"), or what the research couldn't find.
// Nothing counts until it is adopted. Then the check runs again, criterion by criterion, with its sources.

import { itemConfidence } from "../lib/itemConfidence";
const STATE_WORD = { met: "Met", partially_met: "Partly met", unmet: "Not met", unknown: "Need from you" };
const money = (v) => { const n = Number(String(v ?? 0).replace(/,/g, "")) || 0; return Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-GB") : n.toLocaleString("en-GB", { maximumFractionDigits: 2 }); };
// Every figure with its unit: money with its currency, a count with what it counts ("37,000 sales a month").
const MONEY_FIELDS = new Set(["price", "cost", "fixed_costs", "amount", "cash_in_bank", "monthly_revenue"]);
const UNIT = { price: "a sale", cost: "a sale", fixed_costs: "a month", amount: "", cash_in_bank: "", monthly_sales: "sales a month", monthly_revenue: "a month",
  team_size: "people", hours_per_job: "hours a job", hours_per_person: "hours a month each", capacity: "jobs a month" };
export function unitsOf(field, currency) {
  if (!(field in UNIT)) return null;
  return { before: MONEY_FIELDS.has(field) ? getCurrencySymbol(currency) : "", after: UNIT[field] };
}
export function withUnit(field, value, currency) {
  const u = unitsOf(field, currency);
  const n = Number(String(value ?? "").replace(/,/g, ""));
  if (!u || String(value ?? "").trim() === "" || !Number.isFinite(n)) return String(value ?? "");
  return `${u.before}${money(n)}${u.after ? ` ${u.after}` : ""}`;
}
/** ₦994,276 (and −₦6,600,000): money with its sign and commas, whole above 100. */
const signed = (v, currency) => { const n = Number(String(v ?? 0).replace(/,/g, "")) || 0; return `${n < 0 ? "\u2212" : ""}${getCurrencySymbol(currency)}${money(Math.abs(n))}`; };
const pill = (on) => `rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition ${on ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600 hover:border-brand-300"}`;

// §5: market and demand evidence stays current for 180 days; price, cost, forecast and capacity for 30.
const FRESH_NOTE = (i) => (["comparable_prices", "positioning"].includes(i.topic) || ["price", "cost", "fixed_costs", "monthly_sales", "capacity"].includes(i.field)
  ? "Price, cost and forecast figures are current for 30 days." : "Market evidence is current for 180 days.");

function badge(i) {
  // The shared words (lib/vocab.js): Found online, My estimate, Worked out.
  if (i.kind === "researched") return ["Found online", "bg-sky-50 text-sky-800"];
  if (i.kind === "reused") return [i.source_note || "Already on record", "bg-emerald-50 text-emerald-800"];
  if (i.basis === "calculated") return ["Worked out", "bg-indigo-50 text-indigo-800"];
  if (i.basis === "benchmark" || i.kind === "estimated") return ["My estimate", "bg-amber-50 text-amber-800"];
  // §5: a gap no checked source supports is Missing, and asked; "Only you know" is the owner's own information.
  if (i.kind === "question") return i.tag === "Only you know" ? ["Only you know", "bg-violet-50 text-violet-800"] : ["Missing", "bg-rose-50 text-rose-800"];
  return ["My estimate", "bg-amber-50 text-amber-800"];
}

// A note said once per section ("A Nigeria figure, used for an Abuja business"), not under every source.
const NOTES_SAID = new WeakMap();
function Sources({ list, notes = null }) {
  if (!list?.length) return null;
  const said = notes || new Set();
  return (
    <ul className="mt-1 min-w-0 space-y-1.5" data-research-sources>
      {list.map((s) => {
        const note = s.region_note && !said.has(s.region_note) ? s.region_note : null;
        if (note) said.add(note);
        return (
          <li key={s.url} className="min-w-0 break-words text-[12px] text-slate-500" data-research-source>
            <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-brand-700 underline-offset-2 hover:underline">{s.title || s.url}</a>
            {(s.publisher || s.site) && <span className="block">{s.publisher || s.site}</span>}
            <span className="block" data-source-date>{s.date ? `Dated ${s.date}` : "No date given"}</span>
            {s.tier && <span data-source-tier className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600">{s.tier_label || `Tier ${s.tier}`}</span>}
            {s.quote && <q data-source-quote className="mt-0.5 block whitespace-normal break-words italic text-slate-600">{s.quote}</q>}
            {(s.accessed || s.region) && <span className="block text-[11px]">{s.region ? `Covers ${s.region}${s.period ? `, ${s.period}` : ""}. ` : ""}{s.accessed ? `Checked ${s.accessed}.` : ""}</span>}
            {note && <span data-region-note className="block text-[11px] text-amber-700">{note}</span>}
          </li>
        );
      })}
    </ul>
  );
}

// What the 12-month forecast is built from (the owner's QA, 20 Oct: "what of the forecasting?").
const FORECAST_NEEDS = { price: "your price", cost: "your cost per sale", monthly_sales: "your sales a month", fixed_costs: "your monthly fixed costs" };

/** The forecast, and any calculation that was waiting for your figures: built here as soon as they are answered, and
 *  said plainly while it still waits (never a silent gap). */
function FromAnswers({ calc, questions, decisions, goal, currency }) {
  const built = Object.values(calc || {}).filter((c) => c.from_answers && c.value != null);
  const forecast = Object.values(calc || {}).find((c) => c.derive === "forecast" && c.value != null);
  const answered = (q) => decisions[q.id]?.decision === "answer" && String(decisions[q.id]?.value || "").trim();
  const waiting = goal === "need_funding" && !forecast
    ? questions.filter((q) => FORECAST_NEEDS[q.field] && !answered(q)).map((q) => FORECAST_NEEDS[q.field]) : [];
  if (!built.length && !waiting.length) return null;
  const sign = getCurrencySymbol(currency);
  const m = (v) => `${Number(v) < 0 ? "−" : ""}${sign}${Math.abs(Number(v) || 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  return (
    <section className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5" data-from-answers>
      <p className="text-[13px] font-semibold text-slate-900">12-month cash forecast</p>
      {forecast ? (
        <>
          <p className="mt-0.5 text-[12.5px] text-slate-700" data-forecast-value>{forecast.value}. Built from your answers; it updates as you change them.</p>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-[28rem] text-right text-[12px] tabular-nums" data-forecast-live>
              <thead><tr className="text-slate-500"><th className="pr-3 text-left font-medium">Month</th><th className="pr-3 font-medium">In</th><th className="pr-3 font-medium">Out</th><th className="pr-3 font-medium">Profit</th><th className="font-medium">Cash</th></tr></thead>
              <tbody>{forecast.table.map((r) => <tr key={r.month}><td className="pr-3 text-left">{r.month}</td><td className="pr-3">{m(r.in ?? r.revenue)}</td><td className="pr-3">{m(r.out ?? r.costs)}</td><td className="pr-3">{m(r.profit)}</td><td>{m(r.cash)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="mt-0.5 text-[12.5px] text-slate-700" data-forecast-waiting>
          I'll build it as soon as you answer {waiting.length > 1 ? `${waiting.slice(0, -1).join(", ")} and ${waiting[waiting.length - 1]}` : waiting[0]} above.</p>
      )}
      {built.filter((c) => c.derive !== "forecast").map((c) => (
        <p key={c.id} className="mt-2 text-[12.5px] text-slate-700" data-built={c.derive}><span className="font-semibold">{c.label}:</span> {c.value}</p>
      ))}
    </section>
  );
}

/** QA R7-3/R9-4: the funding case's drafts: use of funds, a forecast, the routes compared, the gaps and a summary. */
function FundingDrafts({ d, currency }) {
  if (!d) return null;
  const found = (d.routes || []).filter((r) => r.local && r.sources?.length);
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12.5px]" data-funding-drafts>
      <p className="text-[13px] font-semibold text-slate-900">Drafts for your funding case</p>
      <p className="text-[11.5px] text-slate-500" data-amounts-in>Amounts in {String(currency || "GBP").toUpperCase()} ({getCurrencySymbol(currency)}).</p>
      {d.use_of_funds && (
        <table className="w-full text-left" data-use-of-funds><caption className="text-left font-semibold text-slate-700">Use of funds (estimate)</caption>
          <tbody>{d.use_of_funds.map((r) => <tr key={r.line}><td className="py-0.5 pr-2">{r.line}</td><td className="py-0.5 text-right tabular-nums">{signed(r.amount, currency)}</td><td className="py-0.5 pl-2 text-slate-500">{r.how}</td></tr>)}</tbody>
        </table>
      )}
      {d.forecast && (
        <div className="overflow-x-auto" data-forecast>
          <p className="font-semibold text-slate-700">12-month forecast (estimate, from your figures)</p>
          <table className="mt-1 min-w-[28rem] text-right tabular-nums"><thead><tr className="text-slate-500"><th className="pr-2 text-left">Month</th><th className="pr-2">In</th><th className="pr-2">Out</th><th className="pr-2">Profit</th><th>Cash</th></tr></thead>
            <tbody>{d.forecast.map((r) => <tr key={r.month}><td className="pr-2 text-left">{r.month}</td><td className="pr-2">{signed(r.in ?? r.revenue, currency)}</td><td className="pr-2">{signed(r.out ?? r.costs, currency)}</td><td className="pr-2">{signed(r.profit, currency)}</td><td>{signed(r.cash, currency)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {d.mismatch && (
        <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950" data-route-mismatch>
          <p>{d.mismatch.message}</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <a href="#edit-answers" onClick={(e) => { e.preventDefault(); document.querySelector("[data-edit-answers]")?.click(); document.querySelector("[data-edit-form]")?.scrollIntoView?.({ block: "center" }); }}
              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-100" data-change-target>Change target</a>
            <a href="#edit-answers" onClick={(e) => { e.preventDefault(); document.querySelector("[data-edit-answers]")?.click(); }}
              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-100" data-look-at-loans>Look at loans</a>
          </div>
        </div>
      )}
      {/* Only the routes the research found something for, with its source: never a row of empty sections. */}
      {found.length > 0 && <div data-routes>
        <p className="font-semibold text-slate-700">Funding routes compared</p>
        <ul className="mt-1 space-y-1.5">{found.map((r) => (
          <li key={r.route} data-route={r.route}><span className="font-semibold">{r.name}{r.preferred ? " (your choice)" : ""}:</span> {r.what_it_is}
            <span className="block text-slate-700">{r.local}</span>
            <Sources list={r.sources} />
          </li>))}</ul>
      </div>}
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

/**
 * §1: an accepted figure meets the business's own record. Saved where the field was empty (with Undo); asked about where the
 * record says something else: update the Catalogue, or use it for this case only. Nothing is overwritten without asking.
 */
const CLASS_WORDS = { ready: "Ready", conditionally_ready: "Conditionally ready", not_ready: "Not ready", insufficient_evidence: "Insufficient evidence" };

/** R2: where the launch plan or funding case already held a different figure, it was kept. Said, with a way to use the
 * review's figure instead (the owner's choice), or keep the case's. */
function CaseDifferences({ businessId, assessment, currency, onUpdated }) {
  const [left, setLeft] = useState(() => assessment?.differences || []);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const kind = assessment?.kind;
  if (!kind || (!left.length && !note && !assessment?.reactivated)) return null;
  const shown = (d, v) => withUnit(d.field, v, currency);
  async function use(d) {
    setBusy(true);
    try {
      const out = await apiRequest(`/businesses/${businessId}/assessment/${kind}/use-figures`, "POST", { figures: { [d.field]: Number(d.review_value) } });
      setLeft((l) => l.filter((x) => x.field !== d.field));
      setNote(`Your ${kind === "funding" ? "funding case" : "launch plan"} now uses ${shown(d, d.review_value)} for its ${d.label}, and has been checked again.`);
      onUpdated?.(out?.assessment);
    } catch (e) {
      setNote(refusalMessage(e, "That couldn't be updated just now. Nothing was changed."));
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12.5px] text-amber-950" data-case-differences>
      {assessment?.reactivated && <p data-case-reactivated>Your funding case "{assessment.reactivated}" was archived, so it was reactivated and updated.</p>}
      {left.map((d) => (
        <div key={d.field} className="mt-1.5" data-case-difference={d.field}>
          <p>Your {kind === "funding" ? "funding case" : "launch plan"} has {shown(d, d.case_value)} as its {d.label}; this review has {shown(d, d.review_value)}. The case kept its own.</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button type="button" disabled={busy} onClick={() => use(d)} className={pill(false)}>Use {shown(d, d.review_value)} in the case</button>
            <button type="button" disabled={busy} onClick={() => setLeft((l) => l.filter((x) => x.field !== d.field))} className={pill(false)}>Keep {shown(d, d.case_value)}</button>
          </div>
        </div>
      ))}
      {note && <p className="mt-1.5" role="status">{note}</p>}
    </div>
  );
}

export function RecordSync({ businessId, runId, sync }) {
  const [saved, setSaved] = useState(() => (sync?.saved || []).map((x) => ({ ...x, undone: false })));
  const [conflicts, setConflicts] = useState(() => (sync?.conflicts || []).filter((c) => !c.choice));
  const [note, setNote] = useState("");
  if (!saved.length && !conflicts.length && !note) return null;
  const undo = async (x) => {
    try {
      const out = await apiRequest(`/businesses/${businessId}/record-changes/${x.undo_id}/undo`, "POST", {});
      setSaved((all) => all.map((s) => (s.undo_id === x.undo_id ? { ...s, undone: Boolean(out?.undone) } : s)));
      if (!out?.undone) setNote(`Not undone: ${out?.reason || "it has changed since"}.`);
    } catch { setNote("That couldn't be undone just now."); }
  };
  const choose = async (c, choice) => {
    try {
      await apiRequest(`/businesses/${businessId}/research/${runId}/record-choice`, "POST", { field: c.field, choice });
      setConflicts((all) => all.filter((x) => x.field !== c.field));
      setNote(choice === "update" ? `Your ${c.record} now says the new value.` : `Your ${c.record} is unchanged; the new value is used for this case only.`);
    } catch (e) { setNote(e?.status === 403 ? "Updating needs permission to edit this business. It is used for this case only." : "That couldn't be saved just now."); }
  };
  return (
    <div className="mt-3 space-y-2" data-record-sync>
      {saved.map((x) => (
        <p key={x.undo_id} className="text-[12.5px]" data-record-saved>
          {x.undone ? `Undone: ${x.name} is back as it was.` : x.message}{" "}
          {!x.undone && <button type="button" className="font-semibold underline" onClick={() => undo(x)}>Undo</button>}
        </p>
      ))}
      {conflicts.map((c) => (
        <div key={c.field} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12.5px] text-amber-950" data-record-conflict>
          <p>{c.question}</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button type="button" className="rounded-md bg-amber-600 px-2.5 py-1 font-semibold text-white" onClick={() => choose(c, "update")}>Update my {c.record}</button>
            <button type="button" className="rounded-md border border-amber-300 px-2.5 py-1 font-semibold" onClick={() => choose(c, "case_only")}>This case only</button>
          </div>
        </div>
      ))}
      {note && <p role="status" className="text-[12px]">{note}</p>}
    </div>
  );
}

/** The review, with Retry when the research couldn't run: a retry replaces the run shown here. */
/** Can the owner put their own value on this item? A figure on record or an estimate, yes; a researched finding (its
 *  source's words) or a calculated figure (worked out again from the inputs), no. */
export const ownAnswer = (i) => i.kind === "reused" && /^your answer$/i.test(String(i.source_note || "").trim());
// Every result the owner gives or the research finds can be edited (the owner's QA, 17 Oct). A calculated figure cannot: it
// follows the figures it is worked out from, live, as they are edited.
export const editableItem = (i) => !(i.derive || i.basis === "calculated");
// An adopted item's decision, as the review form holds it, to change it again.
const decisionOf = (x) => ({ accepted: { decision: "accept" }, edited: { decision: "edit", value: x.edited_value ?? "" }, rejected: { decision: "reject" },
  answered: { decision: "answer", value: x.answer ?? "" }, skipped: { decision: "skip", value: "" } })[x.decision] || null;

export default function ResearchReview({ retry = null, ...props }) {
  const [run, setRun] = useState(props.run);
  const [retrying, setRetrying] = useState(false);
  const again = retry ? async () => {
    setRetrying(true);
    try { const next = await retry(); if (next) setRun(next); } finally { setRetrying(false); }
  } : null;
  return <ReviewBody key={run.id} {...props} run={run} onRetry={again} retrying={retrying} />;
}

function ReviewBody({ businessId, run: given, onAdopted = null, onRetry = null, retrying = false }) {
  const [run, setRun] = useState(given);      // after adopting, the adopted results, to change again
  const every = (run.items || []).map((i) => ({ ...i, kind: i.kind || i.state }));
  // The owner's own answers are used as given and changed in "Your answers" above, never reviewed again here (QA, 15 Oct).
  const yours = every.filter(ownAnswer);
  const items = every.filter((i) => !ownAnswer(i));
  // Edits in progress survive a refresh (this browser only): the review shows them as updated, never the old figure again.
  const draftKey = `ea_review_draft:${run.id}`;
  const [decisions, setDecisions] = useState(() => {
    let kept = {};
    try { kept = JSON.parse(sessionStorage.getItem(draftKey) || "{}") || {}; } catch { kept = {}; }
    return { ...Object.fromEntries(yours.map((i) => [i.id, { decision: "accept" }])), ...kept };
  });
  useEffect(() => { try { sessionStorage.setItem(draftKey, JSON.stringify(decisions)); } catch { /* fine without it */ } }, [decisions, draftKey]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(run.status === "adopted" ? run : null);
  const [calc, setCalc] = useState({});      // the calculations as they are with the decisions so far, while editing
  const [doneScore, setDoneScore] = useState(null);
  // Adopted results stay editable: back to the review with every decision as it was adopted.
  const reopen = () => {
    const items2 = (done.items || []).map((i) => ({ ...i, kind: i.kind || i.state }));
    setDecisions(Object.fromEntries(items2.map((x) => [x.id, ownAnswer(x) ? { decision: "accept" } : decisionOf(x)]).filter(([, d]) => d)));
    setRun({ ...done, status: "review" });
    setCalc({});
    setDone(null);
    setReviewing(true);
  };
  // The draft first (the funding case, or the figures worked out); what it rests on, to adopt, edit or reject,
  // opens with "Check or review inputs". With no draft to show, the inputs are shown at once.
  const draftOf = (r) => Boolean(r?.deliverables || r?.figures?.length);
  const [reviewing, setReviewing] = useState(() => !draftOf(run));
  const currency = run?.context?.currency;
  const searched = Object.values(run?.diagnostics?.topics || {}).flatMap((t) => (t.queries || []).map((q) => q.q)).filter(Boolean).slice(0, 6);
  const Draft = ({ r }) => (r.deliverables ? <FundingDrafts d={r.deliverables} currency={currency} /> : <Figures list={r.figures} />);
  const toggle = (label) => (
    <button type="button" onClick={() => setReviewing((v) => !v)} aria-expanded={reviewing} data-review-inputs
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:border-brand-300 hover:text-brand-700">
      {reviewing ? "Hide inputs" : label}
    </button>
  );
  const set = (id, patch) => { setError(""); setDecisions((d) => ({ ...d, [id]: { ...d[id], ...patch } })); };
  // An edit to a figure the case holds (price, cost, fixed costs, the amount) goes onto the case as you type, before
  // adopting (the owner's QA, 17 Oct): the setup form shows it. Adopting is still what makes the research count.
  const caseKind = { need_funding: "funding", launch: "launch" }[run?.goal];
  const sentFigures = useRef({});
  // {item id: the figure now on the case}, and {item id: true} while it is being saved: the Update button fades once saved.
  const [savedAt, setSavedAt] = useState({});
  const [saving, setSaving] = useState({});
  const [failed, setFailed] = useState({});
  const pushFigures = async (figures) => {
    if (!caseKind || !Object.keys(figures).length) return;
    const ids = every.filter((i) => i.field in figures).map((i) => i.id);
    setSaving((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, true])) }));
    setFailed((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, false])) }));
    try {
      await apiRequest(`/businesses/${businessId}/assessment/${caseKind}/use-figures`, "POST", { figures });
      Object.assign(sentFigures.current, figures);
      setSavedAt((m) => ({ ...m, ...Object.fromEntries(every.filter((i) => i.field in figures).map((i) => [i.id, figures[i.field]])) }));
      window.dispatchEvent(new CustomEvent("ea:case:updated"));
    } catch {
      setFailed((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, true])) }));      // said beside the button; adopting still puts it on the case
    } finally {
      setSaving((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, false])) }));
    }
  };
  const figureOf = (i, d) => {
    if (!i.field || !["price", "cost", "fixed_costs", "amount"].includes(i.field) || !d) return null;
    const raw = d.decision === "edit" || d.decision === "answer" ? d.value : null;
    const n = raw == null ? NaN : Number(String(raw).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  // Enter (or the tick): on the case at once.
  const saveNow = (i) => { const n = figureOf(i, decisions[i.id]); if (n != null) pushFigures({ [i.field]: n }); };
  // Edit is a decision once saved (Save or Enter); opening it is not. Cancel puts back what was chosen before.
  const saveEdit = (i) => { set(i.id, { saved: true }); saveNow(i); };
  // Cancel puts back what was there: the figure saved before this edit, else the decision before it (or none).
  const cancelEdit = (i) => setDecisions((m) => {
    const d = m[i.id] || {};
    const next = { ...m };
    if (d.restore != null) next[i.id] = { ...d, value: d.restore, saved: true, restore: undefined };
    else if (d.before) next[i.id] = { decision: d.before };
    else delete next[i.id];
    return next;
  });
  // What is sent: an edit not saved yet counts as what was chosen before it (or nothing).
  const sendable = (m) => Object.fromEntries(Object.entries(m).flatMap(([id, d]) => (d?.decision === "edit" && !d.saved ? (d.before ? [[id, { decision: d.before }]] : []) : [[id, d]])));
  useEffect(() => {
    // Also while questions wait for a calculation (the forecast): answering them builds it here, live.
    if (done || !reviewing || !run?.id || !every.some((i) => i.derive || i.basis === "calculated" || i.for_derive)) return undefined;
    const t = setTimeout(async () => {
      try {
        const out = await apiRequest(`/businesses/${businessId}/research/${run.id}/preview`, "POST", { decisions });
        setCalc(Object.fromEntries((out?.calculated || []).map((c) => [c.id, c])));
      } catch { /* the figures shown stay as they were; adopting works them out again either way */ }
    }, 350);
    return () => clearTimeout(t);
  }, [decisions, reviewing, done, run?.id]);      // eslint-disable-line react-hooks/exhaustive-deps
  const questions = items.filter((i) => i.kind === "question");
  const proposals = items.filter((i) => i.kind !== "question");
  // Every question answered or skipped, explicitly: "Not known yet" is never left by default.
  const open = questions.filter((i) => !(decisions[i.id]?.decision === "skip" || (decisions[i.id]?.decision === "answer" && String(decisions[i.id]?.value || "").trim())));
  const undecided = proposals.filter((i) => !decisions[i.id]?.decision || (decisions[i.id].decision === "edit" && !decisions[i.id].saved));
  const adoptAll = () => setDecisions((d) => ({ ...d, ...Object.fromEntries(undecided.filter((i) => d[i.id]?.decision !== "edit").map((i) => [i.id, { decision: "accept" }])) }));

  async function adopt(chosen = decisions) {
    // What was adopted is applied; a question left open stays open on its own, never blocking the rest (the owner's QA, 21 Oct).
    setBusy(true);
    setError("");
    try {
      const out = await apiRequest(`/businesses/${businessId}/research/${run.id}/review`, "POST", { decisions: sendable(chosen) });
      try { sessionStorage.removeItem(draftKey); } catch { /* fine */ }
      setDone(out.research);
      setDoneScore(out?.result?.score ?? null);
      setReviewing(!draftOf(out.research));      // adopted: back to the draft, now checked again
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
        <p className="font-semibold" data-applied-line>{typeof doneScore === "number" ? `Saved. Your score is now ${Math.round(doneScore)}/100.` : "Saved. Score paused: a few figures are still missing."}</p>
        {done.assessment ? (
          // §2 (R3): a launch or funding review feeds the one assessment; its summary is what is shown, never a second score.
          <dl className="mt-2 grid gap-1 sm:grid-cols-3" data-assessment-summary>
            <div><dt className="text-emerald-800">Readiness</dt><dd className="font-semibold">{CLASS_WORDS[done.assessment.classification] || "Not checked yet"}</dd></div>
            <div><dt className="text-emerald-800">Score</dt><dd className="font-semibold">{done.assessment.score ?? "No score yet"}</dd></div>
            <div><dt className="text-emerald-800">Evidence coverage</dt><dd className="font-semibold">{done.assessment.evidence_coverage ?? 0}%</dd></div>
          </dl>
        ) : (
        <dl className="mt-2 grid gap-1 sm:grid-cols-2" data-before-after>
          <div><dt className="text-emerald-800">Score</dt><dd className="font-semibold" data-score-change>{b.score} → {a.score}{a.score_label ? ` ${a.score_label}` : ""}</dd></div>
          <div><dt className="text-emerald-800">Evidence coverage</dt><dd className="font-semibold" data-coverage-change>{b.evidence_coverage}% → {a.evidence_coverage}%</dd></div>
        </dl>
        )}
        {draftOf(done) && <Draft r={done} />}
        {draftOf(done) && <div className="mt-3">{toggle("Check or review inputs")}</div>}
        {(reviewing || !draftOf(done)) && <>
        {done.deliverables && <Figures list={done.figures} />}
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
        </>}
        <CaseDifferences businessId={businessId} assessment={done.assessment} currency={currency} onUpdated={(a) => a && setDone((d) => ({ ...d, assessment: { ...a, differences: [] } }))} />
        <RecordSync businessId={businessId} runId={done.id} sync={done.record_sync} />
        <p className="mt-2 text-[12px] text-emerald-900">Researched and estimated figures stay marked as such until you confirm them. Nothing else on your business was changed.</p>
        {done.items?.length > 0 && (
          <button type="button" onClick={reopen} data-research-reopen
            className="mt-2 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-emerald-900 hover:bg-emerald-100">Edit these results</button>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Review the research" className="mt-3 rounded-xl border border-indigo-200 bg-white p-3.5" data-research-review>
      {/* Honest outcomes: research couldn't run (a provider down, not set up, a failure), or ran and found nothing, or found
          something and what it used. Never "nothing found" when it couldn't look. */}
      {(run.research === "not_connected" || run.error) ? (
        <div role="note" data-research-error className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12.5px] text-amber-900">
          <span>{run.error === "timeout" ? "The research took too long this time. Nothing was charged." : creditCopy.unavailable()}</span>
          {onRetry && <button type="button" disabled={retrying} aria-busy={retrying} onClick={onRetry} data-research-retry
            className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60">{retrying ? "Trying again…" : "Retry"}</button>}
        </div>
      ) : run.counts && !run.counts.sources ? (
        <div role="note" className="mb-2 text-[13px] text-slate-700" data-research-empty>
          <p>{creditCopy.nothingFound()}</p>
          {searched.length > 0 && <p className="mt-0.5 text-[12px] text-slate-500" data-searched>I searched for: {searched.join("; ")}.</p>}
        </div>
      ) : run.charged > 0 ? (
        <p role="status" className="mb-2 text-[13px] text-slate-700" data-research-used>
          {creditCopy.doneVariable({ used: run.charged, findings: new Set(items.filter((i) => i.sources?.length && ["researched", "estimated"].includes(i.kind) && i.basis !== "calculated").map((i) => i.topic)).size, balance: run.balance })}</p>
      ) : null}
      {run.counts && <p className="text-[12px] text-slate-500" data-research-counts>
        {run.counts.researched} found online · {run.counts.estimated} my estimates · {run.counts.reused} already on record · {run.counts.calculated} worked out · {run.counts.asked} to answer · {run.counts.sources} sources</p>}
      {!reviewing && <>
        <Draft r={run} />
        <p className="mt-3 text-[12.5px] text-slate-600" data-review-prompt>
          {[proposals.length ? `${proposals.length} input${proposals.length === 1 ? "" : "s"} to adopt or edit` : "", questions.length ? `${questions.length} question${questions.length === 1 ? "" : "s"} for you` : ""].filter(Boolean).join(" and ")}. The gaps above update once you adopt them: until then nothing counts.
        </p>
        {error && <p role="alert" className="mt-2 text-[12px] text-rose-700">{error}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* One press when there is nothing to answer; with questions, the inputs open to answer them first. */}
          <button type="button" disabled={busy} aria-busy={busy} data-adopt-and-check
            onClick={() => (questions.length ? setReviewing(true) : adopt({ ...decisions, ...Object.fromEntries(undecided.map((i) => [i.id, { decision: "accept" }])) }))}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
            {busy ? "Checking again…" : questions.length ? `Answer ${questions.length === 1 ? "1 question" : `${questions.length} questions`} and check again` : "Adopt all and check again"}
          </button>
          {toggle("Check or review inputs")}
        </div>
      </>}
      {reviewing && <>
      {draftOf(run) && <div className="mt-3">{toggle("Check or review inputs")}</div>}
      <p className="mt-1 text-[13px] font-semibold text-slate-900">An answer for every gap. Nothing counts until you adopt it.</p>
      {yours.length > 0 && <p className="mt-0.5 text-[12px] text-slate-500" data-your-answers-note>Your own answers ({yours.map((i) => i.label).join(", ")}) are used as you gave them. To change one, edit it in Your answers above.</p>}
      {undecided.length > 0 && <button type="button" onClick={adoptAll} data-adopt-all className="mt-2 rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-[12px] font-semibold text-brand-800 hover:bg-brand-100">Adopt all ({undecided.length})</button>}
      <ul className="mt-2 space-y-3">
        {(() => { NOTES_SAID.set(items, new Set()); return null; })()}
        {items.map((i) => {
          const d = decisions[i.id] || {};
          const live = calc[i.id];
          if (live) i = { ...i, value: live.value ?? null, working: live.working || i.working };
          const [word, tone] = d.decision === "edit" && d.saved ? ["Your figure", "bg-emerald-50 text-emerald-800"] : badge(i);
          return (
            <li key={i.id} className="rounded-lg border border-slate-100 p-2.5" data-research-item={i.topic || i.derive || i.field} data-kind={i.basis || i.kind}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-slate-500">{i.label}</span>
                <span data-research-state className={`rounded px-1.5 text-[11px] font-semibold ${tone}`}>{word}</span>
                {(i.kind === "researched" || i.kind === "estimated" || i.basis === "benchmark") && itemConfidence(i) && (
                  <span className="text-[11px] text-slate-500" data-research-confidence title={itemConfidence(i).reason}>Confidence: {itemConfidence(i).label}</span>)}
              </div>
              {i.kind === "question" ? (
                <div className="mt-1.5" data-question>
                  <label className="block text-[13px] text-slate-800" htmlFor={`q-${i.id}`}>{i.question}</label>
                  {i.why && <p className="text-[11px] text-slate-500">{i.why}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {unitsOf(i.field, currency)?.before && <span className="text-[13px] font-semibold text-slate-600" data-unit-before>{unitsOf(i.field, currency).before}</span>}
                    <input id={`q-${i.id}`} inputMode={i.type === "number" || unitsOf(i.field, currency) ? "decimal" : undefined} value={d.decision === "answer" ? d.value || "" : ""}
                      onChange={(e) => set(i.id, { decision: "answer", value: e.target.value })}
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-500" />
                    {unitsOf(i.field, currency)?.after && <span className="shrink-0 text-[12.5px] text-slate-600" data-unit-after>{unitsOf(i.field, currency).after}</span>}
                    <button type="button" aria-pressed={d.decision === "skip"} onClick={() => set(i.id, { decision: "skip", value: "" })} className={pill(d.decision === "skip")}>Skip</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-1 text-[13px] text-slate-800" data-research-value>{d.decision === "edit" && d.saved && String(d.value ?? "").trim()
                    ? <><span className="font-semibold">{withUnit(i.field, d.value, currency)}</span>
                      <span className="ml-1.5 text-[11.5px] text-slate-500" data-was>Was {withUnit(i.field, i.value, currency)}</span>
                      {savedAt[i.id] != null && savedAt[i.id] === figureOf(i, d) && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 text-[11px] font-semibold text-emerald-700" data-updated>Updated on your case</span>}</>
                    : i.value == null && (i.derive || i.basis === "calculated") ? "Needs the figures below it" : withUnit(i.field, i.value, currency)}{i.basis === "benchmark" && i.number != null && String(i.number) !== String(i.value) ? ` (using ${withUnit(i.field, i.number, currency)})` : ""}</p>
                  {i.working?.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-slate-600" data-working>{i.working.map((w) => <li key={w}>{w}</li>)}</ul>}
                  <Sources list={i.sources} notes={NOTES_SAID.get(items)} />
                  {i.standard && <p className="mt-1 text-[11px] text-slate-500" data-research-standard>{i.kind === "researched" ? "Researched: " : "Not researched: "}{i.standard}.</p>}
                  {Array.isArray(i.range) && <p className="mt-0.5 text-[11px] text-amber-700" data-research-range>Sources disagree: {money(i.range[0])} to {money(i.range[1])}. Both are shown; neither is averaged.</p>}
                  {i.kind !== "researched" && i.method && <p className="mt-0.5 text-[11px] text-slate-500" data-research-method>Method: {i.method}</p>}
                  {i.retrieved_at && <p className="mt-0.5 text-[11px] text-slate-500" data-research-freshness>Found {String(i.retrieved_at).slice(0, 10)}. {FRESH_NOTE(i)}</p>}
                  {i.used_for && <p className="mt-1 text-[11px] text-slate-500" data-used-for>Used for: {i.used_for}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Your decision: ${i.label}`}>
                    {/* A calculated figure is worked out again from the inputs above when you check again: it has no Edit of its
                        own (an edit there was thrown away). Change the inputs it uses instead (the owner's QA, 15 Oct). */}
                    {/* A researched finding is what its checked source says: accepted or rejected, never rewritten (an edit would
                        put words in the source's mouth). Edit is for figures that are yours to set: on record, or estimated. */}
                    {(!editableItem(i) ? [["accept", "Accept"], ["reject", "Reject"]] : [["accept", "Accept"], ["edit", "Edit"], ["reject", "Reject"]]).map(([k, label]) => (
                      // A saved edit is what is accepted (the owner's QA, 20 Oct: Accept after Save put the old figure back):
                      // Accept keeps it, shown pressed; only Reject, or Edit again, changes it.
                      <button key={k} type="button" aria-pressed={d.decision === k || (k === "accept" && d.decision === "edit" && d.saved)} onClick={() => (k === "edit"
                        ? set(i.id, { decision: "edit", value: d.value ?? String(i.number ?? i.value ?? ""), saved: false, before: d.decision === "edit" ? d.before : d.decision,
                            restore: d.decision === "edit" && d.saved ? d.value : d.restore })
                        : k === "accept" && d.decision === "edit" && d.saved ? null
                        : k === "accept" && d.decision === "edit" && String(d.value ?? "").trim() ? saveEdit(i)
                        : set(i.id, { decision: k, value: d.value, saved: undefined, before: undefined, pressed: k === "accept" || undefined }))}
                        className={pill(d.decision === k || (k === "accept" && d.decision === "edit" && d.saved))}>{label}</button>
                    ))}
                  </div>
                  {(i.derive || i.basis === "calculated") && <p className="mt-1 text-[11.5px] text-slate-500" data-calculated-note>Worked out from the figures above, and updated as you change them.</p>}
                  {i.kind === "researched" && !(i.derive || i.basis === "calculated") && <p className="mt-1 text-[11.5px] text-slate-500" data-researched-note>From a checked source. Accept it, edit it to use your own figure, or reject it.</p>}
                  {/* Closed once saved (the owner's QA, 20 Oct): the new figure shows above; Edit opens it again. Open while a save failed. */}
                  {d.decision === "edit" && editableItem(i) && (!d.saved || failed[i.id]) && (() => {
                    const u = unitsOf(i.field, currency);
                    const current = d.saved && (figureOf(i, d) == null || (savedAt[i.id] != null && savedAt[i.id] === figureOf(i, d)));
                    return (
                      <div className="mt-2" data-edit-units>
                        <div className="flex items-start gap-2">
                          {u?.before && <span className="pt-1.5 text-[13px] font-semibold text-slate-600" data-unit-before>{u.before}</span>}
                          <textarea aria-label={`Your version: ${i.label}`} value={d.value ?? ""} rows={1}
                            onChange={(e) => { set(i.id, { value: e.target.value, saved: false }); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }}
                            onFocus={(e) => { e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(i); } }} enterKeyHint="done"
                            inputMode={u ? "decimal" : undefined}
                            className="min-w-0 flex-1 resize-none overflow-hidden rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] leading-5 outline-none focus:border-brand-500" />
                          {u?.after && <span className="shrink-0 pt-1.5 text-[12.5px] text-slate-600" data-unit-after>{u.after}</span>}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2">
                          {failed[i.id] && <span role="alert" className="text-[11.5px] text-rose-700">Not saved. Try again.</span>}
                          <button type="button" onClick={() => cancelEdit(i)} className="rounded-lg px-2.5 py-1 text-[12.5px] font-semibold text-slate-600 hover:text-slate-900" data-edit-cancel>Cancel</button>
                          <button type="button" onClick={() => saveEdit(i)} disabled={current || saving[i.id] || !String(d.value ?? "").trim()} aria-busy={saving[i.id] || undefined} data-update-now
                            data-state={saving[i.id] ? "saving" : current ? "updated" : "ready"}
                            className="rounded-lg bg-brand-600 px-3 py-1 text-[12.5px] font-semibold text-white hover:bg-brand-700 disabled:cursor-default disabled:bg-slate-200 disabled:text-slate-500">
                            {saving[i.id] ? "Saving…" : current ? "Saved" : "Save"}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <FromAnswers calc={calc} questions={questions} decisions={decisions} goal={run.goal} currency={currency} />
      {run.deliverables && <Figures list={run.figures} />}
      {error && <p role="alert" className="mt-2 text-[12px] text-rose-700">{error}</p>}
      {open.length > 0 && <p className="mt-3 text-[12px] text-violet-800" data-questions-left>{open.length === 1 ? "1 question left" : `${open.length} questions left`}: answer or skip each.</p>}
      {undecided.length > 0 && <p className="mt-1 text-[12px] text-slate-500" data-undecided>{undecided.length} not adopted yet: they won't count unless you adopt them.</p>}
      {busy && <p role="status" className="mt-2 text-[12.5px] text-slate-600" data-applying>Saving and checking your score…</p>}
      <button type="button" disabled={busy} onClick={() => adopt()} aria-busy={busy} data-research-adopt
        className="mt-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {busy ? "Checking again…" : "Use what I adopted and check again"}
      </button>
      </>}
    </section>
  );
}

/**
 * The premium step as a result card runs it (QA PF1/PF3): the plan first, then the cost to confirm, then research,
 * then the review. `base` is the premium path (a quick check's, or a homepage task's); `body` what it is sent.
 * `onAdopted(out)`: the adopted result, to replace the first-value card with (R9-4).
 */
/** After Start, in place: the one result view first (the owner's brief, 20 Oct), every input one press away. A run that
 *  failed or found nothing shows the full review at once, where its reason is said. */
export function InlineResearch({ businessId, run, onAdopted = null, retry = null }) {
  const [all, setAll] = useState(false);
  const empty = Boolean(run?.error) || !(run?.items || []).some((i) => i.derive || i.kind === "question" || (i.sources || []).length);
  if (all || empty) return <ResearchReview businessId={businessId} run={run} onAdopted={onAdopted} retry={retry} />;
  return <ResearchSummary businessId={businessId} run={run} onAdopted={onAdopted} onSeeAll={() => setAll(true)} />;
}

export function premiumFlow({ base, body = {}, businessId = null, onError = () => {}, onAdopted = null }) {
  return async () => {
    try {
      const quote = await apiRequest(`${base}/quote`, "POST", body);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ea:credits:refresh"));      // one balance on the page
      if (!quote?.allowed) return { gate: quote?.gate };
      if (quote.reuse) {
        // The same research within 30 days: opened again, free (no price, no hold, no charge).
        const out = await apiRequest(base, "POST", body, { timeoutMs: 60000 });
        if (out?.started) return { research: out.research, render: <InlineResearch businessId={businessId || out.business_id} run={out.research} onAdopted={onAdopted} /> };
      }
      const progressKey = `p${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      const run = async () => {
        // Up to 6 minutes (the owner's QA, 22 Oct: a run took 183 s on a slow database and the page gave up at 180)
        const out = await apiRequest(base, "POST", { ...body, progress_key: progressKey }, { timeoutMs: 360000 });
        return out;
      };
      return { confirm: { ...quote, progressKey }, start: async () => {
        try {
          const out = await run();
          if (!out?.started) return { gate: out?.gate };
          const retry = async () => { try { const again = await run(); return again?.started ? again.research : null; } catch { return null; } };
          return { research: out.research, render: <InlineResearch businessId={businessId || out.business_id} run={out.research} onAdopted={onAdopted} retry={retry} /> };
        } catch (e) { onError(refusalMessage(e, creditCopy.unavailable())); return null; }
      } };
    } catch (e) { onError(refusalMessage(e, "That couldn't be started just now. Nothing was charged.")); return null; }
  };
}
