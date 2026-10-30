// What the chat's buttons do, inside the conversation (the owner, 27 Oct: "the action buttons should make the agent do the
// work and show the result in the chat, not send the user to another page"). Shared by the Agent Centre's chat and the
// funding, launch and idea Assistants. Only "Open full …" and "View full simulation" leave the chat; anything that sends,
// saves or shares still waits for the owner's approval.
import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client";
import { agentErrorMessage, approveAction, approveWithoutSending, rejectAction } from "../../lib/agent";
import { markdownToHtml } from "../DocumentEditor";
import { premiumFlow } from "../ResearchReview";
import { toast } from "../../lib/toast";

const BOX = "rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";
const BTN = "rounded-lg border border-slate-200 px-3.5 py-1.5 text-[13.5px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200";
const PRIMARY = "rounded-lg bg-blue-600 px-3.5 py-1.5 text-[13.5px] font-medium text-white hover:bg-blue-700 disabled:opacity-60";
const at = () => new Date().toISOString();
/** What a card's button did, once, at the bottom of the screen: "Business plan: Land Clearing approved", Undo where it can be. */
export const said = (title, undo = null) => toast({ kind: "success", title, ...(undo ? { actions: [{ label: "Undo", onClick: undo }] } : {}) });
/** Said while a scenario is still running: the result follows in the same chat. */
export const SLOW = () => ({ role: "assistant", at: at(), content: "This one is taking a little longer. I'm still running it on your figures and I'll post the result here as soon as it's done." });

/** The calls, said in the conversation: each returns the assistant message to put in it. */
export function chatActions(businessId) {
  return {
    // Usually answered at once; one still running after the first wait is asked after until it is done, with the owner
    // told it is working (the owner, 27 Oct: "if it really needs longer, show progress and post the result when it's done").
    async scenario(kind, { onWaiting } = {}) {
      try {
        let r = await apiRequest(`/businesses/${businessId}/agent/chat/scenario`, "POST", { kind }, { timeoutMs: 45000 });
        if (r.pending) onWaiting?.();
        for (let i = 0; r.pending && i < 100; i += 1) {
          await new Promise((ok) => setTimeout(ok, 3000));
          r = await apiRequest(`/businesses/${businessId}/agent/chat/scenario/${r.job_id}`, "GET", undefined, { timeoutMs: 15000 });
        }
        if (r.pending) return { role: "assistant", at: at(), content: "That scenario is still running. Ask me again in a few minutes and I'll show you the result." };
        return { role: "assistant", at: at(), content: r.summary, cards: r.rows ? [{ type: "scenario", ...r }] : [], links: r.rows ? [{ label: "View full simulation", to: "/simulation" }] : [] };
      } catch (e) { return { role: "assistant", at: at(), content: agentErrorMessage(e, "I couldn't run that just now. Nothing was saved or charged.") }; }
    },
    // Put away until the day picked, or back now ("undo"): said in a toast, never in the chat (the owner, 27 Oct)
    async postpone(key, when) {
      const r = await apiRequest(`/businesses/${businessId}/agent/chat/postpone`, "POST", { key, when });
      return { until: r.until, day: r.until ? new Date(r.until).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : null };
    },
    async attach(file) {
      const form = new FormData();
      form.append("file", file);
      try {
        const r = await apiRequest(`/businesses/${businessId}/agent/chat/attach`, "POST", form, { timeoutMs: 120000 });
        return { role: "assistant", at: at(), content: r.message };
      } catch (e) { return { role: "assistant", at: at(), content: agentErrorMessage(e, "That file couldn't be attached. Nothing was saved.") }; }
    },
    async revise(item, instruction) {
      try {
        const r = await apiRequest(`/businesses/${businessId}/agent/chat/revise`, "POST", { instruction, ...(item.approval_id ? { run_id: item.run_id } : { draft_id: item.draft_id }) }, { timeoutMs: 120000 });
        return { role: "assistant", at: at(), content: r.message, cards: r.ok ? [{ type: "preview", item, preview: r.preview }] : [] };
      } catch (e) { return { role: "assistant", at: at(), content: agentErrorMessage(e, "I couldn't change that just now. Nothing was changed.") }; }
    },
    preview: (item) => apiRequest(`/businesses/${businessId}/agent/chat/preview?${item.approval_id ? `run_id=${item.run_id}` : `draft_id=${item.draft_id}`}`, "GET"),
  };
}

