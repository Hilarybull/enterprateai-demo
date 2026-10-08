import { useCallback, useEffect, useState } from "react";
import { confirmDialog } from "../lib/dialog";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AgentRunSkeleton, ButtonSpinner, LoadError } from "../components/Skeleton";
import { ApprovalReview, Icon, Modal, Pill, QuestionForm } from "../components/agent/AgentBits";
import DraftEditor from "../components/agent/DraftEditor";
import { agentErrorMessage, answerRun, approveAction, cancelRun, editDraft, fixCustomerEmail, getRun, rejectAction, resolveDelivery, retryRun, runStateLabel, runTone } from "../lib/agent";

const fmt = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

const STEP_STYLE = {
  succeeded: { dot: "bg-emerald-500 text-white", label: "Done" },
  running: { dot: "bg-indigo-500 text-white", label: "In progress" },
  awaiting_approval: { dot: "bg-amber-500 text-white", label: "Needs approval" },
  awaiting_input: { dot: "bg-amber-500 text-white", label: "Waiting for you" },
  failed: { dot: "bg-rose-500 text-white", label: "Stopped" },
  skipped: { dot: "bg-slate-300 text-white", label: "Skipped" },
  cancelled: { dot: "bg-slate-300 text-white", label: "Cancelled" },
  pending: { dot: "bg-slate-200 text-slate-500", label: "To do" },
};

