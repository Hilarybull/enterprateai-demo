import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuthStore } from "../store/auth";
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
    { key: "need_funding", label: "I need funding" }, { key: "more_customers", label: "I need more customers" },
    { key: "price_offer", label: "Help me price my product/service" }, { key: "launch", label: "I want to launch a product/service" },
    { key: "cash_flow", label: "Improve my cash flow" }, { key: "grow", label: "Help me grow my business" },
    { key: "test_idea", label: "Test a business idea" }, { key: "business_risks", label: "Help me understand my business risks" },
  ],
  tasks: [
    { key: "create_invoice", label: "Create Invoice" }, { key: "create_quotation", label: "Create Quotation" },
    { key: "create_business_plan", label: "Create Business Plan" }, { key: "prepare_proposal", label: "Prepare Proposal" },
  ],
  retention_days: 7,
};
const SESSION_KEY = "ea_task_session";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
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

/** The goal flow: what is offered, the task in hand, and what can be done with it. Shared by the launcher and the task card. */
export function useGoalFlow() {
  const navigate = useNavigate();
  const [offer, setOffer] = useState(FALLBACK);
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const authToken = useAuthStore((st) => st.token);
  const authEmail = useAuthStore((st) => st.email) || localStorage.getItem("ea_email");
  const [closed, setClosed] = useState(false);      // phone: the sheet was closed with × or Back; the task is kept and can be reopened
  const here = Boolean(authToken) && authEmail !== "demo";
  const sessionKey = here && authEmail ? `${SESSION_KEY}:${authEmail.toLowerCase()}` : `${SESSION_KEY}:anon`;
  useEffect(() => {
    let alive = true;
    apiRequest("/goal-suggestions", "GET").then((res) => { if (alive && res?.goals) setOffer(res); }).catch(() => {});
    try {
      if (!sessionStorage.getItem("ea_goal_viewed")) { sessionStorage.setItem("ea_goal_viewed", "1"); trackGoal("homepage_goal_prompt_viewed"); }
    } catch { trackGoal("homepage_goal_prompt_viewed"); }
    // A task begun earlier in this browser is picked up where it was left.
    setSession(null);
    let saved = null;
    try { saved = localStorage.getItem(sessionKey); } catch { /* fine without it */ }
    if (saved) {
      apiRequest(`/task-sessions/${saved}`, "GET")
        .then((res) => { if (alive && res?.id && res.resolution && !["handed_off", "awaiting_review", "abandoned", "blocked"].includes(res.state)) setSession({ ...res, questions: res.questions || [] }); })
        .catch(() => { try { localStorage.removeItem(sessionKey); } catch { /* ignore */ } });
    }
    return () => { alive = false; };
  }, [sessionKey]);
  const keep = useCallback((next) => {
    if (!next?.id || !next.resolution) throw new Error("Not a task session");      // an empty or broken reply is a failure, said as one
    setSession({ ...next, questions: next.questions || [] });
    setClosed(false);
    try { localStorage.setItem(sessionKey, next.id); } catch { /* fine without it */ }
  }, [sessionKey]);
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
    trackGoal("entry_mode_selected", { entry_mode: body.entry_mode, ...(body.key ? { key: body.key } : {}) });
    try {
      keep(await retryOnce(() => apiRequest("/task-sessions", "POST", body)));
      return true;
    } catch (e) {
      setProblem(e?.status === 429 ? "That's a lot of tasks started from here. Please try again in a little while." : "Couldn't continue. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, keep, retryOnce]);
  const answer = useCallback(async (answers, confirm = false) => {
    if (!session) return;
    setBusy(true);
    setProblem("");
    try {
      keep(await retryOnce(() => apiRequest(`/task-sessions/${session.id}/inputs`, "POST", confirm ? { answers, confirm: true } : { answers })));
    } catch {
      setProblem("Couldn't continue. Try again.");
    } finally {
      setBusy(false);
    }
  }, [session, keep, retryOnce]);
  const startOver = useCallback(() => {
    setSession(null);
    setProblem("");
    try { localStorage.removeItem(sessionKey); } catch { /* ignore */ }
  }, [sessionKey]);
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
      keep(await retryOnce(() => apiRequest(`/task-sessions/${session.id}/email`, "POST", email === undefined ? {} : { email: address, ...(called ? { name: called } : {}), marketing_consent: Boolean(consent) })));
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
      await useAuthStore.getState().tokenLogin(res.access_token, res.email);
      navigate(startPath(session.id));
      return "";
    } catch (e) {
      return e?.status === 400 || e?.status === 403 ? ((typeof e?.data?.detail === "string" && e.data.detail) || "That code isn't right. Check the email and try again.") : "Couldn't continue. Try again.";
    } finally {
      setBusy(false);
    }
  }, [navigate, retryOnce, session]);
  /** Google: signed in with the Google account, then on to the task. */
  const withGoogle = useCallback(async (credential) => {
    await useAuthStore.getState().googleLogin(credential);
    if (useAuthStore.getState().token) navigate(startPath(session.id));
  }, [navigate, session]);
  return { offer, session, busy, problem, begin, answer, startOver, carryOn, here, closed, setClosed, sendCode, verifyCode, withGoogle };
}

