import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { QuestionForm } from "./AgentBits";
import { agentErrorMessage, answerRun, cancelRun, runStateLabel } from "../../lib/agent";
import { UndoToast } from "../FirstResultPanel";

// Agent Centre lists (the owner's QA, 15 Oct): ONE compact row for every list, the same columns on every row:
//   [type icon] [title in plain words] [what's needed] [age] [Answer / Review / Open]
// No forms in the list: a row opens the side panel with the question or the approval. Duplicates of the same task are one
// row ("2 similar", keep the latest); requests older than 7 days with no answer are "Stale", cleared in one go with Undo.

export const TYPE_OF = (key) => (
  /invoice|receipt|payment|quote_to_cash/.test(key || "") ? "Invoices"
    : /quot|enquiry|rfq|proposal/.test(key || "") ? "Quotations"
    : /fund/.test(key || "") ? "Funding"
    : /launch/.test(key || "") ? "Launch"
    : /idea|market_size|business_plan/.test(key || "") ? "Ideas" : "Other");
const TYPES = ["Invoices", "Quotations", "Funding", "Launch", "Ideas", "Other"];
const STALE_DAYS = 7;

const ago = (at) => {
  const t = new Date(at || 0).getTime();
  if (!t) return "";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} ago`;
  const hours = Math.floor((Date.now() - t) / 3600000);
  return hours >= 1 ? `${hours} hour${hours === 1 ? "" : "s"} ago` : "Just now";
};
const titleOf = (r) => r.question_title || r.title || "Task";
const needOf = (r) => (r.bucket === "needs_approval" || r.status === "awaiting_approval" ? "Waiting for your approval"
  : r.pending_question ? (r.question_detail || r.pending_question.question || "Waiting for your answer")
  : r.status === "succeeded" ? (r.summary || "Done") : r.next_action || r.summary || runStateLabel(r));
const actionOf = (r) => (r.status === "awaiting_approval" ? "Review" : r.pending_question && !r.pending_question.optional ? "Answer" : "Open");

/** Groups the same task asked more than once (same kind and the same title): the newest is the row, "N similar" on it. */
export function grouped(runs) {
  const by = new Map();
  for (const r of runs) {
    const key = `${r.workflow_key}|${titleOf(r).toLowerCase()}`;
    by.set(key, [...(by.get(key) || []), r]);
  }
  return [...by.values()].map((list) => {
    const sorted = [...list].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return { row: sorted[0], older: sorted.slice(1) };
  });
}

export const isStale = (r) => Boolean(r.pending_question) && Date.now() - new Date(r.created_at || 0).getTime() > STALE_DAYS * 86400000;

function Icon({ type }) {
  const d = { Invoices: "M6 3h9l3 3v15H6z M9 9h6 M9 13h6", Quotations: "M5 4h14v12H8l-3 3z", Funding: "M12 3v18 M8 7h6a3 3 0 010 6H9a3 3 0 000 6h7",
    Launch: "M5 19l4-1 9-9a3 3 0 00-4-4l-9 9z", Ideas: "M9 18h6 M10 21h4 M12 3a6 6 0 00-3 11v2h6v-2a6 6 0 00-3-11z", Other: "M4 6h16 M4 12h16 M4 18h10" }[type];
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-slate-800">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}><path d={d} /></svg>
    </span>
  );
}

/** The question, with its form, in the side panel (never in the list). */
function QuestionPanel({ run, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50" data-question-panel>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-slate-900/40" />
      <aside role="dialog" aria-modal="true" aria-label={titleOf(run)} className="absolute inset-y-0 right-0 flex w-full flex-col overflow-y-auto bg-white p-5 shadow-2xl sm:w-[480px] dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">{titleOf(run)}</p>
          <span className="flex shrink-0 items-center gap-3">
            <a href={`/agent/runs/${run.id}`} data-open-full-page className="text-[13px] font-semibold text-brand-700 hover:underline">Open full page</a>
            <button type="button" onClick={onClose} className="text-[13px] font-semibold text-slate-500 hover:text-slate-800">Close</button>
          </span>
        </div>
        <div className="mt-3">
          <QuestionForm question={run.pending_question.question} fields={run.pending_question.fields} submitting={busy}
            onSubmit={async (answers) => {
              setBusy(true);
              setProblem("");
              try { await answerRun(run.id, answers); onDone(run); } catch (e) { setProblem(agentErrorMessage(e, "That answer couldn't be saved. Please try again.")); } finally { setBusy(false); }
            }} />
          {problem && <p role="alert" className="mt-2 text-[12px] text-rose-600">{problem}</p>}
        </div>
      </aside>
    </div>, document.body);
}

export default function AgentRows({ runs, empty, onOpen, onReview, onChanged }) {
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(null);
  const [gone, setGone] = useState(new Set());       // answered or cleared, folding away
  const [clearing, setClearing] = useState(null);    // stale requests to clear once Undo has passed
  const [toast, setToast] = useState("");
  const rows = useMemo(() => grouped(runs.filter((r) => !gone.has(r.id)))
    .filter(({ row }) => (!type || TYPE_OF(row.workflow_key) === type) && (!q || titleOf(row).toLowerCase().includes(q.toLowerCase()))), [runs, gone, type, q]);
  const stale = rows.filter(({ row }) => isStale(row));
  const open = (r) => (r.status === "awaiting_approval" ? onReview(r) : r.pending_question && !r.pending_question.optional ? setAsking(r) : onOpen(r));
  const fold = (ids) => setGone((had) => new Set([...had, ...ids]));
  const cancelAll = async (list) => { for (const r of list) { try { await cancelRun(r.id); } catch { /* left for next time */ } } onChanged?.(); };

  return (
    <div data-agent-rows>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        {TYPES.map((t) => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(type === t ? "" : t)}
            className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${type === t ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}`}>{t}</button>
        ))}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks"
          className="ml-auto w-full rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] sm:w-56 dark:border-slate-700 dark:bg-slate-950" />
      </div>
      {stale.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 bg-amber-50/70 px-4 py-2 text-[13px] text-amber-900" data-stale-bar>
          <span>{stale.length} request{stale.length === 1 ? "" : "s"} older than {STALE_DAYS} days with no answer.</span>
          <button type="button" data-clear-stale onClick={() => { const list = stale.map((s) => s.row); fold(list.map((r) => r.id)); setClearing(list); setToast(`Cleared ${list.length} old request${list.length === 1 ? "" : "s"}. Nothing was charged.`); }}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1 text-[12.5px] font-semibold text-amber-900 hover:bg-amber-100">Clear {stale.length} old request{stale.length === 1 ? "" : "s"}</button>
        </div>
      )}
      {!rows.length ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">{type || q ? "Nothing matches." : empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(({ row: r, older }) => (
            <li key={r.id} data-agent-row className="grid min-h-[64px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 md:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] max-[480px]:grid-cols-[auto_minmax(0,1fr)]">
              <Icon type={TYPE_OF(r.workflow_key)} />
              <button type="button" onClick={() => open(r)} className="min-w-0 text-left">
                <span className="block truncate text-[14px] font-semibold text-slate-900 dark:text-slate-100">{titleOf(r)}</span>
                <span className="mt-0.5 flex flex-wrap gap-1.5">
                  {older.length > 0 && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600" data-similar>{older.length + 1} similar</span>}
                  {isStale(r) && <span className="rounded-full bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200" data-stale>Stale</span>}
                  <span className="truncate text-[12.5px] text-slate-500 md:hidden">{needOf(r)}</span>
                </span>
              </button>
              <span className="hidden truncate text-[13px] text-slate-600 md:block dark:text-slate-300" data-need>{needOf(r)}</span>
              <span className="hidden whitespace-nowrap text-[12px] text-slate-400 md:block">{ago(r.updated_at || r.created_at)}</span>
              <span className="flex items-center gap-2 max-[480px]:col-span-2">
                {older.length > 0 && (
                  <button type="button" onClick={() => { fold(older.map((o) => o.id)); setClearing(older); setToast(`Kept the latest. ${older.length} older ${older.length === 1 ? "copy" : "copies"} cleared.`); }}
                    className="whitespace-nowrap text-[12px] font-semibold text-slate-500 hover:text-slate-800" data-keep-latest>Keep latest</button>
                )}
                <button type="button" onClick={() => open(r)} data-row-action
                  className="whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:border-brand-300 hover:text-brand-700 max-[480px]:w-full dark:border-slate-700 dark:text-slate-200">{actionOf(r)}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {asking && <QuestionPanel run={asking} onClose={() => setAsking(null)} onDone={(r) => { setAsking(null); fold([r.id]); setToast("Answered. I'm carrying on with it."); onChanged?.(); }} />}
      <UndoToast open={Boolean(toast)} text={toast}
        onUndo={() => { if (clearing) setGone((had) => new Set([...had].filter((id) => !clearing.some((c) => c.id === id)))); setClearing(null); setToast(""); }}
        onDone={() => { if (clearing) cancelAll(clearing); setClearing(null); setToast(""); }} />
    </div>
  );
}
