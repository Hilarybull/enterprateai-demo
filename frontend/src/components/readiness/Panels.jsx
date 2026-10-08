import { useEffect, useState } from "react";
import {
  ACTION_STATE, CHECK_STATE, CLASSIFICATION, FEATURES, contradiction, dateLabel, downloadMaterial, generateMaterial, getAssessment, getHistory, getMaterial,
  listMaterials, moneyLabel, monthLabel, newKey, readinessError, recordDecision, recordLaunch, reviewDocument, runScenario, updateAction, updateMaterial,
  staleReason,
} from "../../lib/readiness";
import { todayLocal } from "../../lib/format";
import { Btn, Notice, Panel, Pill, inputClass } from "./Fields";

// ── Results ───────────────────────────────────────────────────────────────────

function Meter({ label, value, text }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        <span className="tabular-nums text-slate-600 dark:text-slate-300">{text}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function CashFacts({ result, feature, currency }) {
  const m = result.metrics || {};
  const f = m.forecast || {};
  if (f.state !== "complete") return <p className="text-[13px] text-slate-500">Cash figures appear once the forecast is complete.</p>;
  const rows = [
    ["Lowest cash without new funding (forecast)", `${moneyLabel(m.baseline_min_cash?.amount, currency)} in ${monthLabel(m.baseline_min_cash?.month)}`],
    ["First month below zero (forecast)", m.first_negative_month ? monthLabel(m.first_negative_month) : "None in the forecast"],
  ];
  if (feature === "funding") {
    rows.push(["Lowest cash with the proposed funding (forecast)", m.funded_min_cash ? `${moneyLabel(m.funded_min_cash.amount, currency)} in ${monthLabel(m.funded_min_cash.month)}` : "Not available: set the amount and date"]);
    if (m.funding_timing_gap?.exists) rows.push(["Funding timing gap", m.funding_timing_gap.text]);
    (m.milestone_coverage || []).forEach((c) => rows.push([`Milestone: ${c.outcome || "Untitled"}`, c.covered === null ? `Not known. ${c.reason}` : c.covered ? "Funded cash covers it" : c.reason]));
  } else {
    rows.push(["Cash at launch (forecast)", m.cash_at_launch ? `${moneyLabel(m.cash_at_launch, currency)} in ${monthLabel(m.launch_month)}` : "Not available"]);
    if (m.capacity?.state === "known") rows.push(["Capacity", `Needs ${m.capacity.need} ${m.capacity.unit}; ${m.capacity.free} free of ${m.capacity.available}${m.capacity.overload ? ` (${m.capacity.overload} short)` : ""}`]);
  }
  const e = m.economics || {};
  if (e.state === "available") {
    rows.push([feature === "funding" ? "Contribution per sale" : "Contribution per unit", moneyLabel(e.contribution_per_sale ?? e.contribution_per_unit, currency)]);
    rows.push(["Monthly break-even " + (feature === "funding" ? "sales" : "units"), e.break_even_sales_per_month ?? e.break_even_units_per_month ?? "Not reachable at this price and cost"]);
  }
  return (
    <>
      <dl className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 py-2 text-[13px] sm:grid-cols-[18rem_1fr]">
            <dt className="font-semibold text-slate-700 dark:text-slate-200">{k}</dt><dd className="break-words text-slate-600 dark:text-slate-300">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[12px] text-slate-500">{f.label} Forecast figures are assumptions, not results.</p>
    </>
  );
}

export function ResultView({ assessment, feature, currency, onOpenSection, historic = false }) {
  const [open, setOpen] = useState({});
  const result = assessment?.result;
  if (!result) return null;
  const cls = CLASSIFICATION[result.classification];
  const meta = FEATURES[feature];
  const fresh = assessment.freshness || {};
  return (
    <div className="space-y-4">
      {fresh.status === "stale" && !historic && (
        <Notice tone="amber"><span className="font-semibold">This result is out of date.</span> {staleReason(fresh.reason)} It is being updated for you; until then it is kept as it was on {dateLabel(assessment.as_of)}.</Notice>
      )}
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Pill tone={cls.tone} mark={cls.mark} className="!text-sm">{cls.label}</Pill>
            <p className="mt-2 text-base font-bold text-slate-900 dark:text-slate-100">{result.headline}</p>
            <p className="mt-1 text-[13px] text-slate-500">{result.disclaimer}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{result.score_display ?? "—"}<span className="text-base font-semibold text-slate-400">{result.score_display !== null && result.score_display !== undefined ? " / 100" : ""}</span></p>
            <p className="text-[12px] text-slate-500">{result.score_display === null || result.score_display === undefined ? "No overall score until every item is known" : "Preparation score"}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Meter label="Evidence coverage" value={result.coverage} text={`${result.coverage}% of the checklist`} />
          <Meter label={`${meta.gatesTitle} known`} value={result.gate_completeness} text={`${result.gate_completeness}%`} />
          <div className="text-[13px]">
            <p className="font-semibold text-slate-700 dark:text-slate-200">Confidence: {result.confidence.level}</p>
            <p className="text-slate-500">{result.confidence.reasons.join(" ")} {result.confidence.note}</p>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-slate-500">
          Checked on {dateLabel(assessment.as_of)} · {result.profile_title}, version {result.ruleset_version}
          {result.data_basis?.label ? ` · figures: ${result.data_basis.label}` : ""}. {result.status_note}
        </p>
      </Panel>

      <Panel title={meta.gatesTitle} description="Checked separately from the score. A confirmed failure means not ready, whatever the score.">
        <ul className="space-y-2">
          {result.gates.map((g) => {
            const st = CHECK_STATE[g.state];
            return (
              <li key={g.code} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{g.label}</p>
                  <Pill tone={st.tone} mark={st.mark}>{g.state === "failed" ? "Blocking" : g.state === "passed" ? "Clear" : st.label}</Pill>
                </div>
                {g.reason && <p className="mt-1 break-words text-[13px] text-slate-600 dark:text-slate-300">{g.reason}</p>}
                {g.state === "failed" && <p className="mt-1 text-[13px] text-slate-700 dark:text-slate-200"><span className="font-semibold">To clear it:</span> {g.remedy}</p>}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Checklist" description="Each item has two checks. Both in place scores 100, one scores 50, neither scores 0. An item with a check that isn't known yet has no score.">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {result.criteria.map((c) => (
            <li key={c.code} className="py-2">
              <button type="button" aria-expanded={Boolean(open[c.code])} onClick={() => setOpen((o) => ({ ...o, [c.code]: !o[c.code] }))}
                className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{c.title} <span className="font-normal text-slate-400">· weight {c.weight}</span></span>
                <span className="flex items-center gap-2">
                  <span className="text-[13px] tabular-nums text-slate-600 dark:text-slate-300">{c.score === null ? "Not known yet" : `${c.score} / 100`}</span>
                  <span aria-hidden="true" className="text-slate-400">{open[c.code] ? "▾" : "▸"}</span>
                </span>
              </button>
              {(open[c.code] || c.checks.some((ch) => ch.state !== "passed")) && (
                <ul className="mt-2 space-y-2">
                  {c.checks.filter((ch) => open[c.code] || ch.state !== "passed").map((ch) => {
                    const st = CHECK_STATE[ch.state];
                    return (
                      <li key={ch.code} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 text-[13px] text-slate-700 dark:text-slate-200">{ch.label}</p>
                          <Pill tone={st.tone} mark={st.mark}>{st.label}</Pill>
                        </div>
                        {ch.reason && !(ch.attestation && ch.state === "passed") && <p className="mt-1 break-words text-[12px] text-slate-500">{ch.reason}</p>}
                        {ch.attestation && <p className="mt-1 text-[12px] text-slate-500">{ch.attestation.independent ? "Independent review" : "Self-attested"} by {ch.attestation.by}, {dateLabel(ch.attestation.at)}.</p>}
                        {ch.state !== "passed" && onOpenSection && <Btn kind="link" className="mt-1 text-[12px]" onClick={() => onOpenSection(c.section)}>Go to {c.tool?.label || "this section"}</Btn>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Cash and economics"><CashFacts result={result} feature={feature} currency={currency} /></Panel>

      <Panel title="Business risks" description="Separate from preparation: a well-prepared case can still carry commercial risk.">
        {result.risks.length === 0 ? <p className="text-[13px] text-slate-500">No commercial risk was found from the figures provided.</p> : (
          <ul className="space-y-1.5">
            {result.risks.map((r) => (
              <li key={r.code} className="flex gap-2 text-[13px] text-slate-700 dark:text-slate-200">
                <Pill tone={r.severity === "high" ? "rose" : r.severity === "medium" ? "amber" : "slate"}>{r.severity === "info" ? "Note" : r.severity === "high" ? "High" : "Medium"}</Pill>
                <span className="min-w-0 break-words">{r.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ── Actions ───────────────────────────────────────────────────────────────────

function ActionRow({ businessId, feature, subject, action, rank, onChanged, onOpenSection }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null);      // "complete" | "dismiss"
  const [text, setText] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const editable = subject.can?.[`${feature}.edit`] && subject.status !== "archived";
  const live = ["open", "in_progress", "awaiting_evidence"].includes(action.status);

  async function send(changes) {
    setBusy(true);
    setProblem(null);
    try { await updateAction(businessId, feature, subject.id, action.id, changes); setMode(null); setText(""); onChanged(); }
    catch (e) { setProblem(readinessError(e)); } finally { setBusy(false); }
  }

  return (
    <li className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 text-left">
        {live && <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[12px] font-bold text-white dark:bg-slate-100 dark:text-slate-900" aria-label={`Priority ${rank}`}>{rank}</span>}
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{action.title}</span>
          <span className="mt-0.5 block text-[12px] text-slate-500">
            {ACTION_STATE[action.status]}{action.due_date ? ` · due ${dateLabel(action.due_date)}` : " · no date set"}{action.owner ? ` · ${action.owner}` : ""}
            {action.reopened_at ? " · still unresolved at the last check" : ""}
          </span>
        </span>
        <span aria-hidden="true" className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-[13px] dark:border-slate-800">
          <p><span className="font-semibold text-slate-800 dark:text-slate-100">Why it matters:</span> <span className="text-slate-600 dark:text-slate-300">{action.why}</span></p>
          <p><span className="font-semibold text-slate-800 dark:text-slate-100">Why it is ranked here:</span> <span className="text-slate-600 dark:text-slate-300">{action.priority_reason}</span></p>
          <p><span className="font-semibold text-slate-800 dark:text-slate-100">What is needed:</span> <span className="text-slate-600 dark:text-slate-300">{action.evidence_required}</span></p>
          {action.also?.length > 0 && <p className="text-slate-500">One fix covers {action.code} and {action.also.join(", ")} on the checklist, so they are a single action.</p>}
          {action.completion && <p className="text-slate-500">Completed {dateLabel(action.completion.at)}{action.completion.by ? ` by ${action.completion.by}` : ""}: {action.completion.note || action.completion.rationale || "evidence attached"}.</p>}
          {action.dismissal && <p className="text-slate-500">Dismissed {dateLabel(action.dismissal.at)} by {action.dismissal.by}: {action.dismissal.reason}. The checklist item is unchanged.</p>}
          {action.section && onOpenSection && <Btn kind="link" onClick={() => onOpenSection(action.section)}>Open {action.tool?.label || "the section"} to fix this</Btn>}
          {editable && live && (
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Owner
                <input className={`mt-1 ${inputClass}`} defaultValue={action.owner || ""} onBlur={(e) => e.target.value !== (action.owner || "") && send({ owner: e.target.value })} />
              </label>
              <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Due date
                <input type="date" className={`mt-1 ${inputClass}`} defaultValue={action.due_date || ""} onChange={(e) => send({ due_date: e.target.value })} />
              </label>
              <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">State
                <select className={`mt-1 ${inputClass}`} value={action.status} onChange={(e) => send({ status: e.target.value })}>
                  <option value="open">Open</option><option value="in_progress">In progress</option><option value="awaiting_evidence">Awaiting evidence</option>
                </select>
              </label>
            </div>
          )}
          {editable && live && !mode && (
            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => setMode("complete")}>Mark complete…</Btn>
              <Btn onClick={() => setMode("dismiss")}>Dismiss…</Btn>
            </div>
          )}
          {mode === "complete" && (
            <div className="space-y-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
              <p className="text-[12px] text-slate-600 dark:text-slate-300">Completing an action needs the evidence that completes it, or a reviewer's recorded reason. It does not change the result: run the check again.</p>
              <select aria-label="Evidence that completes this" className={inputClass} value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)}>
                <option value="">No evidence chosen</option>
                {(subject.evidence || []).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
              <textarea aria-label="Reviewer's reason" rows={2} className={inputClass} value={text} onChange={(e) => setText(e.target.value)} placeholder="Or, as a reviewer: why this is complete" />
              <div className="flex gap-2"><Btn kind="primary" disabled={busy} onClick={() => send({ status: "completed", evidence_id: evidenceId || null, rationale: text })}>Mark complete</Btn><Btn onClick={() => setMode(null)}>Cancel</Btn></div>
            </div>
          )}
          {mode === "dismiss" && (
            <div className="space-y-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
              <p className="text-[12px] text-slate-600 dark:text-slate-300">Dismissing hides the action. The checklist item stays as it is.</p>
              <textarea aria-label="Reason for dismissing" rows={2} className={inputClass} value={text} onChange={(e) => setText(e.target.value)} placeholder="Why this is being dismissed" />
              <div className="flex gap-2"><Btn kind="primary" disabled={busy} onClick={() => send({ status: "dismissed", reason: text })}>Dismiss</Btn><Btn onClick={() => setMode(null)}>Cancel</Btn></div>
            </div>
          )}
          {editable && !live && action.status === "dismissed" && <Btn onClick={() => send({ status: "open" })}>Reopen</Btn>}
          {problem && <p role="alert" className="text-[12px] font-medium text-rose-600">{problem.message}</p>}
        </div>
      )}
    </li>
  );
}

export function ActionsPanel({ businessId, feature, subject, onChanged, onOpenSection, limit }) {
  const live = (subject.actions || []).filter((a) => ["open", "in_progress", "awaiting_evidence"].includes(a.status));
  const closed = (subject.actions || []).filter((a) => !live.includes(a));
  const [showClosed, setShowClosed] = useState(false);
  const shown = limit ? live.slice(0, limit) : live;
  if (!subject.assessment) return <p className="text-[13px] text-slate-500">Actions appear after the first check.</p>;
  return (
    <div className="space-y-3">
      {live.length === 0 && <p className="text-[13px] text-slate-500">No open actions. Nothing was found that still needs doing.</p>}
      <ol className="space-y-2">
        {shown.map((a, i) => <ActionRow key={a.id} businessId={businessId} feature={feature} subject={subject} action={a} rank={i + 1} onChanged={onChanged} onOpenSection={onOpenSection} />)}
      </ol>
      {!limit && closed.length > 0 && (
        <>
          <Btn kind="link" onClick={() => setShowClosed(!showClosed)}>{showClosed ? "Hide" : "Show"} {closed.length} completed or dismissed</Btn>
          {showClosed && <ul className="space-y-2">{closed.map((a) => <ActionRow key={a.id} businessId={businessId} feature={feature} subject={subject} action={a} onChanged={onChanged} onOpenSection={onOpenSection} />)}</ul>}
        </>
      )}
      <p className="text-[12px] text-slate-500">Actions are ranked: confirmed blockers first, then missing evidence, then other gaps. No score increase is promised: the result changes only when the check is run again.</p>
    </div>
  );
}

// ── Documents ─────────────────────────────────────────────────────────────────

export function RequiredDocuments({ businessId, subject, onChanged }) {
  const docs = subject.profile_definition?.required_documents || [];
  const entries = subject.data?.documents || {};
  const assessed = Object.fromEntries((subject.assessment?.result?.documents || []).map((d) => [d.key, d]));
  const [problem, setProblem] = useState(null);
  const [note, setNote] = useState("");
  const can = subject.can || {};
  const archived = subject.status === "archived";
  async function call(fn) {
    setProblem(null);
    try { onChanged(await fn()); } catch (e) { setProblem(readinessError(e).message); }
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {docs.map((d) => {
          const entry = entries[d.key] || {};
          const seen = assessed[d.key];
          const builtIn = d.record === "use_of_funds" ? "Taken from the use of funds in this case" : d.record === "forecast" ? "Taken from the forecast in this case" : null;
          return (
            <li key={d.key} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{d.label}</p>
                <Pill tone={entry.reviewed && !seen?.needs_review ? "emerald" : "slate"} mark={entry.reviewed && !seen?.needs_review ? "✓" : "?"}>
                  {seen?.needs_review ? "Needs reviewing again" : entry.reviewed ? `Reviewed ${dateLabel(entry.reviewed_at)}` : "Not reviewed"}
                </Pill>
              </div>
              <p className="mt-1 text-[12px] text-slate-500">{builtIn || (entry.artifact_id ? "Prepared here (see Materials below)" : entry.evidence_id ? `Your document: ${(subject.evidence || []).find((e) => e.id === entry.evidence_id)?.title || "attached"}` : "Not provided yet")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!builtIn && can["funding.edit"] && !archived && (
                  <select aria-label={`Use your own document for ${d.label}`} className={`${inputClass} !w-auto`} value={entry.evidence_id || ""}
                    onChange={(e) => call(() => reviewDocument(businessId, subject.id, d.key, { evidence_id: e.target.value || null, artifact_id: e.target.value ? null : entry.artifact_id || null }))}>
                    <option value="">Use your own document…</option>
                    {(subject.evidence || []).filter((e) => e.type === "document").map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                  </select>
                )}
                {can["funding.review"] && !archived && (
                  <Btn onClick={() => call(() => reviewDocument(businessId, subject.id, d.key, { reviewed: !(entry.reviewed && !seen?.needs_review) }))}>
                    {entry.reviewed && !seen?.needs_review ? "Undo review" : "Mark as reviewed"}
                  </Btn>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {(subject.data?.contradictions || []).map((c) => (
        <Notice key={c.id} tone={c.resolved ? "slate" : "rose"}>
          <span className="font-semibold">{c.resolved ? "Resolved" : "Contradiction raised"}:</span> {c.description} <span className="text-[12px]">({c.raised_by}, {dateLabel(c.at)})</span>
          {c.resolved ? <span> Resolution: {c.resolution}</span> : can["funding.review"] && !archived && (
            <Btn kind="link" className="ml-2 text-[12px]" onClick={() => note.trim().length > 2 ? call(() => contradiction(businessId, subject.id, { resolve_id: c.id, resolution: note })).then(() => setNote("")) : setProblem("Write how it was resolved in the box below first.")}>Mark resolved</Btn>
          )}
        </Notice>
      ))}
      {can["funding.review"] && !archived && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200">Figures that disagree between documents, or how one was resolved
            <input className={`mt-1 ${inputClass}`} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <Btn onClick={() => call(() => contradiction(businessId, subject.id, { description: note })).then(() => setNote(""))}>Raise a contradiction</Btn>
        </div>
      )}
      {problem && <Notice tone="rose" role="alert">{problem}</Notice>}
    </div>
  );
}

export function MaterialsPanel({ businessId, feature, subject, onChanged }) {
  const [state, setState] = useState({ loading: true, kinds: [], items: [] });
  const [openDoc, setOpenDoc] = useState(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState(null);
  const can = subject.can || {};

  async function load() {
    try { setState({ loading: false, ...(await listMaterials(businessId, feature, subject.id)) }); }
    catch (e) { setState({ loading: false, kinds: [], items: [] }); setProblem(readinessError(e).message); }
  }
  useEffect(() => { load(); }, [businessId, subject.id]);      // eslint-disable-line react-hooks/exhaustive-deps

  async function act(label, fn) {
    setBusy(label);
    setProblem(null);
    try { await fn(); } catch (e) { setProblem(e?.data ? readinessError(e).message : e.message || "That didn't work. Please try again."); } finally { setBusy(""); }
  }
  const open = (id) => act(`open-${id}`, async () => { const doc = await getMaterial(businessId, feature, subject.id, id); setOpenDoc(doc); setBody(doc.body || ""); });
  const make = (kind) => act(`make-${kind}`, async () => {
    const doc = await generateMaterial(businessId, feature, subject.id, kind, newKey());      // one key per click: a retry of the same request makes one document
    setOpenDoc(doc); setBody(doc.body || ""); await load(); onChanged();
  });

  if (state.loading) return <p className="text-[13px] text-slate-500" role="status">Loading documents…</p>;
  return (
    <div className="space-y-3">
      {!subject.assessment && <Notice>Documents are prepared from a completed check. Run the check first.</Notice>}
      <div className="flex flex-wrap gap-2">
        {state.kinds.map((k) => (
          <Btn key={k.kind} disabled={!can[`${feature}.export`] || !subject.assessment || Boolean(busy)} onClick={() => make(k.kind)}>
            {busy === `make-${k.kind}` ? "Preparing…" : `Prepare ${k.title.toLowerCase()}`}
          </Btn>
        ))}
      </div>
      {problem && <Notice tone="rose" role="alert">{problem} Nothing was duplicated; you can try again.</Notice>}
      <ul className="space-y-2">
        {state.items.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{m.title} <span className="font-normal text-slate-400">· version {m.version}</span></p>
              <p className="text-[12px] text-slate-500">From the check of {dateLabel(m.as_of)} · {m.status === "superseded" ? "Replaced by a newer version" : m.status === "reviewed" ? `Reviewed by ${m.reviewed_by}` : "Draft"}{m.edited ? " · edited" : ""}</p>
              {m.needs_review && <p className="text-[12px] font-medium text-amber-700 dark:text-amber-300">Needs review: {m.needs_review_reason}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => open(m.id)}>Open</Btn>
              <Btn disabled={!can[`${feature}.export`]} onClick={() => act("dl", () => downloadMaterial(businessId, feature, subject.id, m.id, "pdf"))}>PDF</Btn>
              <Btn disabled={!can[`${feature}.export`]} onClick={() => act("dl", () => downloadMaterial(businessId, feature, subject.id, m.id, "txt"))}>Text</Btn>
            </div>
          </li>
        ))}
      </ul>
      {openDoc && (
        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{openDoc.title} · version {openDoc.version}</p>
            <Btn kind="link" onClick={() => setOpenDoc(null)}>Close</Btn>
          </div>
          <p className="mt-1 text-[12px] text-slate-500">{openDoc.content?.footer} Anything missing is shown as a named gap, never filled in.</p>
          <textarea aria-label={`${openDoc.title} text`} rows={18} className={`mt-2 font-mono !text-[12px] ${inputClass}`} value={body} readOnly={openDoc.status === "superseded" || !can[`${feature}.edit`]} onChange={(e) => setBody(e.target.value)} />
          {openDoc.status !== "superseded" && (
            <div className="mt-2 flex flex-wrap gap-2">
              {can[`${feature}.edit`] && <Btn kind="primary" disabled={Boolean(busy) || body === (openDoc.body || "")} onClick={() => act("save", async () => { const d = await updateMaterial(businessId, feature, subject.id, openDoc.id, { body, revision: openDoc.revision }); setOpenDoc(d); await load(); })}>Save changes</Btn>}
              {can[`${feature}.review`] && <Btn disabled={Boolean(busy)} onClick={() => act("review", async () => { const d = await updateMaterial(businessId, feature, subject.id, openDoc.id, { reviewed: openDoc.status !== "reviewed" }); setOpenDoc(d); await load(); })}>{openDoc.status === "reviewed" ? "Back to draft" : "Mark as reviewed"}</Btn>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

export function ScenarioPanel({ businessId, feature, subject, currency }) {
  const [form, setForm] = useState(feature === "funding" ? { amount: subject.data?.target_amount ?? "", receipt_date: subject.data?.receipt_date || "" } : { kind: "launch_delay", months: 1, percent: 20 });
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  if (!subject.scenarios_available) return <Notice>Scenarios aren't available yet. The readiness check works without them, and nothing here is estimated in their place.</Notice>;
  async function run() {
    setBusy(true); setProblem(null);
    try { setOut(await runScenario(businessId, feature, subject.id, form)); } catch (e) { setOut(null); setProblem(readinessError(e).message); } finally { setBusy(false); }
  }
  const cell = (v) => (v ? `${moneyLabel(v.amount, currency)} in ${monthLabel(v.month)}` : "Not available");
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {feature === "funding" ? (
          <>
            <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Funding amount
              <input type="text" inputMode="decimal" className={`mt-1 ${inputClass}`} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </label>
            <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Received on
              <input type="date" className={`mt-1 ${inputClass}`} value={form.receipt_date} onChange={(e) => setForm({ ...form, receipt_date: e.target.value })} />
            </label>
          </>
        ) : (
          <>
            <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">What if
              <select className={`mt-1 ${inputClass}`} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="launch_delay">The launch is delayed</option><option value="lower_demand">Demand is lower</option><option value="higher_costs">Delivery costs are higher</option>
              </select>
            </label>
            {form.kind === "launch_delay" ? (
              <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">By how many months
                <input type="number" min={1} max={12} className={`mt-1 ${inputClass}`} value={form.months} onChange={(e) => setForm({ ...form, months: Number(e.target.value) })} />
              </label>
            ) : (
              <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">By what percentage
                <input type="number" min={1} max={500} className={`mt-1 ${inputClass}`} value={form.percent} onChange={(e) => setForm({ ...form, percent: Number(e.target.value) })} />
              </label>
            )}
          </>
        )}
        <div className="flex items-end"><Btn kind="primary" disabled={busy} onClick={run}>{busy ? "Working it out…" : "Compare with the baseline"}</Btn></div>
      </div>
      {problem && <Notice tone="rose" role="alert">{problem}</Notice>}
      {out && (
        <div className="space-y-2">
          <ul className="list-disc pl-5 text-[13px] text-slate-700 dark:text-slate-200">{out.assumption_changes.map((t) => <li key={t}>{t}</li>)}</ul>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-left text-[13px]">
              <thead><tr className="text-[11px] uppercase tracking-wide text-slate-500"><th className="py-1 pr-3"> </th><th className="py-1 pr-3">Baseline</th><th className="py-1">Scenario</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                <tr><th scope="row" className="py-2 pr-3 font-semibold text-slate-700 dark:text-slate-200">Lowest cash</th><td className="py-2 pr-3">{cell(out.comparison.min_cash.baseline)}</td><td className="py-2">{cell(out.comparison.min_cash.scenario)}</td></tr>
                <tr><th scope="row" className="py-2 pr-3 font-semibold text-slate-700 dark:text-slate-200">First month below zero</th>
                  <td className="py-2 pr-3">{out.comparison.first_negative_month.baseline ? monthLabel(out.comparison.first_negative_month.baseline) : out.baseline.state === "complete" ? "None" : "Not available"}</td>
                  <td className="py-2">{out.comparison.first_negative_month.scenario ? monthLabel(out.comparison.first_negative_month.scenario) : out.scenario.state === "complete" ? "None" : "Not available"}</td></tr>
              </tbody>
            </table>
          </div>
          <Notice>{out.note} <span className="text-[12px]">Formula {out.formula_version}.</span></Notice>
        </div>
      )}
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

export function HistoryPanel({ businessId, feature, subject, currency }) {
  const [items, setItems] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    let live = true;
    getHistory(businessId, feature, subject.id).then((r) => live && setItems(r.items)).catch((e) => live && setProblem(readinessError(e).message));
    return () => { live = false; };
  }, [businessId, feature, subject.id, subject.assessment?.id]);
  if (problem) return <Notice tone="rose" role="alert">{problem}</Notice>;
  if (!items) return <p className="text-[13px] text-slate-500" role="status">Loading history…</p>;
  if (!items.length) return <p className="text-[13px] text-slate-500">No checks have been run yet.</p>;
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((h) => {
          const cls = CLASSIFICATION[h.classification];
          return (
            <li key={h.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{dateLabel(h.as_of || h.created_at)}</p>
                {cls ? <Pill tone={cls.tone} mark={cls.mark}>{cls.label}</Pill> : <Pill>{h.execution_status === "failed" ? "Did not finish" : "Running"}</Pill>}
              </div>
              <p className="mt-1 text-[12px] text-slate-500">
                {h.score !== null && h.score !== undefined ? `Score ${h.score} · ` : h.classification ? "No overall score · " : ""}{h.coverage !== null && h.coverage !== undefined ? `coverage ${h.coverage}% · ` : ""}
                checklist {String(h.profile || "").split("@")[1] || ""}{h.requested_by ? ` · run by ${h.requested_by}` : ""}
              </p>
              {h.changed_because?.length > 0 && <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-300">Changed since the check before because of {h.changed_because.join(" and ")}.</p>}
              {h.changed_because?.length > 0 && !h.comparable && <p className="text-[12px] text-amber-700 dark:text-amber-300">A different checklist version was used, so the scores are not directly comparable.</p>}
              {h.execution_status === "succeeded" && <Btn kind="link" className="mt-1 text-[12px]" onClick={async () => { try { setViewing(await getAssessment(businessId, feature, subject.id, h.id)); } catch (e) { setProblem(readinessError(e).message); } }}>View this result as it was</Btn>}
            </li>
          );
        })}
      </ul>
      {viewing && (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 p-3 dark:border-slate-700">
          <div className="mb-2 flex items-center justify-between"><p className="text-sm font-bold text-slate-900 dark:text-slate-100">Result of {dateLabel(viewing.as_of)}, as it was</p><Btn kind="link" onClick={() => setViewing(null)}>Close</Btn></div>
          <ResultView assessment={viewing} feature={feature} currency={currency} historic />
        </div>
      )}
    </div>
  );
}

// ── Launch decision ───────────────────────────────────────────────────────────

export function DecisionPanel({ businessId, subject, onChanged }) {
  const [rationale, setRationale] = useState("");
  const [newDate, setNewDate] = useState("");
  const [actualDate, setActualDate] = useState(todayLocal());
  const [scope, setScope] = useState("");
  const [ack, setAck] = useState(false);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const can = subject.can?.["launch.decide"];
  const a = subject.assessment;
  const result = a?.result;
  const blockers = (result?.gates || []).filter((g) => g.state === "failed");
  const atRisk = !result || blockers.length > 0 || !["ready", "conditionally_ready"].includes(result.classification) || a.freshness?.status !== "current";
  const closed = ["launched", "cancelled", "archived"].includes(subject.status);
  const decisions = (subject.decisions || []).filter((d) => d.kind !== "attestation");

  async function call(fn) {
    setBusy(true); setProblem(null);
    try { onChanged(await fn()); setRationale(""); } catch (e) { setProblem(readinessError(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Panel title="What the decision is based on">
        {result ? (
          <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
            <div><dt className="font-semibold text-slate-700 dark:text-slate-200">Last check</dt><dd className="text-slate-600 dark:text-slate-300">{dateLabel(a.as_of)} · {CLASSIFICATION[result.classification].label}{a.freshness?.status === "stale" ? " · out of date" : ""}</dd></div>
            <div><dt className="font-semibold text-slate-700 dark:text-slate-200">Scope and date</dt><dd className="text-slate-600 dark:text-slate-300">{subject.data?.scope === "commercial" ? "Commercial launch" : subject.data?.scope} · {subject.data?.target_date ? dateLabel(subject.data.target_date) : "no date set"}</dd></div>
            <div className="sm:col-span-2"><dt className="font-semibold text-slate-700 dark:text-slate-200">Open blockers and risks</dt>
              <dd className="text-slate-600 dark:text-slate-300">{blockers.length === 0 && result.risks.length === 0 ? "None found at the last check." : (
                <ul className="list-disc pl-5">{blockers.map((g) => <li key={g.code}><span className="font-semibold">Blocker:</span> {g.reason}</li>)}{result.risks.map((r) => <li key={r.code}>{r.text}</li>)}</ul>)}</dd></div>
          </dl>
        ) : <p className="text-[13px] text-slate-500">No check has been run yet. A decision can still be recorded; it will say so.</p>}
      </Panel>

      {!closed && (
        <Panel title="Record your decision" description="This records what you intend. It publishes nothing, takes no payments and does not mark the business as launched.">
          {!can && <Notice>Only the owner, or a member who can approve, can record a launch decision.</Notice>}
          <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Reasons
            <textarea rows={2} className={`mt-1 ${inputClass}`} disabled={!can} value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </label>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Btn kind="primary" disabled={!can || busy} onClick={() => call(() => recordDecision(businessId, subject.id, { decision: "proceed", rationale, assessment_id: a?.id || null, acknowledged_risks: blockers.map((g) => g.label) }))}>Proceed</Btn>
            <label className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">New launch date
              <input type="date" className={`mt-1 ${inputClass}`} disabled={!can} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </label>
            <Btn disabled={!can || busy} onClick={() => call(() => recordDecision(businessId, subject.id, { decision: "defer", rationale, new_target_date: newDate || null }))}>Defer to this date</Btn>
            <Btn kind="danger" disabled={!can || busy} onClick={() => call(() => recordDecision(businessId, subject.id, { decision: "cancel", rationale }))}>Cancel the launch</Btn>
          </div>
        </Panel>
      )}

      {!closed && (
        <Panel title="Record that the launch happened" description="Only once it has. You can record it whatever the last check said; the check's result is kept as it was.">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Date it launched
              <input type="date" max={todayLocal()} className={`mt-1 ${inputClass}`} disabled={!can} value={actualDate} onChange={(e) => setActualDate(e.target.value)} />
            </label>
            <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">What actually launched
              <input className={`mt-1 ${inputClass}`} disabled={!can} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="For example: two pilot clients" />
            </label>
          </div>
          {atRisk && (
            <label className="mt-3 flex items-start gap-2 text-[13px] text-slate-700 dark:text-slate-200">
              <input type="checkbox" className="mt-1" disabled={!can} checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>I have seen the open blockers and risks above. Recording the launch does not resolve them, and is not permission to skip any legal requirement.</span>
            </label>
          )}
          <Btn className="mt-3" kind="primary" disabled={!can || busy || (atRisk && !ack)} onClick={() => call(() => recordLaunch(businessId, subject.id, { actual_date: actualDate, scope, acknowledge: ack }))}>Record the launch</Btn>
        </Panel>
      )}

      {subject.data?.actual_launch && (
        <Notice tone="emerald">Launched on {dateLabel(subject.data.actual_launch.date)} ({subject.data.actual_launch.scope}), recorded by {subject.data.actual_launch.recorded_by}.
          {subject.data.actual_launch.blockers?.length > 0 && ` ${subject.data.actual_launch.blockers.length} blocker${subject.data.actual_launch.blockers.length !== 1 ? "s were" : " was"} open and acknowledged, not resolved.`}
          {" "}Your business stage was not changed.</Notice>
      )}
      {problem && <Notice tone="rose" role="alert">{problem.message}</Notice>}

      <Panel title="Decision log">
        {decisions.length === 0 ? <p className="text-[13px] text-slate-500">No decisions recorded yet.</p> : (
          <ul className="divide-y divide-slate-100 text-[13px] dark:divide-slate-800">
            {decisions.map((d) => (
              <li key={d.id} className="py-2">
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  {d.kind === "actual_launch" ? `Launch recorded for ${dateLabel(d.actual_date)}` : d.kind === "reopen" ? "Reopened" : d.decision === "proceed" ? "Decided to proceed" : d.decision === "defer" ? `Deferred to ${dateLabel(d.target_date)}` : "Cancelled"}
                </p>
                <p className="text-slate-500">{dateLabel(d.at)} · {d.actor}{d.classification ? ` · last check: ${CLASSIFICATION[d.classification]?.label}` : ""}{d.blockers?.length ? ` · ${d.blockers.length} open blocker${d.blockers.length !== 1 ? "s" : ""} acknowledged` : ""}</p>
                {d.rationale && <p className="text-slate-600 dark:text-slate-300">{d.rationale}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
