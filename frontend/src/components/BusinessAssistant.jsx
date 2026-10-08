import { useAuthStore } from "../store/auth";
import { firstNameOf, getGreeting } from "../lib/greeting";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Button from "./Button";
import { apiRequestCached } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import { agentErrorMessage, clearConversation, getConversation, replyText, saveAgentFact, submitAgentRequest } from "../lib/agent";
import { useTaskFlow } from "./agent/TaskFlow";

const STARTER_PROMPTS = [
  "What does my business do?",
  "What is my business registration status?",
  "Summarise my current services",
  "What do my latest simulations suggest?",
  "Who is my target market?",
  "What should I improve next?",
];

/** One reply from the Agent as a chat message: the result, links to what it made, and what needs the owner. */
function toMessage(routed, businessId) {
  const run = routed.run;
  const message = { role: "assistant", content: replyText(routed), link: null, links: null, prompts: null, remember: null };
  if (routed.kind === "workflow") {
    const many = (routed.runs || []).length > 1;
    message.link = many ? "/agent" : `/agent/runs/${run.id}`;
    if (!many) message.links = (run.outcome?.links || []).filter((l) => l.to).map((l) => ({ label: l.label, to: l.to }));
  } else if (routed.kind === "remember") {
    message.remember = routed.can_save ? { fact: routed.fact, businessId } : null;      // nothing is remembered until the owner says so
  } else if (routed.kind === "needs_input") {
    message.link = "/agent";
    message.content = `${routed.message} I need those details to carry on.`;
  } else if (routed.kind === "blocked" && routed.upgrade) {
    message.link = "/pricing";
  } else if (routed.kind === "answer") {
    message.links = (routed.actions || []).filter((a) => a.to).map((a) => ({ label: a.label, to: a.to }));
    message.prompts = (routed.actions || []).filter((a) => a.capability && !a.to).map((a) => ({ label: a.label, prompt: a.label }));
  } else if (routed.kind === "unavailable") {
    message.links = (routed.offers || []).filter((o) => o.to).map((o) => ({ label: o.label, to: o.to }));
    message.prompts = (routed.offers || []).filter((o) => o.kind === "explain").map((o) => ({ label: o.label, prompt: o.prompt }));
  }
  if (!message.content) message.content = "I couldn't find a clear answer just yet.";
  return message;
}

