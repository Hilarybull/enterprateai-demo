import { useEffect, useRef, useState } from "react";
import { agentErrorMessage, answerRun, cancelRun, creditsText, fixCustomerEmail, getRun } from "../../lib/agent";
import { formatCurrency } from "../../lib/format";
import { Modal, QuestionForm } from "./AgentBits";

// A task started from the Agent box or the chat stays where the owner is. Its questions open in
// a dialog, one after another; what it prepares lands in Needs Approval and is confirmed in a
// line; a task still working is watched until it changes. Nothing here changes the page: the
// task's own page opens only from "See details".

export const WORKING_TEXT = "Working on it…";
const POLL_MS = 1500;
const MAX_POLLS = 60;

/** "Working on it… Pricing items…": the step comes from the task while the Agent carries it on. */
export const workingText = (run) => [WORKING_TEXT, run?.step?.doing].filter(Boolean).join(" ");

const PREPARED = { send_quotation: "Quotation", send_contract: "Contract", send_invoice: "Invoice", send_receipt: "Receipt",
  send_proposal: "Proposal", send_purchase_order: "Purchase order", send_credit_note: "Credit note" };

/** "Quotation QUO-12 for £480.00 is ready. It's in Needs Approval." */
export function readyText(run, approval) {
  const p = approval?.payload || {};
  const amount = [p.total, p.amount, p.outstanding].find((v) => typeof v === "number");
  const money = typeof amount === "number" ? formatCurrency(amount, p.currency || "GBP") : "";
  if (approval?.tool_id === "send_payment_reminder") {
    const ref = p.invoice_reference || p.reference || run?.refs?.invoice_reference;
    return `Payment reminder${ref ? ` for ${ref}` : ""}${money ? ` (${money})` : ""} is ready. It's in Needs Approval.`;
  }
  const thing = PREPARED[approval?.tool_id];
  const ref = p.receipt_number || p.reference || run?.refs?.quote_reference || run?.refs?.invoice_reference;
  if (!thing) return `${run?.summary || "I've prepared it."} It's in Needs Approval.`;
  return `${[thing, ref].filter(Boolean).join(" ")}${money ? ` for ${money}` : ""} is ready. It's in Needs Approval.`;
}

/**
 * say(reply): where results go (the line under the ask box, or a chat message). A reply is
 *   { tone, text, next, runId, working }. `working` marks the "Working on it…" line.
 * onChanged(): the Agent card and Needs Approval should reload.
 * onDetails(runId): the owner pressed "See details".
 */
