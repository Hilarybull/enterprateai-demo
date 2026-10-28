import { useAuthStore } from "../store/auth";
import { firstNameOf, getGreeting } from "../lib/greeting";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { useWorkspaceStore } from "../store/workspace";
import { agentErrorMessage, approveAction, caseChatPath, clearConversation, getAgentSummary, getChat, listChats, newChatId, offerFor, replyText, saveAgentFact, saveChat, submitAgentRequest, continueConversation } from "../lib/agent";
import { apiRequest } from "../api/client";
import { PostponeChoice, PreviewCard, SLOW, ScenarioCard, SegmentsCard, chatActions, said as sayDone } from "./agent/ChatActions";
import { useTaskFlow } from "./agent/TaskFlow";
import { AgentGoalChat } from "./GoalLauncher";

// The mockup's four (the owner, 27 Oct): each goes to its own page's conversation, or is answered here
const STARTER_PROMPTS = ["I need funding", "Validate a new idea", "Am I ready to launch?", "Draft a quotation"];
// "What should I do next?": answered here, from the cases and checks on record (no model, no credits)
// The segments research asked for in words, as its button asks for it
export const SEGMENTS = /\b(?:find|explore|research|look for|show me)\b.{0,20}\b(?:new )?customer segments?\b/i;
const NEXT = /\b(?:what (?:should|do|can) i do next|what'?s next|where (?:does|do) (?:my )?(?:work|things) stand)\b/i;
const NUMBER = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const clock = (at) => { try { return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return ""; } };

// A finished task's draft waiting for review ("?review=<draft>" on its link): read and decided in the chat, never only a link
// to the task's page (the owner, 28 Oct: "it should show me the business plan here... view it full page on the blueprints")
function draftCards(links, title) {
  const out = [];
  for (const l of links || []) {
    let id = null;
    try { id = new URLSearchParams(String(l.to || "").split("?")[1] || "").get("review"); } catch { id = null; }
    if (id) out.push({ type: "preview", item: { draft_id: id, to: l.to, title: title || l.label, open: true } });
  }
  return out;
}

/** One reply from the Agent as a chat message: the result, links to what it made, and what needs the owner. */
function toMessage(routed, businessId) {
  const run = routed.run;
  const message = { role: "assistant", content: replyText(routed), link: null, links: null, prompts: null, remember: null };
  if (routed.kind === "workflow") {
    const many = (routed.runs || []).length > 1;
    message.link = many ? "/agent" : `/agent/runs/${run.id}`;
    if (!many) message.links = (run.outcome?.links || []).filter((l) => l.to).map((l) => ({ label: l.label, to: l.to }));
    const cards = many ? [] : draftCards(message.links, run.outcome?.plan?.title || run.title);
    if (cards.length) { message.cards = cards; message.link = null; message.links = []; }
  } else if (routed.kind === "remember") {
    message.remember = routed.can_save ? { fact: routed.fact, businessId } : null;      // nothing is remembered until the owner says so
  } else if (routed.kind === "needs_input") {
    message.link = "/agent";
    message.content = `${routed.message} I need those details to carry on.`;
  } else if (routed.kind === "blocked" && routed.upgrade) {
    message.link = "/pricing";
  } else if (routed.kind === "answer") {
    message.links = (routed.actions || []).filter((a) => a.to).map((a) => ({ label: a.label, to: a.to }));
    message.prompts = (routed.actions || []).filter((a) => (a.capability || a.kind === "explain") && !a.to).map((a) => ({ label: a.label, prompt: a.prompt || a.label }));
  } else if (routed.kind === "unavailable") {
    message.links = (routed.offers || []).filter((o) => o.to).map((o) => ({ label: o.label, to: o.to }));
    message.prompts = (routed.offers || []).filter((o) => o.kind === "explain").map((o) => ({ label: o.label, prompt: o.prompt }));
  }
  if (!message.content) message.content = "I couldn't find a clear answer just yet.";
  return message;
}

/** A module page's own thread (a funding case or launch plan, the idea): never the panel's to restore or write over. */
export const isModuleThread = (id) => /^case-/.test(String(id || "")) || String(id || "") === "idea-check";

export const hasOwnChat = (pathname, search = "") => /^\/(funding|launch)\/[^/]+\/?$/.test(pathname) || /^\/check\/idea\/?$/.test(pathname)
  || (/^\/launch\/?$/.test(pathname) && new URLSearchParams(search).get("tab") === "assistant");

/** The floating button, on every page but the Agent Centre and the pages with their own Assistant: it opens the Agent
 *  Centre, the one general chat (the owner, 27 Oct). A message handed over from anywhere ("ea:chat", "?chat=") goes there. */
export function AgentLauncher() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const here = /^\/agent\/?$/.test(pathname);
  useEffect(() => {
    const onChat = (e) => {
      if (here || !e?.detail?.text) return;
      e.detail.handled = true;
      navigate(`/agent?chat=${encodeURIComponent(String(e.detail.text).slice(0, 500))}`);
    };
    window.addEventListener("ea:chat", onChat);
    return () => window.removeEventListener("ea:chat", onChat);
  }, [here, navigate]);
  useEffect(() => {
    const p = new URLSearchParams(search);
    if (!here && p.get("chat") && p.get("tab") !== "assistant") navigate(`/agent?chat=${encodeURIComponent(p.get("chat"))}`, { replace: true });
  }, [here, search, navigate]);
  // On a phone it steps aside while the page is scrolled down, so it never sits on a card's button (the owner's QA, 27 Oct),
  // and is back on the way up, at the top and at the bottom (where the page keeps room for it)
  const [away, setAway] = useState(false);
  useEffect(() => {
    const area = document.querySelector('[data-tour="content-area"]');
    const target = area && area.scrollHeight > area.clientHeight ? area : window;
    let last = 0;
    const at = () => (target === window ? window.scrollY : area.scrollTop);
    const end = () => (target === window ? document.documentElement.scrollHeight - innerHeight : area.scrollHeight - area.clientHeight);
    const onScroll = () => {
      if (window.innerWidth >= 1024) { setAway(false); return; }
      const y = at();
      setAway(y > last + 4 && y > 40 && y < end() - 40 ? true : y < last - 4 || y <= 40 || y >= end() - 40 ? false : (v) => v);
      last = y;
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [pathname]);
  if (here || hasOwnChat(pathname, search)) return null;
  return createPortal(
    <button type="button" aria-label="Ask about your business" onClick={() => navigate("/agent")} data-agent-launcher aria-hidden={away || undefined} tabIndex={away ? -1 : undefined}
      className={`group fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] right-4 z-30 flex items-center overflow-hidden rounded-full bg-brand-600 p-3 text-sm font-semibold text-white shadow-lg transition-[colors,transform,opacity] duration-300 hover:bg-brand-700 sm:bottom-6 sm:right-6 ${away ? "pointer-events-none translate-y-24 opacity-0" : ""}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
      <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 [@media(hover:hover)_and_(pointer:fine)]:group-hover:ml-2 [@media(hover:hover)_and_(pointer:fine)]:group-hover:max-w-[200px]">Ask about your business</span>
    </button>, document.body);
}

const Spark = () => <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-brand-600" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /></svg>;

/** The Agent Centre's chat, the one general conversation (the owner, 27 Oct): its greeting says what is waiting, as cards;
 *  a funding, launch or idea message goes on in that page's own thread. `actions`: extra buttons in its header. */
export default function BusinessAssistant({ actions = null, ctx = null, work = [], waiting: given, onWaitingChanged = null }) {
  // One name everywhere: the business name the sidebar and the Marketplace show.
  const workspaceName = useWorkspaceStore((state) => state.workspaceCompanyName || state.workspaceName);
  const person = firstNameOf(useAuthStore((st) => st.name));      // the person, by first name, as everywhere the Agent speaks to them
  // Said as someone who does the work, never a help desk (the owner, 27 Oct: "this sounds chatbotic than agentic")
  const intro = `${getGreeting({ subject: person })}. What do you need done? I can get your funding case ready, draft quotes and invoices, write your business plan, or work out what to do next for ${workspaceName || "your business"}.`;
  // A side panel that stays open from page to page (the owner, 27 Oct: "the agent panel should be here to continue
  // conversations, carry out tasks", "maybe the side"): on a wide screen the page makes room for it
  // Closed on every load (the owner's test, 27 Oct: on a phone it covered the screen each time): opened by the button or a
  // message sent to it, and it stays open from page to page while the app is open
  const go = useInRouterContext() ? useNavigate() : (to) => window.location.assign(to);      // eslint-disable-line react-hooks/rules-of-hooks
  useEffect(() => { try { localStorage.removeItem("ea_panel_open"); } catch { /* nothing kept */ } }, []);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  // The conversation so far in this business is picked up again (it is shared with the Agent box).
  // The last conversation, brought back on every load (the owner's QA, 27 Oct); the others are in History
  const [messages, setMessages] = useState(() => [{ role: "assistant", content: intro }]);
  const [chatId, setChatId] = useState(newChatId);
  const openedAt = useRef(new Date().toISOString());      // when the opening was said
  const act = useMemo(() => chatActions(useWorkspaceStore.getState().workspaceId), []);      // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState(null);      // the draft the next message changes ("Edit", typed in the chat)
  const fileRef = useRef(null);
  const push = (...said) => setMessages((prev) => [...prev, ...said]);
  const mine = (content) => ({ role: "user", content, at: new Date().toISOString() });
  const startEdit = (item) => {
    setEditing(item);
    push({ role: "assistant", at: new Date().toISOString(), content: `What would you like to change in ${item.title}? Tell me in your own words and I'll show you the updated draft before anything is sent.` });
  };
  const runScenario = async (kind, label) => { push(mine(label)); setLoading(true); try { push(await act.scenario(kind, { onWaiting: () => push(SLOW()) })); } finally { setLoading(false); } };
  const attachFile = async (file) => {
    if (!file) return;
    push(mine(`Attached ${file.name}`));
    setLoading(true);
    try { push(await act.attach(file)); } finally { setLoading(false); }
  };
  // A task or document opened from the Tasks panel beside the chat: shown here, as Review shows it (the owner, 27 Oct)
  useEffect(() => {
    const open = async (e) => {
      const item = e.detail || {};
      sent.current = true;      // never replaced by the last conversation arriving after it
      push(mine(`Show me ${item.title}`));
      setLoading(true);
      try { push({ role: "assistant", at: new Date().toISOString(), content: "Here it is.", cards: [{ type: "preview", item, preview: await act.preview(item) }] }); }
      catch (err) { push({ role: "assistant", at: new Date().toISOString(), content: agentErrorMessage(err, "I couldn't open it just now.") }); }
      finally { setLoading(false); }
    };
    window.addEventListener("ea:chat-review", open);
    return () => window.removeEventListener("ea:chat-review", open);
  }, [act]);      // eslint-disable-line react-hooks/exhaustive-deps
  const [history, setHistory] = useState(null);      // the list, while it is open
  const bizId = useWorkspaceStore((st) => st.workspaceId);
  const sent = useRef(false);      // a message was sent here: the last conversation is never brought back over it
  const [restored, setRestored] = useState(false);      // the last conversation was brought back on load
  useEffect(() => {
    if (!bizId) return undefined;
    let live = true;
    listChats(bizId).then(async (r) => {
      // The panel's own conversations only: a funding case's, a launch plan's or the idea's thread belongs to its page
      const last = (r?.items || []).filter((c) => !isModuleThread(c.id))[0];
      // The last conversation, whenever it was (the owner's QA, 27 Oct: "the chat is lost after a page reload"); "+" starts a new one,
      // and it stays new on the next visit until something is said in it (the owner, 28 Oct: "except I click new session")
      let fresh = null;
      try { fresh = localStorage.getItem(`ea_chat_fresh:${bizId}`); } catch { fresh = null; }
      if (!live || sent.current || !last || (fresh && String(last.at || "") < fresh)) return;
      const chat = await getChat(bizId, last.id);
      if (live && !sent.current && chat?.messages?.length) { setChatId(chat.id); continueConversation(bizId, chat.messages); setRestored(chat.messages.length); setMessages([{ role: "assistant", content: intro }, ...chat.messages]); }
    }).catch(() => {});
    return () => { live = false; };
  }, [bizId]);      // eslint-disable-line react-hooks/exhaustive-deps
  const [own, setWaiting] = useState(null);
  const loadOwn = () => (bizId ? getAgentSummary(bizId).then((s) => setWaiting({ count: s?.needs_approval_count || 0, items: s?.needs_approval || [] }), () => setWaiting({ count: 0, items: [] })) : null);
  useEffect(() => { if (given === undefined) loadOwn(); }, [bizId, given === undefined]);      // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = given === undefined ? own : given;
  const loadWaiting = () => (given === undefined ? loadOwn() : onWaitingChanged?.());
  // Kept as it goes: every exchange is saved, so it can be opened again from History
  useEffect(() => {
    const said = messages.slice(1).filter((m) => m.content);
    if (!bizId || isModuleThread(chatId) || !said.some((m) => m.role === "user")) return undefined;
    const t = setTimeout(() => { saveChat(bizId, chatId, said).catch(() => {}); }, 500);
    return () => clearTimeout(t);
  }, [messages, chatId, bizId]);
  // The latest message in view whenever the panel opens or the conversation moves on
  // Again once the greeting and its cards are drawn, and as they finish drawing (the owner, 28 Oct: not scrolled to the latest)
  const drawnAll = waiting !== null && (given === undefined || ctx !== null);
  useEffect(() => {
    if (messages.length <= 1) return undefined;
    const down = () => listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
    requestAnimationFrame(down);
    const later = [setTimeout(down, 250), setTimeout(down, 900)];
    return () => later.forEach(clearTimeout);
  }, [messages.length, chatId, drawnAll]);
  const listRef = useRef(null);
  // A task started from the chat stays in the chat: its questions open in a dialog over the page,
  // and what happens next is said here as a message. Its own page opens only from "See details".
  const [working, setWorking] = useState(false);
  const flow = useTaskFlow({
    say: (reply) => {
      setWorking(Boolean(reply?.working));
      if (!reply || reply.working) return;
      const links = (reply.links || []).filter((l) => l.to).map((l) => ({ label: l.label, to: l.to }));
      const cards = draftCards(links, reply.title);
      setMessages((prev) => [...prev, { role: "assistant", at: new Date().toISOString(), content: [reply.text, reply.next].filter(Boolean).join(" "),
        ...(cards.length ? { cards, link: null, links: [] } : { link: reply.runId ? `/agent/runs/${reply.runId}` : null, links }) }]);
    },
    onChanged: () => window.dispatchEvent(new CustomEvent("ea:credits:refresh")),
    onDetails: (runId, to) => { window.location.assign(to || `/agent/runs/${runId}`); },
  });

  // A task's questions, asked here in the chat one at a time (never a dialog); its answers sent together once all are given
  const asking = useRef(null);
  const confirming = useRef(null);      // a priced task waiting for Start
  async function answerPrice(text) {
    const c = confirming.current;
    confirming.current = null;
    setMessages((prev) => [...prev, mine(text)]);
    if (!/^\s*(?:start|yes|yeah|yep|ok(?:ay)?|sure|go ahead|go on|do it|proceed|please do|confirm)\b/i.test(text)) {
      setMessages((prev) => [...prev, { role: "assistant", at: new Date().toISOString(), content: "No problem, nothing was started or charged." }]);
      return;
    }
    setLoading(true);
    try {
      deliver(await submitAgentRequest({ businessId: c.businessId, capability: c.single.capability, params: c.single.params || {}, sourceChannel: "ui_action", background: true, confirmed: true }), c.businessId);
    } catch (error) {
      setMessages((prev) => [...prev, { role: "assistant", content: agentErrorMessage(error, "I couldn't start that just now. Nothing was charged; please try again.") }]);
    } finally {
      setLoading(false);
    }
  }
  const shownField = (f, answers) => !f.show_if || Object.entries(f.show_if).every(([k, v]) => answers[k] === v);
  function askNext(lead = "") {
    const a = asking.current;
    while (a && a.at < a.fields.length && !shownField(a.fields[a.at], a.answers)) a.at += 1;
    if (!a || a.at >= a.fields.length) return finishAsking();
    const f = a.fields[a.at];
    const options = (f.options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    setMessages((prev) => [...prev, { role: "assistant", at: new Date().toISOString(), content: [lead, f.label].filter(Boolean).join(" "),
      prompts: options.map((o) => ({ label: o.label, prompt: o.label })) }]);
    return undefined;
  }
  async function finishAsking() {
    const a = asking.current;
    asking.current = null;
    if (!a) return;
    setLoading(true);
    try {
      deliver(await submitAgentRequest({ businessId: a.businessId, capability: a.single.capability, params: { ...(a.single.params || {}), ...a.answers }, sourceChannel: "ui_action", background: true }), a.businessId);
    } catch (error) {
      setMessages((prev) => [...prev, { role: "assistant", content: agentErrorMessage(error, "I couldn't do that right now. Nothing was changed; please try again.") }]);
    } finally {
      setLoading(false);
    }
  }
  function answerAsked(text) {
    const a = asking.current;
    const f = a.fields[a.at];
    const options = (f.options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    const t = String(text).trim().toLowerCase();
    const picked = options.find((o) => String(o.label).toLowerCase() === t || String(o.value).toLowerCase() === t)
      || options.find((o) => String(o.label).toLowerCase().startsWith(t) || t.includes(String(o.label).toLowerCase().split(/[,:]/)[0]));
    if (options.length && !picked) {
      setMessages((prev) => [...prev, mine(text), { role: "assistant", at: new Date().toISOString(), content: `Pick one: ${options.map((o) => o.label).join(", ")}.`,
        prompts: options.map((o) => ({ label: o.label, prompt: o.label })) }]);
      return;
    }
    setMessages((prev) => [...prev, mine(text)]);
    a.answers[f.key] = picked ? picked.value : String(text).trim();
    a.at += 1;
    askNext();
  }

  /** One reply from the Agent, put where it belongs: a message, a question in a dialog, or a task to watch. */
  function deliver(routed, businessId) {
    const parts = routed.kind === "multi" ? routed.results || [] : [routed];
    const single = parts.length === 1 ? parts[0] : null;
    const run = single?.kind === "workflow" && !((single.runs || []).length > 1) ? single.run : null;
    if (run && !["succeeded", "cancelled"].includes(run.status)) return flow.follow(run);
    // A guided chat (funding, launch, customers, risks, an idea): carried on here in the panel, as in the Agent Centre (the
    // owner, 27 Oct: "all these agentic flows need to be conversational... a conversation panel")
    if (single?.kind === "check") {
      setMessages((prev) => [...prev, { role: "assistant", content: "", check: { said: single.said || "", goal: single.goal_key, at: Date.now() } }]);
      return undefined;
    }
    if (single?.kind === "needs_input") {
      asking.current = { single, businessId, fields: single.fields || [], at: 0, answers: {} };
      return askNext(single.message);
    }
    // Its price said, then Start or Not now, here in the chat (the owner, 28 Oct: "go ahead" asked the question again)
    if (single?.kind === "needs_confirmation" && single.price) {
      confirming.current = { single, businessId };
      setMessages((prev) => [...prev, { role: "assistant", at: new Date().toISOString(), content: single.message,
        prompts: [{ label: "Start", prompt: "Start" }, { label: "Not now", prompt: "Not now" }] }]);      // the price is in the sentence above
      return undefined;
    }
    // Never the same reply twice in a row (the owner, 27 Oct: "but you said I only have 3" got the last message again)
    return setMessages((prev) => {
      const before = [...prev].reverse().find((m) => m.role === "assistant")?.content;
      const said = parts.map((r) => ({ ...toMessage(r, businessId), at: new Date().toISOString() }));
      // ... only when the owner questioned it; asking again for the same thing gets its answer again (the owner, 28 Oct)
      const asked = [...prev].reverse().find((m) => m.role === "user")?.content || "";
      const doubted = /\b(?:but you said|you said|i thought|that'?s (?:not right|wrong)|isn'?t right|why (?:only|did you say)|how come|not true)\b/i.test(asked);
      if (said.length === 1 && before && doubted && said[0].content === before) said[0] = { ...said[0], content: "I've said that already. Tell me what doesn't look right and I'll check it again.", offers: [], links: [] };
      return [...prev, ...said];
    });
  }

  const sendDisabled = !String(input || "").trim() || loading;
  // Named for the conversation, never the business (the owner, 27 Oct: "why is the chat name E2E Car Wash Abuja")
  const title = useMemo(() => {
    const first = messages.find((m) => m.role === "user")?.content;
    return first ? (first.length > 48 ? `${first.slice(0, 46).trimEnd()}…` : first) : "New conversation";
  }, [messages]);
  async function openHistory() {
    if (history) { setHistory(null); return; }
    try { setHistory(((await listChats(bizId))?.items || []).filter((c) => !isModuleThread(c.id))); } catch { setHistory([]); }
  }
  async function openChat(id) {
    try {
      const chat = await getChat(bizId, id);
      continueConversation(bizId, chat.messages);      // the Agent carries on from what was said there
      setChatId(chat.id);
      setMessages([{ role: "assistant", content: intro }, ...(chat.messages || [])]);
    } catch { /* stays on the current one */ }
    setHistory(null);
  }

  function resetConversation() {
    clearConversation(useWorkspaceStore.getState().workspaceId);      // a new conversation: nothing earlier is sent again
    try { localStorage.setItem(`ea_chat_fresh:${useWorkspaceStore.getState().workspaceId}`, new Date().toISOString()); } catch { /* new for this visit */ }
    setChatId(newChatId());      // the one before stays in History
    setMessages([{ role: "assistant", content: intro }]);
    setHistory(null);
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

  // Opened with a message from anywhere (the owner, 27 Oct: "these should be on the agent chat page, panel"): "?chat=" in the
  // address (the landing page's funding chat hands over this way) or an "ea:chat" event; the message is sent at once
  const handed = useRef("");
  useEffect(() => {
    // From the address once (a page shown twice in development must not send it twice); from the boxes every time
    // A message handed over starts its own conversation, shown at once with its reply in it (never an older one)
    const take = (text, once = false) => {
      const t = String(text || "").trim();
      if (!t || (once && handed.current === t)) return;
      if (once) handed.current = t;
      sent.current = true;
      clearConversation(useWorkspaceStore.getState().workspaceId);
      setChatId(newChatId());
      setHistory(null);
      void send(t, { fresh: true });
    };
    const params = new URLSearchParams(window.location.search);
    // A page with its own assistant (a case's or the idea's) answers its own message: never sent twice
    if (params.get("chat") && params.get("tab") !== "assistant") {
      take(params.get("chat"), true);
      params.delete("chat");
      window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`);
    }
    const onChat = (e) => { if (e?.detail) e.detail.handled = true; take(e?.detail?.text); };
    window.addEventListener("ea:chat", onChat);
    return () => window.removeEventListener("ea:chat", onChat);
  }, []);      // eslint-disable-line react-hooks/exhaustive-deps

  async function send(prefilledQuestion = "", { fresh = false } = {}) {
    let question = String(prefilledQuestion || input || "").trim();
    if (!question) return;
    sent.current = true;
    if (!prefilledQuestion) {
      // Typed at the last reply's buttons ("yes, go ahead", "open it"): that button, as a click (the owner, 27 Oct)
      const last = [...messages].reverse().find((m) => m.role === "assistant");
      const chosen = offerFor(question, [...(last?.prompts || []).map((p) => ({ label: p.label, prompt: p.prompt })), ...(last?.links || []).map((l) => ({ label: l.label, to: l.to }))]);
      if (chosen?.to) { setInput(""); window.location.assign(chosen.to); return; }
      if (chosen?.prompt) question = chosen.prompt;
    }

    if (editing) {
      // The change, made to the draft and shown again for approval (the owner, 27 Oct: "let the user say what to change in the chat")
      const item = editing;
      setEditing(null);
      setInput("");
      push(mine(question));
      setLoading(true);
      try { push(await act.revise(item, question)); } finally { setLoading(false); }
      return;
    }
    if (confirming.current) {      // Start or Not now, for the price just said
      setInput("");
      answerPrice(question);
      return;
    }
    if (asking.current) {      // the answer to the question the chat just asked
      setInput("");
      answerAsked(question);
      return;
    }
    if (SEGMENTS.test(question)) {      // typed, as its button does: the research offer, never questions (the owner, 28 Oct)
      setInput("");
      push(mine(question), { role: "assistant", at: new Date().toISOString(), content: "I can research new customer segments for you.", cards: [{ type: "segments" }] });
      return;
    }
    if (NEXT.test(question)) {
      const at = new Date().toISOString();
      setMessages((prev) => [...prev, { role: "user", content: question, at },
        { role: "assistant", at, content: work.length ? "Here's where your work stands. Pick one and I'll continue." : "Nothing is in progress yet. Tell me the job: funding, a launch, an idea or a quotation.", cards: work.length ? [{ type: "work" }] : [] }]);
      setInput("");
      return;
    }
    const there = await caseChatPath(useWorkspaceStore.getState().workspaceId, question);
    if (there) { setInput(""); go(there); return; }      // its own thread, never this one (the owner, 27 Oct)
    const nextMessages = [...(fresh ? [{ role: "assistant", content: intro }] : messages), { role: "user", content: question, at: new Date().toISOString() }];
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

  // The opening, as the mockup has it (the owner, 27 Oct): what was checked and what needs them, the approvals as a card;
  // then a risk the records show, as a card. Said fresh on each visit, never saved into the conversation.
  const biz = ctx?.business?.name || workspaceName || "your business";
  const n = waiting?.count || 0;
  const risk = ctx?.risk && ctx.risk.share >= 50 ? ctx.risk : null;
  const ready = waiting !== null && (given === undefined || ctx !== null);
  // Said once (the owner, 28 Oct: the greeting and approvals came again at the bottom, with a new time, on every visit): while
  // nothing it says has changed it keeps the time it was first said, so it stays where it was; a change is a new greeting
  const sig = `${n}|${risk ? `${risk.customer}:${risk.share}` : ""}`;
  const greet = useRef(null);
  if (ready && greet.current === null) {
    let seen = null;
    try { seen = JSON.parse(localStorage.getItem(`ea_greeted:${bizId}`) || "null"); } catch { /* not kept: greeted now */ }
    const same = restored && seen && seen.sig === sig && seen.at;
    greet.current = !same;
    if (same) openedAt.current = seen.at;
    try { localStorage.setItem(`ea_greeted:${bizId}`, JSON.stringify({ sig, at: openedAt.current })); } catch { /* not kept */ }
  }
  const opening = [{ role: "assistant", at: openedAt.current, cards: n ? [{ type: "approvals" }] : [],
    content: `${intro.split(". ")[0]}. I've checked ${biz}. ${n ? `${n === 1 ? "One thing needs" : `${(NUMBER[n] || String(n)).replace(/^./, (c) => c.toUpperCase())} things need`} you today.` : "Nothing is waiting for you right now. Tell me the job and I'll get on with it."}` },
    ...(risk ? [{ role: "assistant", at: openedAt.current, cards: [{ type: "risk" }],
      content: `I also noticed that ${risk.customer} makes up ${risk.share}% of your customer revenue. That's a concentration risk.` }] : [])];
  // Each shown message knows its place in the conversation (`_i`), whatever comes before it on screen
  const said = messages.map((m, i) => ({ ...m, _i: i })).slice(1);
  // The greeting and its cards (approvals, the risk and its Simulate buttons) always, after a conversation brought back
  // (the owner, 28 Oct: "bring them back, after the conversation in time order")
  // A conversation brought back, then the greeting, then what is said now: in time order (the owner, 28 Oct: a result posted
  // above the greeting was out of sight)
  // Placed by time, never by count (the owner, 28 Oct: the greeting came again after a reply, with an earlier time): each
  // message keeps the time of the one before it when it has none, and the order is otherwise kept
  const inOrder = (list) => { let t = ""; return list.map((m, k) => { t = m.at || t; return { m, t, k }; }).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.k - b.k)).map((x) => x.m); };
  const shown = !ready ? said : restored ? inOrder([...said.slice(0, restored), ...opening, ...said.slice(restored)]) : [...opening, ...said];
  const bubble = "whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-[1.5]";
  const card = (c, key) => {
    if (c.type === "approvals" && waiting?.items?.length) return <WaitingCard key={key} businessId={bizId} items={waiting.items} count={n} onDone={loadWaiting} go={go} act={act} onEdit={startEdit} say={push} />;
    if (c.type === "risk" && risk) return <RiskCard key={key} risk={risk} onScenario={runScenario} onSegments={() => push(mine("Find new customer segments"), { role: "assistant", at: new Date().toISOString(), content: "I can research new customer segments for you.", cards: [{ type: "segments" }] })} />;
    if (c.type === "scenario") return <ScenarioCard key={key} card={c} />;
    if (c.type === "preview") return <PreviewCard key={key} businessId={bizId} item={c.item} preview={c.preview} go={go} onEdit={startEdit} onDone={(m) => { sayDone(m); loadWaiting(); }} />;
    if (c.type === "segments") return <SegmentsCard key={key} businessId={bizId} onDone={(m) => push({ role: "assistant", at: new Date().toISOString(), content: m })} onChanges={() => { setInput("For the customer segments, please change "); }} />;
    if (c.type === "work" && work.length) return <WorkCard key={key} work={work} go={go} />;
    return null;
  };
  const last = [...shown].reverse().find((m) => m.role === "assistant");
  // A reply's buttons only while it is the last thing said and nothing is under way (the owner, 28 Oct: Start and Not now still
  // showing beside "Working on it…"); otherwise the starters
  const answered = shown.length > 0 && shown[shown.length - 1] !== last;
  // ... and no starters while a task is under way: they come back with its result (the owner, 28 Oct)
  const chips = loading || working ? []
    : (last?.prompts || []).length && !answered ? last.prompts
      : STARTER_PROMPTS.map((q) => ({ label: q, prompt: q }));
  return (
    <section aria-label="Agent chat" data-agent-chat className="flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Earlier conversations and a fresh one, at the top right of the chat (the owner, 27 Oct: out of the suggestions row) */}
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-slate-100 px-3 py-1.5 dark:border-slate-800" data-chat-header>
        {actions}
        <button type="button" onClick={openHistory} aria-pressed={Boolean(history)} data-chat-history-button aria-label="History" title="Earlier conversations"
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:hover:bg-slate-800">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2" /></svg>
        </button>
        <button type="button" onClick={resetConversation} aria-label="New conversation" title="New conversation" className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:hover:bg-slate-800">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
      {history && (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5" data-chat-history onKeyDown={(e) => { if (e.key === "Escape") setHistory(null); }}>
          {/* A way back, said (the owner, 28 Oct: "how do i exit the history now?"); the clock button and Escape close it too */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your conversations</p>
            <button type="button" autoFocus onClick={() => setHistory(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" data-history-back>
              ← Back to the conversation
            </button>
          </div>
          {history.length === 0 ? <p className="mt-2 text-sm text-slate-500">No earlier conversations yet.</p> : (
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {history.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => openChat(c.id)} data-chat-item={c.id}
                    className={`w-full px-1 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 ${c.id === chatId ? "font-semibold" : ""}`}>
                    <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{c.title}</span>
                    <span className="block text-[11.5px] text-slate-500">{new Date(c.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div ref={listRef} data-conversation-panel className={`min-h-0 flex-1 space-y-4 overflow-auto px-4 py-5 sm:px-6 ${history ? "hidden" : ""}`}>
        {!ready && (
          <div className="space-y-3" aria-busy="true" aria-label="Checking your business" data-chat-skeleton>
            <div className="flex items-start gap-3"><span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
              <span className="block h-14 w-full max-w-md animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /></div>
            <div className="sm:pl-[3.25rem]"><span className="block h-56 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /></div>
          </div>
        )}
        {shown.map((message, index) => (message.role === "user" ? (
          <div key={`u-${index}`} className="flex flex-col items-end">
            <p className={`${bubble} max-w-[80%] bg-blue-50 text-slate-900 dark:bg-brand-950/50 dark:text-slate-50`}>{message.content}</p>
            {message.at && <span className="mt-1 text-[12px] text-slate-500">{clock(message.at)}</span>}
          </div>
        ) : (
          <div key={`a-${index}`} className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-brand-950/40"><Spark /></span>
              <div className={`min-w-0 ${message.check ? "flex-1" : ""}`}>
                {message.content && <p className={`${bubble} bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100`}>{message.content}</p>}
                {message.at && <span className="mt-1 block text-[12px] text-slate-500">{clock(message.at)}</span>}
                {message.check && <div className="mt-2 whitespace-normal" data-panel-chat><AgentGoalChat key={`${message.check.goal}:${message.check.at}`} text={message.check.said} /></div>}
                {message.link && (
                  <a href={message.link} className="mt-2 inline-block rounded-lg border border-brand-600 px-3 py-1.5 text-[13px] font-semibold text-brand-700 hover:bg-brand-50">
                    {message.link === "/pricing" ? "See plans" : message.link === "/agent" ? "See your tasks" : "See details"}
                  </a>
                )}
                {message.remember && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => rememberFact(message._i, message.remember)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700">Save</button>
                    <button type="button" onClick={() => setMessages((prev) => prev.map((m, i) => (i === message._i ? { ...m, remember: null, content: "Not saved." } : m)))}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Don't save</button>
                  </div>
                )}
                {(message.links || []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">{message.links.map((l) => <a key={l.to} href={l.to} className="rounded-lg border border-brand-600 px-3 py-1.5 text-[13px] font-semibold text-brand-700 hover:bg-brand-50">{l.label}</a>)}</div>
                )}
              </div>
            </div>
            {(message.cards || []).map((c, j) => <div key={j} className="sm:pl-[3.25rem]">{card(c, j)}</div>)}
          </div>
        )))}
        {loading || working ? (
          <div className="flex items-center gap-4"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50"><Spark /></span>
            <span className="text-[14px] text-slate-500">{working && !loading ? "Working on it…" : "Thinking…"}</span></div>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-slate-100 px-4 pb-3 pt-2.5 dark:border-slate-800 sm:px-5">
        <div className="flex items-center gap-2 pb-2.5">
          {!history && !loading && (
            // One line, never wrapped (the owner, 27 Oct); on a narrow screen it scrolls sideways, no scrollbar shown
            <div className="no-scrollbar flex min-w-0 flex-1 flex-nowrap gap-2 overflow-x-auto pr-6 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]" data-chat-chips>{chips.map((p) => (
              <button key={p.label} type="button" onClick={() => void send(p.prompt)}
                className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 px-3.5 py-1.5 text-[13.5px] text-slate-700 hover:border-brand-400 hover:text-brand-700 dark:border-slate-700 dark:text-slate-200">{p.label}</button>
            ))}</div>
          )}
        </div>
        <form className="flex items-center gap-2 rounded-2xl border border-slate-200 py-2 pl-4 pr-2 dark:border-slate-700" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void attachFile(f); }} data-chat-file />
          <button type="button" aria-label="Attach a document" onClick={() => fileRef.current?.click()} className="p-1 text-slate-500 hover:text-slate-800">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.5l-8.5 8.5a6 6 0 01-8.5-8.5l9-9a4 4 0 015.7 5.7l-9 9a2 2 0 01-2.8-2.8l8.3-8.3" /></svg>
          </button>
          <label className="sr-only" htmlFor="agent-chat-input">Message</label>
          <input id="agent-chat-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={editing ? `What should change in ${editing.title}?` : "Ask EnterprateAI anything…"} maxLength={4000}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100" />
          <button type="submit" aria-label="Send" disabled={sendDisabled} className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" /></svg>
          </button>
        </form>
      </div>
      {flow.element}
    </section>
  );
}

const BOX = "rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";
const initials = (t) => String(t || "?").replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
const TINT = ["bg-blue-50 text-blue-700", "bg-emerald-50 text-emerald-700", "bg-violet-50 text-violet-700", "bg-amber-50 text-amber-700", "bg-rose-50 text-rose-700"];

/** What is waiting for the owner, as the mockup's "Pending approvals" (the owner, 27 Oct): Review, Approve, Edit, Postpone.
 *  Approve sends an approval, or accepts a draft; Postpone only takes it out of this card (it stays in Needs Approval). */
function WaitingCard({ businessId, items, count, onDone, go, act, onEdit, say }) {
  const [opened, setOpened] = useState({});      // the preview shown under an item: key → preview
  const [asking, setAsking] = useState(null);      // the item asking "Remind me when?"
  const [allShown, setAllShown] = useState(false);
  const [state, setState] = useState({});
  const [hidden, setHidden] = useState(new Set());
  const [menu, setMenu] = useState(null);      // the item whose ⋯ menu is open (a phone)
  const [problem, setProblem] = useState("");
  const keyOf = (a) => a.approval_id || a.draft_id || a.run_id || a.title;
  const draftId = (a) => a.draft_id || (() => { try { return new URLSearchParams(String(a.to || "").split("?")[1] || "").get("review"); } catch { return null; } })();
  const approve = async (a) => {
    setProblem("");
    setState((x) => ({ ...x, [keyOf(a)]: "working" }));
    try {
      if (a.approval_id) await approveAction(a.run_id, a.approval_id);
      else await apiRequest(`/businesses/${businessId}/agent-drafts/${draftId(a)}/decide`, "POST", { decision: "accept" });
      setState((x) => ({ ...x, [keyOf(a)]: "done" }));
      setHidden((h) => new Set([...h, keyOf(a)]));      // out of the card at once; the count follows
      sayDone(`${a.title} approved`);
      onDone?.();
    } catch (e) {
      setState((x) => ({ ...x, [keyOf(a)]: null }));
      setProblem(agentErrorMessage(e, "That couldn't be done just now. Nothing was sent or changed."));
    }
  };
  const review = async (a) => {
    const k = keyOf(a);
    if (opened[k]) { setOpened((o) => ({ ...o, [k]: undefined })); return; }
    setOpened((o) => ({ ...o, [k]: "loading" }));
    try { const p = await act.preview({ ...a, draft_id: draftId(a) }); setOpened((o) => ({ ...o, [k]: p })); }
    catch { setOpened((o) => ({ ...o, [k]: { found: false } })); }
  };
  const later = async (a, when) => {
    setAsking(null);
    try {
      const k = keyOf(a);
      const got = await act.postpone(k, when);
      setHidden((h) => new Set([...h, k]));
      // Once, naming the item, with Undo (the owner, 27 Oct: it was said twice in the chat, without saying which)
      sayDone(`${a.title} postponed to ${got.day}`, async () => {
        await act.postpone(k, "undo");
        setHidden((h) => { const n = new Set(h); n.delete(k); return n; });
        onDone?.();
      });
      onDone?.();
    } catch (e) { setProblem(agentErrorMessage(e, "That couldn't be postponed just now.")); }
  };
  const list = items.filter((a) => !hidden.has(keyOf(a)));
  const Btn = ({ children, onClick, primary, disabled }) => (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium disabled:opacity-60 max-sm:w-full max-sm:px-2 ${primary ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-slate-200 text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"}`}>{children}</button>
  );
  return (
    <div className={`${BOX} p-4 sm:p-5`} data-card="approvals">
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>
          </span>
          <span><span className="block text-[17px] font-bold text-slate-900 dark:text-slate-50">Pending approvals</span>
            <span className="text-[13.5px] text-slate-500">Drafts I've prepared. Nothing counts until you approve it.</span></span>
        </span>
        <button type="button" onClick={() => go("/agent?tab=needs_approval")} className="shrink-0 text-[13.5px] font-medium text-blue-600 hover:underline">{count} waiting</button>
      </div>
      <ul className="mt-3 space-y-3">{list.slice(0, allShown ? undefined : 4).map((a, k) => (
        <li key={keyOf(a)} className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 items-center gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13.5px] font-semibold ${TINT[k % TINT.length]}`}>{initials(a.title?.split(":")[0])}</span>
              <span className="min-w-0"><span className="block text-[15px] font-semibold text-slate-900 dark:text-slate-50">{a.title}</span>
                <span className="block text-[13.5px] text-slate-500">{a.subtitle}</span>
                {/* On a phone the badge sits under the name, so the name keeps the row */}
                <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium sm:hidden ${state[keyOf(a)] === "done" ? "bg-emerald-50 text-emerald-700" : a.approval_id ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
                  {state[keyOf(a)] === "done" ? (a.approval_id ? "Sent" : "Accepted") : a.approval_id ? "Ready to send" : "Draft"}</span></span>
            </span>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-medium max-sm:hidden ${state[keyOf(a)] === "done" ? "bg-emerald-50 text-emerald-700" : a.approval_id ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
              {state[keyOf(a)] === "done" ? (a.approval_id ? "Sent" : "Accepted") : a.approval_id ? "Ready to send" : "Draft"}</span>
          </div>
          {state[keyOf(a)] !== "done" && (
            <div className="relative mt-3 grid grid-cols-[repeat(3,minmax(0,1fr))_auto] gap-2 sm:flex sm:flex-wrap">
              {/* On a phone three equal buttons and ⋯, all inside the card (the owner, 28 Oct: ⋯ went past its edge) */}
              <Btn onClick={() => review(a)}>{opened[keyOf(a)] ? "Hide" : "Review"}</Btn>
              <Btn primary disabled={state[keyOf(a)] === "working"} onClick={() => approve(a)}>{state[keyOf(a)] === "working" ? "Working…" : "Approve"}</Btn>
              <Btn onClick={() => onEdit?.({ ...a, draft_id: draftId(a) })}>Edit</Btn>
              <span className="max-sm:hidden"><Btn onClick={() => setAsking(keyOf(a))}>Postpone</Btn></span>
              <button type="button" aria-label="More" aria-haspopup="menu" aria-expanded={menu === keyOf(a)} onClick={() => setMenu(menu === keyOf(a) ? null : keyOf(a))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-[13.5px] font-medium text-slate-700 sm:hidden dark:border-slate-700 dark:text-slate-200">⋯</button>
              {menu === keyOf(a) && (
                <div role="menu" className="absolute right-0 top-10 z-20 w-36 rounded-xl border border-slate-200 bg-white py-1 shadow-lg sm:hidden dark:border-slate-700 dark:bg-slate-900">
                  <button type="button" role="menuitem" onClick={() => { setMenu(null); setAsking(keyOf(a)); }}
                    className="block w-full px-3 py-2 text-left text-[13.5px] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">Postpone</button>
                </div>
              )}
            </div>
          )}
            {asking === keyOf(a) && <PostponeChoice onPick={(when) => later(a, when)} onClose={() => setAsking(null)} />}
            {opened[keyOf(a)] === "loading" && <p className="mt-3 text-[13px] text-slate-500">Opening it…</p>}
            {opened[keyOf(a)] && opened[keyOf(a)] !== "loading" && (
              <div className="mt-3"><PreviewCard businessId={businessId} item={{ ...a, draft_id: draftId(a) }} preview={opened[keyOf(a)]} go={go} onEdit={onEdit}
                onDone={(m) => { setState((x) => ({ ...x, [keyOf(a)]: "done" })); setHidden((h) => new Set([...h, keyOf(a)])); sayDone(m); onDone?.(); }} /></div>
            )}
        </li>
      ))}</ul>
      {/* the rest shown here, in the card, never another page (the owner, 27 Oct) */}
      {list.length > 4 && <button type="button" onClick={() => setAllShown((v) => !v)} className="mt-3 text-[13.5px] font-medium text-blue-600 hover:underline">{allShown ? "Show fewer" : `See all ${list.length}`}</button>}
      {problem && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-rose-600">{problem}</p>}
      <p className="mt-3 rounded-lg bg-blue-50 px-3.5 py-2 text-[13px] text-blue-800 dark:bg-brand-950/40 dark:text-blue-200">ⓘ Nothing is sent, saved or shared without your approval.</p>
    </div>
  );
}

/** Reliance on one customer, from the paid invoices (the mockup's "Customer concentration risk"). */
function RiskCard({ risk, onScenario, onSegments }) {
  const others = Math.max(0, Math.round((100 - risk.share) * 10) / 10);
  const Bar = ({ label, n, tone }) => (
    <li className="grid grid-cols-[auto_minmax(2.5rem,1fr)_3rem] items-center gap-3 text-[13.5px] text-slate-700 dark:text-slate-200">
      <span className="min-w-[6.5rem] leading-snug">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(n, 1)}%` }} /></span>
      <span className="text-right tabular-nums">{n}%</span>
    </li>
  );
  return (
    <div className={`${BOX} p-4 sm:p-5`} data-card="risk">
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 3l10 18H2zM12 10v5M12 18h.01" /></svg>
          </span>
          <span><span className="block text-[17px] font-bold text-slate-900 dark:text-slate-50">Customer concentration risk</span>
            <span className="text-[13.5px] text-slate-500">One customer drives your revenue and cash flow.</span></span>
        </span>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold ${risk.level === "High" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>{risk.level}</span>
      </div>
      <div className="mt-3 grid gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center">
        <div><p className="text-[13px] text-slate-500">Main customer</p><p className="text-[15px] font-semibold text-slate-900 dark:text-slate-50">{risk.customer}</p>
          <p className="text-[30px] font-bold leading-tight text-rose-600">{risk.share}%<span className="ml-1.5 text-[13.5px] font-normal text-slate-600">of revenue</span></p></div>
        <ul className="space-y-3"><Bar label={risk.customer} n={risk.share} tone="bg-red-600" /><Bar label="Other customers" n={others} tone="bg-blue-500" /></ul>
      </div>
      {/* One row at every width, each button on one line; scrolling sideways only if it can't fit (the owner, 28 Oct) */}
      <div className="no-scrollbar mt-3 flex flex-nowrap gap-2 overflow-x-auto max-sm:pr-6 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]">
        {["Simulate order reduction", "Simulate payment delay", "Find new customer segments"].map((t) => (
          <button key={t} type="button" onClick={() => (t.startsWith("Find") ? onSegments() : onScenario(t.includes("delay") ? "payment_delay" : "order_reduction", t))}
            className="shrink-0 whitespace-nowrap rounded-lg border border-blue-200 px-2.5 py-1.5 text-[12.5px] font-medium text-blue-700 hover:bg-blue-50 xl:px-3 xl:text-[13px]">{t}</button>
        ))}
      </div>
    </div>
  );
}

const WORK_TONE = { funding: "bg-blue-50 text-blue-700", idea: "bg-amber-50 text-amber-700", launch: "bg-violet-50 text-violet-700" };
/** Where the work stands: each case or check with its score and what is next (the mockup's last card). */
function WorkCard({ work, go }) {
  return (
    <div className={`${BOX} divide-y divide-slate-100 px-4 dark:divide-slate-800 sm:px-5`} data-card="work">
      {work.map((w, i) => (
        <div key={w.key} className="flex items-center justify-between gap-3 py-3.5">
          <span className="flex min-w-0 items-center gap-4">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-semibold ${WORK_TONE[w.kind] || WORK_TONE.funding}`}>{w.score ?? "?"}</span>
            <span className="min-w-0"><span className="block text-[15px] font-semibold text-slate-900 dark:text-slate-50">{w.title}</span>
              <span className="block text-[13.5px] text-slate-500">{w.detail}</span></span>
          </span>
          <button type="button" onClick={() => go(w.to)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-1.5 text-[13.5px] font-medium ${i === 0 ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-blue-600 text-blue-700 hover:bg-blue-50"}`}>{i === 0 ? "Continue" : "Open"} →</button>
        </div>
      ))}
    </div>
  );
}