export default function BusinessAssistant() {
  // One name everywhere: the business name the sidebar and the Marketplace show.
  const workspaceName = useWorkspaceStore((state) => state.workspaceCompanyName || state.workspaceName);
  const [answerCost, setAnswerCost] = useState(null);      // credits per conversational answer, from the price list
  useEffect(() => {
    let alive = true;
    apiRequestCached("/credits/features")
      .then((res) => {
        const row = (res?.features || []).find((f) => f.feature_code === "chat_message");
        if (alive && row && row.enabled !== false) setAnswerCost(Number(row.credit_cost) || 0);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const person = firstNameOf(useAuthStore((st) => st.name));      // the person, by first name, as everywhere the Agent speaks to them
  const intro = `${getGreeting({ subject: person })}. Ask me anything about ${workspaceName || "your business"}. I'll answer from your workspace, documents, catalogue, financials, validations, registrations, and simulations.`;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  // The conversation so far in this business is picked up again (it is shared with the Agent box).
  const [messages, setMessages] = useState(() => [{ role: "assistant", content: intro }, ...getConversation(useWorkspaceStore.getState().workspaceId)]);
  const listRef = useRef(null);
  // A task started from the chat stays in the chat: its questions open in a dialog over the page,
  // and what happens next is said here as a message. Its own page opens only from "See details".
  const [working, setWorking] = useState(false);
  const flow = useTaskFlow({
    say: (reply) => {
      setWorking(Boolean(reply?.working));
      if (!reply || reply.working) return;
      setMessages((prev) => [...prev, { role: "assistant", content: [reply.text, reply.next].filter(Boolean).join(" "),
        link: reply.runId ? `/agent/runs/${reply.runId}` : null, links: (reply.links || []).filter((l) => l.to).map((l) => ({ label: l.label, to: l.to })) }]);
    },
    onChanged: () => window.dispatchEvent(new CustomEvent("ea:credits:refresh")),
    onDetails: (runId) => { window.location.assign(`/agent/runs/${runId}`); },
  });

  /** One reply from the Agent, put where it belongs: a message, a question in a dialog, or a task to watch. */
  function deliver(routed, businessId) {
    const parts = routed.kind === "multi" ? routed.results || [] : [routed];
    const single = parts.length === 1 ? parts[0] : null;
    const run = single?.kind === "workflow" && !((single.runs || []).length > 1) ? single.run : null;
    if (run && !["succeeded", "cancelled"].includes(run.status)) return flow.follow(run);
    if (single?.kind === "needs_input") {
      return flow.ask({ message: single.message, fields: single.fields, onSubmit: async (answers) => {
        setLoading(true);
        try {
          deliver(await submitAgentRequest({ businessId, capability: single.capability, params: { ...(single.params || {}), ...answers }, sourceChannel: "ui_action", background: true }), businessId);
        } catch (error) {
          setMessages((prev) => [...prev, { role: "assistant", content: agentErrorMessage(error, "I couldn't do that right now. Nothing was changed; please try again.") }]);
        } finally {
          setLoading(false);
        }
      } });
    }
    return setMessages((prev) => [...prev, ...parts.map((r) => toMessage(r, businessId))]);
  }

  const sendDisabled = !String(input || "").trim() || loading;
  const title = useMemo(() => workspaceName || "Business assistant", [workspaceName]);

  function resetConversation() {
    clearConversation(useWorkspaceStore.getState().workspaceId);      // a new conversation: nothing earlier is sent again
    setMessages([{ role: "assistant", content: intro }]);
    setInput("");
  }

  async function rememberFact(index, remember) {
    try {
      await saveAgentFact(remember.businessId, remember.fact);
      setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, remember: null, content: `Saved. I'll remember: “${remember.fact}”. You can remove it in Agent settings.` } : m)));
    } catch (e) {
      setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, remember: null, content: agentErrorMessage(e, "I couldn't save that. Please try again.") } : m)));
    }
  }

  async function send(prefilledQuestion = "") {
    const question = String(prefilledQuestion || input || "").trim();
    if (!question) return;

    const nextMessages = [...messages, { role: "user", content: question }];
    const trimmedMessages = nextMessages.slice(-20);
    setMessages(trimmedMessages);
    setInput("");
    setLoading(true);

    const agentBusinessId = useWorkspaceStore.getState().workspaceId;
    try {
      if (!agentBusinessId) {
        setMessages((prev) => [...prev, { role: "assistant", content: "It looks like you haven't set up a workspace yet. Create one first and I'll be able to help with your business." }]);
        return;
      }
      // One Agent: every message goes to the same place. It answers from the records, runs the
      // task, or writes the answer itself. There is no second chat behind this one.
      const routed = await submitAgentRequest({ businessId: agentBusinessId, text: question, sourceChannel: "text", background: true });
      deliver(routed, agentBusinessId);
      window.dispatchEvent(new CustomEvent("ea:credits:refresh"));      // tasks and written answers use credits
      requestAnimationFrame(() => {
        listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight, behavior: "smooth" });
      });
    } catch (error) {
      setMessages((prev) => [...prev, { role: "assistant", content: agentErrorMessage(error, "I couldn't do that right now. Nothing was changed; please try again.") }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {open ? (
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+4.75rem)] z-40 flex h-[min(720px,calc(100vh-6rem))] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950 sm:inset-x-auto sm:bottom-20 sm:right-4 sm:w-[420px] lg:bottom-4 lg:w-[440px]">
          <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-brand-50 via-white to-accent-50 px-4 py-3 dark:border-slate-800 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetConversation}
                className="rounded-xl p-2 text-slate-500 hover:bg-white dark:hover:bg-slate-900"
                aria-label="New conversation"
                title="New conversation"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 1 0 3-6.7" />
                  <path d="M3 4v5h5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl p-2 text-slate-500 hover:bg-white dark:hover:bg-slate-900"
                aria-label="Close assistant"
                title="Close assistant"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m18 6-12 12" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>

          {messages.length <= 1 ? (
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Try asking</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div ref={listRef} className="flex-1 space-y-3 overflow-auto px-4 py-4">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={
                  "max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm " +
                  (message.role === "user"
                    ? "ml-auto bg-brand-600 text-white"
                    : "border border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100")
                }
              >
                {message.content}
                {message.link && (
                  <a href={message.link} className="mt-1.5 block font-semibold underline">
                    {message.link === "/pricing" ? "See plans" : message.link === "/agent" ? "Open Agent Centre" : "See details"}
                  </a>
                )}
                {message.remember && (
                  <div className="mt-2 flex flex-wrap gap-2 whitespace-normal">
                    <button type="button" onClick={() => rememberFact(index, message.remember)}
                      className="rounded-lg bg-brand-600 px-2.5 py-1 text-[13px] font-semibold text-white hover:bg-brand-700">Save</button>
                    <button type="button" onClick={() => setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, remember: null, content: "Not saved." } : m)))}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">Don't save</button>
                  </div>
                )}
                {(message.links?.length > 0 || message.prompts?.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-2 whitespace-normal">
                    {(message.prompts || []).map((p) => (
                      <button key={p.label} type="button" disabled={loading} onClick={() => send(p.prompt)}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                        {p.label}
                      </button>
                    ))}
                    {(message.links || []).map((l) => (
                      <a key={l.to} href={l.to} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                        {l.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading || working ? (
              <div className="max-w-[88%] rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                {working && !loading ? "Working on it…" : "Thinking..."}
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Ask about customers, revenue, simulations, registration, blueprints, or services..."
                className="min-h-[72px] flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-brand-200 focus:ring dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <Button onClick={() => void send()} disabled={sendDisabled}>
                Send
              </Button>
            </div>
            {answerCost > 0 && (
              <p className="mt-2 text-[12px] text-slate-500 dark:text-slate-400">
                A written answer uses {answerCost} AI Credit{answerCost === 1 ? "" : "s"}. Answers read straight from your records are free; Agent tasks are charged as they run.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {flow.element}

      {/* Rendered on <body> so no ancestor transform or overflow can ever break position: fixed.
          Always the viewport's bottom-right corner: 16px on mobile, 24px from 640px. */}
      {createPortal(
      <button
        type="button"
        aria-label="Ask about your business"
        onClick={() => setOpen(true)}
        className="group fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] right-4 z-30 flex items-center overflow-hidden rounded-full bg-brand-600 p-3 text-sm font-semibold text-white shadow-lg transition-colors duration-300 hover:bg-brand-700 sm:bottom-6 sm:right-6"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {/* The label only opens for a real pointer. On touch screens "hover" sticks after a tap, which
            left the button stretched across the page, over whatever sat beside it. */}
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 [@media(hover:hover)_and_(pointer:fine)]:group-hover:ml-2 [@media(hover:hover)_and_(pointer:fine)]:group-hover:max-w-[200px]">Ask about your business</span>
      </button>,
      document.body)}
    </>
  );
}
