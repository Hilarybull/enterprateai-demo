import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { apiRequest } from "../api/client";
import UkDateInput, { ukDate } from "./UkDateInput";
import SaidLine from "./SaidLine";
import { MoneyInput } from "./readiness/Fields";
import { useAuthStore, useSignedIn } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";
import { resultLine } from "../lib/resultLine";
import GoogleSignInButton from "./GoogleSignInButton";
import { DURATION, prefersReducedMotion, useReducedMotion, useTypewriter } from "../lib/motion";
import { DEMO_SECONDS } from "../config/agentDemo";
import AgentShell, { AgentAvatar, AgentIdentity } from "./agent/AgentShell";

export { AgentAvatar };

// The homepage's way in (PRD-GO-001): say what you want done, pick a common business goal, or
// start a task. All three go to the same place: a goal is resolved to what EnterprateAI really
// supports, a few questions are asked, and the work is saved once the visitor signs in.
// Nothing here costs AI Credits, and nothing is stored about a business before sign-in.
//
// Two pieces share one flow (useGoalFlow): the launcher (the prompt and the suggestions, always
// in view) and the task card (the goal that was chosen: what was read from the sentence, the few
// questions, the save checkpoint). On the homepage the card takes the place of the product
// preview in the right-hand column, so opening a goal never moves or stretches the hero; below
// 1024px it opens as a full-screen sheet with its button always in reach.

// Shown until the server's list arrives (and if it can't be reached). The server decides what is offered.
const FALLBACK = {
  prompt: "What do you want EnterprateAI to do for your business?",
  reassurance: "Free essential business tools. 50 AI Credits to get started.",
  goals: [
    { key: "need_funding", label: "I need funding" },
    { key: "price_offer", label: "Help me price my product/service" },
    { key: "launch", label: "I want to launch a product/service" },
    { key: "test_idea", label: "Test a business idea" },
  ],
  tasks: [
    { key: "create_invoice", label: "Create Invoice" }, { key: "create_quotation", label: "Create Quotation" },
    { key: "create_business_plan", label: "Create Business Plan" },
  ],
  retention_days: 7,
};
const SESSION_KEY = "ea_task_session";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// The name a visitor gave in one flow, kept in this browser so a later flow never asks for it again.
const NAME_KEY = "enterprate_visitor_name";
export function rememberedName() {
  try { return (localStorage.getItem(NAME_KEY) || "").trim(); } catch { return ""; }
}
function rememberName(name) {
  const called = String(name || "").replace(/\s+/g, " ").trim();
  if (called) { try { localStorage.setItem(NAME_KEY, called); } catch { /* fine without it */ } }
}
const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 md:text-sm";

export const GOALS_SHOWN = 3;
export const GOALS_EVERY_MS = 4000;
/** The goals in sets of three. A short last set is filled from the start, so there are always three to choose from. */
export function goalSets(goals, size = GOALS_SHOWN) {
  const all = goals || [];
  if (all.length <= size) return [all];
  const sets = [];
  for (let i = 0; i < all.length; i += size) sets.push(Array.from({ length: size }, (_, k) => all[(i + k) % all.length]));
  return sets;
}

/** The number in an answer: "£45 per groom" is 45, "£2.5k" is 2500. Null when there is none. (The server reads it the same way.) */
/** The currency an amount was written in: "$300" or "300 usd" is USD. Null when it says none. */
export function currencyIn(value) {
  const text = String(value ?? "");
  const sign = { "£": "GBP", "$": "USD", "€": "EUR", "₦": "NGN" }[(text.match(/[£$€₦]/) || [])[0]];
  if (sign) return sign;
  const code = (text.match(/\b(gbp|usd|eur|ngn|dollars?|euros?|pounds?|naira)\b/i) || [])[1];
  if (!code) return null;
  const c = code.toLowerCase();
  return c.startsWith("dollar") ? "USD" : c.startsWith("euro") ? "EUR" : c.startsWith("pound") ? "GBP" : c === "naira" ? "NGN" : c.toUpperCase();
}

export function numberIn(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const m = String(value ?? "").replace(/[£$€₦]/g, " ").match(/(-?\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)?\b/i);
  if (!m) return null;
  const scale = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6 }[(m[2] || "").toLowerCase()] || 1;
  const n = Number(m[1].replace(/,/g, "")) * scale;
  return Number.isFinite(n) ? n : null;
}

export const startPath = (sessionId) => `/start/${sessionId}`;

/** A funnel step for analytics (PRD s20): its name, and at most a goal key and entry mode. Never what was typed. */
export function trackGoal(name, extra = {}) {
  try { apiRequest("/goal-events", "POST", { name, ...extra }).catch(() => {}); } catch { /* analytics never gets in the way */ }
}


const InfoIcon = () => (
  <svg aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4m0-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 10h10m0 0-4-4m4 4-4 4" />
  </svg>
);

// The task in hand, in the address too ("?task=<id>"): a re-mount, a sign-in check or a reload resumes the same thread.
const TASK_PARAM = "task";
function taskInAddress() {
  try { return new URLSearchParams(window.location.search).get(TASK_PARAM) || ""; } catch { return ""; }
}
function putTaskInAddress(id) {
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set(TASK_PARAM, id); else url.searchParams.delete(TASK_PARAM);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);      // never a navigation, never a scroll
  } catch { /* fine without it */ }
}