/** The launcher on its own: it runs its own flow and shows the task card beneath it. */
export default function GoalLauncher({ className = "" }) {
  const flow = useGoalFlow();
  return <GoalLauncherView className={className} flow={flow}>{flow.session && <GoalTaskCard flow={flow} placement="inline" />}</GoalLauncherView>;
}

// What the placeholder types out, one after another, while the field is empty and untouched.
export const EXAMPLES = ["Create an invoice for Mark, $300", "Find grants for my bakery", "Draft a quote for 20 chairs", "Help me price my product"];
const STATIC_EXAMPLE = "For example: create an invoice for ABC Consulting, or I need more customers";
// The Agent's steps as a visitor sees them. Ticked from the real task where there is one.
export const AGENT_STEPS = ["Reading your request", "Drafting the document", "Ready for your approval"];

export const LAUNCHER_PREFILL = "ea:launcher:prefill";
/** Put words in the launcher's field, ready to send (nothing is sent). */
export function prefillLauncher(text) {
  focusLauncher();
  window.dispatchEvent(new CustomEvent(LAUNCHER_PREFILL, { detail: { text } }));
}

/** Scroll the launcher into view and put the cursor in its field (the nav button and the floating pill both do this). */
export function focusLauncher() {
  const field = document.getElementById("goal-prompt");
  if (!field) return;
  const card = field.closest("[data-goal-launcher]") || field;
  card.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  field.focus({ preventScroll: true });
}

/**
 * The Agent's steps, ticking in turn. `done` is how many are finished (from the real task when there is
 * one); the next one is shown as under way. Used over the product preview while a request is read.
 */
