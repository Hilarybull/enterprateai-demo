import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentAvatar } from "./AgentShell";
import { agentErrorMessage, caseChatPath, offerFor, submitAgentRequest, toSidePanel } from "../../lib/agent";
import { useAuthStore } from "../../store/auth";
import { useTaskFlow } from "./TaskFlow";
import { AgentGoalChat } from "../GoalLauncher";

// The Agent Centre's slim bar (the owner's QA, 15 Oct): the avatar, a greeting, the input and Online, about 72px tall. The
// lists below are the page; the full Agent card stays on the dashboard. Whatever the Agent answers is acted on here, as in
// the Agent card (the owner's QA, 21 Oct: "this chat is not agentic"): a check opens under the bar, a paid task shows its
// price with Start or Not now, a question is asked, an offered action is a button. Never only a sentence.
export default function AgentBar({ businessId, onChanged, onOpenRun }) {
  const name = useAuthStore((s) => s.name) || "";
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(null);      // { text, check?, offers? }
  const [said, setSaid] = useState("");      // the owner's own words, shown above the answer
  const flow = useTaskFlow({ say: (r) => setReply(r ? { text: r.text, offers: r.offers } : null), onChanged: () => onChanged?.(), onDetails: (id, to) => onOpenRun?.(id, to) });

  async function ask(req) {
    if (!businessId || busy) return;
    if (req?.sourceChannel === "text" && req.text) setSaid(req.text);
    setBusy(true);
    setReply(null);
    try {
      const res = await submitAgentRequest({ businessId, background: true, ...req });
      handle(res, req);
    } catch (err) {
      setReply({ text: agentErrorMessage(err, "That didn't go through. Try again.") });
    } finally { setBusy(false); }
  }

  function handle(res, req) {
    if (res?.run?.id) { onChanged?.(); onOpenRun?.(res.run.id); return; }
    if (res?.kind === "check") { setReply({ text: "", check: { goalKey: res.goal_key, said: res.said || req?.text || "", at: Date.now() } }); return; }
    if (res?.kind === "needs_confirmation" && res.price) {
      // Its price first: Start, or Not now (the owner's rule: nothing paid starts from one press).
      setReply({ text: res.message, offers: [{ label: "Not now", dismiss: true }, { label: "Start", start: { capability: res.capability, params: res.params } }] });
      return;
    }
    if (res?.kind === "needs_input") {
      flow.ask({ title: res.title, message: res.message, fields: res.fields,
        onSubmit: (answers) => ask({ ...(req || {}), capability: res.capability, text: null, params: { ...((req || {}).params || {}), ...(res.params || {}), ...answers }, sourceChannel: "ui_action" }) });
      return;
    }
    setReply({ text: res?.message || "Done.", offers: [...(res?.actions || []), ...(res?.offers || [])] });
  }

  const send = async (e) => {
    e.preventDefault();
    const said = text.trim();
    if (!said) return;
    setText("");
    // Typed at the buttons ("yes, go ahead", "open it"): that button, as a click would (the owner, 27 Oct)
    const chosen = reply?.offers && offerFor(said, reply.offers);
    if (chosen) { press(chosen); return; }
    const there = await caseChatPath(businessId, said);      // funding or a launch: its case's Assistant tab (27 Oct)
    if (there) { setReply(null); navigate(there); return; }
    if (toSidePanel(said)) { setReply(null); return; }      // the conversation, by the side (27 Oct)
    // Answered here, in the Agent Centre (the owner's brief, 25 Oct: a result shows where the question was asked), by the
    // same request and the same chat as the dashboard's Agent card
    setReply(null);
    ask({ text: said, sourceChannel: "text" });
  };
  const press = (o) => {
    if (o.dismiss) return setReply(null);
    if (o.start) return ask({ ...o.start, sourceChannel: "ui_action", confirmed: true });
    if (o.kind === "explain" && o.prompt) return ask({ text: o.prompt });
    if (o.to) return navigate(o.to);
    if (o.capability) return ask({ capability: o.capability, params: o.params, sourceChannel: "ui_action" });
    return undefined;
  };
  const first = String(name).split(" ")[0];
  return (
    <section aria-label="EnterprateAI Agent" className="rounded-2xl bg-gradient-to-r from-brand-700 to-indigo-700 px-4 py-3 text-white shadow-sm" data-agent-bar>
      <form onSubmit={send} className="flex flex-wrap items-center gap-3">
        <AgentAvatar size={32} working={busy} />
        <p className="shrink-0 text-sm font-semibold">{first ? `Hi ${first}` : "Hi"}</p>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask EnterprateAI…" aria-label="Ask EnterprateAI"
          className="order-last min-w-0 basis-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-white/40 sm:order-none sm:basis-auto sm:flex-1" />
        {/* On a phone the box has its own row under the greeting (the owner's test, 27 Oct: it was squeezed between them) */}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-emerald-300 sm:ml-0"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-400" />Online</span>
      </form>
      {busy && !reply && <p role="status" className="mt-2 text-[13px] text-white/85">Working on it…</p>}
      {reply && (
        <div role="status" className="mt-2" data-agent-bar-reply>
          {(said || reply.check?.said) && <p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-white/15 px-3 py-1.5 text-[13px] font-medium text-white" data-you-asked>{reply.check?.said || said}</p>}
          {reply.text && <p className="mt-2 whitespace-pre-wrap text-[13px] text-white/85">{reply.text}</p>}
          {reply.check && businessId && (
            // The check itself, here (the reply said "answer anything I still need below")
            <div className="mt-3 rounded-xl bg-white p-3 text-left text-slate-800 dark:bg-slate-900 dark:text-slate-100" data-agent-check={reply.check.goalKey}>
              <AgentGoalChat key={`${reply.check.goalKey}:${reply.check.at}`} text={reply.check.said} />
            </div>
          )}
          {reply.offers?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {reply.offers.map((o, i) => (
                // "Not now" first and focused on a price (never a paid start from one press)
                <button key={o.label} type="button" disabled={busy} autoFocus={i === 0 && Boolean(o.dismiss)} onClick={() => press(o)} data-agent-bar-offer
                  className={o.start ? "rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-brand-700 hover:bg-white/90 disabled:opacity-60"
                    : "rounded-lg border border-white/40 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-white/10 disabled:opacity-60"}>{o.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {flow.element}
    </section>
  );
}