export default function AgentRunPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await getRun(runId));
      setError("");
    } catch (e) {
      setError(agentErrorMessage(e, "This task could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { load(); }, [load]);

  async function act(name, fn) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      const res = await fn();
      if (res?.message) setNotice(res.message);
      window.dispatchEvent(new CustomEvent("ea:credits:refresh"));
      window.dispatchEvent(new CustomEvent("ea:workspace:refresh"));
      await load();
    } catch (e) {
      setError(agentErrorMessage(e));
    } finally {
      setBusy("");
    }
  }

  if (loading) return <AgentRunSkeleton />;
  if (!data) {
    return (
      <LoadError what="this task" detail={error || "This task could not be found."} onRetry={() => { setLoading(true); load(); }}>
        <Link to="/agent" className="text-sm font-semibold text-brand-600 hover:underline">Back to Agent Centre</Link>
      </LoadError>
    );
  }

  const { run, steps, approvals, history, can } = data;
  const pending = approvals.find((a) => a.status === "pending");
  const terminal = ["succeeded", "cancelled"].includes(run.status);
  const question = run.status === "running" && run.pending_question ? run.pending_question : null;

  // Plan timeline: the latest attempt of each planned step, in plan order (every attempt
  // is in the History list below).
  const latest = {};
  [...steps].sort((a, b) => (a.seq || 0) - (b.seq || 0)).forEach((s) => { latest[s.step_key] = s; });
  const currentIdx = run.steps_planned.findIndex((s) => s.key === run.current_step);
  const timeline = run.steps_planned
    .map((s, i) => {
      const done = latest[s.key];
      if (done) return { ...s, state: done.state, note: done.error || done.note, at: done.finished_at || done.started_at, external: done.external };
      if (terminal || i < currentIdx) return null;      // a step this run did not need
      // The step in hand is written to the record when it has something to record; until then it is the one in progress.
      return { ...s, state: i === currentIdx && ["running", "created"].includes(run.status) && !run.pending_question && !run.substatus ? "running" : "pending" };
    })
    .filter(Boolean);
  const sent = data.messages_sent ?? (data.step_attempts || steps).filter((s) => s.external).length;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <button type="button" onClick={() => navigate("/agent")} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        <span className="rotate-180"><Icon name="chevron" className="h-3.5 w-3.5" /></span> Agent Centre
      </button>

      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{run.family}</p>
            <h1 className="mt-0.5 text-xl font-bold text-slate-900 dark:text-slate-100">{run.title}</h1>
            <p className="mt-1 text-sm text-slate-500">{run.goal}</p>
          </div>
          <Pill tone={runTone(run)}>{runStateLabel(run)}</Pill>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/60">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">What happened</div>
            <p className="mt-1 text-sm text-slate-800 dark:text-slate-100">{run.summary || "The task has started."}</p>
            {sent > 0 && <p className="mt-1.5 text-[12px] text-slate-500">{sent} message{sent === 1 ? " has" : "s have"} been sent to the customer.</p>}
            <p className="mt-1.5 text-[12px] text-slate-500" aria-label="Credits used">
              {run.credits_used > 0
                ? `Credits used: ${run.credits_used} (${(run.credits || []).map((c) => `${c.what}: ${c.credits}`).join(", ")})`
                : "Credits used: none"}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/60">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">What happens next</div>
            <p className="mt-1 text-sm text-slate-800 dark:text-slate-100">
              {run.status === "succeeded" ? (run.next_action || "Nothing more to do.")
                : run.status === "cancelled" ? "Nothing. This task was stopped."
                : run.next_action || "The Agent is working on it."}
            </p>
          </div>
        </div>
        {Object.keys(run.refs || {}).length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
            {run.refs.quote_reference && <span className="rounded-lg bg-slate-100 px-2 py-1 dark:bg-slate-800">Quotation {run.refs.quote_reference}</span>}
            {run.refs.invoice_reference && <span className="rounded-lg bg-slate-100 px-2 py-1 dark:bg-slate-800">Invoice {run.refs.invoice_reference}</span>}
            <Link to="/operations?tab=Sales" className="font-semibold text-brand-600 hover:underline">Open in Business Operations</Link>
          </div>
        )}
      </header>

      {notice && <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-900">{notice}</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</p>}

      {pending && run.status === "awaiting_approval" && (
        <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm dark:border-amber-900/50 dark:bg-slate-900" aria-label="Approval required">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{editing ? "Edit the draft" : "Your approval is needed"}</h2>
              <p className="mt-0.5 text-sm text-slate-500">{editing ? "Save your changes and it will be shown again for approval. Nothing is sent meanwhile." : "Check the details. Nothing is sent until you approve."}</p>
            </div>
            {/* The same actions as at the foot of the card, where they can be reached without scrolling. */}
            {!editing && (
              <div className="flex flex-wrap gap-2" data-top-actions>
                {can.edit_draft && (
                  <button type="button" disabled={!!busy} onClick={() => setEditing(true)} aria-label="Edit"
                    className="rounded-xl border border-slate-200 px-3.5 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Edit</button>
                )}
                {can.approve && (
                  <>
                    <button type="button" disabled={!!busy} onClick={() => act("reject", () => rejectAction(run.id, pending.id))} aria-label="Decline this"
                      className="rounded-xl border border-slate-200 px-3.5 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Decline</button>
                    <button type="button" disabled={!!busy} onClick={() => act("approve", () => approveAction(run.id, pending.id))} aria-label="Approve this"
                      className="rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">Approve</button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="mt-4">
            {editing && can.edit_draft ? (
              <DraftEditor approval={pending} options={data.draft_options} saving={busy === "edit"} problem={error} onCancel={() => { setEditing(false); setError(""); }}
                onSave={(changed) => act("edit", async () => {
                  const res = await editDraft(run.id, changed);
                  setEditing(false);
                  return { ...res, message: "Draft updated. Check the new version, then approve it to send." };
                })} />
            ) : <ApprovalReview approval={pending} lastEdit={run.last_edit} editedByYou={data.draft_options?.edited_by_you} />}
          </div>
          {editing ? null : can.approve ? (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {can.edit_draft && (
                <button type="button" disabled={!!busy} onClick={() => setEditing(true)}
                  className="mr-auto rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  Edit draft
                </button>
              )}
              <button type="button" disabled={!!busy} onClick={() => act("reject", () => rejectAction(run.id, pending.id))}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                {busy === "reject" && <ButtonSpinner />}{busy === "reject" ? "Declining…" : "Decline"}
              </button>
              <button type="button" disabled={!!busy} onClick={() => act("approve", () => approveAction(run.id, pending.id))}
                className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {busy === "approve" && <ButtonSpinner />}{busy === "approve" ? "Sending…" : "Approve and send"}
              </button>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {can.edit_draft && (
                <button type="button" disabled={!!busy} onClick={() => setEditing(true)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  Edit draft
                </button>
              )}
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Only the workspace owner (or a member they have authorised) can approve this.
              </p>
            </div>
          )}
        </section>
      )}

      {question && can.answer && (
        <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm dark:border-amber-900/50 dark:bg-slate-900" aria-label="Information needed">
          <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-slate-100">
            {question.optional ? "You can confirm this yourself" : "The Agent needs something from you"}
          </h2>
          <QuestionForm question={question.question} fields={question.fields} submitting={busy === "answer"}
            onSubmit={(answers) => act("answer", () => answerRun(run.id, answers))} />
        </section>
      )}

      {run.status === "failed" && (
        <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm dark:border-rose-900/50 dark:bg-slate-900" aria-label="Recovery">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {run.email_needed
              ? `${run.email_needed.customer} has no email on record${run.email_needed.reference ? ` for ${run.email_needed.reference}` : ""}`
              : runStateLabel(run)}
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{run.error}</p>
          <p className="mt-2 text-[13px] text-slate-500">
            {sent > 0 ? `${sent} message${sent === 1 ? " was" : "s were"} already sent before this stopped; retrying will not send ${sent === 1 ? "it" : "them"} again.` : "Nothing has been sent to the customer."}
          </p>
          {can.fix_customer_email && (
            <form className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end" aria-label="Fix customer email"
              onSubmit={(e) => { e.preventDefault(); if (newEmail.trim()) act("fix_email", () => fixCustomerEmail(run.id, newEmail.trim())); }}>
              <label className="block flex-1 text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                {run.email_needed ? `Email address for ${run.email_needed.customer}` : "Customer email"}
                <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="accounts@customer.com" autoComplete="off"
                  className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
              </label>
              <button type="submit" disabled={!!busy || !newEmail.trim()}
                className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {busy === "fix_email" && <ButtonSpinner />}{busy === "fix_email" ? "Saving…" : "Save and carry on"}
              </button>
            </form>
          )}
          {can.confirm_delivery && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4" role="group" aria-label="Was it delivered?">
              <p className="text-sm font-semibold text-amber-900">
                Did {run.delivery_question?.to || "the customer"} receive it?
              </p>
              <p className="mt-1 text-[13px] text-amber-800">I won't send anything until you choose. Check your sent mail or ask the customer.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={!!busy} onClick={() => act("delivered", () => resolveDelivery(run.id, "delivered"))}
                  className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                  {busy === "delivered" && <ButtonSpinner />}{busy === "delivered" ? "Saving…" : "Yes, mark as delivered"}
                </button>
                <button type="button" disabled={!!busy}
                  onClick={async () => {
                    if (await confirmDialog("If the first one did arrive, the customer will have two.", { title: "Send it again?", confirmLabel: "Send again", danger: true })) {
                      act("resend", () => resolveDelivery(run.id, "resend"));
                    }
                  }}
                  className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60">
                  {busy === "resend" && <ButtonSpinner />}{busy === "resend" ? "Sending…" : "No, send it again"}
                </button>
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {["invoice_disputed", "invoice_voided", "invoice_cancelled", "invoice_credited"].includes(run.reason_code) && (
              <Link to="/operations?tab=Sales&sub=Invoices" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">Open invoices</Link>
            )}
            {run.next_attempt_at && (
              // The Agent is still trying this itself: no button, just when.
              <p className="text-[13px] text-slate-600 dark:text-slate-300" aria-label="Next attempt">
                The Agent's next attempt is on {new Date(run.next_attempt_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. There is nothing you need to do.
              </p>
            )}
            {can.retry && !run.next_attempt_at && !can.fix_customer_email && !can.confirm_delivery && (
              <button type="button" disabled={!!busy} onClick={() => act("retry", () => retryRun(run.id))}
                className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {busy === "retry" && <ButtonSpinner />}{busy === "retry" ? "Retrying…" : "Try again"}
              </button>
            )}
            {["credits_exhausted", "plan_limit"].includes(run.reason_code) && (
              <Link to="/pricing" className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100">See plans</Link>
            )}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-label="Plan">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Plan</h2>
        <ol className="mt-4 space-y-0">
          {timeline.map((s, i) => {
            const style = STEP_STYLE[s.state] || STEP_STYLE.pending;
            return (
              <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
                {i < timeline.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />}
                <span className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${style.dot}`}>
                  {s.state === "succeeded" ? <Icon name="check" className="h-3.5 w-3.5" /> : s.state === "failed" ? <Icon name="x" className="h-3 w-3" />
                    : s.state === "skipped" ? <span className="text-[13px] font-bold leading-none" aria-hidden="true">–</span>
                    : <span className="text-[10px] font-bold">{i + 1}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className={`text-sm font-semibold ${s.state === "pending" ? "text-slate-400" : "text-slate-900 dark:text-slate-100"}`}>{s.title}</span>
                    <span className="text-[11px] text-slate-400">{style.label}{s.at ? ` · ${fmt(s.at)}` : ""}</span>
                  </div>
                  {s.note && <p className="mt-0.5 text-[13px] text-slate-500">{s.note}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-label="History">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">History</h2>
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm">
              <span className="text-slate-800 dark:text-slate-200">{h.text}{h.note && h.type !== "tool_executed" ? <span className="text-slate-500"> — {h.note}</span> : null}</span>
              <span className="text-[12px] text-slate-400">{h.actor && h.actor !== "system" ? `${h.actor} · ` : h.actor === "system" ? "Automatic · " : ""}{fmt(h.at)}</span>
            </li>
          ))}
        </ul>
      </section>

      {!terminal && can.cancel && (
        <div className="flex justify-end">
          <button type="button" disabled={!!busy}
            onClick={async () => {
              if (await confirmDialog("Anything already sent can't be recalled.", { title: "Stop this task?", confirmLabel: "Stop task", cancelLabel: "Keep going", danger: true })) {
                act("cancel", () => cancelRun(run.id));
              }
            }}
            className="text-sm font-medium text-slate-500 hover:text-rose-600 disabled:opacity-60">
            {busy === "cancel" && <ButtonSpinner />}{busy === "cancel" ? "Stopping…" : "Stop this task"}
          </button>
        </div>
      )}
    </div>
  );
}