export function AgentSteps({ done = 0, title = "EnterprateAI Agent", className = "" }) {
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
    const prefill = (e) => { const words = String(e.detail?.text || ""); if (!words) return; setText(words); field.current?.focus(); };
    window.addEventListener(LAUNCHER_PREFILL, prefill);
    return () => window.removeEventListener(LAUNCHER_PREFILL, prefill);
  }, []);
  const typed = useTypewriter(EXAMPLES, { paused: focused || Boolean(text) || Boolean(picking) });
  const placeholder = reduced || focused || text ? STATIC_EXAMPLE : `${typed}|`;
  // Three goals at a time, moving on every few seconds so all of them get seen. It waits while the
  // pointer or the keyboard is on them, and stays on the chosen goal while its task is open.
  const sets = useMemo(() => goalSets(offer.goals), [offer.goals]);
  const [turn, setTurn] = useState(0);
  const [held, setHeld] = useState(false);
  const chosen = sets.findIndex((set) => set.some((g) => g.key === flow.session?.goal_key));
  const shown = chosen >= 0 ? chosen : turn % sets.length;
  useEffect(() => {
    if (sets.length < 2 || held || chosen >= 0) return undefined;
    const timer = setInterval(() => setTurn((t) => t + 1), GOALS_EVERY_MS);
    return () => clearInterval(timer);
  }, [sets.length, held, chosen]);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!text.trim()) {      // nothing typed yet: the button still answers, by pointing at the field
      field.current?.focus();
      setShake(true);
      setTimeout(() => setShake(false), 450);
      return;
    }
    if (await begin({ text: text.trim(), entry_mode: "free_text" })) setText("");
  }

  /** A chip: its words run into the field, then it starts. With reduced motion it starts at once. */
  function pick(item, entry_mode) {
    if (busy || picking) return;
    const start = () => begin({ key: item.key, entry_mode });
    if (reduced) { start(); return; }
    setPicking(item.key);
    const words = item.label;
    let n = 0;
    const each = Math.max(8, Math.floor(DURATION.base / Math.max(1, words.length)));
    const timer = setInterval(() => {
      n += 1;
      setText(words.slice(0, n));
      if (n >= words.length) { clearInterval(timer); setTimeout(async () => { await start(); setText(""); setPicking(null); }, DURATION.fast); }
    }, each);
  }

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
            <button type="submit" aria-label="Start" aria-busy={busy || undefined}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white transition hover:bg-brand-700 active:scale-95">
              {busy ? "Working…" : "Start"}
              <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6l6 6-6 6" /></svg>
            </button>
          </div>
        </form>

        {/* Business goals first, in the owner's own words; tasks second, for someone who knows the document they want. */}
        <div className="mt-4" role="group" aria-label="Popular business goals" data-goal-sets={sets.length}
          onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
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
                  <button key={g.key} type="button" disabled={busy || n !== shown} tabIndex={n === shown ? undefined : -1} data-goal={g.key} onClick={() => pick(g, "business_goal")}
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
              <button key={t.key} type="button" disabled={busy} data-task={t.key} onClick={() => pick(t, "quick_task")}
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
            <span>No sign up to start</span><span aria-hidden="true">·</span><span>Nothing is sent without your approval</span>
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
          {f.options.map((o) => (
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
            <input id={`goal-field-${at}-${f.key}`} className={`${inputCls} ${f.prefix ? "pl-7" : ""}`} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
              step={f.type === "number" ? "0.01" : undefined} min={f.type === "number" ? "0" : undefined} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
          </div>
          {f.chips?.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label={`Common answers for ${f.label}`}>
              {f.chips.map((c) => (
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
export function GoalTaskCard({ flow, placement = "column" }) {
  const { session, busy, answer, startOver, carryOn, here, closed, setClosed } = flow;
  const card = useRef(null);
  const sessionId = session?.id;
  // Tablet: the card opens under the launcher and the page moves to it (smoothly, unless reduced motion is asked for).
  useEffect(() => {
    if (placement !== "below" || !sessionId || !card.current?.offsetParent) return;
    const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.current.scrollIntoView?.({ behavior: calm ? "auto" : "smooth", block: "nearest" });
  }, [placement, sessionId]);
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
  const [editing, setEditing] = useState(() => new Set());      // said-chips that were clicked: their fields are open to change
  const [currency, setCurrency] = useState(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);      // "Not you? Change": the name field comes back
  const [marketing, setMarketing] = useState(false);    // tips and the newsletter: unticked unless they tick it
  const [code, setCode] = useState("");
  const [changing, setChanging] = useState(false);      // "Change email": back to the address, the task untouched
  const [note, setNote] = useState("");
  const { sendCode, verifyCode, withGoogle } = flow;
  const sent = !here && Boolean(session?.verification?.sent) && !changing;      // a code is out: the card asks for it (a refresh comes back to this)
  const googleOn = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID || import.meta.env.REACT_APP_GOOGLE_CLIENT_ID);
  const key = `${session?.id}:${session?.goal_key}:${session?.next}`;
  useEffect(() => {      // a new step: start from what the server holds
    setValues(Object.fromEntries((session?.questions || []).map((q) => [q.key, q.default ?? ""])));
    setEditing(new Set());
    setCurrency(null);
    setError("");
  }, [key]);      // eslint-disable-line react-hooks/exhaustive-deps

  const res = session?.resolution;
  const questions = session?.questions || [];
  const shownCurrency = currency || session?.currency;
  const sign = { GBP: "£", USD: "$", EUR: "€", NGN: "₦" }[shownCurrency] || "";
  const fields = useMemo(() => questions.filter((q) => !q.proposed || editing.has(q.key)).map((q) => (q.prefix && sign ? { ...q, prefix: sign } : q)), [questions, editing, sign]);

  const step = session?.next;
  const said = (session?.summary || []).filter((r) => (step === "identity" ? true : r.proposed));
  const chosen = session?.goal_label && step !== "none" && step !== "clarify" ? session.goal_label : res?.original_goal;
  const open = (k) => setEditing((s) => new Set(s).add(k));

  useEffect(() => {
    if (here && step === "identity") carryOn();
  }, [here, step, carryOn]);

  if (!session) return null;
  if (here && step === "identity") return null;

  function submit(e) {
    e?.preventDefault();
    if (step === "questions") {
      const missing = questions.find((q) => q.required && (values[q.key] === "" || values[q.key] == null));
      if (missing) { if (missing.proposed) open(missing.key); setError(`${missing.label} is required.`); return; }
      setError("");
      const answers = Object.fromEntries(fields.filter((f) => values[f.key] !== "" && values[f.key] != null).map((f) => [f.key, values[f.key]]));
      if (currency && currency !== session.currency) answers.currency = currency;
      answer(answers, questions.some((q) => q.proposed));      // sending it confirms what was read from their sentence
    } else if (step === "identity") {
      setNote("");
      if (here) { setError(carryOn()); return; }
      if (sent) { verifyCode(code).then(setError); return; }
      sendCode(email, renaming || !session.first_name ? name : "", marketing).then((problem) => { setError(problem); if (!problem) { setChanging(false); setCode(""); } });
    }
  }
  const resend = () => { setError(""); sendCode(undefined).then((problem) => { setError(problem); setNote(problem ? "" : "A new code is on its way. The last one no longer works."); }); };

  const boxed = "rounded-2xl border-2 border-brand-500 bg-white shadow-xl shadow-brand-900/10 ring-4 ring-brand-500/10";
  const shell = placement === "inline" ? `relative mt-4 flex max-h-[80vh] flex-col ${boxed}`
    : placement === "below" ? `relative mt-4 hidden max-h-[80vh] scroll-mt-20 flex-col md:flex lg:hidden ${boxed}`
    // Under 768px: a full-screen sheet. From 1024px: the right-hand column, where the product preview was, never taller than the hero.
    : `${closed ? "max-md:hidden" : "max-md:flex"} flex-col bg-white max-md:fixed max-md:inset-0 max-md:z-[70] max-md:motion-safe:animate-[ea-sheet-up_.22s_ease-out] md:hidden `
      + "lg:absolute lg:left-6 lg:right-0 lg:top-10 lg:z-10 lg:flex lg:max-h-[calc(100%-2.5rem)] lg:rounded-2xl lg:border-2 lg:border-brand-500 lg:shadow-2xl lg:shadow-brand-900/10 lg:ring-4 lg:ring-brand-500/10 lg:motion-safe:animate-[ea-slide-in_.3s_ease-out]";
  const primary = step === "questions" ? "Continue" : step === "identity" ? "Continue" : null;

  return (
    <section ref={card} aria-label="Your task" data-task-card data-placement={placement} className={`text-left ${shell}`}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-slate-900" data-chosen title={chosen}>{chosen}</p>
          {res.original_goal && res.original_goal !== chosen && <p className="mt-0.5 truncate text-[12px] text-slate-400" title={res.original_goal}>You asked: {res.original_goal}</p>}
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
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-task-body>
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <p className="min-w-0 flex-1 text-[13px] font-medium text-slate-800" data-says>{res.message}</p>
            {res.credit_badge && step !== "none" && step !== "clarify" && (
              <span data-credit-badge title={res.credit_implication || undefined} className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{res.credit_badge}</span>
            )}
          </div>
          {res.execution_boundary && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900" data-boundary role="note">
              <InfoIcon /><span>{res.execution_boundary}</span>
            </p>
          )}
          {res.recommended_path?.length > 1 && (
            <div data-path>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Here is how I can help</p>
              <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {res.recommended_path.map((s, i) => (
                  <li key={s} className="flex items-center gap-1.5 text-[12px] text-slate-700">
                    <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">{i + 1}</span>
                    <span data-step>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
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

          {(step === "questions" || step === "identity") && said.length > 0 && (
            // What was read from their own sentence (or, at the checkpoint, everything given): a chip each, open to change with a click.
            <div data-said>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{step === "identity" ? "What you told me" : "From what you said"}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {said.map((r) => {
                  const canEdit = step === "questions" && (r.key !== "currency" || session.currency_options?.length > 0);
                  const label = `${r.label.replace(/\?$/, "")}: ${r.key === "currency" ? shownCurrency : r.value}`;
                  return canEdit ? (
                    <button key={r.key} type="button" data-said-chip={r.key} aria-label={`Change ${label}`} aria-pressed={editing.has(r.key)} onClick={() => open(r.key)}
                      className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold transition ${editing.has(r.key) ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-slate-50 text-slate-800 hover:border-brand-300"}`}>
                      {r.key === "currency" ? shownCurrency : r.value}
                    </button>
                  ) : (
                    <span key={r.key} data-said-chip={r.key} title={label} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-semibold text-slate-800">{r.key === "currency" ? shownCurrency : r.value}</span>
                  );
                })}
              </div>
              {session.currency_note && step === "questions" && !editing.has("currency") && <p className="mt-1 text-[11px] text-slate-500" data-currency-note>In {shownCurrency}.</p>}
            </div>
          )}

          {step === "questions" && (fields.length > 0 || editing.has("currency")) && (
            // Only what is missing (and anything opened to change), two to a row where it fits.
            <div className={`grid gap-3 sm:grid-cols-2 ${placement === "column" ? "lg:max-xl:grid-cols-1" : ""}`} data-fields>
              {fields.map((f) => <Field key={f.key} at={placement} f={f} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />)}
              {editing.has("currency") && session.currency_options?.length > 0 && (
                <Field at={placement} f={{ key: "currency", label: "Currency", type: "choice", required: true, options: session.currency_options.map((c) => ({ value: c, label: c })) }}
                  value={shownCurrency} onChange={setCurrency} />
              )}
            </div>
          )}

          {step === "identity" && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3" data-checkpoint>
              <p className="text-sm font-semibold text-slate-900">
                {sent ? <>We sent a code to <span data-masked>{session.verification.masked}</span>.</>
                  : here ? "Continue to carry on." : "To continue, verify your email."}
              </p>
              {sent ? (
                // The code is asked for right here: nobody is sent to another page to prove an address.
                <div data-code-step>
                  {googleOn && session.verification.google && (
                    // A Google address: one tap with Google is the quickest way in. The code below works just as well.
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
              ) : (
                <>
                  {session.first_name && !renaming && (
                    // They said who they are in their message, so the name isn't asked for again.
                    <p className="mt-2 text-[13px] font-semibold text-slate-900" data-continue-as>
                      Continue as {session.first_name}
                      <button type="button" onClick={() => setRenaming(true)} className="ml-2 text-[12px] font-semibold text-brand-700 underline-offset-2 hover:underline">Not you? Change</button>
                    </p>
                  )}
                  <div className={`mt-2 grid gap-2 ${session.first_name && !renaming ? "" : "sm:grid-cols-2"}`}>
                    {(!session.first_name || renaming) && (
                      <input type="text" aria-label="Your name" placeholder="Your name" autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                    )}
                    <input type="email" aria-label="Your email address" placeholder="you@yourbusiness.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">We'll email you a 6-digit code. No password needed.</p>
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
                </>
              )}
              {!here && <p className="mt-1.5 text-[11px] text-slate-500" data-retention>Kept for {session.retention_days} days, and picked up as soon as you're in.</p>}
            </div>
          )}
        </div>

        {error && <p role="alert" className="mx-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

        {/* Always in reach, however long the card: the one next step, and the way out. */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-b-2xl border-t border-slate-100 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" data-task-footer>
          <div className="flex items-center gap-3">
            <button type="button" onClick={startOver} className="text-[13px] font-medium text-slate-500 hover:text-slate-700">{step === "none" ? "Ask for something else" : "Start again"}</button>
            {step === "identity" && !here && !sent && <button type="button" onClick={() => setError(carryOn())} className="text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline">Sign in with a password</button>}
          </div>
          {primary && (
            <button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1F5BFF] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#1747CC] disabled:opacity-60">
              <span>{busy ? "Working…" : primary}</span>
              {!busy && <ArrowRightIcon />}
            </button>
          )}
        </footer>
      </form>
    </section>
  );
}