/** A scenario's result: before and after, in one table, with what it means. */
export function ScenarioCard({ card }) {
  return (
    <div className={`${BOX} p-4 sm:p-5`} data-card="scenario">
      <p className="text-[17px] font-bold text-slate-900 dark:text-slate-50">{card.title}</p>
      <p className="text-[13.5px] text-slate-500">Run on your own figures, over {card.months} months. Nothing was saved to your records.</p>
      <table className="mt-3 w-full text-[13.5px]">
        <thead><tr className="text-left text-[12px] text-slate-500"><th className="py-1.5 font-medium" /><th className="py-1.5 font-medium">As things are</th><th className="py-1.5 font-medium">In this scenario</th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{card.rows.map((r) => (
          <tr key={r.label}><td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{r.label}</td><td className="py-2 pr-3 tabular-nums text-slate-900 dark:text-slate-100">{r.before}</td>
            <td className={`py-2 font-semibold tabular-nums ${card.worse ? "text-rose-600" : "text-emerald-600"}`}>{r.after}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** A waiting item, read in the chat: Approve, Edit (typed in the chat) and Reject; only "Open full document" leaves. */
export function PreviewCard({ businessId, item, preview: given, onEdit, onDone, go, onConvert = null }) {
  const [state, setState] = useState("");
  const [problem, setProblem] = useState("");
  // A preview reopened from a saved conversation keeps only which draft it was: shown again when asked
  const [preview, setPreview] = useState(given);
  const [opening, setOpening] = useState(false);
  const again = async () => {
    setOpening(true);
    try { setPreview(await chatActions(businessId).preview(item)); } catch { setPreview({ found: false }); } finally { setOpening(false); }
  };
  // A draft just made opens by itself, to read and decide in the chat (the owner, 28 Oct); one reopened from history waits to be asked
  useEffect(() => { if (!given && item?.open) again(); }, []);      // eslint-disable-line react-hooks/exhaustive-deps
  if (!preview && item) {
    return (
      <div className={`${BOX} flex items-center justify-between gap-3 p-4`} data-card="preview">
        <p className="min-w-0 truncate text-[15px] font-semibold text-slate-900 dark:text-slate-50">{item.title || "The draft"}</p>
        <button type="button" className={BTN} onClick={again} disabled={opening}>{opening ? "Opening…" : "Show it again"}</button>
      </div>
    );
  }
  const p = preview || {};
  const money = (n) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency || "GBP", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(Number(n) || 0); } catch { return String(n); } };
  const draftId = item.draft_id;
  const decide = async (yes, keepOnly = false) => {
    setProblem("");
    setState(yes ? (keepOnly ? "keeping" : "approving") : "rejecting");
    try {
      const approvalId = item.approval_id || p.approval_id;
      if (approvalId) await (yes ? (keepOnly ? approveWithoutSending(item.run_id, approvalId) : approveAction(item.run_id, approvalId)) : rejectAction(item.run_id, approvalId));
      else await apiRequest(`/businesses/${businessId}/agent-drafts/${draftId}/decide`, "POST", { decision: yes ? "accept" : "reject" });
      setState(yes ? "approved" : "rejected");
      const name = item.title || p.title || "It";
      onDone?.(yes ? `${name} ${keepOnly ? "approved. Nothing was sent yet" : approvalId ? "approved and sent" : "approved"}` : `${name} rejected. Nothing was sent`);
    } catch (e) { setState(""); setProblem(agentErrorMessage(e, "That couldn't be done just now. Nothing was sent or changed.")); }
  };
  return (
    <div className={`${BOX} p-4 sm:p-5`} data-card="preview">
      <p className="text-[17px] font-bold text-slate-900 dark:text-slate-50">{p.title || item.title}</p>
      {p.customer && <p className="text-[13.5px] text-slate-500">For {p.customer}{p.to_email ? ` · ${p.to_email}` : ""}</p>}
      {(p.lines || []).length > 0 && (
        <table className="mt-3 w-full text-[13.5px]"><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{p.lines.map((l, i) => (
          <tr key={i}><td className="py-1.5 text-slate-800 dark:text-slate-100">{l.name}</td><td className="py-1.5 text-right tabular-nums text-slate-500">{l.quantity ?? ""}{l.quantity ? " × " : ""}{l.unit_price != null ? money(l.unit_price) : ""}</td></tr>
        ))}</tbody></table>
      )}
      {p.total != null && <p className="mt-2 text-right text-[15px] font-semibold text-slate-900 dark:text-slate-50">Total {money(p.total)}</p>}
      {(p.due_date || p.valid_until) && <p className="mt-1 text-right text-[13px] text-slate-500">{p.due_date ? `Due ${p.due_date}` : `Valid until ${p.valid_until}`}</p>}
      {/* What the customer will get, read before anything is sent (the owner, 29 Oct: "Approve & send shows the email preview first") */}
      {p.message && (
        <div className="mt-3" data-email-preview>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">Email preview{p.to_email ? ` · to ${p.to_email}` : ""}</p>
          <p className="mt-1 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[13.5px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">{p.message}</p>
        </div>
      )}
      {p.text && (
        // The document as it reads on its own page (the owner, 27 Oct: "shows raw HTML and markdown"): the same converter
        <div className="ea-doc ea-doc-inline mt-3 max-h-80 overflow-y-auto rounded-xl bg-slate-50 p-4 text-slate-700 dark:bg-slate-800 dark:text-slate-200" data-preview-text
          dangerouslySetInnerHTML={{ __html: markdownToHtml(p.text) }} />
      )}
      {!p.found && preview && <p className="mt-2 text-[13.5px] text-slate-500">This isn't waiting any more.</p>}
      {state === "approved" || state === "rejected" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-[13.5px] font-semibold text-emerald-700">{state === "approved" ? "Done." : "Rejected."}</p>
          {state === "approved" && onConvert && /quot/i.test(`${p.kind || ""} ${p.title || item.title || ""}`) && (
            <button type="button" className={BTN} onClick={() => onConvert(p.title || item.title)} data-convert>Convert to invoice</button>
          )}
        </div>
      ) : p.found !== false && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(p.message || p.to_email) && (item.approval_id || p.approval_id) && (
            <button type="button" className={BTN} disabled={Boolean(state)} onClick={() => decide(true, true)} data-approve-only>{state === "keeping" ? "Working…" : "Approve"}</button>
          )}
          <button type="button" className={PRIMARY} disabled={Boolean(state)} onClick={() => decide(true)} data-approve>{state === "approving" ? "Working…" : p.message || p.to_email ? "Approve & send" : "Approve"}</button>
          {p.editable !== false && <button type="button" className={BTN} onClick={() => onEdit?.(item)}>Edit</button>}
          <button type="button" className={BTN} disabled={Boolean(state)} onClick={() => decide(false)}>{state === "rejecting" ? "Working…" : "Reject"}</button>
          {(item.to || p.to) && <button type="button" onClick={() => go(item.to || p.to)} className="ml-auto text-[13.5px] font-medium text-blue-600 hover:underline">Open full page →</button>}
        </div>
      )}
      {problem && <p role="alert" className="mt-2 text-[13px] font-semibold text-rose-600">{problem}</p>}
      <p className="mt-3 text-[12px] text-slate-500">Nothing is sent, saved or shared without your approval.</p>
    </div>
  );
}

/** "Remind me when?": Tomorrow or Next week, saved, so the item stays away until then. */
export function PostponeChoice({ onPick, onClose }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800" data-postpone-choice>
      <span className="text-[13.5px] text-slate-700 dark:text-slate-200">Remind me when?</span>
      <button type="button" className={BTN} onClick={() => onPick("tomorrow")}>Tomorrow</button>
      <button type="button" className={BTN} onClick={() => onPick("next_week")}>Next week</button>
      <button type="button" onClick={onClose} className="text-[13px] text-slate-500 hover:underline">Cancel</button>
    </div>
  );
}