export function useTaskFlow({ say, onChanged, onDetails }) {
  const [open, setOpen] = useState(null);        // { kind: "question" | "problem" | "ask", run, ... }
  const [sending, setSending] = useState(false);
  const [working, setWorking] = useState(false); // the task is running after an answer: the dialog waits with it
  const [doing, setDoing] = useState("");
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);      // Cancel was pressed on a question: keep it for later, or discard it?
  const [email, setEmail] = useState("");
  const asked = useRef(0);
  const timer = useRef(null);
  const alive = useRef(true);
  const out = useRef({ say, onChanged, onDetails });
  out.current = { say, onChanged, onDetails };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; clearTimeout(timer.current); };
  }, []);

  const tell = (reply) => out.current.say?.(reply);
  const changed = () => out.current.onChanged?.();
  function settle(reply) {
    setWorking(false);
    setOpen(null);
    if (reply) tell(reply);
    changed();
  }

  async function follow(run, tries = 0) {
    clearTimeout(timer.current);
    if (!alive.current) return;
    if (!run?.id) return settle(null);
    const status = run.status;
    const q = run.pending_question;
    if (status === "running" && q && !q.optional) {
      asked.current += 1;
      setWorking(false);
      setError("");
      setOpen({ kind: "question", run, n: asked.current, fromBox: true });
      tell(null);
      return changed();
    }
    if (status === "awaiting_approval") {
      let approval = null;
      try {
        approval = ((await getRun(run.id))?.approvals || []).find((a) => a.status === "pending") || null;
      } catch { /* the confirmation is still given, without the figures */ }
      if (!alive.current) return undefined;
      return settle({ tone: "emerald", text: readyText(run, approval), next: creditsText(run), runId: run.id });
    }
    if (status === "succeeded") {
      return settle({ tone: "emerald", text: run.summary || "Done.", next: [run.next_action, creditsText(run)].filter(Boolean).join(" "),
        runId: run.id, links: run.outcome?.links });
    }
    if (status === "cancelled") return settle({ tone: "slate", text: run.summary || "That task was cancelled.", runId: run.id });
    if (status === "failed") {
      if (run.retrying) return settle({ tone: "amber", text: run.error || run.summary || "That didn't go through. I'll have another go shortly.", runId: run.id });
      setWorking(false);
      setError("");
      setEmail("");
      setOpen({ kind: "problem", run });
      tell(null);
      return changed();
    }
    if (run.substatus === "waiting_for_external_event") {
      // Waiting on someone else (a customer's acceptance, a payment): nothing to watch second by second.
      return settle({ tone: "indigo", text: run.next_action || run.summary || "I've started that. I'll carry on as soon as there is news.", runId: run.id });
    }
    // Still running: say so in place and look again shortly.
    if (tries >= MAX_POLLS) return settle({ tone: "indigo", text: "Still working on it. The result will appear on the Agent card.", runId: run.id });
    setWorking(true);
    setDoing(workingText(run));
    tell({ tone: "indigo", text: workingText(run), working: true, runId: run.id });
    timer.current = setTimeout(async () => {
      let next = run;
      try { next = (await getRun(run.id))?.run || run; } catch { /* look again next time */ }
      follow(next, tries + 1);
    }, POLL_MS);
    return undefined;
  }

  /** A question already waiting (opened from its tile on the Agent card). */
  function openQuestion(question) {
    asked.current += 1;
    setError("");
    setOpen({ kind: "question", n: asked.current, run: { id: question.run_id, pending_question: question, step: question.step } });
  }

  /** Details needed before a task can start at all ("Which quotation should I invoice?"). */
  function ask({ title, message, fields, onSubmit }) {
    asked.current += 1;
    setError("");
    setOpen({ kind: "ask", n: asked.current, title, message, fields, onSubmit });
  }

  async function answer(values) {
    const run = open?.run;
    if (!run) return;
    setSending(true);
    setError("");
    try {
      setDoing(WORKING_TEXT);
      const res = await answerRun(run.id, values, true);      // carried on by the server; watched here step by step
      await follow(res?.run);
    } catch (e) {
      setError(agentErrorMessage(e, "That answer couldn't be saved. Please give it again."));
    } finally {
      setSending(false);
    }
  }

  async function saveEmail(e) {
    e.preventDefault();
    const run = open?.run;
    if (!run) return;
    setSending(true);
    setError("");
    try {
      const res = await fixCustomerEmail(run.id, email.trim());
      await follow(res?.run);
    } catch (err) {
      setError(agentErrorMessage(err, "That address couldn't be saved. Please check it and save again."));
    } finally {
      setSending(false);
    }
  }

  function close() {
    clearTimeout(timer.current);
    const was = open;
    setWorking(false);
    setLeaving(false);
    setOpen(null);
    // Closing a question leaves the task waiting: it stays as a tile on the Agent card.
    if (was?.kind === "question" && was.fromBox) {
      tell({ tone: "amber", text: "I've kept that waiting for your answer. It's on the Agent card whenever you're ready.", runId: was.run.id });
    }
    if (was?.kind !== "ask") changed();
  }

  const details = (runId) => { close(); out.current.onDetails?.(runId); };

  /** "Discard this request": the task is cancelled, so it leaves Needs You for History. */
  async function discard() {
    const run = open?.run;
    if (!run) return;
    setSending(true);
    setError("");
    try {
      await cancelRun(run.id);
      clearTimeout(timer.current);
      setWorking(false);
      setLeaving(false);
      setOpen(null);
      if (open.fromBox) tell({ tone: "slate", text: "Discarded. Nothing was sent." });
      changed();
    } catch (e) {
      setError(agentErrorMessage(e, "That couldn't be discarded just now. Please try again."));
    } finally {
      setSending(false);
    }
  }
  const seeDetails = (runId) => (
    <button type="button" onClick={() => details(runId)} className="text-[13px] font-semibold text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">See details</button>
  );

  let element = null;
  if (open?.kind === "question") {
    const q = open.run.pending_question || {};
    const fields = q.fields || [];
    const confirm = fields.some((f) => f.confirm);
    const several = fields.length > 1;      // a form, even when most of it only applies after the first choice
    const step = open.run.step;
    element = (
      <Modal compact title={confirm ? "Is this right?" : several ? "The Agent needs a few details" : "The Agent needs one thing from you"} onClose={close}>
        <div>
          {step?.total > 1 && <p className="-mt-2 mb-3 text-[12px] font-semibold uppercase tracking-wide text-slate-400" data-step>Step {step.index} of {step.total}</p>}
          {leaving && (
            // Cancel asks what should happen to the request: nothing is thrown away, or left hanging in Needs You, by accident.
            <div role="group" aria-label="What should happen to this request?" data-leaving className="space-y-3">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">What should happen to this request?</p>
              <button type="button" onClick={close} className="block w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-left hover:border-brand-300 dark:border-slate-700">
                <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">Keep for later</span>
                <span className="block text-[12px] text-slate-500">It stays in Needs You with what you've entered so far.</span>
              </button>
              <button type="button" disabled={sending} onClick={discard} className="block w-full rounded-xl border border-rose-200 px-3.5 py-2.5 text-left hover:border-rose-400 disabled:opacity-60 dark:border-rose-900">
                <span className="block text-sm font-semibold text-rose-700 dark:text-rose-300">{sending ? "Discarding…" : "Discard this request"}</span>
                <span className="block text-[12px] text-slate-500">Cancels it. Nothing has been sent, and it won't sit in Needs You.</span>
              </button>
              {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
              <div className="flex justify-end"><button type="button" onClick={() => setLeaving(false)} className="text-[13px] font-semibold text-brand-600 hover:underline">Back to the form</button></div>
            </div>
          )}
          <div className={leaving ? "hidden" : undefined}>
          <QuestionForm key={`${open.run.id}:${open.n}`} question={q.question} fields={fields} submitting={sending || working}
            submitLabel={confirm ? "Confirm" : "Continue"} onCancel={() => setLeaving(true)} onSubmit={answer}
            note={error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
              : (sending || working) ? <p role="status" data-working className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[13px] text-indigo-900">{doing || WORKING_TEXT}</p> : null}
            aside={open.fromBox ? seeDetails(open.run.id) : null} />
          </div>
        </div>
      </Modal>
    );
  } else if (open?.kind === "ask") {
    element = (
      <Modal title={open.title || "A little more detail"} onClose={close}>
        <QuestionForm key={`ask:${open.n}`} question={open.message} fields={open.fields} submitting={sending} onCancel={close}
          onSubmit={(values) => { const go = open.onSubmit; setOpen(null); go?.(values); }} />
      </Modal>
    );
  } else if (open?.kind === "problem") {
    const run = open.run;
    const need = run.email_needed;
    element = (
      <Modal compact title={need ? `${need.customer} has no email on record${need.reference ? ` for ${need.reference}` : ""}` : "This needs you"} onClose={close}>
        <p className="text-sm text-slate-700 dark:text-slate-200">{run.error || run.summary || run.next_action || "This task stopped and needs a look."}</p>
        {need ? (
          <form onSubmit={saveEmail} className="mt-4 space-y-3">
            <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300">
              Email address for {need.customer}
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            </label>
            {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto">{seeDetails(run.id)}</span>
              <button type="button" onClick={close} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">Not now</button>
              <button type="submit" disabled={sending || working} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {sending || working ? "Working…" : "Save and carry on"}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto">{seeDetails(run.id)}</span>
            <button type="button" onClick={close} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Close</button>
          </div>
        )}
      </Modal>
    );
  }

  /** A task named only by its id (a button elsewhere on the page): load it, then handle it here. */
  async function followId(runId) {
    tell({ tone: "indigo", text: WORKING_TEXT, working: true, runId });
    try {
      await follow((await getRun(runId))?.run);
    } catch (e) {
      tell({ tone: "rose", text: agentErrorMessage(e, "That task couldn't be opened. Please try again."), runId });
    }
  }

  return { follow, followId, openQuestion, ask, element, busy: sending || working };
}
