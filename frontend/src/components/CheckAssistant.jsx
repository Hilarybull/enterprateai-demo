import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { agentErrorMessage, getChat, replyText, saveChat, submitAgentRequest } from "../lib/agent";

// A free check as a conversation on its own page (the owner, 30 Oct: the landing page's shortcuts "should be in a chat",
// as the idea, launch and funding ones are): its result in the chat, and every reply ending on its next step and button.
const BOX = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const YES = /^\s*(?:start|yes|yeah|yep|ok(?:ay)?|sure|go ahead|go on|do it|proceed|please do|confirm)\b/i;
const OPENING = { customers: "How do I get more customers?", risks: "What are the risks in my business?", pricing: "Help me price my product or service" };

function ResultCard({ result }) {
  const r = result || {};
  const score = typeof r.score === "number" ? `${Math.round(r.score)}/100` : r.score_label || r.score;
  return (
    <div className={`${BOX} p-5`} data-card="check_result">
      <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">{r.headline || "Your result"}</p>
      {score && <p className="mt-1 text-[14px] font-semibold text-brand-700 dark:text-brand-300">{String(score)}{r.classification ? ` · ${r.classification}` : ""}</p>}
      {(r.metrics || []).length > 0 && (
        <dl className="mt-3 grid gap-2 sm:grid-cols-3">{r.metrics.slice(0, 6).map((m) => (
          <div key={m.label} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60"><dt className="text-[12px] text-slate-500">{m.label}</dt><dd className="text-[14px] font-semibold text-slate-900 dark:text-slate-50">{m.value}</dd></div>
        ))}</dl>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(r.strengths || []).length > 0 && <div><p className="text-[13px] font-bold text-emerald-700">What's working</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[13.5px] text-slate-700 dark:text-slate-200">{r.strengths.map((s) => <li key={s}>{s}</li>)}</ul></div>}
        {(r.missing || []).length > 0 && <div><p className="text-[13px] font-bold text-rose-700">What's missing</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[13.5px] text-slate-700 dark:text-slate-200">{r.missing.map((s) => <li key={s}>{s}</li>)}</ul></div>}
      </div>
    </div>
  );
}

export default function CheckAssistant({ businessId, topic }) {
  const chatId = `check-${topic}`;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const confirming = useRef(null);      // a task whose price was just said, waiting for Start or Not now
  const keep = (next) => { setMessages(next); saveChat(businessId, chatId, next).catch(() => {}); };
  useEffect(() => {
    let live = true;
    getChat(businessId, chatId).then((c) => { if (live) setMessages(c?.messages || []); }).catch(() => { if (live) setMessages([]); });
    return () => { live = false; };
  }, [businessId, chatId]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [messages?.length, busy]);

  const send = async (said, before = messages) => {
    const t = String(said || "").trim();
    if (!t || busy) return;
    const list = [...(before || []), { role: "user", content: t, at: new Date().toISOString() }];
    keep(list);      // saved at once: a slow reply or a refresh never loses what was said (QA F4, 30 Oct)
    setText("");
    setBusy(true);
    try {
      // A price just said: Start, "go ahead" or "yes" starts it; anything else leaves it, nothing charged
      const priced = confirming.current;
      confirming.current = null;
      if (priced && !YES.test(t)) {
        keep([...list, { role: "assistant", content: "No problem, nothing was started or charged.", at: new Date().toISOString() }]);
        return;
      }
      const res = priced
        ? await submitAgentRequest({ businessId, capability: priced.capability, params: priced.params || {}, sourceChannel: "ui_action", background: true, confirmed: true })
        : await submitAgentRequest({ businessId, text: t, page: topic });
      if (res?.elsewhere) { navigate(`${res.elsewhere}${res.elsewhere.includes("?") ? "&" : "?"}message=${encodeURIComponent(t)}`); return; }
      const acts = res?.actions || [];
      const ask = res?.kind === "needs_confirmation" && res.capability;
      if (ask) confirming.current = res;
      keep([...list, { role: "assistant", content: replyText(res) || "Done.", at: new Date().toISOString(), cards: res?.cards || [],
        links: acts.filter((a) => a.to).map((a) => ({ label: a.label, to: a.to })),
        prompts: ask ? [{ label: "Start", prompt: "Start" }, { label: "Not now", prompt: "Not now" }] : acts.filter((a) => a.prompt).map((a) => ({ label: a.label, prompt: a.prompt })) }]);
    } catch (e) {
      keep([...list, { role: "assistant", content: agentErrorMessage(e, "That didn't go through. Nothing was changed; please try again."), at: new Date().toISOString() }]);
    } finally { setBusy(false); }
  };

  // Handed over from the landing page or a shortcut: that message starts the chat here, once; an empty chat opens on its
  // result, never a blank page
  const started = useRef(false);
  useEffect(() => {
    if (messages === null || started.current) return;
    started.current = true;
    const said = params.get("message");
    if (said) {
      const p = new URLSearchParams(params);
      p.delete("message");
      setParams(p, { replace: true });
      send(said, []);
    } else if (!messages.length) keep([{ role: "assistant", content: `I'm here to help with ${topic === "customers" ? "winning more customers" : topic === "risks" ? "your business risks" : "pricing"}. What would you like to know?`, at: new Date().toISOString() }]);
  }, [messages]);      // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-label="Conversation" className={`${BOX} flex h-full min-h-[28rem] flex-col`} data-check-assistant={topic}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {messages === null && <p className="text-[13px] text-slate-500" role="status">Loading your conversation…</p>}
        {(messages || []).map((m, i) => (m.role === "user" ? (
          <div key={i} className="flex justify-end"><p className="max-w-[80%] rounded-2xl bg-brand-50 px-4 py-3 text-[15px] text-slate-800 dark:bg-brand-950/40 dark:text-slate-100">{m.content}</p></div>
        ) : (
          <div key={i} className="space-y-3">
            <p className="max-w-[90%] whitespace-pre-line rounded-2xl bg-slate-100 px-4 py-3 text-[15px] text-slate-800 dark:bg-slate-800 dark:text-slate-100">{m.content}</p>
            {(m.cards || []).filter((c) => c.type === "check_result").map((c, j) => <ResultCard key={j} result={c.result} />)}
            {((m.links || []).length > 0 || (m.prompts || []).length > 0) && (
              <div className="flex flex-wrap gap-2">
                {(m.links || []).map((l) => <button key={l.label + l.to} type="button" onClick={() => navigate(l.to)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700">{l.label}</button>)}
                {(m.prompts || []).map((p) => <button key={p.label} type="button" disabled={busy} onClick={() => send(p.prompt)} className="rounded-lg border border-brand-600 px-3 py-1.5 text-[13px] font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-60">{p.label}</button>)}
              </div>
            )}
          </div>
        )))}
        {busy && <p className="flex items-center gap-2 text-[13px] text-slate-500" role="status"><span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-brand-500 border-r-transparent motion-safe:animate-spin" />Thinking…</p>}
        <div ref={end} />
      </div>
      <form className="border-t border-slate-200 p-3 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700">
          <input aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask EnterprateAI anything…" className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
          <button type="submit" aria-label="Send" disabled={busy || !text.trim()} className="rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">Send</button>
        </div>
      </form>
    </section>
  );
}