/** New customer segments, researched for the business: its price first, then the findings in the chat to adopt or change. */
export function SegmentsCard({ businessId, onDone, onChanges }) {
  const [step, setStep] = useState({ at: "idle" });
  const flow = premiumFlow({ base: `/businesses/${businessId}/quick-check/more_customers/premium`, body: { answers: {} }, businessId,
    onError: (m) => setStep({ at: "problem", message: m }), onAdopted: () => onDone?.("Adopted. The segments are on your customer plan.") });
  const quote = async () => {
    setStep({ at: "quoting" });
    const got = await flow();
    if (got?.gate) setStep({ at: "problem", message: got.gate.message || "That isn't included in your plan yet." });
    else if (got?.confirm) setStep({ at: "confirm", got });
    else if (got?.render) setStep({ at: "done", render: got.render });
  };
  const start = async () => {
    setStep((s) => ({ ...s, at: "running" }));
    const out = await step.got.start();
    if (out?.render) setStep({ at: "done", render: out.render });
    else if (out?.gate) setStep({ at: "problem", message: out.gate.message || "That couldn't be started. Nothing was charged." });
  };
  const price = step.got?.confirm?.max || step.got?.confirm?.cost;
  return (
    <div className={`${BOX} p-4 sm:p-5`} data-card="segments">
      <p className="text-[17px] font-bold text-slate-900 dark:text-slate-50">New customer segments</p>
      <p className="text-[13.5px] text-slate-500">I'll research who else would buy from you, from your records and the market, and show you what I find.</p>
      {step.at === "idle" && <button type="button" className={`${PRIMARY} mt-3`} onClick={quote}>See what it costs</button>}
      {step.at === "quoting" && <p className="mt-3 text-[13.5px] text-slate-500">Getting the price…</p>}
      {step.at === "confirm" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] text-slate-700 dark:text-slate-200">{price ? `Up to ${price} credits, and you only pay for what I find.` : "This one is free."}</span>
          <button type="button" className={PRIMARY} onClick={start}>Start{price ? ` · up to ${price} credits` : ""}</button>
          <button type="button" className={BTN} onClick={() => setStep({ at: "idle" })}>Not now</button>
        </div>
      )}
      {step.at === "running" && <p className="mt-3 text-[13.5px] text-slate-500">Researching… this takes a minute or two.</p>}
      {step.at === "done" && (
        <div className="mt-3 space-y-3">{step.render}
          <button type="button" className={BTN} onClick={() => onChanges?.()}>Request changes</button></div>
      )}
      {step.at === "problem" && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-rose-600">{step.message}</p>}
    </div>
  );
}
