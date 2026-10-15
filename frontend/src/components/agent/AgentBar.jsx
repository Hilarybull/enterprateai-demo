import { useState } from "react";
import { AgentAvatar } from "./AgentShell";
import { agentErrorMessage, submitAgentRequest } from "../../lib/agent";
import { useAuthStore } from "../../store/auth";

// The Agent Centre's slim bar (the owner's QA, 15 Oct): the avatar, a greeting, the input and Online, about 72px tall. The
// lists below are the page; the full Agent card stays on the dashboard.
export default function AgentBar({ businessId, onChanged, onOpenRun }) {
  const name = useAuthStore((s) => s.name) || "";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const send = async (e) => {
    e.preventDefault();
    const said = text.trim();
    if (!said || busy) return;
    setBusy(true);
    setReply("");
    try {
      const res = await submitAgentRequest({ businessId, text: said, background: true });
      setText("");
      if (res?.run?.id) { onChanged?.(); onOpenRun?.(res.run.id); }
      else setReply(res?.message || "Done.");
    } catch (err) {
      setReply(agentErrorMessage(err, "That didn't go through. Try again."));
    } finally { setBusy(false); }
  };
  const first = String(name).split(" ")[0];
  return (
    <section aria-label="EnterprateAI Agent" className="rounded-2xl bg-gradient-to-r from-brand-700 to-indigo-700 px-4 py-3 text-white shadow-sm" data-agent-bar>
      <form onSubmit={send} className="flex flex-wrap items-center gap-3">
        <AgentAvatar size={32} working={busy} />
        <p className="shrink-0 text-sm font-semibold">{first ? `Hi ${first}` : "Hi"}</p>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask EnterprateAI…" aria-label="Ask EnterprateAI"
          className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-white/40" />
        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-emerald-300"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-400" />Online</span>
      </form>
      {reply && <p role="status" className="mt-2 text-[13px] text-white/85">{reply}</p>}
    </section>
  );
}