/** The goal flow: what is offered, the task in hand, and what can be done with it. Shared by the launcher and the task card. */
// `inApp`: the chat in the dashboard's Agent card or the Agent Centre. It never reads or writes the address or this
// browser's saved task (the owner's QA, 25 Oct: its "?task=" was read by the dashboard as an Agent task: "This item no
// longer exists"); a new chat starts from each message there.
export function useGoalFlow({ inApp = false } = {}) {
  const navigate = useNavigate();
  const [offer, setOffer] = useState(FALLBACK);
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [failed, setFailed] = useState(null);      // P1.8: a message that didn't go through, kept in the thread with Try again
  const [pending, setPending] = useState("");
  const [resuming, setResuming] = useState(false);      // a saved task is being fetched: the card's shell shows, never an older thread      // what is being started: the card shell shows it at once, with the Agent typing
  const authToken = useSignedIn();      // read reliably: the kept token counts while the first sign-in check runs
  const authEmail = useAuthStore((st) => st.email) || localStorage.getItem("ea_email");
  const [closed, setClosed] = useState(false);      // phone: the sheet was closed with × or Back; the task is kept and can be reopened
  const here = Boolean(authToken) && authEmail !== "demo";
  const sessionKey = here && authEmail ? `${SESSION_KEY}:${authEmail.toLowerCase()}` : `${SESSION_KEY}:anon`;
  const live = useRef(null);      // the task on screen now: never dropped because the sign-in state was checked again
  live.current = session;
  useEffect(() => {
    let alive = true;
    apiRequest("/goal-suggestions", "GET").then((res) => { if (alive && res?.goals) setOffer(res); }).catch(() => {});
    try {
      if (!sessionStorage.getItem("ea_goal_viewed")) { sessionStorage.setItem("ea_goal_viewed", "1"); trackGoal("homepage_goal_prompt_viewed"); }
    } catch { trackGoal("homepage_goal_prompt_viewed"); }
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    // Signed in by a code, with the new account's password still to set: the same task stays on screen.
    if (passwordHold.current) { try { localStorage.setItem(sessionKey, session?.id || ""); } catch { /* fine without it */ } return undefined; }
    // A task already on screen stays on screen when the sign-in changes or is checked again (it was wiped here before, mid-flow):
    // it is only kept under the new key.
    if (live.current?.id) { if (!inApp) { try { localStorage.setItem(sessionKey, live.current.id); } catch { /* fine without it */ } } return undefined; }
    if (inApp) return undefined;
    let alive = true;
    // A task begun earlier is picked up where it was left: the one in the address first, then this browser's.
    let saved = taskInAddress();
    if (!saved) { try { saved = localStorage.getItem(sessionKey); } catch { /* fine without it */ } }
    if (saved) {
      setResuming(true);
      apiRequest(`/task-sessions/${saved}`, "GET")
        .then((res) => {
          // Picked up only while there is something left to do here: questions to answer, a choice to make, or (signed
          // out) the email to save it with. A task already carried on after sign-in (its result shown, or handed to the
          // dashboard) is not shown again as an empty card: it is forgotten here, and kept where it went.
          // A task stopped before its last step (ready to prepare, or a choice to make) resumes exactly there (QA, 15 Oct).
          const open = ["questions", "clarify", "choose"].includes(res?.next) || (res?.next === "identity" && !res?.authenticated)
            || (res?.next === "prepare" && res?.authenticated && here);      // only for the owner signed in here
          if (live.current?.id) return;      // a task was started meanwhile: it is the one on screen
          if (alive && res?.id && res.resolution && open && !["handed_off", "awaiting_review", "abandoned", "blocked"].includes(res.state)) setSession({ ...res, questions: res.questions || [] });
          else if (alive) { try { localStorage.removeItem(sessionKey); } catch { /* ignore */ } putTaskInAddress(""); }
        })
        .catch(() => { if (!live.current?.id) { try { localStorage.removeItem(sessionKey); } catch { /* ignore */ } } })
        .finally(() => { if (alive) setResuming(false); });
    }
    return () => { alive = false; };
  }, [sessionKey]);
  const keep = useCallback((next) => {
    if (!next?.id || !next.resolution) throw new Error("Not a task session");      // an empty or broken reply is a failure, said as one
    setSession({ ...next, questions: next.questions || [] });
    setClosed(false);
    if (inApp) return;
    try { localStorage.setItem(sessionKey, next.id); } catch { /* fine without it */ }
    putTaskInAddress(next.id);
  }, [sessionKey, inApp]);
  const retryOnce = useCallback(async (action) => {
    try {
      return await action();
    } catch (error) {
      if (error?.status && error.status < 500 && error?.code !== "NETWORK_ERROR" && error?.code !== "TIMEOUT") throw error;
      return await action();
    }
  }, []);
  const begin = useCallback(async (body) => {
    if (busy) return false;
    setBusy(true);
    setProblem("");
    setPending(body.text || [...(offer.goals || []), ...(offer.tasks || [])].find((g) => g.key === body.key)?.label || "Your task");
    trackGoal("entry_mode_selected", { entry_mode: body.entry_mode, ...(body.key ? { key: body.key } : {}) });
    const began = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      keep(await retryOnce(() => apiRequest("/task-sessions", "POST", { ...body, currency: body.currency || chatCurrency(), ...chatWorkspace() })));
      // Time to the first question, measured and logged (the target is under 1.5 seconds).
      const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - began);
      trackGoal("first_question_shown", { ms });
      return true;
    } catch (e) {
      setProblem(e?.status === 429 ? "That's a lot of tasks started from here. Please try again in a little while." : "Couldn't continue. Try again.");
      return false;
    } finally {
      setBusy(false);
      setPending("");
    }
  }, [busy, keep, retryOnce, offer]);
  const answer = useCallback(async (answers, confirm = false, said = null, messageId = null) => {
    if (!session) return false;
    setBusy(true);
    setProblem("");
    // One id for this message, the same on every retry: the server answers it once (never two bubbles, never two turns).
    const mid = messageId || `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    try {
      // `said`: the reply as typed and the question it answers, read in full by the Agent (every slot it gives a value for).
      // A slow reply never holds the chat: 20 seconds a try, tried again once on a 5xx or a timeout, then "Try again".
      keep(await retryOnce(() => apiRequest(`/task-sessions/${session.id}/inputs`, "POST", { answers, ...(confirm ? { confirm: true } : {}), ...(said || {}), client_message_id: mid },
        { timeoutMs: 20000 })));
      setFailed(null);
      return true;
    } catch {
      // Kept in the thread, the question not moved on: "That didn't go through. [Try again]".
      setFailed({ text: said?.message || said?.picked || "", retry: () => answer(answers, confirm, said, mid) });
      return false;
    } finally {
      setBusy(false);
    }
  }, [session, keep, retryOnce]);
  const startOver = useCallback(() => {
    setSession(null);
    setProblem("");
    if (inApp) return;
    try { localStorage.removeItem(sessionKey); } catch { /* ignore */ }
    putTaskInAddress("");
  }, [sessionKey, inApp]);
  /** Straight on, for someone signed in; or to the sign-in page for someone who says they have an account.
   *  The address is never put in a link: only where to come back to. */
  const carryOn = useCallback(() => {
    const next = startPath(session.id);
    if (here) { navigate(next); return ""; }
    navigate(`/login?next=${encodeURIComponent(next)}`);
    return "";
  }, [here, navigate, session]);
  /** Send the 6-digit code that saves this task (to a new address, or again to the one already given). Returns what to say if it could not be done. */
  const sendCode = useCallback(async (email, name, consent) => {
    const address = (email || "").trim();
    const called = (name || "").replace(/\s+/g, " ").trim();
    const known = Boolean(session?.first_name) && !called;      // they said who they are in their message: not asked again
    if (email !== undefined && !known && called.length < 2) return "Enter your name.";
    if (email !== undefined && called && !/^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ' -]{0,39}$/.test(called)) return "Enter your name using letters only (spaces, hyphens and apostrophes are fine).";
    if (email !== undefined && !EMAIL.test(address)) return "Enter your email address to continue.";
    setBusy(true);
    try {
      const reply = await retryOnce(() => apiRequest(`/task-sessions/${session.id}/email`, "POST", email === undefined ? {} : { email: address, ...(called ? { name: called } : {}), marketing_consent: Boolean(consent) }));
      rememberName(called || session?.first_name);      // given and accepted: a later flow won't ask again
      keep(reply);
      return "";
    } catch (e) {
      return e?.status === 429 ? "That's a lot of codes. Please try again in a little while." : e?.status === 422 ? "Enter a valid email address." : "Couldn't continue. Try again.";
    } finally {
      setBusy(false);
    }
  }, [retryOnce, session, keep]);
  /** The code is right: signed in (an account is made if there wasn't one) and on to the task, without leaving the page first. */
  const verifyCode = useCallback(async (code) => {
    if (!/^\d{6}$/.test(String(code || "").replace(/\s/g, ""))) return "Enter the 6-digit code from the email.";
    setBusy(true);
    try {
      let zone;
      try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { zone = undefined; }
      const res = await retryOnce(() => apiRequest(`/task-sessions/${session.id}/verify`, "POST", { code: String(code).replace(/\s/g, ""), ...(zone ? { timezone: zone } : {}) }));
      // A new account has no password yet: it is asked for here, then the task carries on. An existing one goes straight on.
      // Held before the sign-in lands, so being signed in doesn't carry the card on past the question.
      if (res.new_account) { passwordHold.current = true; setNewPassword(true); }
      await useAuthStore.getState().tokenLogin(res.access_token, res.email);
      if (res.new_account) return "";
      navigate(startPath(session.id));
      return "";
    } catch (e) {
      return e?.status === 400 || e?.status === 403 ? ((typeof e?.data?.detail === "string" && e.data.detail) || "That code isn't right. Check the email and try again.") : "Couldn't continue. Try again.";
    } finally {
      setBusy(false);
    }
  }, [navigate, retryOnce, session]);
  const [newPassword, setNewPassword] = useState(false);      // a new account, signed in by its code, sets its password
  const passwordHold = useRef(false);
  /** The new account's first password, then on to the task. */
  const setPassword = useCallback(async (password) => {
    const pw = String(password || "");
    if (pw.length < 8) return "Use at least 8 characters.";
    if (pw.length > 72) return "Use 72 characters or fewer.";
    setBusy(true);
    try {
      await apiRequest("/auth/me/set-password", "POST", { new_password: pw });
      useAuthStore.setState({ hasPassword: true });
      passwordHold.current = false;
      setNewPassword(false);
      navigate(startPath(session.id));
      return "";
    } catch (e) {
      if (e?.status === 409) { passwordHold.current = false; setNewPassword(false); navigate(startPath(session.id)); return ""; }      // it has one already: carry on
      return "Couldn't save the password. Try again.";
    } finally {
      setBusy(false);
    }
  }, [navigate, session]);
  const skipPassword = useCallback(() => { passwordHold.current = false; setNewPassword(false); navigate(startPath(session.id)); }, [navigate, session]);
  /** Google: signed in with the Google account, then on to the task. */
  const withGoogle = useCallback(async (credential) => {
    await useAuthStore.getState().googleLogin(credential);
    if (useAuthStore.getState().token) navigate(startPath(session.id));
  }, [navigate, session]);
  // Signed in: the task is the user's at once (the owner's QA, 21 Oct: it stalled at "Here's where you stand", never attached).
  const attached = useRef("");      // once per task, however many cards show it
  const attachUser = useCallback(async () => {
    if (!session?.id || attached.current === session.id) return false;
    attached.current = session.id;
    try { keep(await retryOnce(() => apiRequest(`/task-sessions/${session.id}/attach-user`, "POST", {}, { timeoutMs: 15000 }))); return true; }
    catch { attached.current = ""; return false; }
  }, [session?.id, keep, retryOnce]);
  return { offer, session, busy, pending, resuming, problem, failed, begin, answer, startOver, carryOn, here, closed, setClosed, sendCode, verifyCode, withGoogle,
    newPassword, passwordHold, setPassword, skipPassword, attachUser, go: navigate };
}

/** The launcher on its own: it runs its own flow and shows the task card beneath it. */
// The chat's currency before anything is said (the owner's brief, 20 Oct): the workspace's when signed in, else the visitor's
// country's from the browser's region or time zone; never £ by default for a visitor elsewhere.
// The recap's confirm button, in each check's words (the owner's brief, 20 Oct).
// The recap's rows in plain words (the owner's QA, 21 Oct): never the question text, never "?:".
const RECAP_LABEL = { amount: "Amount", use: "For", stage: "Stage", route: "Route", timing: "When", traction: "Traction", currency: "Currency",
  customer: "For", item: "Item", customer_email: "Email", where: "Where", price: "Price", cost: "Cost", sell: "Selling", description: "Idea" };

const RECAP_OK = { need_funding: "Looks right, check my readiness", launch: "Looks right, check my readiness", test_idea: "Looks right, check my idea",
  price_offer: "Looks right, check my price", more_customers: "Looks right, show my next steps", create_invoice: "Looks right, prepare it",
  create_quotation: "Looks right, prepare it", prepare_proposal: "Looks right, prepare it" };
const REGION_CURRENCY = { NG: "NGN", GB: "GBP", US: "USD", GH: "GHS", KE: "KES", IE: "EUR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR" };
const ZONE_CURRENCY = { "Africa/Lagos": "NGN", "Europe/London": "GBP", "Africa/Accra": "GHS", "Africa/Nairobi": "KES" };
/** Signed in: the workspace, so the server uses its own currency (a kept "GBP" default never reaches a naira workspace). */
function chatWorkspace() {
  try {
    const ws = useWorkspaceStore.getState();
    return ws.workspaceId ? { business_id: ws.workspaceId } : {};
  } catch { return {}; }
}

function chatCurrency() {
  try {
    const ws = useWorkspaceStore.getState();
    if (ws.workspaceId && ws.currency) return ws.currency;
  } catch { /* no workspace: the visitor's */ }
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (ZONE_CURRENCY[zone]) return ZONE_CURRENCY[zone];
    const region = String((navigator.languages || [navigator.language])[0] || "").split("-")[1]?.toUpperCase();
    if (REGION_CURRENCY[region]) return REGION_CURRENCY[region];
    if (zone.startsWith("America/")) return "USD";
    if (zone.startsWith("Europe/")) return "EUR";
  } catch { /* none known */ }
  return undefined;
}

export default function GoalLauncher({ className = "" }) {
  const flow = useGoalFlow();
  return <GoalLauncherView className={className} flow={flow}>{flow.session && <GoalTaskCard key={flow.session.id} flow={flow} placement="inline" />}</GoalLauncherView>;
}

/** The landing page's own conversation, started from what was typed in the Agent card or bar (the owner's QA, 22 Oct:
 *  "no chatting, just this?"): the same questions, the same current data, the same recap and result, never a form. */
export function AgentGoalChat({ text }) {
  const flow = useGoalFlow({ inApp: true });
  // A new chat for each message sent, from what was just said: never an earlier chat picked up from the browser (the
  // owner's QA, 22 Oct: "this is not what I just gave it": the same words again showed the earlier chat's £25k).
  const [mine, setMine] = useState(null);
  const started = useRef(false);
  useEffect(() => {
    if (!text || started.current) return;
    started.current = true;
    flow.startOver();
    flow.begin({ text, entry_mode: "free_text" }).then((ok) => { if (ok) setMine(true); });
  }, []);      // eslint-disable-line react-hooks/exhaustive-deps
  if (!mine || !flow.session) return <p role="status" className="text-[13px] text-slate-500" data-agent-goal-chat-starting>{flow.problem || "One moment…"}</p>;
  return <div data-agent-goal-chat><GoalTaskCard key={flow.session.id} flow={flow} placement="inline" compact /></div>;
}

// What the placeholder types out, one after another, while the field is empty and untouched.
export const EXAMPLES = ["Create an invoice for Mark, $300", "Find grants for my bakery", "Draft a quote for 20 chairs", "Help me price my product"];
const STATIC_EXAMPLE = "For example: create an invoice for ABC Consulting, or I need more customers";
// The Agent's steps as a visitor sees them. Ticked from the real task where there is one.
export const AGENT_STEPS = [];

export const LAUNCHER_PREFILL = "ea:launcher:prefill";
/** Put words in the launcher's field, ready to send (nothing is sent). */
export function prefillLauncher(text) {
  focusLauncher();
  window.dispatchEvent(new CustomEvent(LAUNCHER_PREFILL, { detail: { text } }));
}

/** Brings an element into view by scrolling the page up or down only (never sideways, never an ancestor). */
export function scrollPageTo(el, block = "nearest") {
  if (!el || typeof window.scrollBy !== "function") return;
  const r = el.getBoundingClientRect();
  const h = window.innerHeight || document.documentElement.clientHeight;
  const by = block === "center" ? r.top + r.height / 2 - h / 2 : r.top < 0 ? r.top - 16 : r.bottom > h ? Math.min(r.bottom - h + 16, r.top - 16) : 0;
  if (Math.abs(by) > 1) window.scrollBy({ top: by, left: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/** Scroll the launcher into view and put the cursor in its field (the nav button and the floating pill both do this). */
export function focusLauncher() {
  const field = document.getElementById("goal-prompt");
  if (!field) return;
  scrollPageTo(field.closest("[data-goal-launcher]") || field, "center");
  field.focus({ preventScroll: true });
}

/**
 * The Agent's steps, ticking in turn. `done` is how many are finished (from the real task when there is
 * one); the next one is shown as under way. Used over the product preview while a request is read.
 */
/** The task card while its first question is on its way: the same frame, in the same place, with the Agent typing. */
export function TaskCardShell({ title = "", className = "" }) {
  return (
    <section aria-label="Your task" aria-busy="true" data-task-shell
      className={`flex flex-col overflow-hidden rounded-2xl border-2 border-brand-500 bg-white text-left shadow-2xl shadow-brand-900/10 ring-4 ring-brand-500/10 motion-safe:animate-[ea-fade-in_.2s_ease-out] ${className}`}>
      <header className="shrink-0 border-b border-slate-100 px-4 py-3"><p className="truncate text-base font-bold text-slate-900">{title}</p></header>
      <div className="min-h-0 flex-1 px-4 py-3">
        <div role="status" className="inline-flex w-fit items-center gap-1 rounded-2xl rounded-tl-sm bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-100" data-typing>
          <span className="sr-only">The Agent is typing</span>
          {[0, 1, 2].map((n) => <span key={n} aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-slate-400 motion-safe:animate-bounce" style={{ animationDelay: `${n * 120}ms` }} />)}
        </div>
      </div>
    </section>
  );
}

export function AgentSteps({ done = 0, title = "EnterprateAI", className = "" }) {
  return (
    <div role="status" aria-live="polite" data-agent-steps className={`rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-2xl shadow-brand-900/15 ${className}`}>
      <div className="flex items-center gap-2"><AgentAvatar size={28} working={done < AGENT_STEPS.length} /><p className="text-sm font-bold text-slate-900">{title}</p></div>
      <ol className="mt-3 space-y-2">
        {AGENT_STEPS.map((label, n) => {
          const state = n < done ? "done" : n === done ? "now" : "next";
          return (
            <li key={label} data-step={state} className={`flex items-center gap-2 text-[13px] ${state === "next" ? "text-slate-400" : "font-medium text-slate-800"}`}>
              {state === "done" ? (
                <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-600" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4"><path className="m-check-draw" strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
              ) : state === "now" ? <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-brand-500 border-r-transparent motion-safe:animate-spin" />
                : <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-slate-200" />}
              <span>{label}{state === "done" && <span className="sr-only"> (done)</span>}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** How many of the Agent's steps a task has finished: read once it exists, drafted once its questions are answered. */
export function stepsDone(flow) {
  if (!flow?.session) return 0;
  return flow.session.next === "questions" ? 1 : 2;
}

/** The Agent's launcher: who it is, the field to say what you want, and the suggestions. The page holds the flow (the homepage puts the task card in its other column). */
/** Where a signed-in owner's message goes: the dashboard's Agent card, the one pathway (the owner's choice, 22 Oct). */
export const agentCardPath = (text) => `/dashboard?ask=${encodeURIComponent(String(text || "").slice(0, 500))}`;

export function GoalLauncherView({ className = "", flow, children = null, onWatch = null, onTouch = null }) {
  const { offer, busy, begin } = flow;
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [shake, setShake] = useState(false);
  const [picking, setPicking] = useState(null);      // the chip whose words are on their way into the field
  const field = useRef(null);
  const reduced = useReducedMotion();
  // "Try it yourself" in the demo: its request arrives here, in the field, with the cursor after it.
  useEffect(() => {
    const prefill = (e) => { const words = String(e.detail?.text || ""); if (!words) return; setText(words); field.current?.focus({ preventScroll: true }); };
    window.addEventListener(LAUNCHER_PREFILL, prefill);
    return () => window.removeEventListener(LAUNCHER_PREFILL, prefill);
  }, []);
  const typed = useTypewriter(EXAMPLES, { paused: focused || Boolean(text) || Boolean(picking) || Boolean(flow?.session) });
  const placeholder = reduced || focused || text ? STATIC_EXAMPLE : `${typed}|`;
  // Three goals at a time, moving on every few seconds so all of them get seen. It waits while the
  // pointer or the keyboard is on them, and stays on the chosen goal while its task is open.
  const sets = useMemo(() => goalSets(offer.goals), [offer.goals]);
  const [turn, setTurn] = useState(0);
  const [held, setHeld] = useState(false);
  const [starting, setStarting] = useState(false);      // this box's own Send is working (not the task card's: QA P3)
  const [stopped, setStopped] = useState(false);      // a goal was chosen once: the goals stay put from then on
  const chosen = sets.findIndex((set) => set.some((g) => g.key === flow.session?.goal_key));
  const shown = chosen >= 0 ? chosen : turn % sets.length;
  useEffect(() => {
    // Never moves under the pointer, the keyboard or a finger, while a goal is being started, once one has been, or with reduced motion.
    if (sets.length < 2 || held || chosen >= 0 || stopped || picking || reduced) return undefined;
    const timer = setInterval(() => setTurn((t) => t + 1), GOALS_EVERY_MS);
    return () => clearInterval(timer);
  }, [sets.length, held, chosen, stopped, picking, reduced]);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!text.trim()) {      // nothing typed yet: the button still answers, by pointing at the field
      field.current?.focus({ preventScroll: true });
      setShake(true);
      setTimeout(() => setShake(false), 450);
      return;
    }
    setStarting(true);
    // Exactly as typed: the placeholder's typewriter never reaches the value, and its caret is never sent.
    const goal = text.replace(/\|$/, "").trim();
    // The chat by the side, on this page, signed in or not (the owner's QA, 23 Oct: "you're still jumping into the dashboard
    // before you load the chat by the side"); it asks its questions here, then carries on to the result.
    try { if (await begin({ text: goal, entry_mode: "free_text" })) setText(""); } finally { setStarting(false); }
  }

  /** A chip starts its goal at once: the chip pulses while it starts. Nothing is typed into the field (only the placeholder
   *  ever animates), so what the owner typed is never mixed with a chip's words. */
  const pressed = useRef(null);      // the chip under the pointer at pointerdown: the one a click starts, whatever has rotated since
  async function pick(item, entry_mode) {
    const chip = pressed.current?.item || item;
    const mode = pressed.current?.entry_mode || entry_mode;
    pressed.current = null;
    if (busy || picking) return;
    setStopped(true);
    setPicking(chip.key);
    try { await begin({ key: chip.key, entry_mode: mode }); } finally { setPicking(null); }
  }
  const press = (item, entry_mode) => { pressed.current = { item, entry_mode }; setHeld(true); };

  return (
    <AgentShell className={className} data-goal-launcher
      onPointerDownCapture={(e) => { if (onTouch && !e.target.closest?.("[data-watch-demo]")) onTouch(); }}>
      <div data-launcher-body>
        <AgentIdentity working={busy} subtitle="Tell it the job. It does the work and asks only for what it needs." />

        <form onSubmit={submit} className="mt-4">
          <label htmlFor="goal-prompt" className="block text-base font-bold text-white sm:text-lg">{offer.prompt}</label>
          <div data-prompt-field className={`mt-2 flex h-14 items-center gap-2 rounded-xl border-2 border-white bg-white pl-4 pr-1.5 shadow-lg shadow-indigo-950/30 focus-within:ring-4 focus-within:ring-white/40 ${shake ? "m-shake" : ""}`}>
            <input id="goal-prompt" ref={field} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} readOnly={Boolean(picking)}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder={placeholder}
              className="h-full min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-500" />
            <button type="submit" aria-label="Send" aria-busy={busy || undefined}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white transition hover:bg-brand-700 active:scale-95">
              {starting ? "Working…" : "Send"}
              <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6l6 6-6 6" /></svg>
            </button>
          </div>
        </form>

        {/* Business goals first, in the owner's own words; tasks second, for someone who knows the document they want. */}
        <div className="mt-4" role="group" aria-label="Popular business goals" data-goal-sets={sets.length}
          onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}
          onTouchStart={() => setHeld(true)} onPointerDown={() => setHeld(true)}>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-indigo-100">
            Popular business goals
            {sets.length > 1 && (
              <span aria-hidden="true" className="flex items-center gap-1" data-goal-dots>
                {sets.map((_, n) => <span key={n} className={`h-1.5 w-4 origin-left rounded-full transition duration-500 ${n === shown ? "scale-x-100 bg-white" : "scale-x-[.4] bg-white/50"}`} />)}
              </span>
            )}
          </p>
          {/* Every set sits in the same cell, so the card is as tall as the tallest one and never moves when the goals change. */}
          <div className="mt-1.5 grid">
            {sets.map((set, n) => (
              <div key={n} aria-hidden={n === shown ? undefined : "true"} data-chip-row data-goal-set={n}
                className={`col-start-1 row-start-1 flex flex-wrap content-start gap-2 motion-safe:transition motion-safe:duration-500 ${n === shown ? "opacity-100" : "pointer-events-none invisible translate-y-1 opacity-0"}`}>
                {set.map((g) => (
                  <button key={g.key} type="button" disabled={busy || n !== shown} tabIndex={n === shown ? undefined : -1} data-goal={g.key} onPointerDown={() => press(g, "business_goal")} onClick={() => pick(g, "business_goal")}
                    aria-pressed={flow.session?.goal_key === g.key}
                    className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold transition motion-safe:hover:-translate-y-0.5 lg:max-xl:px-2.5 lg:max-xl:text-[13px] ${picking === g.key ? "m-chip-pulse" : ""} ${n === shown ? "disabled:opacity-70" : ""} ${flow.session?.goal_key === g.key
                      ? "border-white bg-white text-brand-700" : "border-white/40 bg-white/15 text-white hover:border-white/70 hover:bg-white/25"}`}>
                    {g.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3" role="group" aria-label="Or start a task">
          <p className="text-[11px] font-medium text-indigo-100">Or start a task</p>
          <div className="mt-1 flex flex-wrap gap-1.5" data-chip-row>
            {offer.tasks.map((t) => (
              <button key={t.key} type="button" disabled={busy} data-task={t.key} onPointerDown={() => press(t, "quick_task")} onClick={() => pick(t, "quick_task")}
                aria-pressed={flow.session?.goal_key === t.key}
                className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-medium transition disabled:opacity-70 ${picking === t.key ? "m-chip-pulse" : ""} ${flow.session?.goal_key === t.key
                  ? "border-white bg-white text-slate-900" : "border-white/40 bg-transparent text-white hover:border-white/70 hover:bg-white/10"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {/* The bottom row: what you can rely on, and (on the homepage) a 30 second look at the Agent at work. They stack on a phone. */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-launcher-foot>
          <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-[12px] font-medium text-indigo-100" data-trust-row>

          </p>
          {onWatch && (
            <button type="button" data-watch-demo onClick={onWatch} aria-label={`Watch a ${DEMO_SECONDS} second demo of the Agent`}
              className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-white/95 pl-1.5 pr-3.5 text-[13px] font-semibold text-brand-700 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-auto">
              <span aria-hidden="true" className="m-pulse-ring flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-brand-700"><svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M9 7v10l8-5z" /></svg></span>
              Watch it work · {DEMO_SECONDS}s
            </button>
          )}
        </div>
        {flow.session && flow.closed && (
          <button type="button" data-resume onClick={() => flow.setClosed(false)}
            className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 text-left md:hidden">
            <span className="min-w-0 truncate text-sm font-semibold text-brand-900">Carry on: {flow.session.goal_label || flow.session.resolution?.original_goal}</span>
            <span className="shrink-0 text-[13px] font-semibold text-brand-700">Open</span>
          </button>
        )}
        {flow.problem && !flow.session && <p role="alert" className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{flow.problem}</p>}
        {children}
      </div>
    </AgentShell>
  );
}

const half = (f) => f.type === "number" || f.type === "date" || f.type === "choice";

/** One question, compact: text, a longer answer, an amount (with its currency sign and quick amounts), a date, or a choice. */
function Field({ f, value, onChange, at = "card" }) {
  return (
    <div className={half(f) ? "" : "sm:col-span-2"}>
      <label htmlFor={`goal-field-${at}-${f.key}`} className="mb-1 block text-[12px] font-semibold text-slate-700">
        {f.label}{!f.required && <span className="ml-1 font-normal text-slate-400">(optional)</span>}
      </label>
      {f.type === "choice" ? (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={f.label}>
          {[...f.options, ...(f.unsure && !f.options.some((o) => o.value === "unknown") ? [{ value: "unknown", label: f.unsure }] : [])].map((o) => (
            <label key={o.value} className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition ${value === o.value ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-700 hover:border-slate-300"}`}>
              <input type="radio" name={`goal-field-${at}-${f.key}`} className="sr-only" checked={value === o.value} onChange={() => onChange(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      ) : f.type === "textarea" ? (
        <textarea id={`goal-field-${at}-${f.key}`} rows={2} className={inputCls} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <>
          <div className={f.prefix ? "relative" : undefined}>
            {f.prefix && <span data-currency aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">{f.prefix}</span>}
            {f.type === "date" ? <UkDateInput id={`goal-field-${at}-${f.key}`} className={inputCls} value={value ?? ""} onChange={onChange} />
              : <input id={`goal-field-${at}-${f.key}`} className={`${inputCls} ${f.prefix ? "pl-7" : ""}`} inputMode={f.type === "number" ? "decimal" : undefined} type="text"
                value={value ?? ""} onChange={(e) => onChange(e.target.value)} />}
          </div>
          {(f.chips?.length > 0 || f.unsure) && (
            <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label={`Common answers for ${f.label}`}>
              {[...(f.chips || []), ...(f.unsure ? [{ value: "unknown", label: f.unsure }] : [])].map((c) => (
                <button key={c.value} type="button" onClick={() => onChange(c.value)} aria-pressed={String(value) === String(c.value)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${String(value) === String(c.value) ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The goal or task in hand. `placement`:
 *   "column" (the homepage): from 1024px, the right-hand column, laid over the product preview's space
 *     and scrolling inside itself, so the hero never changes height. Below 768px, a full-screen sheet
 *     that slides up, with a close button and its next step always in reach. (Not shown from 768 to 1023.)
 *   "below" (the homepage, 768 to 1023px only): directly under the launcher card, full width; the page scrolls to it.
 *   "inline": in the flow of the page, under the launcher, at every width.
 */
// The result card, loaded when a check's result is shown in the chat itself (the Agent Centre, the dashboard Agent: R-7)

export function GoalTaskCard({ flow, placement = "column", compact = false }) {
  const { session, busy, answer, startOver, carryOn, here, closed, setClosed } = flow;
  // Never "Working…" for more than 10 seconds without saying so.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) { setSlow(false); return undefined; }
    const timer = setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(timer);
  }, [busy]);
  const card = useRef(null);
  const sessionId = session?.id;
  // The page never scrolls during the intake: the card opens where it is, and its thread scrolls inside it.
  // Phone: Back closes the sheet (the task stays saved), as × does.
  useEffect(() => {
    if (placement !== "column" || !sessionId || closed || typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 767px)").matches) return undefined;
    try { window.history.pushState({ ...(window.history.state || {}), eaSheet: sessionId }, ""); } catch { return undefined; }
    const onBack = () => setClosed(true);
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, [placement, sessionId, closed, setClosed]);
  const closeSheet = () => {
    setClosed(true);
    try { if (window.history.state?.eaSheet === sessionId) window.history.back(); } catch { /* the sheet is closed either way */ }
  };
  const [values, setValues] = useState({});
  const [editing, setEditing] = useState(() => new Set());
  const [answeredHere, setAnsweredHere] = useState(() => new Set());
  // The question a reply is being read for: the card stays on it until the server answers (the owner's QA, 17 Oct: the next
  // question showed while the reply was still being read).
  const [awaitingKey, setAwaitingKey] = useState(null);
  // The recap before the hand-off (the owner's brief, 20 Oct): "Here's what I'll use", then [Looks right] or [Change something].
  const [recapOk, setRecapOk] = useState(false);
  const [changingRecap, setChangingRecap] = useState(false);
  const recapDone = recapOk || Boolean(session?.verification?.sent);
  // The risk check moves on only when [Check my risks] is pressed (R-7, R-8, 24 Oct): never by itself after the last answer
  const risky = session?.goal_key === "business_risks";
  const [awaitingText, setAwaitingText] = useState("");      // what was sent, shown at once while it is read      // turns taken in this card (before the server's reply is in)
  useEffect(() => { setAnsweredHere(new Set()); }, [session?.id]);      // said-chips that were clicked: their fields are open to change
  const [currency, setCurrency] = useState(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);      // "Not you? Change": the name field comes back
  const [marketing, setMarketing] = useState(false);    // tips and the newsletter: unticked unless they tick it
  const [code, setCode] = useState("");
  const [changing, setChanging] = useState(false);      // "Change email": back to the address, the task untouched
  // Their name, from this message or from an earlier flow in this browser: asked for only when neither has it.
  const [remembered] = useState(rememberedName);
  const knownName = session?.first_name || remembered;
  const [identityPhase, setIdentityPhase] = useState(() => (knownName ? "email" : "name"));
  const [note, setNote] = useState("");
  const { sendCode, verifyCode, withGoogle, newPassword, setPassword, skipPassword } = flow;
  const [password, setPasswordText] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const sent = !here && Boolean(session?.verification?.sent) && !changing;      // a code is out: the card asks for it (a refresh comes back to this)
  const googleOn = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID || import.meta.env.REACT_APP_GOOGLE_CLIENT_ID);
  const key = `${session?.id}:${session?.goal_key}:${session?.next}`;
  const held = JSON.stringify((session?.questions || []).map((q) => [q.key, q.default]));
  useEffect(() => {      // every reply from the server: the answers it kept are the ones shown
    setValues(Object.fromEntries((session?.questions || []).map((q) => [q.key, q.default ?? ""])));
  }, [held]);      // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {      // every reply: an answer it could not use is said, even the same one twice
    const refused = Object.keys(session?.rejected || {});
    const bad = Object.entries(session?.rejected || {})[0];
    if (bad) { const q = (session?.questions || []).find((x) => x.key === bad[0]); setError(`${q ? q.label : "That answer"} ${bad[1]}`); }
    // An answer the server couldn't use was not given: its question is open again (it was skipped before).
    if (refused.length) setAnsweredHere((had) => new Set([...had].filter((k) => !refused.includes(k))));
  }, [session]);
  useEffect(() => {      // a new step: start from what the server holds
    setValues(Object.fromEntries((session?.questions || []).map((q) => [q.key, q.default ?? ""])));
    setEditing(new Set());
    setCurrency(null);
    setError("");
    setIdentityPhase(session?.first_name || remembered ? "email" : "name");
  }, [key]);      // eslint-disable-line react-hooks/exhaustive-deps

  const res = session?.resolution;
  const questions = session?.questions || [];
  const shownCurrency = currency || session?.currency;
  const sign = { GBP: "£", USD: "$", EUR: "€", NGN: "₦" }[shownCurrency] || "";
  // Given: answered by the person, or read from their own message. A default alone is not an answer.
  const given = (q) => Object.prototype.hasOwnProperty.call(session?.inputs || {}, q.key) || Object.prototype.hasOwnProperty.call(session?.proposed || {}, q.key) || answeredHere.has(q.key);
  // An empty answer is still open, unless it was the question's own "I'll add it later": that was answered, and is not asked again.
  const laterSaid = (q) => Boolean(q.unsure) && Object.prototype.hasOwnProperty.call(session?.inputs || {}, q.key) && (session.inputs[q.key] === "" || session.inputs[q.key] === "unknown");
  const open_ = (q) => !q.hidden && (!given(q) || ((values[q.key] === "" || values[q.key] == null) && !laterSaid(q)));
  const currentQuestion = useMemo(() => {
    const atRecap = ["identity", "prepare"].includes(session?.next);
    if (session?.next !== "questions" && !(atRecap && editing.size)) return null;
    const held = awaitingKey && questions.find((question) => question.key === awaitingKey);
    if (held) return held.prefix && sign ? { ...held, prefix: sign } : held;
    const editedKey = [...editing].find((value) => questions.some((question) => question.key === value));
    // In the order asked (who it is for first), required or not: each one is a turn.
    const fallback = editedKey ? questions.find((question) => question.key === editedKey) : questions.find(open_);
    if (!fallback) return null;
    return fallback.prefix && sign ? { ...fallback, prefix: sign } : fallback;
  }, [session?.next, questions, editing, values, sign, session?.inputs, session?.proposed, answeredHere, awaitingKey]);      // eslint-disable-line react-hooks/exhaustive-deps
  const [draftValue, setDraftValue] = useState("");
  const [typing, setTyping] = useState(false);
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(max-width: 767px)");
    const changed = () => setPhone(media.matches);
    media.addEventListener?.("change", changed);
    return () => media.removeEventListener?.("change", changed);
  }, []);
  useEffect(() => {      // the page behind the sheet does not scroll while it is open
    if (!(placement === "column" && phone && !closed && session)) return undefined;
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = was; };
  }, [placement, phone, closed, session]);
  const [picking, setPicking] = useState(false);      // "Change something": which answer
  const [riskBusy, setRiskBusy] = useState(false);
  // The check done: one short line and a button to the result's own page, never the result in the chat (the owner's brief,
  // 25 Oct), from the landing page, the dashboard's Agent card and the Agent Centre alike
  const [done, setDone] = useState(null);      // { text, cta, to }
  const openPage = (to) => {
    flow.go(to, { state: { from: `${window.location.pathname}${window.location.search}` } });      // its "Back" returns here
    const top = () => { document.querySelector("[data-tour='content-area']")?.scrollTo?.({ top: 0 }); window.scrollTo?.(0, 0); };
    top();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(top);
    setTimeout(top, 80);      // opened at its top
  };
  const checkRisks = async () => {
    const answers = Object.fromEntries(questions.filter((q) => values[q.key] !== "" && values[q.key] != null).map((q) => [q.key, values[q.key]]));
    if (!here && !compact) { setRecapOk(true); await answer(answers, true); return; }      // the landing page signed out: sign in first, then its result page
    setRiskBusy(true);
    try {
      // One request (the owner's brief, 25 Oct: the result in under 5 seconds): the answers kept, the free hand-off, the result
      const out = await apiRequest(`/task-sessions/${session.id}/risk-check`, "POST", { answers }, { timeoutMs: 30000 });
      if (out?.business_id) useWorkspaceStore.getState().setWorkspaceId(out.business_id);
      if (out?.result) setDone(resultLine(out.result, out.session?.handoff, "business_risks"));
    } catch { setError("Your risks couldn't be checked just now. Nothing was lost: try again."); } finally { setRiskBusy(false); }
  };
  // Everything came from the records and nothing was asked: straight on to the result, never a list to confirm first
  // (the owner, 24 Oct: "I need to understand my business risk... you just gave me this"). "Edit answers" on the result changes them.
  const straightOn = useRef("");
  useEffect(() => {
    const rows = session?.summary || [];
    const all = session?.goal_key !== "business_risks" && rows.length > 0 && rows.every((r) => r.from_records || r.key === "currency");
    if (!session?.id || session?.next !== "questions" || currentQuestion || !questions.length || !all || busy || editing.size || straightOn.current === session.id) return;
    straightOn.current = session.id;
    answer(Object.fromEntries(questions.filter((q) => values[q.key] !== "" && values[q.key] != null).map((q) => [q.key, values[q.key]])), true);
  }, [session?.id, session?.next, session?.summary, currentQuestion, questions.length, busy, editing.size]);      // eslint-disable-line react-hooks/exhaustive-deps
  const body = useRef(null);
  const reply = useRef(null);
  const justOpened = useRef(true);      // this task card has just appeared: its first question takes the cursor
  useEffect(() => {
    if (!currentQuestion || prefersReducedMotion()) { setTyping(false); return undefined; }
    setTyping(true);
    const timer = setTimeout(() => setTyping(false), 300 + Math.floor(Math.random() * 300));
    return () => clearTimeout(timer);
  }, [currentQuestion?.key]);      // eslint-disable-line react-hooks/exhaustive-deps
  // The conversation so far: each question already answered, with the answer under it (tap to change it).
  const shownValue = (q, v) => (v === "unknown" ? (q.unsure || "Not sure") : q.type === "date" && ukDate(v) ? ukDate(v) : q.type === "choice" ? (q.options.find((o) => String(o.value) === String(v))?.label || String(v))
    : q.prefix && v !== "" && !Number.isNaN(Number(v)) ? `${sign || q.prefix}${Number(v).toLocaleString("en-GB")}` : String(v));
  useEffect(() => {      // each turn: the newest question in view inside the card, and the cursor back in the reply box
    if (typing) return;
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
    const here = card.current;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    // Only when the person is in the card (or nowhere), or has just started this task from the launcher (QA R12c):
    // the cursor is never taken from somewhere else on the page.
    const fromLauncher = Boolean(here && active?.closest?.("[data-goal-launcher]")) && !here.contains(active) && justOpened.current;
    if (reply.current && here && (!active || active === document.body || here.contains(active) || fromLauncher)) {
      reply.current.focus({ preventScroll: true });
      justOpened.current = false;
    }
  }, [typing, currentQuestion?.key, session]);      // eslint-disable-line react-hooks/exhaustive-deps
  // What came from their first message is shown once, in the "From what you said" line, never as a reply here (QA P5-1).
  const fromMessage = new Set((session?.summary || []).filter((r) => r.from_message || r.proposed).map((r) => r.key));
  const thread = questions.filter((q) => q.key !== currentQuestion?.key && values[q.key] !== "" && values[q.key] != null && given(q) && !fromMessage.has(q.key));
  const [changingSaid, setChangingSaid] = useState(false);
  useEffect(() => {
    if (!currentQuestion) { setDraftValue(""); return; }
    // An empty box for each new question (G4, 23 Oct: the last answer stayed in it); the current answer only when the owner
    // asked to change that one.
    const changing = editing.has(currentQuestion.key);
    // (the question's own default, "1" for a quantity, is still offered as a suggestion: QA P2-3)
    const kept = changing ? (values[currentQuestion.key] || session?.inputs?.[currentQuestion.key] || "") : (currentQuestion.default ?? "");
    setDraftValue(kept === "unknown" ? "" : kept);      // "not known" is never typed back into the box
  }, [currentQuestion?.key, currentQuestion?.default]);      // eslint-disable-line react-hooks/exhaustive-deps
  const step = session?.next;
  useEffect(() => { if (step !== "identity") { setRecapOk(false); setChangingRecap(false); } }, [step]);
  const turn = session?.agent_turn || null;
  const ackLine = turn ? turn.ack : thread.length === 0 ? session?.acknowledged : "";
  // The thread as it happened (the server's turns): each message as typed, then the Agent's one reply. The newest reply is
  // the bubble with the next question; nothing is made up for a slot the Agent never asked about.
  const said_turns = Array.isArray(session?.turns) ? session.turns : null;
  // The server's word on what is still open wins (the owner's QA, 17 Oct): a reply it didn't keep ("what do you think") is
  // asked again, so the card reopens that question instead of moving on to the next one.
  useEffect(() => {
    const last = [...(said_turns || [])].reverse().find((t) => t.role === "assistant");
    const k = last?.next;
    if (!k) return;
    const kept = session?.inputs?.[k];
    if (kept !== undefined && kept !== null && kept !== "") return;      // kept: nothing to reopen
    setValues((v) => (v[k] !== undefined && v[k] !== "" ? { ...v, [k]: "" } : v));
    setAnsweredHere((had) => { if (!had.has(k)) return had; const next = new Set(had); next.delete(k); return next; });
  }, [said_turns]);      // eslint-disable-line react-hooks/exhaustive-deps
  const lastAgent = said_turns && said_turns.length && said_turns[said_turns.length - 1].role === "assistant" ? said_turns[said_turns.length - 1] : null;
  const past = said_turns ? (lastAgent ? said_turns.slice(0, -1) : said_turns) : null;
  const agentLine = lastAgent && currentQuestion && lastAgent.next === currentQuestion.key ? lastAgent.content : null;
  const recapStep = step === "identity" || (here && step === "prepare");
  // A change asked for at the recap (the owner's QA, 21 Oct): that one question again, with its chips and the composer.
  const reasking = recapStep && Boolean(currentQuestion);
  const askingNow = step === "questions" || reasking;
  const said = (session?.summary || []).filter((r) => (recapStep ? true : r.proposed || r.from_message));
  // The whole conversation stays on screen (the owner's brief, 20 Oct): asked, answered, recapped, never replaced.
  const keepThread = ["questions", "identity", "prepare", "currency"].includes(step);
  const allTurns = step === "questions" ? past : said_turns;
  const shownTurns = compact && allTurns?.[0]?.role === "user" ? allTurns.slice(1) : allTurns;
  const chosen = session?.goal_label && step !== "none" && step !== "clarify" ? session.goal_label : res?.original_goal;
  const open = (k) => setEditing((s) => new Set(s).add(k));

  const recapOkRef = useRef(null);
  const [fixText, setFixText] = useState("");
  // A correction typed at the recap: read against every answer, nothing set up or charged (the owner's QA, 21 Oct).
  const sendFix = () => {
    const text = fixText.trim();
    if (!text || busy) return;
    setFixText("");
    setAwaitingText(text);
    Promise.resolve(answer({}, false, { message: text, asked: null })).finally(() => setAwaitingText(""));
  };
  const recapRows = said.filter((r) => r.key !== "currency");      // what the recap would list: the currency alone is nothing to check
  const recapShown = recapStep && !reasking && recapRows.length > 0 && !recapDone && !risky;      // the risk check: [Check my risks], never a list
  // "Here's what I'll use:" only above the recap itself (the owner's brief, 25 Oct: never an empty step); a change said at the
  // recap keeps its "Got it, ..." without it
  const RECAP_LINE = /\s*Here's what I'll use(?::| now\.)\s*$/;
  const threadTurns = ((reasking ? said_turns : shownTurns) || [])
    .map((t, i, all) => (t.role === "assistant" && RECAP_LINE.test(t.content || "") && !(recapShown && i === all.length - 1) ? { ...t, content: String(t.content).replace(RECAP_LINE, "") } : t))
    .filter((t) => t.role !== "assistant" || String(t.content || "").trim());
  // What "Looks right" will change on the funding case, said in the recap itself (the owner's QA, 21 Oct: one confirmation,
  // never a second "I'll update your funding case" screen), in the chat's own words.
  const [caseChanges, setCaseChanges] = useState([]);
  const changesKey = recapShown && here && session?.goal_key === "need_funding" ? `${session.id}:${JSON.stringify(session.inputs || {})}` : "";
  useEffect(() => {
    if (!changesKey) { setCaseChanges([]); return undefined; }
    let live = true;
    apiRequest(`/task-sessions/${session.id}/case-changes`, "GET").then((r) => { if (live) setCaseChanges(r?.changes || []); }).catch(() => {});
    return () => { live = false; };
  }, [changesKey]);      // eslint-disable-line react-hooks/exhaustive-deps
  // "Change something": its rows brought into view (the owner's QA, 21 Oct).
  useEffect(() => {
    if (!changingRecap) return;
    const rows = typeof document !== "undefined" ? document.querySelector("[data-recap-rows]") : null;
    rows?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [changingRecap]);
  useEffect(() => {
    // The newest turn or card in view: the card's own thread scrolled to its end (the page itself stays where it is).
    const go = () => { if (body.current) body.current.scrollTop = body.current.scrollHeight; };
    go();
    const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(go) : null;
    return () => { if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame); };
    // also while a reply is read and when the next question arrives (the owner's QA, 21 Oct: "I shouldn't have to scroll")
  }, [shownTurns?.length, recapShown, step, awaitingText, currentQuestion?.key, ackLine, busy, Boolean(done)]);      // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (recapShown) recapOkRef.current?.focus({ preventScroll: true });
  }, [recapShown]);
  const attaching = useRef(false);
  useEffect(() => {
    // Signed in, the questions done: the task is attached to the user here (never left awaiting an email), then the recap.
    if (here && step === "identity" && session && !session.authenticated && !newPassword && !attaching.current) {
      attaching.current = true;
      flow.attachUser?.().finally(() => { attaching.current = false; });
    }
  }, [here, step, session?.authenticated, newPassword]);      // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // The recap first, signed in too (the owner's brief, 20 Oct): "Here's what I'll use", then on only after "Looks right".
    const recapped = recapDone || (!risky && !(session?.summary || []).some((r) => r.key !== "currency"));
    if (here && recapped && (step === "identity" || (step === "prepare" && session?.authenticated)) && !newPassword && !flow.passwordHold?.current) carryOn();
  }, [here, step, carryOn, newPassword, recapDone]);      // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) return null;
  if (here && (step === "identity" || step === "prepare") && !newPassword && (recapDone || (!risky && !(session?.summary || []).some((r) => r.key !== "currency")))) return null;      // signed in, recap confirmed: on to the task

  function submitQuestion(nextValue = draftValue, typed = nextValue === draftValue) {
    const activeQuestion = currentQuestion;
    if (!activeQuestion) return;
    let answerValue = nextValue ?? "";
    const asTyped = typed && typeof answerValue === "string" ? answerValue.trim() : "";
    if (activeQuestion.required && (answerValue === "" || answerValue == null)) {
      setError(`${activeQuestion.label} is required.`);
      return;
    }
    // A price written with its currency ("$300", "300 USD"): the currency goes with it, to be confirmed, never dropped for £.
    const writtenIn = activeQuestion.prefix ? currencyIn(answerValue) : null;
    if (activeQuestion.type === "number" && answerValue !== "unknown" && answerValue !== "") {
      const figure = numberIn(answerValue);
      // Digits are read here; words ("about sixty", "standard rate") go to the server, which reads them (QA H) or says why not.
      if (figure != null) answerValue = figure;
    }
    const nextValues = { ...values, [activeQuestion.key]: answerValue };
    setValues(nextValues);
    if (editing.has(activeQuestion.key)) setEditing((had) => { const next = new Set(had); next.delete(activeQuestion.key); return next; });
    setError("");
    // Only what was given goes back: a default nobody confirmed is not sent as an answer (QA P2-3).
    const answers = Object.fromEntries(questions.filter((question) => nextValues[question.key] !== "" && nextValues[question.key] != null
      && (question.key === activeQuestion.key || given(question))).map((question) => [question.key, nextValues[question.key]]));
    if (currency && currency !== session.currency) answers.currency = currency;
    if (writtenIn && writtenIn !== (currency || session.currency || "GBP")) answers.currency_said = writtenIn;
    const chipWords = !asTyped ? [...(activeQuestion.options || []), ...(activeQuestion.chips || [])].find((o) => String(o.value) === String(nextValue))?.label
      || (nextValue === "unknown" ? activeQuestion.unsure || "Not sure" : "") : "";
    setDraftValue("");      // cleared on send, whatever was sent (the owner's brief, 20 Oct)
    // Every answer, typed or picked, is read first: the card moves on to the next question only once the server has kept it
    // (the owner's QA, 21 Oct: a picked answer showed the next question while it was still "Working…").
    setAwaitingKey(activeQuestion.key);
    setAwaitingText(asTyped || chipWords || String(nextValue ?? ""));
    Promise.resolve(answer(answers, questions.some((question) => question.proposed),
      asTyped ? { message: asTyped, asked: activeQuestion.key } : chipWords ? { picked: chipWords, asked: activeQuestion.key } : null)).then((ok) => {
      if (ok !== false) setAnsweredHere((had) => new Set([...had, activeQuestion.key]));      // never advanced on a failure
    }).finally(() => { setAwaitingKey(null); setAwaitingText(""); });
  }

  function submit(e) {
    e?.preventDefault();
    if (askingNow) {      // a question, or one asked again at the recap
      submitQuestion();
    } else if (step === "identity") {
      setNote("");
      if (newPassword) { setPassword(password).then(setError); return; }
      if (here) { setError(carryOn()); return; }
      if (sent) { verifyCode(code).then(setError); return; }
      if (identityPhase === "name") {
        if (!name.trim()) { setError("By the way, what's your name?"); return; }
        if (!/^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ' -]{0,39}$/.test(name.replace(/\s+/g, " ").trim())) {
          setError("Enter your name using letters only (spaces, hyphens and apostrophes are fine).");
          return;
        }
        setError("");
        setIdentityPhase("email");
        return;
      }
      if (!email.trim() || !EMAIL.test(email)) { setError("Simple - what's your email address?"); return; }
      sendCode(email, renaming ? name : session.first_name ? "" : (name.trim() || knownName), marketing).then((problem) => { setError(problem); if (!problem) { setChanging(false); setCode(""); } });
    }
  }
  const resend = () => { setError(""); sendCode(undefined).then((problem) => { setError(problem); setNote(problem ? "" : "A new code is on its way. The last one no longer works."); }); };

  const boxed = "rounded-2xl border-2 border-brand-500 bg-white shadow-xl shadow-brand-900/10 ring-4 ring-brand-500/10";
  // Compact (in the Agent card): at most this height (the owner's QA, 22 Oct: "this height is okay, with scrollbar"), only
  // as tall as what it holds below that; more than fits scrolls inside, with its scrollbar, never growing the card
  const shell = placement === "inline" ? `relative ${compact ? "mt-0 flex max-h-[200px]" : "mt-4 flex max-h-[80vh]"} flex-col ${boxed}`
    : placement === "below" ? `relative mt-4 hidden max-h-[80vh] scroll-mt-20 flex-col md:flex lg:hidden ${boxed}`
    // Under 768px: a full-screen sheet. From 1024px: the right-hand column, where the product preview was, never taller than the hero.
    : `${closed ? "max-md:hidden" : "max-md:flex"} flex-col bg-white max-md:fixed max-md:inset-0 max-md:z-[70] max-md:motion-safe:animate-[ea-sheet-up_.22s_ease-out] md:hidden `
      + "lg:absolute lg:inset-y-0 lg:left-6 lg:right-0 lg:z-10 lg:flex lg:rounded-2xl lg:border-2 lg:border-brand-500 lg:shadow-2xl lg:shadow-brand-900/10 lg:ring-4 lg:ring-brand-500/10 lg:motion-safe:animate-[ea-fade-in_.2s_ease-out]";
  const primary = step === "questions" ? "Send" : step === "identity" && (recapDone || said.length === 0) && !(here && !newPassword) ? (newPassword ? "Save and continue" : "Send") : null;

  const sheet = (
    <section ref={card} aria-label="Your task" data-task-card data-placement={placement} className={`text-left ${shell}`}>
      {!compact && (
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-slate-900" data-chosen title={chosen}>{chosen}</p>
          {res.original_goal && res.original_goal !== chosen && <p className="mt-0.5 truncate text-[12px] text-slate-400" title={res.original_goal}>You asked: {res.original_goal}</p>}
          {res.execution_boundary && <p className="mt-0.5 text-[11.5px] text-slate-400" data-boundary>{res.execution_boundary}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={startOver} className="pt-0.5 text-[12px] font-semibold text-brand-700 underline-offset-2 hover:underline">
            {step === "none" ? "Ask for something else" : "Change goal"}
          </button>
          {placement === "column" && (
            // Phone: close the sheet. The task stays saved, and the launcher offers the way back to it.
            <button type="button" onClick={closeSheet} aria-label="Close (your task is kept)" data-sheet-close className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 md:hidden">
              <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </header>
      )}

      {placement === "column" && step !== "none" && (
        <ol aria-label="What the Agent is doing" data-task-steps className="hidden shrink-0 items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2 lg:flex lg:flex-wrap">
          {AGENT_STEPS.map((label, n) => {
            const finished = n < stepsDone(flow);
            return (
              <li key={label} data-step={finished ? "done" : n === stepsDone(flow) ? "now" : "next"} className={`flex items-center gap-1.5 text-[12px] ${finished ? "font-semibold text-emerald-700" : n === stepsDone(flow) ? "font-semibold text-slate-800" : "text-slate-400"}`}>
                {finished ? <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6"><path className="m-check-draw" strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
                  : <span aria-hidden="true" className={`h-2 w-2 rounded-full ${n === stepsDone(flow) ? "bg-brand-500" : "bg-slate-300"}`} />}
                {label}
              </li>
            );
          })}
        </ol>
      )}
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div ref={body} className={`min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 ${compact ? "[scrollbar-gutter:stable]" : ""}`} data-task-body>
          {!compact && (
            <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <p className="min-w-0 flex-1 text-[13px] font-medium text-slate-800" data-says>{session.value_line || res.message}</p>
            </div>
          )}
          {res.recommended_path?.length > 1 && (
            <p data-path className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-900">
              Your result comes straight after the questions, and starting is free.
            </p>
          )}

          {step === "clarify" && session.clarify && (
            // One question, answered with one tap (PRD s8.2.2).
            <div className="flex flex-wrap gap-2" role="group" aria-label={session.clarify.label} data-clarify>
              {session.clarify.options.map((o) => (
                <button key={o.value} type="button" disabled={busy} onClick={() => answer({ goal_key: o.value })}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60 ${o.value === "other"
                    ? "border-slate-200 bg-white text-slate-600 hover:border-slate-300" : "border-brand-200 bg-brand-50 text-brand-800 hover:border-brand-400 hover:bg-brand-100"}`}>
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {step === "choose" && session.choose && (
            // A plan is already on record: answered here as a quick reply (the owner's QA, 15 Oct), the likely answer
            // marked ("Start a new launch plan" when the offering differs). Nothing is written until one is picked.
            <div className="space-y-2" role="group" aria-label={session.choose.label} data-choose>
              <p className="text-[14px] text-slate-800">{session.choose.label}</p>
              <div className="flex flex-wrap gap-2">
                {session.choose.options.map((o) => {
                  const likely = String(o.value) === String(session.choose.default ?? "");
                  return (
                    <button key={o.value} type="button" disabled={busy} data-choice={o.value} aria-pressed={likely}
                      onClick={() => answer({ subject_choice: o.value }, false, { picked: o.label, asked: "subject_choice" })}
                      className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60 ${likely
                        ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {false && step === "questions" && said.length > 0 && (
            // Removed from the thread (the owner's brief, 20 Oct): the recap before the hand-off shows what will be used.
            // What was read from their own sentence: one compact line, shown once (QA P5-1). "Edit" lists each, to pick the one to change.
            <SaidLine items={said.map((r) => ({ key: r.key, text: r.key === "currency" ? shownCurrency : r.value }))} editing={changingSaid}
              onEdit={() => setChangingSaid(true)}>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Change what you said">
                {said.filter((r) => r.key !== "currency" || session.currency_options?.length > 0).map((r) => (
                  <button key={r.key} type="button" data-said-change={r.key} aria-pressed={editing.has(r.key)}
                    onClick={() => { open(r.key); setChangingSaid(false); }}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-800 hover:border-brand-300">
                    {r.label.replace(/\?$/, "")}: {r.key === "currency" ? shownCurrency : r.value}
                  </button>
                ))}
                <button type="button" onClick={() => setChangingSaid(false)} className="text-[12px] font-semibold text-slate-500 hover:underline">Done</button>
              </div>
            </SaidLine>
          )}
          {keepThread && threadTurns.length > 0 && (
            <ol className="space-y-2" aria-label="The conversation so far" data-thread>
              {threadTurns.map((t, n) => (
                <li key={n} data-turn={t.role}>
                  {t.role === "user"
                    ? <p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand-600 px-3 py-1.5 text-left text-[13px] font-medium text-white" data-user-says>{t.content}</p>
                    : <p className="w-fit max-w-[90%] rounded-2xl rounded-tl-sm bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-800 shadow-sm ring-1 ring-slate-100">{t.content}</p>}
                </li>
              ))}
            </ol>
          )}
          {recapShown && (
            // One recap card before anything is set up, the last thing in the thread, under "Here's where you stand" (the owner's
            // QA, 21 Oct: it rendered at the top and had to be scrolled to).
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" data-recap>
              {/* Said once (the owner's QA, 21 Oct): the chat's last line already says "Here's what I'll use:". */}
              {!String([...(said_turns || [])].reverse().find((t) => t.role === "assistant")?.content || "").includes("what I'll use") && (
                <p className="text-[13px] font-semibold text-slate-900">Here's what I'll use:</p>
              )}
              <p className="mt-1 text-[13px] leading-5 text-slate-700" data-recap-line>
                {said.filter((r) => r.key !== "currency").map((r) => r.value).join(" · ")}
              </p>
              {caseChanges.length > 0 && (
                <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700" data-recap-case-changes>
                  <p className="font-semibold text-slate-900">This updates your funding case:</p>
                  <ul className="mt-1 space-y-0.5">
                    {caseChanges.map((c) => <li key={c.field}>{c.field}: {c.before === "Not set" ? c.now : `${c.before} to ${c.now}`}</li>)}
                  </ul>
                </div>
              )}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button type="button" ref={recapOkRef} disabled={busy} onClick={() => { setRecapOk(true); setChangingRecap(false); if (here) setError(carryOn()); }} data-recap-ok
                  className="rounded-lg bg-[#1F5BFF] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#1747CC] disabled:opacity-60">
                  {RECAP_OK[session.goal_key] || "Looks right, carry on"}
                </button>
                <button type="button" onClick={() => setChangingRecap((v) => !v)} aria-expanded={changingRecap} data-recap-change
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:border-brand-300">Change something</button>
              </div>
              {changingRecap && (
                <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100" role="group" aria-label="Change something" data-recap-rows>
                  {said.filter((r) => r.key !== "currency" || session.currency_options?.length > 0).map((r) => (
                    <li key={r.key} className="flex items-center gap-3 px-3 py-2 text-[13px]" data-recap-row={r.key}>
                      <span className="w-20 shrink-0 text-slate-500">{RECAP_LABEL[r.key] || String(r.label || r.key).replace(/[?.:]+$/, "")}</span>
                      <span className="min-w-0 flex-1 break-words font-medium text-slate-900">{r.key === "currency" ? shownCurrency : r.value}</span>
                      <button type="button" data-said-chip={r.key} onClick={() => { open(r.key); setChangingRecap(false); }}
                        className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-[12px] font-semibold text-slate-700 hover:border-brand-300">Change</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === "identity" && said.length > 0 && recapDone && (
            // After the recap, at the sign-in: what will be saved, a chip each.
            <div data-said>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">What you told me</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {said.map((r) => <span key={r.key} data-said-chip={r.key} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-semibold text-slate-800">{r.key === "currency" ? shownCurrency : r.value}</span>)}
              </div>
            </div>
          )}
          {step === "questions" && !past && thread.length > 0 && (
            <ol className="space-y-2" aria-label="The conversation so far" data-thread>
              {thread.map((q) => (
                <li key={q.key} className="space-y-1">
                  <p className="w-fit max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-50 px-3 py-1.5 text-[12px] text-slate-600 ring-1 ring-slate-100">{q.label}</p>
                  <button type="button" onClick={() => open(q.key)} aria-label={`Change your answer: ${shownValue(q, values[q.key])}`} data-answer={q.key}
                    className="ml-auto block w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-600 px-3 py-1.5 text-left text-[13px] font-medium text-white hover:bg-brand-700">
                    {shownValue(q, values[q.key])}
                  </button>
                </li>
              ))}
            </ol>
          )}

          {askingNow && currentQuestion && typing && (
            <p role="status" aria-label="EnterprateAI is typing" data-typing className="flex w-fit gap-1 rounded-2xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-100">
              {[0, 1, 2].map((n) => <span key={n} aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-slate-400 motion-safe:animate-bounce" style={{ animationDelay: `${n * 120}ms` }} />)}
            </p>
          )}

          {["questions", "identity", "prepare"].includes(step) && !currentQuestion && questions.length > 0 && risky && !done && (!recapOk || compact || here) && (
            // The risk check: one press, no list to confirm (R-6). In the Agent Centre and the dashboard Agent the result is shown
            // here, never a jump to another page (R-7).
            <div className="flex flex-wrap items-center gap-3" data-risk-check-go>
              <button type="button" disabled={busy || riskBusy} onClick={checkRisks} data-check-my-risks
                className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{riskBusy ? "Checking your risks…" : "Check my risks"}</button>
            </div>
          )}
          {done && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3 text-left" data-result-line>
              <p className="text-[13px] font-semibold text-slate-900">{done.text}</p>
              {done.to && done.cta && (
                <button type="button" onClick={() => openPage(done.to)} data-view-result
                  className="mt-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">{done.cta}</button>
              )}
            </div>
          )}
          {step === "questions" && !currentQuestion && questions.length > 0 && session?.goal_key !== "business_risks" && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3" data-summary>
              <p className="text-[13px] font-semibold text-slate-900">Here's what I've got:</p>
              <ul className="mt-1.5 space-y-0.5">
                {(session.summary || []).filter((r) => r.key !== "currency").map((r) => {
                  const q = questions.find((x) => x.key === r.key) || {};
                  return <li key={r.key} className="text-[13px] text-slate-700"><span className="text-slate-500">{q.noun ? q.noun[0].toUpperCase() + q.noun.slice(1) : r.label}:</span> {r.value}{r.from_records ? <span className="text-slate-400" data-from-records> ({r.source ? r.source.toLowerCase() : "from your records"})</span> : null}</li>;
                })}
              </ul>
              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <button type="button" disabled={busy} onClick={() => answer(Object.fromEntries(questions.filter((q) => values[q.key] !== "" && values[q.key] != null).map((q) => [q.key, values[q.key]])), true)}
                  className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">Continue</button>
                <button type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking} className="text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline">Change something</button>
              </div>
              {picking && (
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Which answer to change" data-change-pick>
                  {/* Every question, so what is missing can be added too (the owner, 24 Oct: "change something is not working well") */}
                  {questions.filter((q) => !q.hidden).map((q) => {
                    const has = values[q.key] !== "" && values[q.key] != null && values[q.key] !== "unknown";
                    const name = q.noun ? q.noun[0].toUpperCase() + q.noun.slice(1) : q.label;
                    return (
                      <button key={q.key} type="button" onClick={() => { setPicking(false); open(q.key); }} data-change-key={q.key}
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-700 hover:border-brand-300">
                        {has ? name : `Add: ${name.toLowerCase()}`}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {askingNow && currentQuestion && !typing && (
            <div className="space-y-2" data-question-turn aria-live="polite">
              {/* One acknowledgement per answer, in the Agent's own bubble: what it captured (the last turn's, or what it read
                  from the first message), an answer to anything the owner asked, then the question, or a check to confirm. */}
              <div className="w-fit max-w-[90%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-[13px] leading-5 text-slate-800 shadow-sm ring-1 ring-slate-100" data-agent-says>
                {agentLine ? <span data-agent-line>{agentLine}</span> : <>
                  {turn?.answer ? <span className="block text-slate-700" data-agent-answer>{turn.answer}</span> : null}
                  {ackLine ? <span className="block text-slate-500" data-acknowledged>{ackLine}</span> : null}
                  {turn?.confirm?.[0]?.slot === currentQuestion.key ? turn.confirm[0].question : currentQuestion.label}
                </>}
              </div>
              {awaitingKey && awaitingText && (
                <>
                  <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-600 px-3 py-2 text-[13px] font-semibold text-white" data-sending>{awaitingText}</div>
                  <p role="status" className="text-[12px] text-slate-500" data-reading>Reading your reply…</p>
                </>
              )}
              {currentQuestion.type === "choice" ? (
                <div className="flex flex-wrap gap-2" role="group" aria-label={currentQuestion.label} data-question-choice>
                  {[...currentQuestion.options, ...(currentQuestion.unsure && !currentQuestion.options.some((o) => o.value === "unknown") ? [{ value: "unknown", label: currentQuestion.unsure }] : [])].map((o) => (
                    <button key={o.value} type="button" disabled={busy} onClick={() => submitQuestion(o.value, false)} data-quick-reply
                      className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60 ${String(draftValue) === String(o.value) ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
              ) : (
                // One input only, the composer at the bottom (the owner's brief, 20 Oct): the quick replies sit under the question.
                <div>
                  {(currentQuestion.chips?.length > 0 || currentQuestion.unsure) && (
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label={currentQuestion.label}>
                      {[...(currentQuestion.chips || []), ...(currentQuestion.unsure ? [{ value: "unknown", label: currentQuestion.unsure }] : [])].map((chip) => (
                        <button key={chip.value} type="button" disabled={busy} onClick={() => submitQuestion(chip.value, false)} data-quick-reply
                          className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold transition ${String(draftValue) === String(chip.value) ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-slate-50 text-slate-700 hover:border-brand-300"}`}>
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* No "2 of 6" counter under the chat (the owner, 23 Oct: "no need") */}
          {step === "identity" && (recapDone || said.length === 0) && !(here && !newPassword) && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3" data-checkpoint>
              <div className="space-y-2" data-identity-turn>
                <div className="rounded-2xl bg-white px-3 py-2 text-[13px] leading-5 text-slate-800 shadow-sm ring-1 ring-slate-100">
                  {newPassword ? "You're in. Set a password so you can sign in with it next time."
                    : sent ? <>I sent a code to <span data-masked>{session.verification.masked}</span>.</>
                    : here ? "I already have your account. Let’s keep going."
                      : identityPhase === "name" ? "What name should I use for this?" : "What email should I send the code to?"}
                </div>
                {newPassword ? (
                  <div className="rounded-xl border border-white bg-white p-3 shadow-sm" data-password-step>
                    <div className="relative">
                      <input type={showPassword ? "text" : "password"} aria-label="New password" placeholder="At least 8 characters" autoComplete="new-password" maxLength={72}
                        value={password} onChange={(e) => setPasswordText(e.target.value)} className={`${inputCls} pr-16`} />
                      <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-brand-700">{showPassword ? "Hide" : "Show"}</button>
                    </div>
                    <button type="button" disabled={busy} onClick={skipPassword} className="mt-2 text-[12px] font-semibold text-slate-500 underline-offset-2 hover:underline" data-skip-password>Skip for now</button>
                  </div>
                ) : sent ? (
                  <div data-code-step>
                    {googleOn && session.verification.google && (
                      <div className="mt-2" data-google-first>
                        <GoogleSignInButton disabled={busy} onCredential={withGoogle} />
                        <p className="mt-1.5 text-center text-[11px] text-slate-500">or enter the code we emailed you</p>
                      </div>
                    )}
                    <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={7} aria-label="6-digit code" placeholder="6-digit code" value={code}
                      onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, ""))} className={`${inputCls} mt-2 tracking-[0.3em]`} />
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      <button type="button" disabled={busy} onClick={resend} className="text-[12px] font-semibold text-brand-700 underline-offset-2 hover:underline disabled:opacity-60">Resend code</button>
                      <button type="button" onClick={() => { setChanging(true); setCode(""); setError(""); setNote(""); }} className="text-[12px] font-semibold text-brand-700 underline-offset-2 hover:underline">Change email</button>
                    </div>
                    {note && <p role="status" className="mt-1.5 text-[11px] text-slate-600">{note}</p>}
                  </div>
                ) : identityPhase === "name" ? (
                  <div className="rounded-xl border border-white bg-white p-3 shadow-sm">
                    {knownName && !renaming ? (
                      <p className="text-[13px] font-semibold text-slate-900" data-continue-as>
                        I'll use {knownName}.
                        <button type="button" onClick={() => { setRenaming(true); setIdentityPhase("name"); }} className="ml-2 text-[12px] font-semibold text-brand-700 underline-offset-2 hover:underline">Change</button>
                      </p>
                    ) : (
                      <input type="text" aria-label="Your name" placeholder="Your name" autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-white bg-white p-3 shadow-sm">
                    {knownName && !renaming && (
                      <p className="mb-2 text-[13px] font-semibold text-slate-900" data-continue-as>
                        I'll use {knownName}.
                        <button type="button" onClick={() => { setRenaming(true); setIdentityPhase("name"); }} className="ml-2 text-[12px] font-semibold text-brand-700 underline-offset-2 hover:underline">Change</button>
                      </p>
                    )}
                    <input type="email" aria-label="Your email address" placeholder="you@yourbusiness.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
                    <p className="mt-1 text-[11px] text-slate-500">I'll email a 6-digit code so I can keep the task moving.</p>
                    <label className="mt-2 flex items-start gap-2 text-[12px] text-slate-600" data-marketing>
                      <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300" />
                      <span>Send me tips, product updates and the EnterprateAI newsletter. Unsubscribe any time.</span>
                    </label>
                    {googleOn && (
                      <div className="mt-2" data-google>
                        <p className="mb-1.5 text-center text-[11px] text-slate-400">or</p>
                        <GoogleSignInButton disabled={busy} onCredential={withGoogle} />
                      </div>
                    )}
                  </div>
                )}
              </div>
              {!here && <p className="mt-1.5 text-[11px] text-slate-500" data-retention>Kept for {session.retention_days} days, and picked up as soon as you're in.</p>}
            </div>
          )}
        </div>

        {flow.failed && (
          <div className="mx-4 space-y-1.5" data-turn-failed>
            {flow.failed.text && <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-[#1F5BFF]/10 px-3 py-2 text-[14px] text-slate-800" data-unsent>{flow.failed.text}</p>}
            <p role="alert" className="flex flex-wrap items-center justify-end gap-2 text-[13px] text-rose-700">That didn't go through.
              <button type="button" disabled={busy} onClick={() => flow.failed.retry()} className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 font-semibold text-rose-700 hover:bg-rose-50">Try again</button></p>
          </div>
        )}
        {error && <p role="alert" className="mx-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

        {/* Always in reach, however long the card: the one next step, and the way out. */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-b-2xl border-t border-slate-100 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" data-task-footer>
          {askingNow && currentQuestion ? (
            <div className="flex w-full items-center gap-2" data-composer>
              {currentQuestion.prefix
                ? <span className="min-w-0 flex-1"><MoneyInput aria-label={currentQuestion.label} value={draftValue} currency={shownCurrency} onChange={setDraftValue} className={`${inputCls} w-full`} /></span>
                : currentQuestion.type === "date"
                ? <UkDateInput aria-label={currentQuestion.label} value={draftValue} onChange={setDraftValue} className={`${inputCls} flex-1`} />
                : <input ref={reply} aria-label={currentQuestion.label} placeholder={currentQuestion.type === "choice" ? "Pick one above, or type your reply" : "Type your reply"}
                    value={!reasking && [...(currentQuestion.options || []), ...(currentQuestion.chips || [])].some((o) => String(o.value) === String(draftValue)) ? "" : draftValue}
                    onChange={(e) => setDraftValue(e.target.value)}
                    inputMode={currentQuestion.type === "number" ? "decimal" : undefined} type="text" className={`${inputCls} min-w-0 flex-1`} />}
              <button type="submit" disabled={busy} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#1F5BFF] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1747CC] disabled:opacity-60">
                <span>{busy ? (slow ? "Still working…" : "Working…") : "Send"}</span>
                {!busy && <ArrowRightIcon />}
              </button>
            </div>
          ) : recapShown ? (
            <div className="flex w-full items-center gap-2" data-composer data-recap-composer>
              <input aria-label="Change something in your own words" placeholder="Or type what to change" value={fixText}
                onChange={(e) => setFixText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendFix(); } }}
                type="text" className={`${inputCls} min-w-0 flex-1`} />
              <button type="button" disabled={busy || !fixText.trim()} onClick={sendFix}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">Send</button>
            </div>
          ) : (<>
          <div className="flex items-center gap-3">
            <button type="button" onClick={startOver} className="text-[13px] font-medium text-slate-500 hover:text-slate-700">{step === "none" ? "Ask for something else" : "Start again"}</button>
            {step === "identity" && !here && !sent && !newPassword && <button type="button" onClick={() => setError(carryOn())} className="text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline">Sign in with a password</button>}
          </div>
          {primary && (
            <button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1F5BFF] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#1747CC] disabled:opacity-60">
              <span>{busy ? (slow ? "Still working…" : "Working…") : primary}</span>
              {!busy && <ArrowRightIcon />}
            </button>
          )}
          </>)}
        </footer>
      </form>
    </section>
  );
  // Below 768px the card is a full-screen sheet. It is put on the page's body, so no animated parent (the hero's
  // slide-in leaves a translate behind, which traps fixed elements) can shrink or clip it; the page behind it stays still.
  return placement === "column" && phone && !closed ? createPortal(sheet, document.body) : sheet;
}
